/**
 * output-guard.ts
 * Gemini-safe output sanitization for MCP tool responses.
 *
 * Problem: Gemini models in Antigravity crash when an MCP tool returns
 * payloads that are too large or contain raw ANSI/control characters.
 * Claude and GPT handle this gracefully; Gemini does not.
 *
 * This module provides a single `sanitizeOutput` function that:
 *   1. Strips ANSI escape codes and terminal control characters
 *   2. Truncates output to a configurable max length
 *   3. Appends a truncation notice so the LLM knows data was cut
 */

const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

// Characters below 0x20 except \n (0x0A), \r (0x0D), \t (0x09)
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

const DEFAULT_MAX_LENGTH = 8000;

export function sanitizeOutput(raw: string, maxLength?: number): string {
    const limit = maxLength ?? DEFAULT_MAX_LENGTH;

    // Step 1: Strip ANSI escape sequences
    let cleaned = raw.replace(ANSI_REGEX, "");

    // Step 2: Strip remaining control characters (keep \n, \r, \t)
    cleaned = cleaned.replace(CONTROL_CHAR_REGEX, "");

    // Step 3: Truncate if over limit
    if (cleaned.length > limit) {
        cleaned = cleaned.substring(0, limit) + "\n\n...[OUTPUT TRUNCATED — exceeded safe MCP payload limit]...";
    }

    return cleaned;
}
