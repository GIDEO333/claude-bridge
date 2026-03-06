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
import { claudePromptSchema, executeClaudePrompt } from "./tools/claude-prompt.js";
import { claudeTeamsSchema, executeClaudeTeams } from "./tools/claude-teams.js";
import { claudeReviewSchema, executeClaudeReview } from "./tools/claude-review.js";
import { claudeInitSchema, executeClaudeInit } from "./tools/claude-init.js";
import { claudeSessionSchema, executeClaudeSession } from "./tools/claude-session.js";
import { claudeStatusSchema, executeClaudeStatus } from "./tools/claude-status.js";
import { claudeAbortSchema, executeClaudeAbort } from "./tools/claude-abort.js";
import { claudeMcpSchema, executeClaudeMcp } from "./tools/claude-mcp.js";

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

const tools = [
    {
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
    },
    {
        name: "claude_agent_teams",
        description: "Launch Claude Agent Teams with Mode 1 (Scatter-Gather) or Mode 2 (Reflection). Spawns multiple agents with file ownership constraints and starts mailbox monitoring.",
        inputSchema: {
            type: "object" as const,
            properties: {
                mode: { type: "number", enum: [1, 2], description: "1 = Scatter-Gather, 2 = Reflection" },
                agents: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            role: { type: "string", description: "Agent role name (e.g. 'frontend', 'backend')" },
                            owns: { type: "array", items: { type: "string" }, description: "Paths this agent owns" },
                            forbidden: { type: "array", items: { type: "string" }, description: "Paths this agent must NOT write to" },
                            spawnPrompt: { type: "string", description: "Task prompt for this agent" },
                        },
                        required: ["role", "owns", "forbidden", "spawnPrompt"],
                    },
                    description: "List of agents to spawn",
                },
                claudeMdPath: { type: "string", description: "Path to CLAUDE.md file" },
                mailboxPath: { type: "string", description: "Path to .agent-teams/mailbox/ directory" },
                timeoutMs: { type: "number", description: "Timeout in milliseconds (default: 600000)" },
            },
            required: ["mode", "agents", "claudeMdPath", "mailboxPath"],
        },
    },
    {
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
    },
    {
        name: "claude_init",
        description: "Initialize a new project with Claude. Runs /init to generate CLAUDE.md.",
        inputSchema: {
            type: "object" as const,
            properties: {
                cwd: { type: "string", description: "Working directory for the project" },
                projectName: { type: "string", description: "Optional project name" },
            },
            required: ["cwd"],
        },
    },
    {
        name: "claude_session",
        description: "Manage Claude sessions: continue the last session, resume a specific session, or list all sessions.",
        inputSchema: {
            type: "object" as const,
            properties: {
                action: {
                    type: "string",
                    enum: ["continue", "resume", "list"],
                    description: "Action to perform",
                },
                sessionId: {
                    type: "string",
                    description: "Session ID (required for 'resume' action)",
                },
            },
            required: ["action"],
        },
    },
    {
        name: "claude_status",
        description: "Check the status of a long-running process like clause_agent_teams. Returns ProcessStatus.",
        inputSchema: {
            type: "object" as const,
            properties: {
                processId: { type: "string", description: "The UUID of the process to check" },
            },
            required: ["processId"],
        },
    },
    {
        name: "claude_abort",
        description: "Abort a running process. Triggers SIGTERM followed by SIGKILL if needed.",
        inputSchema: {
            type: "object" as const,
            properties: {
                processId: { type: "string", description: "The UUID of the process to abort" },
            },
            required: ["processId"],
        },
    },
    {
        name: "claude_mcp_manage",
        description: "Manage MCP servers configured in Claude Code (wraps `claude mcp`).",
        inputSchema: {
            type: "object" as const,
            properties: {
                action: { type: "string", enum: ["add", "remove", "list"], description: "Action to perform" },
                serverName: { type: "string", description: "Name of the MCP server (required for add/remove)" },
                config: {
                    type: "object",
                    properties: {
                        command: { type: "string", description: "Command to start the MCP server" },
                        args: { type: "array", items: { type: "string" }, description: "Arguments for the command" }
                    },
                    description: "Configuration for 'add' action"
                }
            },
            required: ["action"],
        },
    },
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        switch (name) {
            case "claude_prompt": {
                const parsed = claudePromptSchema.parse(args);
                const result = await executeClaudePrompt(parsed);
                return formatResult(result);
            }

            case "claude_agent_teams": {
                const parsed = claudeTeamsSchema.parse(args);
                const result = await executeClaudeTeams(parsed);
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            success: result.success,
                            output: result.output,
                            processIds: result.processIds,
                            mailboxPath: result.mailboxPath,
                            monitoringActive: result.monitoringActive,
                        }, null, 2),
                    }],
                };
            }

            case "claude_review": {
                const parsed = claudeReviewSchema.parse(args);
                const result = await executeClaudeReview(parsed);
                return formatResult(result);
            }

            case "claude_init": {
                const parsed = claudeInitSchema.parse(args);
                const result = await executeClaudeInit(parsed);
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            success: result.success,
                            claudeMdPath: result.claudeMdPath,
                            output: result.output,
                        }, null, 2),
                    }],
                    isError: !result.success,
                };
            }

            case "claude_session": {
                const parsed = claudeSessionSchema.parse(args);
                const result = await executeClaudeSession(parsed);
                return formatResult(result);
            }

            case "claude_status": {
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
            }

            case "claude_abort": {
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
            }

            case "claude_mcp_manage": {
                const parsed = claudeMcpSchema.parse(args);
                const result = await executeClaudeMcp(parsed);
                return formatResult(result);
            }

            default:
                throw new Error(`Tool not found: ${name}`);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            content: [{ type: "text" as const, text: `Error: ${message}` }],
            isError: true,
        };
    }
});

function formatResult(result: { success: boolean; output: string; error?: string }) {
    if (!result.success) {
        return {
            content: [{ type: "text" as const, text: `Error: ${result.error}\nOutput:\n${result.output}` }],
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
