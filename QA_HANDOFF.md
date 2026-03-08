# 🔄 MULTI-SESSION HANDOFF — Claude Bridge Ecosystem QA Fix

> **PURPOSE**: This file is a self-contained instruction set for any AI agent to pick up and execute across multiple sessions. Each phase is independent and can be resumed from any checkpoint.

---

## 📍 Project Locations

| Project | Path | Purpose |
|---------|------|---------|
| `claude-bridge` | `/Users/gideonthirtytres/Projects/claude-bridge/` | MCP Server (Node.js/TypeScript) |
| `claude-bridge-monitor` | `/Users/gideonthirtytres/Projects/claude-bridge-monitor/` | VSCode Extension (TypeScript) |
| IPC Channel | `~/.claude-bridge/ipc/abort/` | File-drop folder for inter-process communication |
| Signal File | `~/.claude-bridge/active-team.json` | Agent status file (MCP writes, Extension reads) |

---

## 🐛 QA Issues to Fix

### Issue 1: Abort Button is Cosmetic (🔴 CRITICAL)
- **File**: `claude-bridge-monitor/src/agent-monitor.ts` lines 83–88
- **Current**: `vscode.window.showWarningMessage("Use claude_abort MCP tool to abort agents")`
- **Problem**: Button does nothing. Extension cannot call MCP tools directly.
- **Solution**: File-based IPC. Extension writes `~/.claude-bridge/ipc/abort/<processId>` → MCP server watches folder → kills process.

### Issue 2: Clear History Instantly Reverts (🟡 MAJOR)
- **File**: `claude-bridge-monitor/src/agent-monitor.ts` line 92
- **Current**: `this.lastTimestamp = 0`
- **Problem**: Next 1-second poll reads `active-team.json` with timestamp > 0 → re-renders everything.
- **Solution**: Change to `this.lastTimestamp = Date.now()`.

### Issue 3: No IPC Channel Exists (🔴 CRITICAL)
- **Problem**: Extension and MCP server share data via file (`active-team.json`) but communication is one-way only (MCP→Extension).
- **Solution**: Create reverse IPC channel via file-drop folder.

---

## ✅ PHASE CHECKLIST

Track progress by marking `[x]` as each step completes:

```
Phase 1: [ ] Step 1.1  [ ] Step 1.2  [ ] Step 1.3
Phase 2: [ ] Step 2.1  [ ] Step 2.2  [ ] Step 2.3
Phase 3: [ ] Step 3.1  [ ] Step 3.2  [ ] Step 3.3  [ ] Step 3.4  [ ] Step 3.5
Phase 4: [ ] Step 4.1  [ ] Step 4.2  [ ] Step 4.3  [ ] Step 4.4
```

---

## 🟢 PHASE 1 — Build IPC Abort Watcher

> **Suggested Model**: Gemini 3.1 Pro (low cost, mechanical coding task)
> **Estimated tokens**: ~5K output
> **Session**: Can complete in 1 session

### Step 1.1: Create `abort-watcher.ts`

**File**: `/Users/gideonthirtytres/Projects/claude-bridge/src/abort-watcher.ts`

Create a new TypeScript module that:
1. Ensures directory `~/.claude-bridge/ipc/abort/` exists on startup (use `mkdirSync` recursive)
2. Uses `fs.watch()` to monitor the directory for new files
3. When a file appears:
   - Read filename as `processId` (UUID format)
   - Call `processManager.abort(processId)` from `./process-manager.js`
   - Wait 500ms, then `fs.unlinkSync()` the file
   - Log to stderr: `[abort-watcher] Aborted process ${processId}`
4. Export two functions: `startAbortWatcher()` and `stopAbortWatcher()`
5. `stopAbortWatcher()` must close the `FSWatcher` instance cleanly

**Reference**: Look at `process-manager.ts:100-113` for the existing `abort()` method signature.

### Step 1.2: Wire into `index.ts`

**File**: `/Users/gideonthirtytres/Projects/claude-bridge/src/index.ts`

```diff
+ import { startAbortWatcher, stopAbortWatcher } from "./abort-watcher.js";

  async function cleanup() {
      await stopMonitoring();
+     stopAbortWatcher();
      processManager.cleanup();
  }

  async function main() {
      startupVersionCheck();
+     startAbortWatcher();
      const transport = new StdioServerTransport();
```

### Step 1.3: Verify

```bash
cd /Users/gideonthirtytres/Projects/claude-bridge
npx tsc --noEmit   # must exit 0
npm run build       # must exit 0
npm test            # must exit 0 (existing tests unchanged)
```

**CHECKPOINT**: If all pass, mark Phase 1 complete and proceed to Phase 2.

---

## 🟢 PHASE 2 — Fix Extension UI Actions

> **Suggested Model**: Gemini 3.1 Pro (low cost, straightforward refactor)
> **Estimated tokens**: ~4K output
> **Session**: Can complete in same session as Phase 1, or new session

### Step 2.1: Fix Abort Button

**File**: `/Users/gideonthirtytres/Projects/claude-bridge-monitor/src/agent-monitor.ts`

Add imports at top:
```typescript
import { writeFile, mkdir } from "fs/promises";
```

Replace `abortAll()` method (lines 83–88):
```typescript
public async abortAgent(processId: string): Promise<void> {
    try {
        const ipcDir = join(homedir(), ".claude-bridge", "ipc", "abort");
        await mkdir(ipcDir, { recursive: true });
        await writeFile(join(ipcDir, processId), "", "utf-8");
        vscode.window.showInformationMessage(`Abort signal sent: ${processId.slice(0, 8)}...`);
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to abort: ${err}`);
    }
}

public async abortAll(): Promise<void> {
    // Read current agents from last known state
    try {
        const content = await readFile(SIGNAL_PATH, "utf-8");
        const signal = JSON.parse(content);
        const running = signal.agents?.filter((a: any) => a.status === "running") || [];
        for (const agent of running) {
            await this.abortAgent(agent.processId);
        }
        vscode.window.showInformationMessage(`Abort sent to ${running.length} agents`);
    } catch {
        vscode.window.showWarningMessage("No active agents to abort");
    }
}
```

### Step 2.2: Fix Message Handler

In the same file, update `handleMessage()` (line 189):
```diff
  case "abort":
-     vscode.window.showWarningMessage(`Use claude_abort tool with ID: ${message.processId}`);
+     void this.abortAgent(message.processId);
      break;
  case "abortAll":
-     this.abortAll();
+     void this.abortAll();
      break;
```

### Step 2.3: Fix Clear History

In the same file, update `clearHistory()` (line 92):
```diff
- this.lastTimestamp = 0;
+ this.lastTimestamp = Date.now();
```

**CHECKPOINT**: Proceed to Phase 3 for build verification.

---

## 🟢 PHASE 3 — Build, Package, Smoke Test

> **Suggested Model**: Gemini 3.1 Pro (mechanical verification)
> **Estimated tokens**: ~2K output
> **Session**: Same session as Phase 2

### Step 3.1: Build MCP Server
```bash
cd /Users/gideonthirtytres/Projects/claude-bridge
npm run build
```

### Step 3.2: Run MCP Tests
```bash
cd /Users/gideonthirtytres/Projects/claude-bridge
npm test
```

### Step 3.3: Compile Extension
```bash
cd /Users/gideonthirtytres/Projects/claude-bridge-monitor
npm run compile
```

### Step 3.4: Package VSIX
```bash
cd /Users/gideonthirtytres/Projects/claude-bridge-monitor
npx @vscode/vsce package
```

### Step 3.5: Live Integration Test
1. Install VSIX: `Cmd+Shift+P` → "Install from VSIX" → select `claude-bridge-monitor-0.1.0.vsix`
2. Spawn agents using `claude_agent_teams` tool (mode 1, 3 agents)
3. Click "Abort" on one agent → verify it gets killed (status changes to EXITED)
4. Click "Clear History" → verify agents disappear and don't reappear
5. Spawn new agents → verify they appear fresh

**CHECKPOINT**: If all pass, the core fix is DONE. Phase 4 is optional.

---

## 🔴 PHASE 4 — Deep QA & Edge Cases (OPTIONAL)

> **Suggested Model**: Claude Opus 4.6 (complex reasoning, edge-case analysis)
> **Estimated tokens**: ~8K output
> **Session**: New session — provide this file as context

### Step 4.1: Write Unit Tests

**File**: `/Users/gideonthirtytres/Projects/claude-bridge/src/__tests__/abort-watcher.test.ts`

Test cases to write:
- Watcher starts and creates IPC directory
- File drop triggers `processManager.abort()`
- File is deleted after processing
- Invalid filename (non-UUID) is ignored gracefully
- Watcher stops cleanly without errors

### Step 4.2: Race Condition Test

Simulate 10 abort files written within 50ms. Verify:
- All 10 processes receive abort signal
- No files left behind in IPC folder
- No duplicate abort calls

### Step 4.3: Memory Leak Check

Run the watcher for 5 minutes with repeated file creation/deletion. Verify:
- `process.memoryUsage().heapUsed` stays stable (±10%)
- No unclosed file handles (`lsof -p <pid> | wc -l`)

### Step 4.4: Cross-Platform Path Audit

Review all `join()` and `homedir()` calls for Windows compatibility:
- Check `path.sep` usage
- Verify `~` expansion works on Windows

---

## 🧠 CONTEXT FOR NEW AGENT SESSION

If you are an AI agent reading this for the first time, here is what you need to know:

1. **Architecture**: `claude-bridge` is an MCP server that spawns Claude CLI processes. `claude-bridge-monitor` is a VSCode/Antigravity IDE extension that reads `~/.claude-bridge/active-team.json` to display agent status.

2. **Communication is file-based**: No HTTP, no WebSocket. Everything flows through files in `~/.claude-bridge/`. This is by design — it avoids port conflicts and works across all environments.

3. **The ProcessManager** (`src/process-manager.ts`) holds all spawned processes in memory. It has a working `abort(processId)` method that sends SIGTERM then SIGKILL. The problem was that the Extension had no way to call this method.

4. **Build commands**:
   - MCP: `cd claude-bridge && npm run build && npm test`
   - Extension: `cd claude-bridge-monitor && npm run compile && npx @vscode/vsce package`

5. **Key files to read first**:
   - `claude-bridge/src/process-manager.ts` — the abort logic
   - `claude-bridge/src/index.ts` — server entry point
   - `claude-bridge-monitor/src/agent-monitor.ts` — extension provider
   - `claude-bridge-monitor/src/webview/main.js` — frontend UI

---

## 📝 SESSION LOG

| Date | Model | Phase | Status | Notes |
|------|-------|-------|--------|-------|
| 2026-03-08 | Gemini 3.1 Pro | Planning | ✅ Done | QA analysis + handoff doc created |
| | | Phase 1 | ⬜ Pending | |
| | | Phase 2 | ⬜ Pending | |
| | | Phase 3 | ⬜ Pending | |
| | | Phase 4 | ⬜ Pending | Optional |
