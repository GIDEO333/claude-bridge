import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { processManager } from "./process-manager.js";
import { stopMonitoring } from "./file-monitor.js";
import { startupVersionCheck } from "./cli-version.js";

// Tool imports
import { toolDefinition as promptDef, claudePromptSchema, executeClaudePrompt } from "./tools/claude-prompt.js";
import { toolDefinition as teamsDef, claudeTeamsSchema, executeClaudeTeams } from "./tools/claude-teams.js";
import { toolDefinition as reviewDef, claudeReviewSchema, executeClaudeReview } from "./tools/claude-review.js";
import { toolDefinition as initDef, claudeInitSchema, executeClaudeInit } from "./tools/claude-init.js";
import { toolDefinition as sessionDef, claudeSessionSchema, executeClaudeSession } from "./tools/claude-session.js";
import { toolDefinition as statusDef, claudeStatusSchema, executeClaudeStatus } from "./tools/claude-status.js";
import { toolDefinition as abortDef, claudeAbortSchema, executeClaudeAbort } from "./tools/claude-abort.js";
import { toolDefinition as mcpDef, claudeMcpSchema, executeClaudeMcp } from "./tools/claude-mcp.js";

const server = new Server(
    {
        name: "claude-bridge",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

export const tools = [
    promptDef,
    teamsDef,
    reviewDef,
    initDef,
    sessionDef,
    statusDef,
    abortDef,
    mcpDef,
];

const executors: Record<string, (args: unknown) => Promise<unknown>> = {
    claude_prompt: async (args) => {
        const parsed = claudePromptSchema.parse(args);
        return formatResult(await executeClaudePrompt(parsed));
    },
    claude_agent_teams: async (args) => {
        const parsed = claudeTeamsSchema.parse(args);
        const result = await executeClaudeTeams(parsed);
        return {
            content: [{
                type: "text" as const, // ts ignores
                text: JSON.stringify({
                    success: result.success,
                    output: result.output,
                    processIds: result.processIds,
                    mailboxPath: result.mailboxPath,
                    monitoringActive: result.monitoringActive,
                }, null, 2),
            }],
        };
    },
    claude_review: async (args) => {
        const parsed = claudeReviewSchema.parse(args);
        return formatResult(await executeClaudeReview(parsed));
    },
    claude_init: async (args) => {
        const parsed = claudeInitSchema.parse(args);
        const result = await executeClaudeInit(parsed);
        return {
            content: [{
                type: "text" as const, // ts ignores
                text: JSON.stringify({
                    success: result.success,
                    claudeMdPath: result.claudeMdPath,
                    output: result.output,
                }, null, 2),
            }],
            isError: !result.success,
        };
    },
    claude_session: async (args) => {
        const parsed = claudeSessionSchema.parse(args);
        return formatResult(await executeClaudeSession(parsed));
    },
    claude_status: async (args) => {
        const parsed = claudeStatusSchema.parse(args);
        const result = await executeClaudeStatus(parsed);
        if (!result.success) {
            return {
                content: [{ type: "text" as const, text: `Error: ${result.error}` }],
                isError: true,
            };
        }
        return {
            content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }],
        };
    },
    claude_abort: async (args) => {
        const parsed = claudeAbortSchema.parse(args);
        const result = await executeClaudeAbort(parsed);
        if (!result.success) {
            return {
                content: [{ type: "text" as const, text: `Error: ${result.message}` }],
                isError: true,
            };
        }
        return {
            content: [{ type: "text" as const, text: result.message }],
        };
    },
    claude_mcp_manage: async (args) => {
        const parsed = claudeMcpSchema.parse(args);
        return formatResult(await executeClaudeMcp(parsed));
    },
};

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        const executor = executors[name];
        if (!executor) {
            throw new Error(`Tool not found: ${name}`);
        }
        return await executor(args) as any;
    } catch (error) {
        let message = error instanceof Error ? error.message : String(error);
        // Truncate error messages to prevent Gemini MCP overflow
        if (message.length > 1000) {
            message = message.substring(0, 1000) + "...[error truncated]";
        }
        return {
            content: [{ type: "text" as const, text: `Error: ${message}` }],
            isError: true,
        };
    }
});

export function formatResult(result: { success: boolean; output: string; error?: string }) {
    if (!result.success) {
        const errText = result.error ? result.error.substring(0, 500) : "Unknown error";
        const outText = result.output.substring(0, 2000);
        return {
            content: [{ type: "text" as const, text: `Error: ${errText}\nOutput:\n${outText}` }],
            isError: true,
        };
    }
    return {
        content: [{ type: "text" as const, text: result.output }],
    };
}

async function cleanup() {
    await stopMonitoring();
    processManager.cleanup();
}

async function main() {
    // Non-blocking CLI version compatibility check
    startupVersionCheck();

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Claude Bridge MCP Server running on stdio");
}

process.on("SIGINT", () => {
    cleanup().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
    cleanup().then(() => process.exit(0));
});

main().catch((error) => {
    console.error("Fatal error", error);
    cleanup().then(() => process.exit(1));
});
