import { z } from "zod";
import { processManager } from "../process-manager.js";

export const claudeAbortSchema = z.object({
    processId: z.string(),
});

export async function executeClaudeAbort(args: z.infer<typeof claudeAbortSchema>) {
    try {
        const p = processManager.getStatus(args.processId);
        if (p.status === "exited") {
            return {
                success: true,
                message: `Process ${args.processId} is already exited.`,
            };
        }

        processManager.abort(args.processId);

        return {
            success: true,
            message: `Abort signal sent to process ${args.processId}.`,
        };
    } catch (error) {
        return {
            success: false,
            message: `Failed to abort: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
