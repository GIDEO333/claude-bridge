import { z } from "zod";

export const toolDefinition = {
    name: "claude_status",
    description: "Check the status of a long-running process like clause_agent_teams. Returns ProcessStatus.",
    inputSchema: {
        type: "object" as const,
        properties: {
            processId: { type: "string", description: "The UUID of the process to check" },
        },
        required: ["processId"],
    },
};

import { processManager } from "../process-manager.js";
import { getSignals } from "../file-monitor.js";
import { ProcessStatus, TeamStatus } from "../types.js";
import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export const claudeStatusSchema = z.object({
    processId: z.string(),
});

export async function executeClaudeStatus(args: z.infer<typeof claudeStatusSchema>): Promise<{ success: boolean; data?: ProcessStatus; error?: string }> {
    try {
        const status = processManager.getStatus(args.processId);

        // Enhance with actual mailbox signals from file monitor
        status.mailboxSignals = getSignals();

        // QA 4.1 to 4.5 coverage: inject teamContext if active-team.json matches
        try {
            const teamFileStr = await readFile(join(homedir(), ".claude-bridge", "active-team.json"), "utf8");
            const teamData = JSON.parse(teamFileStr) as TeamStatus;
            
            if (teamData && teamData.agents && Array.isArray(teamData.agents)) {
                const isMember = teamData.agents.some((a) => a.processId === args.processId);
                if (isMember) {
                    status.teamContext = teamData;
                }
            }
        } catch {
            // Ignore errors reading/parsing team file (e.g. no team active or corrupted file)
        }

        return {
            success: true,
            data: status,
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
