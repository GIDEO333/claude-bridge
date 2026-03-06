import { z } from "zod";
import { processManager } from "../process-manager.js";

export const claudeReviewSchema = z.object({
    targetPath: z.string(),
    reviewType: z.enum(["security", "performance", "general"]).optional(),
});

export async function executeClaudeReview(args: z.infer<typeof claudeReviewSchema>) {
    const claudePath = process.env.CLAUDE_CLI_PATH || "claude";
    const reviewType = args.reviewType || "general";
    const timeoutMs = parseInt(process.env.DEFAULT_TIMEOUT || "300000", 10);

    const prompt = [
        `Review the code at "${args.targetPath}".`,
        `Focus: ${reviewType}.`,
        `Provide a structured markdown report with:`,
        `- Summary of findings`,
        `- Issues found (severity: critical/warning/info)`,
        `- Specific line references where applicable`,
        `- Recommendations for improvement`,
        `Return the full report as markdown.`,
    ].join(" ");

    const cmdArgs = ["-p", prompt, "--output-format", "text"];

    const childId = processManager.spawn(claudePath, cmdArgs, process.cwd(), {}, timeoutMs);


    const exitCode = await processManager.waitForExit(childId);

    const outputLines = processManager.getOutput(childId);
    const outputStr = outputLines.join("\n").trim();

    if (exitCode !== 0) {
        return {
            success: false,
            output: outputStr,
            error: `Review process exited with code ${exitCode}`,
            processId: childId,
        };
    }

    return {
        success: true,
        output: outputStr,
        processId: childId,
    };
}
