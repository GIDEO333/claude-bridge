# Claude Bridge — MCP Server for Claude Code

This MCP server acts as a bridge between Antigravity (or any MCP client) and the native Anthropic `claude` CLI, enabling programmatic control of Claude Code. It introduces 8 modular tools for executing prompts, orchestrating agent teams, reviewing code, and managing long-running processes.

## Installation & Deployment To Antigravity

1. **Build the Project**
   ```bash
   npm install
   npm run build
   ```

2. **Configure Antigravity**
   The server is automatically deployed by adding it to Antigravity's `mcp_config.json`:
   ```json
   {
     "mcpServers": {
       "claude-bridge": {
         "command": "node",
         "args": ["/Users/gideonthirtytres/Projects/claude-bridge/dist/index.js"],
         "env": {
           "CLAUDE_CLI_PATH": "claude",
           "DEFAULT_TIMEOUT": "300000"
         }
       }
     }
   }
   ```
   *Restart Antigravity IDE to load the tools.*

## Available Tools

All tools are asynchronous where appropriate, returning process IDs for long-running tasks.

### 1. `claude_prompt`
Runs a basic query using `claude -p "..."`. 
- **Input:** `{ prompt: string, cwd?: string, outputFormat?: "text" | "json" }`
- **Output:** Synchronously returns the text response from Claude. (Warning: may block until complete)

### 2. `claude_agent_teams`
Launches the experimental Agent Teams workflow from `claude-agent-teams` SKILL. 
- **Input:** `TeamConfig` (mode, agents with role/owns/forbidden/prompt, CLAUDE.md path, mailbox path)
- **Output:** Asynchronously returns `processId`. It internally spawns the agents and starts a filesystem watcher (`chokidar`) on `.agent-teams/mailbox/` to monitor signals (`ESCALATION.md`, `*-DONE.md`).
- *Note:* Bypasses permissions with `--dangerously-skip-permissions` to allow agents to operate headlessly.

### 3. `claude_review`
Dedicated code review tool.
- **Input:** `{ targetPath: string, reviewType?: "security" | "performance" | "general" }`
- **Output:** Returns structural markdown representing the code review.

### 4. `claude_init`
Initializes a Claude Code project environment.
- **Input:** `{ cwd: string, projectName?: string }`
- **Output:** Generates `CLAUDE.md` and returns its absolute path.

### 5. `claude_session`
Session management.
- **Input:** `{ action: "continue" | "resume" | "list", sessionId?: string }`
- **Output:** 
  - `list`: sync, returns list of sessions.
  - `continue` / `resume`: async, returns `processId` of the backgrounded session.

### 6. `claude_status`
Checks the heartbeat of an async tool.
- **Input:** `{ processId: string }`
- **Output:** Returns deep process statistics (`ProcessStatus`) including `exitCode`, uptime, `lastOutputLine`, `stuckDetection` (flags if no stdout was emitted for >3 min), and `mailboxSignals` (listing active communication signals from the file monitor).

### 7. `claude_abort`
Aborts a stalled or runaway process.
- **Input:** `{ processId: string }`
- **Output:** Sends `SIGTERM` followed by a hard `SIGKILL` 5s later if the process ignores it.

### 8. `claude_mcp_manage`
Wraps the native `claude mcp` CLI.
- **Input:** `{ action: "add" | "remove" | "list", serverName?: string, config?: { command: string, args?: string[] } }`
- **Output:** Confirmation string.

## Testing

A rudimentary test script `test-tools.js` is included to verify the integration between the TypeScript Node `child_process` wraps and the actual CLI.
To verify:
1. Ensure the `claude` CLI is configured properly and authenticated.
2. Run `node test-tools.js`
3. It will echo a simple prompt, verify status tracking, and attempt to run a review.
