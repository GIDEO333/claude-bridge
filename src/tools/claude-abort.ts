import { z } from "zod";

export const toolDefinition = {
    name: "claude_abort",
    description: "Abort a running process. Triggers SIGTERM followed by SIGKILL if needed.",
    inputSchema: {
        type: "object" as const,
        properties: {
            processId: { type: "string", description: "The UUID of the process to abort" },
        },
        required: ["processId"],
    },
};

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
