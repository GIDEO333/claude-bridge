import { z } from "zod";

export const toolDefinition = {
    name: "claude_review",
    description: "Run a code review using Claude. Returns a structured markdown report with findings.",
    inputSchema: {
        type: "object" as const,
        properties: {
            targetPath: { type: "string", description: "Path to file or directory to review" },
            reviewType: {
                type: "string",
                enum: ["security", "performance", "general"],
                description: "Focus area for the review (default: general)",
            },
        },
        required: ["targetPath"],
    },
};

import { processManager } from "../process-manager.js";
import { sanitizeOutput } from "../output-guard.js";
import { config } from "../config.js";

export const claudeReviewSchema = z.object({
    targetPath: z.string(),
    reviewType: z.enum(["security", "performance", "general"]).optional(),
});

export async function executeClaudeReview(args: z.infer<typeof claudeReviewSchema>) {
    const claudePath = config.claudePath;
    const reviewType = args.reviewType || "general";
    const timeoutMs = config.defaultTimeout;

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
    const outputStr = sanitizeOutput(outputLines.join("\n").trim());

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
