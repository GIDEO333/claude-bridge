/**
 * config.ts
 * Centralized configuration for claude-bridge MCP server.
 * All magic numbers and env var lookups live here.
 */

import { resolve } from "path";
import { homedir } from "os";

export const config = {
    /** Path to the Claude CLI binary */
    claudePath: process.env.CLAUDE_CLI_PATH || "claude",

    /** Default timeout for CLI commands (ms). Gemini-safe: keep ≤60s for sync tools */
    defaultTimeout: parseInt(process.env.DEFAULT_TIMEOUT || "60000", 10),

    /** Max lines kept in process output buffer */
    maxOutputBuffer: 1000,

    /** Max characters for sanitized MCP output (Gemini-safe) */
    maxSafePayload: 8000,

    /** Max characters for error messages returned to client */
    maxErrorLength: 1000,

    /** TTL for completed processes before eviction from memory (ms) */
    processEvictionTtl: 5 * 60 * 1000, // 5 minutes

    /** Allowed base directory for CWD sandboxing */
    allowedBaseDir: process.env.CLAUDE_BRIDGE_SANDBOX_ROOT || homedir(),
} as const;

/**
 * Resolves a user-supplied cwd to an absolute path and verifies
 * it stays within the allowed sandbox root (defaults to $HOME).
 * Prevents AI agents from executing CLI commands in /etc, /System, etc.
 */
export function resolveSafeCwd(userCwd?: string): string {
    const base = config.allowedBaseDir;
    const resolved = resolve(base, userCwd || ".");

    if (!resolved.startsWith(base)) {
        throw new Error(
            `CWD sandboxing violation: "${userCwd}" resolves to "${resolved}" which is outside allowed root "${base}".`
        );
    }

    return resolved;
}
