# Claude Bridge MCP Server — Architecture Plan

## Overview

MCP server yang memungkinkan Antigravity IDE mengontrol Claude Code CLI secara native
melalui 8 modular tools dengan process management dan event-driven file monitoring.

## Tech Stack

- Runtime: Node.js 20+
- Language: TypeScript (strict, ESM)
- MCP SDK: @modelcontextprotocol/sdk
- Process Management: child_process.spawn (native)
- File Watcher: chokidar
- Validation: zod

## Project Structure

```
claude-bridge/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # MCP server entry point (stdio transport)
│   ├── types.ts              # All TypeScript interfaces
│   ├── process-manager.ts    # Spawn, track, kill CLI processes
│   ├── file-monitor.ts       # Watch .agent-teams/mailbox/ (chokidar)
│   └── tools/
│       ├── claude-prompt.ts   # One-shot headless: claude -p
│       ├── claude-teams.ts    # Agent Teams spawn + monitor
│       ├── claude-review.ts   # Code review
│       ├── claude-init.ts     # Project init (/init)
│       ├── claude-session.ts  # Session resume/list
│       ├── claude-mcp.ts      # MCP server management
│       ├── claude-status.ts   # Process status check
│       └── claude-abort.ts    # Process kill
└── dist/                      # Compiled JS output
```

## Core Interfaces

```typescript
interface TeamConfig {
  mode: 1 | 2;
  agents: {
    role: string;
    owns: string[];
    forbidden: string[];
    spawnPrompt: string;
  }[];
  claudeMdPath: string;
  mailboxPath: string;
  timeoutMs: number;
}

interface ProcessStatus {
  processId: string;
  status: "running" | "exited" | "stuck";
  exitCode?: number;
  uptime: number;
  lastOutputLine: string;
  mailboxSignals: string[];
  stuckDetection: boolean;
}

interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  processId?: string;
}
```

## Tool Specifications

### 1. claude_prompt
- **Input:** `{ prompt: string, cwd?: string, outputFormat?: "text" | "json" }`
- **Command:** `claude -p "{prompt}" --output-format {format}`
- **Sync:** Waits for completion, returns output

### 2. claude_agent_teams
- **Input:** `TeamConfig`
- **Command:** `claude --dangerously-skip-permissions` with env `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
- **Async:** Returns processId immediately, starts file monitor on mailboxPath
- **Signals:** ESCALATION.md (urgent), *-DONE.md (completion), *-to-*.md (comms)

### 3. claude_review
- **Input:** `{ targetPath: string, reviewType?: "security" | "performance" | "general" }`
- **Command:** `claude -p "Review code at {path}. Focus: {type}. Return structured markdown."`
- **Sync:** Returns review markdown

### 4. claude_init
- **Input:** `{ cwd: string, projectName?: string }`
- **Command:** `claude -p "/init"` in cwd
- **Sync:** Returns path to generated CLAUDE.md

### 5. claude_session
- **Input:** `{ action: "continue" | "resume" | "list", sessionId?: string }`
- **Command:** `claude -c` | `claude -r {id}` | `claude sessions list`
- **Async for continue/resume, sync for list**

### 6. claude_mcp_manage
- **Input:** `{ action: "add" | "remove" | "list", serverName?: string, config?: object }`
- **Command:** `claude mcp add|remove|list`
- **Sync:** Returns server list or confirmation

### 7. claude_status
- **Input:** `{ processId: string }`
- **Returns:** ProcessStatus with stuck detection (no output > 3 min)

### 8. claude_abort
- **Input:** `{ processId: string }`
- **Behavior:** SIGTERM → wait 5s → SIGKILL if still alive
- **Returns:** `{ success, message }`

## Process Manager Design

```
ProcessManager (Singleton)
├── processes: Map<string, ManagedProcess>
├── spawn(cmd, args, cwd, env, timeout) → processId
├── getStatus(processId) → ProcessStatus
├── abort(processId) → void
├── getOutput(processId, lines) → string[]
└── cleanup() → kill all on server shutdown

ManagedProcess
├── process: ChildProcess
├── id: string (uuid)
├── startedAt: Date
├── lastOutputAt: Date
├── outputBuffer: string[]  (ring buffer, max 1000 lines)
├── exitCode: number | null
└── timeoutHandle: NodeJS.Timeout
```

## File Monitor Design

```
FileMonitor
├── watcher: chokidar.FSWatcher
├── startMonitoring(mailboxPath, callbacks)
│   callbacks:
│   ├── onEscalation(filePath, content) → void
│   ├── onDone(agentName, filePath, content) → void
│   ├── onMessage(from, to, filePath, content) → void
│   └── onAllDone(doneFiles[]) → void
├── stopMonitoring() → void
└── getSignals() → string[]  (list of all files detected)
```

## MCP Config (for Antigravity)

```json
{
  "claude-bridge": {
    "command": "node",
    "args": ["/Users/gideonthirtytres/Projects/claude-bridge/dist/index.js"],
    "env": {
      "CLAUDE_CLI_PATH": "claude",
      "DEFAULT_TIMEOUT": "300000",
      "ENABLE_AGENT_TEAMS": "true"
    }
  }
}
```

## Integration with claude-agent-teams SKILL.md

This MCP server directly enables the 3-hat workflow defined in SKILL.md:
- 🏠 Architect: Antigravity creates CLAUDE.md, ownership matrix (unchanged)
- 🚀 Launcher: `claude_agent_teams` tool replaces manual `run_command`
- 👁️ Supervisor: `file-monitor` enables true event-driven supervision

Signal protocol from SKILL.md is embedded in file-monitor.ts:
- ESCALATION.md → onEscalation callback → Antigravity reads + responds
- *-DONE.md → onDone callback → when all done → onAllDone → trigger Gather
- *-to-*.md → onMessage callback → optional notification
