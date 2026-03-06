import { z } from "zod";
import { processManager } from "../process-manager.js";

export const claudeSessionSchema = z.object({
    action: z.enum(["continue", "resume", "list"]),
    sessionId: z.string().optional(),
});

export async function executeClaudeSession(args: z.infer<typeof claudeSessionSchema>) {
    const claudePath = process.env.CLAUDE_CLI_PATH || "claude";
    const timeoutMs = parseInt(process.env.DEFAULT_TIMEOUT || "300000", 10);

    switch (args.action) {
        case "continue": {
            // Async: spawn claude -c, return processId immediately
            const cmdArgs = ["-c"];
            const processId = processManager.spawn(claudePath, cmdArgs, process.cwd(), {}, timeoutMs);

            return {
                success: true,
                output: `Session continued. Process running with ID: ${processId}`,
                processId,
            };
        }

        case "resume": {
            if (!args.sessionId) {
                return {
                    success: false,
                    output: "",
                    error: "sessionId is required for 'resume' action",
                };
            }

            // Async: spawn claude -r <sessionId>, return processId immediately
            const cmdArgs = ["-r", args.sessionId];
            const processId = processManager.spawn(claudePath, cmdArgs, process.cwd(), {}, timeoutMs);

            return {
                success: true,
                output: `Session ${args.sessionId} resumed. Process running with ID: ${processId}`,
                processId,
            };
        }

        case "list": {
            // Sync: spawn claude sessions list, wait for output
            const cmdArgs = ["sessions", "list"];
            const childId = processManager.spawn(claudePath, cmdArgs, process.cwd(), {}, 60000);

            const exitCode = await processManager.waitForExit(childId);

            const outputLines = processManager.getOutput(childId);
            const outputStr = outputLines.join("\n").trim();

            if (exitCode !== 0) {
                return {
                    success: false,
                    output: outputStr,
                    error: `Sessions list exited with code ${exitCode}`,
                    processId: childId,
                };
            }

            return {
                success: true,
                output: outputStr,
                processId: childId,
            };
        }
    }
}
