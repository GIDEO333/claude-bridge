import { z } from "zod";
import { processManager } from "../process-manager.js";

export const claudePromptSchema = z.object({
    prompt: z.string(),
    cwd: z.string().optional(),
    outputFormat: z.enum(["text", "json"]).optional(),
});

export async function executeClaudePrompt(args: z.infer<typeof claudePromptSchema>) {
    const cwd = args.cwd || process.cwd();
    const format = args.outputFormat || "text";
    const claudePath = process.env.CLAUDE_CLI_PATH || "claude";

    const cmdArgs = ["-p", args.prompt, "--output-format", format];

    const childId = processManager.spawn(claudePath, cmdArgs, cwd, {}, 300000);

    const exitCode = await processManager.waitForExit(childId);

    const outputLines = processManager.getOutput(childId);
    const outputStr = outputLines.join("\n").trim();

    if (exitCode !== 0) {
        return {
            success: false,
            output: outputStr,
            error: `Process exited with code ${exitCode}`,
            processId: childId,
        };
    }

    return {
        success: true,
        output: outputStr,
        processId: childId,
    };
}
