import { z } from "zod";
import { mkdir } from "fs/promises";
import { processManager } from "../process-manager.js";
import { startMonitoring, stopMonitoring, getSignals } from "../file-monitor.js";

const agentConfigSchema = z.object({
    role: z.string(),
    owns: z.array(z.string()),
    forbidden: z.array(z.string()),
    spawnPrompt: z.string(),
});

export const claudeTeamsSchema = z.object({
    mode: z.union([z.literal(1), z.literal(2)]),
    agents: z.array(agentConfigSchema).min(1),
    claudeMdPath: z.string(),
    mailboxPath: z.string(),
    timeoutMs: z.number().positive().default(600000),
});

export async function executeClaudeTeams(args: z.infer<typeof claudeTeamsSchema>) {
    const claudePath = process.env.CLAUDE_CLI_PATH || "claude";
    const processIds: string[] = [];

    // Ensure mailbox directory exists
    try {
        await mkdir(args.mailboxPath, { recursive: true });
    } catch {
        // Directory may already exist
    }

    // Build environment variables
    const teamEnv: NodeJS.ProcessEnv = {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
    };

    // Spawn each agent
    for (const agent of args.agents) {
        // Build the ownership constraint prompt
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

        const cmdArgs = [
            "--dangerously-skip-permissions",
            "-p",
            fullPrompt,
        ];

        const processId = processManager.spawn(
            claudePath,
            cmdArgs,
            process.cwd(),
            teamEnv,
            args.timeoutMs
        );

        processIds.push(processId);
    }

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
                // Auto-stop monitoring when all agents are done
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
