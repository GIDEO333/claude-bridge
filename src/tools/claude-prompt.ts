import { z } from "zod";

export const toolDefinition = {
    name: "claude_prompt",
    description: "Run a one-shot headless Claude prompt. Waits for completion and returns output.",
    inputSchema: {
        type: "object" as const,
        properties: {
            prompt: { type: "string", description: "The prompt to send to Claude" },
            cwd: { type: "string", description: "Working directory for the process" },
            outputFormat: { type: "string", enum: ["text", "json"], description: "Output format of the CLI" },
        },
        required: ["prompt"],
    },
};

import { processManager } from "../process-manager.js";
import { sanitizeOutput } from "../output-guard.js";
import { config, resolveSafeCwd } from "../config.js";

export const claudePromptSchema = z.object({
    prompt: z.string(),
    cwd: z.string().optional(),
    outputFormat: z.enum(["text", "json"]).optional(),
});

export async function executeClaudePrompt(args: z.infer<typeof claudePromptSchema>) {
    const cwd = resolveSafeCwd(args.cwd);
    const format = args.outputFormat || "text";
    const claudePath = config.claudePath;
    const timeoutMs = config.defaultTimeout;

    const cmdArgs = ["-p", args.prompt, "--output-format", format];

    const childId = processManager.spawn(claudePath, cmdArgs, cwd, {}, timeoutMs);

    const exitCode = await processManager.waitForExit(childId);

    const outputLines = processManager.getOutput(childId);
    const outputStr = sanitizeOutput(outputLines.join("\n").trim());

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
