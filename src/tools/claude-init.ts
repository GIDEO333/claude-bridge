import { z } from "zod";
import { join } from "path";
import { processManager } from "../process-manager.js";
import { sanitizeOutput } from "../output-guard.js";
import { config, resolveSafeCwd } from "../config.js";

export const claudeInitSchema = z.object({
    cwd: z.string(),
    projectName: z.string().optional(),
});

export async function executeClaudeInit(args: z.infer<typeof claudeInitSchema>) {
    const claudePath = config.claudePath;
    const timeoutMs = config.defaultTimeout;
    const safeCwd = resolveSafeCwd(args.cwd);

    const initPrompt = args.projectName
        ? `/init\nProject name: ${args.projectName}`
        : "/init";

    const cmdArgs = ["-p", initPrompt, "--output-format", "text"];

    const childId = processManager.spawn(claudePath, cmdArgs, safeCwd, {}, timeoutMs);

    const exitCode = await processManager.waitForExit(childId);

    const outputLines = processManager.getOutput(childId);
    const outputStr = sanitizeOutput(outputLines.join("\n").trim());

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
