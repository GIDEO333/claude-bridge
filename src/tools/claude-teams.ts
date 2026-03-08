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
            contractFirst: {
                type: "boolean",
                description: "If true, enables Contract-First Protocol: the first agent writes an API contract to the mailbox before other agents begin coding. Prevents import/export mismatches. Default: false.",
            },
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
    contractFirst: z.boolean().optional().default(false),
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
    const isContractFirst = args.contractFirst;
    const allRoles = args.agents.map((a) => a.role);

    for (let i = 0; i < args.agents.length; i++) {
        const agent = args.agents[i];
        const isFirstAgent = i === 0;

        // Contract-First Protocol instructions
        const contractProtocol = isContractFirst ? [
            isFirstAgent
                ? `CONTRACT PHASE: Before writing any code, you MUST first create the file ${args.mailboxPath}/${agent.role}-CONTRACT.md.`
                  + ` In this file, list every function you will export with: name, parameters (with types), return type, and a one-line description.`
                  + ` Example format: '- addTask(task: {title: string, description?: string}): Task — Adds a new task, returns the created task with generated id (string).'`
                  + ` After writing the contract, proceed with implementation.`
                : `CONTRACT PHASE: Before writing any code, you MUST read ALL *-CONTRACT.md files in ${args.mailboxPath}/.`
                  + ` These files define the exact API contracts written by other agents.`
                  + ` Respect them EXACTLY — use the same function names, parameter types, and return types.`
                  + ` If there is no contract file yet, write ${args.mailboxPath}/ESCALATION.md saying 'Waiting for contract' and STOP.`,
        ].join(" ") : "";

        const ownershipInfo = [
            `=== AGENT IDENTITY ===`,
            `You are the ${agent.role} agent in a multi-agent team.`,
            `Team members: ${allRoles.join(", ")}.`,
            ``,
            `=== FILE OWNERSHIP ===`,
            `You OWN these paths (only write to these): ${agent.owns.join(", ")}.`,
            `FORBIDDEN from writing to: ${agent.forbidden.length > 0 ? agent.forbidden.join(", ") : "none"}.`,
            ``,
            contractProtocol ? `=== CONTRACT PROTOCOL ===\n${contractProtocol}\n` : "",
            `=== MAILBOX COMMUNICATION ===`,
            `Mailbox directory: ${args.mailboxPath}`,
            `Read ALL files in mailbox before starting work — other agents may have left contracts or messages.`,
            `To send a message to another agent, write a file: ${args.mailboxPath}/${agent.role}-to-{RECIPIENT_ROLE}.md`,
            `  Example: ${args.mailboxPath}/${agent.role}-to-${allRoles.find((r) => r !== agent.role) ?? "other"}.md`,
            `  Use this for: reporting what you exported, asking for clarification, signaling readiness.`,
            ``,
            `=== COMPLETION SIGNALS ===`,
            `When done: write ${args.mailboxPath}/${agent.role}-DONE.md with a summary of what you built.`,
            `If stuck 3x on same error: write ${args.mailboxPath}/ESCALATION.md describing the issue, then STOP.`,
            ``,
            `=== PROJECT CONTEXT ===`,
            `Follow all constraints in CLAUDE.md at ${args.claudeMdPath}.`,
            `If .docs/ directory exists in the project, read relevant files there for library API reference.`,
        ].filter(Boolean).join("\n");

        const fullPrompt = `${ownershipInfo}\n\n=== YOUR TASK ===\n${agent.spawnPrompt}`;
        const cmdArgs = ["--dangerously-skip-permissions", "-p", fullPrompt];

        const processId = processManager.spawn(
            claudePath, cmdArgs, process.cwd(), teamEnv, args.timeoutMs
        );

        processIds.push(processId);
        roles.push(agent.role);

        // Contract-First: non-first agents wait 15s to give contract writers a head start
        if (isContractFirst && !isFirstAgent && i < args.agents.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 15000));
        }
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
