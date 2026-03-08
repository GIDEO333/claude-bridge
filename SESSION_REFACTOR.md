# SESSION: Claude Bridge + Context7 Refactor

> **Session Type**: Multi-file refactor  
> **Risk Level**: 🟡 Medium — touches live MCP infrastructure, must not break either system  
> **Estimated Duration**: 1 session (~45 min)  
> **Safety Backup**: Pushed to `github.com/GIDEO333/claude-bridge.git` @ commit `1eb2ebd` (2026-03-07)  
> **Rollback**: `git reset --hard 1eb2ebd` if anything goes wrong

---

## 1. CONTEXT (Current State)

### Architecture Overview
```
┌──────────────────────────────────────────────────────────────┐
│  Antigravity IDE (Gemini)                                     │
│                                                                │
│  MCP Config: ~/.gemini/antigravity/mcp_config.json             │
│  ├── sequential-thinking  (npx, standalone)                    │
│  ├── skills-search        (python3, standalone)                │
│  ├── switchboard          (bash wrapper → switchboard binary)  │
│  │   ├── fetch            (uvx mcp-server-fetch)               │
│  │   ├── glm-bridge       (python3 glm_bridge_server.py)       │
│  │   ├── puppeteer        (npx @mcp/server-puppeteer)          │
│  │   ├── sqlite           (uvx mcp-server-sqlite)              │
│  │   └── context7    ❌   (npx @upstash/context7-mcp)          │
│  └── claude-bridge        (node dist/index.js)                 │
│      ├── claude_prompt                                         │
│      ├── claude_agent_teams                                    │
│      ├── claude_review                                         │
│      ├── claude_init                                           │
│      ├── claude_session                                        │
│      ├── claude_status                                         │
│      ├── claude_abort                                          │
│      └── claude_mcp_manage                                     │
└──────────────────────────────────────────────────────────────┘
```

### What's Wrong
1. **Context7 in Switchboard**: The `.mcp.json` is syntactically correct but the Switchboard MCP proxy mangles tool names with a `context7_suite` prefix, making the UX inconsistent.
2. **Team Monitor**: The `claude-teams.ts` writes `~/.claude-bridge/active-team.json` but no tool in claude-bridge reads it back — it's dead-end data.
3. **Code Hygiene**: `index.ts` has 300 lines of duplicated schema definitions that mirror what's already in the tool files. Classic DRY violation.

---

## 2. OBJECTIVES

| # | Goal | Priority |
|---|------|----------|
| A | Fix Context7 MCP so it works reliably via Switchboard | 🔴 P0 |
| B | Add a `context7_suite` proxy tool to claude-bridge as backup | 🟡 P1 |
| C | Clean up `index.ts` — extract tool schemas to their respective files | 🟡 P1 |
| D | Wire team-monitor read-back into `claude_status` tool | 🟢 P2 |
| E | Build & verify no regressions | 🔴 P0 |

---

## 3. PHASE-BY-PHASE INSTRUCTIONS

### Phase 1: Fix Context7 in Switchboard
**Goal**: Ensure Context7 MCP tools work reliably through Switchboard.

**Files**:
- `~/.switchboard/mcps/context7/.mcp.json`

**Steps**:
1. Read the current `.mcp.json` file
2. Verify that `npx -y @upstash/context7-mcp` runs successfully standalone:
   ```bash
   timeout 10 npx -y @upstash/context7-mcp 2>&1 | head -20
   ```
3. If the binary path resolution is the issue (common on macOS), switch to absolute path:
   ```bash
   which npx  # Get absolute path
   ```
4. Update `.mcp.json` with absolute `cmd` path if needed
5. Test via Switchboard introspection:
   ```
   mcp_switchboard_context7_suite({ action: "introspect" })
   ```
6. Test an actual query:
   ```
   mcp_switchboard_context7_suite({ 
     action: "call", 
     subtool: "resolve-library-id",
     args: { query: "How to create routes", libraryName: "next.js" }
   })
   ```

**Success Criteria**: Both `resolve-library-id` and `query-docs` tools return valid responses through Switchboard.

---

### Phase 2: Refactor `index.ts` — Extract Tool Registry
**Goal**: Eliminate the 150-line schema duplication. Each tool file should export its own `name`, `description`, and `inputSchema`.

**Files to modify**:
- `src/index.ts` (major cleanup)
- `src/tools/claude-prompt.ts` (add exported metadata)
- `src/tools/claude-teams.ts` (add exported metadata)
- `src/tools/claude-review.ts` (add exported metadata)
- `src/tools/claude-init.ts` (add exported metadata)
- `src/tools/claude-session.ts` (add exported metadata)
- `src/tools/claude-status.ts` (add exported metadata)
- `src/tools/claude-abort.ts` (add exported metadata)
- `src/tools/claude-mcp.ts` (add exported metadata)

**Pattern** — Each tool file adds:
```typescript
// At top of each tool file, export the MCP tool definition
export const toolDefinition = {
    name: "claude_prompt",
    description: "Run a one-shot headless Claude prompt...",
    inputSchema: {
        type: "object" as const,
        properties: { /* ... */ },
        required: ["prompt"],
    },
};
```

**Then `index.ts` becomes**:
```typescript
import { toolDefinition as promptDef, executeClaudePrompt, claudePromptSchema } from "./tools/claude-prompt.js";
// ... other imports

const tools = [promptDef, teamsDef, reviewDef, initDef, sessionDef, statusDef, abortDef, mcpDef];

// Tool executor registry (replaces giant switch statement)
const executors: Record<string, (args: unknown) => Promise<unknown>> = {
    claude_prompt: (args) => executeClaudePrompt(claudePromptSchema.parse(args)),
    // ...
};
```

**Constraint**: Do NOT change any tool's external behavior. Only restructure internally.

---

### Phase 3: Add Context7 Proxy Tool (Optional Backup)
**Goal**: Add a `context7_resolve` and `context7_docs` tool directly in claude-bridge, so Context7 is available even when Switchboard is down.

**New file**: `src/tools/context7-proxy.ts`

**Design**:
- Uses `processManager.spawn()` to call `npx -y @upstash/context7-mcp` 
- Sends JSON-RPC `tools/call` message via stdin
- Parses response from stdout
- Falls back to error message if Context7 unavailable

**Why proxy instead of native?**: Context7 is a full MCP server. It's simpler to proxy than to re-implement their API client.

---

### Phase 4: Wire Team Monitor into `claude_status`
**Goal**: When `claude_status` is called, also read `~/.claude-bridge/active-team.json` to include team-level information.

**Files**:
- `src/tools/claude-status.ts` — add file read for active-team.json
- `src/types.ts` — add `TeamStatus` interface

**Behavior**:
- If a `processId` matches an agent in `active-team.json`, include team context (role, mode, all agent statuses)
- If no team file exists, behave exactly as today

---

### Phase 5: Build & Verify
```bash
# Type check
npx tsc --noEmit

# Build
npm run build

# Run tests
npm test

# Smoke test — start server and list tools
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js 2>/dev/null | head -5

# Push only after all green
git add -A && git commit -m "refactor: extract tool registry, fix context7, wire team monitor"
git push origin main
```

---

## 4. FILES INVENTORY

| File | Action | Risk |
|------|--------|------|
| `~/.switchboard/mcps/context7/.mcp.json` | MODIFY (fix cmd path) | Low |
| `src/index.ts` | MAJOR REFACTOR (extract schemas, simplify switch) | High |
| `src/tools/claude-prompt.ts` | ADD export `toolDefinition` | Low |
| `src/tools/claude-teams.ts` | ADD export `toolDefinition` | Low |
| `src/tools/claude-review.ts` | ADD export `toolDefinition` | Low |
| `src/tools/claude-init.ts` | ADD export `toolDefinition` | Low |
| `src/tools/claude-session.ts` | ADD export `toolDefinition` | Low |
| `src/tools/claude-status.ts` | MODIFY (add team file read + export def) | Medium |
| `src/tools/claude-abort.ts` | ADD export `toolDefinition` | Low |
| `src/tools/claude-mcp.ts` | ADD export `toolDefinition` | Low |
| `src/tools/context7-proxy.ts` | NEW FILE | Medium |
| `src/types.ts` | ADD `TeamStatus` interface | Low |

---

## 5. CONSTRAINTS (NON-NEGOTIABLE)

1. **No breaking changes** — all 8 existing tool names and schemas must remain identical
2. **Build must pass** — `npx tsc --noEmit` must exit 0 before any git commit
3. **Tests must pass** — `npm test` must exit 0
4. **Switchboard stays working** — do NOT modify any other `.mcp.json` in `~/.switchboard/mcps/`
5. **Rollback ready** — if anything goes wrong: `git reset --hard 1eb2ebd`
6. **One commit per phase** — for easy bisect if issues arise

---

## 6. BEGIN SESSION PROMPT

Copy-paste this as the opening prompt for the new session:

```
Read /Users/gideonthirtytres/Projects/claude-bridge/SESSION_REFACTOR.md — this is the refactor plan. Execute it phase by phase. Start with Phase 1 (fix Context7 in Switchboard), then Phase 2 (refactor index.ts), then Phase 3 (context7 proxy), then Phase 4 (team monitor), then Phase 5 (build & verify). Commit after each phase. Do NOT modify behavior of existing tools. Rollback if build fails: git reset --hard 1eb2ebd.
```
