import { z } from "zod";
import { join } from "path";
import { processManager } from "../process-manager.js";

export const claudeInitSchema = z.object({
    cwd: z.string(),
    projectName: z.string().optional(),
});

export async function executeClaudeInit(args: z.infer<typeof claudeInitSchema>) {
    const claudePath = process.env.CLAUDE_CLI_PATH || "claude";
    const timeoutMs = parseInt(process.env.DEFAULT_TIMEOUT || "300000", 10);

    const initPrompt = args.projectName
        ? `/init\nProject name: ${args.projectName}`
        : "/init";

    const cmdArgs = ["-p", initPrompt, "--output-format", "text"];

    const childId = processManager.spawn(claudePath, cmdArgs, args.cwd, {}, timeoutMs);

    const exitCode = await processManager.waitForExit(childId);

    const outputLines = processManager.getOutput(childId);
    const outputStr = outputLines.join("\n").trim();

    if (exitCode !== 0) {
        return {
            success: false,
            output: outputStr,
            error: `Init process exited with code ${exitCode}`,
            claudeMdPath: "",
            processId: childId,
        };
    }

    const claudeMdPath = join(args.cwd, "CLAUDE.md");

    return {
        success: true,
        output: outputStr,
        claudeMdPath,
        processId: childId,
    };
}
