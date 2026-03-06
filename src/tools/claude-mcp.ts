import { z } from "zod";
import { processManager } from "../process-manager.js";
import { sanitizeOutput } from "../output-guard.js";

export const claudeMcpSchema = z.object({
    action: z.enum(["add", "remove", "list"]),
    serverName: z.string().optional(),
    configCommand: z.string().optional(),
    configArgs: z.string().optional(),
});

export async function executeClaudeMcp(args: z.infer<typeof claudeMcpSchema>) {
    const claudePath = process.env.CLAUDE_CLI_PATH || "claude";

    let cmdArgs: string[] = ["mcp"];

    switch (args.action) {
        case "add": {
            if (!args.serverName || !args.configCommand) {
                return {
                    success: false,
                    output: "",
                    error: "serverName and configCommand are required for 'add' action",
                };
            }
            cmdArgs.push("add", args.serverName, "--", args.configCommand);
            if (args.configArgs) {
                const parsedArgs = args.configArgs.split(",").map((a) => a.trim()).filter(Boolean);
                cmdArgs.push(...parsedArgs);
            }
            break;
        }
        case "remove": {
            if (!args.serverName) {
                return {
                    success: false,
                    output: "",
                    error: "serverName is required for 'remove' action",
                };
            }
            cmdArgs.push("remove", args.serverName);
            break;
        }
        case "list": {
            cmdArgs.push("list");
            break;
        }
    }

    const childId = processManager.spawn(claudePath, cmdArgs, process.cwd(), {}, 60000);
    const exitCode = await processManager.waitForExit(childId);

    const outputLines = processManager.getOutput(childId);
    const outputStr = sanitizeOutput(outputLines.join("\n").trim());

    if (exitCode !== 0) {
        return {
            success: false,
            output: outputStr,
            error: `MCP command exited with code ${exitCode}`,
            processId: childId,
        };
    }

    return {
        success: true,
        output: outputStr,
        processId: childId,
    };
}
