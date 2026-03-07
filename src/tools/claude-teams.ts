import { z } from "zod";

export const toolDefinition = {
    name: "claude_agent_teams",
    description: "Launch Claude Agent Teams with Mode 1 (Scatter-Gather) or Mode 2 (Reflection). Spawns multiple agents with file ownership constraints and starts mailbox monitoring.",
    inputSchema: {
        type: "object" as const,
        properties: {
            mode: { type: "string", enum: ["1", "2"], description: "1 = Scatter-Gather, 2 = Reflection" },
            agents: {
                type: "string",
                description: "JSON array of agent objects. Each object must have: role (string), owns (string[]), forbidden (string[]), spawnPrompt (string). Example: [{\"role\":\"frontend\",\"owns\":[\"src/components/\"],\"forbidden\":[\"src/api/\"],\"spawnPrompt\":\"Build UI\"}]",
            },
            claudeMdPath: { type: "string", description: "Path to CLAUDE.md file" },
            mailboxPath: { type: "string", description: "Path to .agent-teams/mailbox/ directory" },
            timeoutMs: { type: "number", description: "Timeout in milliseconds (default: 600000)" },
        },
        required: ["mode", "agents", "claudeMdPath", "mailboxPath"],
    },
};

import { mkdir, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { processManager } from "../process-manager.js";
import { startMonitoring, stopMonitoring, getSignals } from "../file-monitor.js";

const agentConfigSchema = z.object({
    role: z.string(),
    owns: z.array(z.string()),
    forbidden: z.array(z.string()),
    spawnPrompt: z.string(),
});

export const claudeTeamsSchema = z.object({
    mode: z.union([z.literal(1), z.literal(2), z.literal("1"), z.literal("2")]).transform((val) => Number(val) as 1 | 2),
    agents: z.string().transform((val) => {
        const parsed = JSON.parse(val);
        return z.array(agentConfigSchema).min(1).parse(parsed);
    }),
    claudeMdPath: z.string(),
    mailboxPath: z.string(),
    timeoutMs: z.number().positive().default(600000),
});

const SIGNAL_DIR = join(homedir(), ".claude-bridge");
const SIGNAL_PATH = join(SIGNAL_DIR, "active-team.json");

/**
 * Write live agent status to ~/.claude-bridge/active-team.json
 * so claude-bridge-monitor extension can read it directly.
 */
async function writeTeamStatus(
    processIds: string[],
    roles: string[],
    mode: number,
    mailboxPath: string,
): Promise<void> {
    try {
        const agents = processIds.map((id, i) => {
            try {
                const status = processManager.getStatus(id);
                return { ...status, role: roles[i] };
            } catch {
                return {
                    processId: id,
                    role: roles[i],
                    status: "exited" as const,
                    exitCode: undefined,
                    uptime: 0,
                    lastOutputLine: "",
                    mailboxSignals: [],
                    stuckDetection: false,
                };
            }
        });

        await writeFile(SIGNAL_PATH, JSON.stringify({
            timestamp: Date.now(),
            mode,
            agents,
            mailboxPath,
        }, null, 2));
    } catch {
        // Non-critical write failure
    }
}

export async function executeClaudeTeams(args: z.infer<typeof claudeTeamsSchema>) {
    const claudePath = process.env.CLAUDE_CLI_PATH || "claude";
    const processIds: string[] = [];

    // Ensure directories exist
    try { await mkdir(args.mailboxPath, { recursive: true }); } catch { /* */ }
    try { await mkdir(SIGNAL_DIR, { recursive: true }); } catch { /* */ }

    // Build environment variables
    const teamEnv: NodeJS.ProcessEnv = {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
    };

    // Spawn each agent
    const roles: string[] = [];
    for (const agent of args.agents) {
        const ownershipInfo = [
            `You are ${agent.role}.`,
            `You OWN these paths (only write here): ${agent.owns.join(", ")}.`,
            `FORBIDDEN from writing to: ${agent.forbidden.join(", ")}.`,
            `Before coding, read .agent-teams/mailbox/ for messages.`,
            `When done, write completion signal to .agent-teams/mailbox/${agent.role}-DONE.md.`,
            `If stuck 3x on same error, write .agent-teams/mailbox/ESCALATION.md and STOP.`,
            `Follow all constraints in CLAUDE.md.`,
        ].join(" ");

        const fullPrompt = `${ownershipInfo}\n\nTASK:\n${agent.spawnPrompt}`;
        const cmdArgs = ["--dangerously-skip-permissions", "-p", fullPrompt];

        const processId = processManager.spawn(
            claudePath, cmdArgs, process.cwd(), teamEnv, args.timeoutMs
        );

        processIds.push(processId);
        roles.push(agent.role);
    }

    // Write initial status immediately
    await writeTeamStatus(processIds, roles, args.mode, args.mailboxPath);

    // Start continuous status writer (every 1 second)
    const statusInterval = setInterval(() => {
        void writeTeamStatus(processIds, roles, args.mode, args.mailboxPath);
    }, 1000);

    // Stop writing when all agents have exited
    const checkDone = setInterval(() => {
        const allExited = processIds.every((id) => {
            try {
                const s = processManager.getStatus(id);
                return s.status === "exited";
            } catch { return true; }
        });
        if (allExited) {
            // Write final status then stop
            void writeTeamStatus(processIds, roles, args.mode, args.mailboxPath);
            clearInterval(statusInterval);
            clearInterval(checkDone);
        }
    }, 2000);

    // Start file monitoring on mailbox
    let monitoringActive = false;
    try {
        startMonitoring(args.mailboxPath, args.agents.length, {
            onEscalation: (filePath, content) => {
                console.error(`[claude-teams] ESCALATION detected: ${filePath}`);
                console.error(`[claude-teams] Content: ${content.substring(0, 500)}`);
            },
            onDone: (agentName, filePath, _content) => {
                console.error(`[claude-teams] Agent ${agentName} completed: ${filePath}`);
            },
            onMessage: (from, to, filePath, _content) => {
                console.error(`[claude-teams] Message from ${from} to ${to}: ${filePath}`);
            },
            onAllDone: (doneFiles) => {
                console.error(`[claude-teams] ALL agents completed! Files: ${doneFiles.join(", ")}`);
                stopMonitoring().catch(() => { });
            },
        });
        monitoringActive = true;
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`[claude-teams] Failed to start monitoring: ${errMsg}`);
    }

    const modeLabel = args.mode === 1 ? "Scatter-Gather" : "Reflection";
    const agentNames = args.agents.map((a) => a.role).join(", ");

    return {
        success: true,
        output: `Mode ${args.mode} (${modeLabel}) launched with ${args.agents.length} agents: [${agentNames}]. Monitoring mailbox at ${args.mailboxPath}.`,
        processIds,
        mailboxPath: args.mailboxPath,
        monitoringActive,
        signals: getSignals(),
    };
}
