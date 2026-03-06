import { z } from "zod";
import { processManager } from "../process-manager.js";
import { getSignals } from "../file-monitor.js";
import { ProcessStatus } from "../types.js";

export const claudeStatusSchema = z.object({
    processId: z.string(),
});

export async function executeClaudeStatus(args: z.infer<typeof claudeStatusSchema>): Promise<{ success: boolean; data?: ProcessStatus; error?: string }> {
    try {
        const status = processManager.getStatus(args.processId);

        // Enhance with actual mailbox signals from file monitor
        status.mailboxSignals = getSignals();

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
