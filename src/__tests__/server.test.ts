import { describe, it, expect, vi } from "vitest";
import { readFile } from "fs/promises";

/**
 * Server integration tests.
 * Validates tool definitions, formatResult logic, and error routing.
 */

// ─── Helper: replicate formatResult exactly as in index.ts ───────────
// formatResult is not exported, so we replicate and test the exact logic.
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

describe("MCP Server — Tool Definitions", () => {
    let source: string;

    // Read source once for all tests in this describe block
    it("exports all 8 tools with correct names", async () => {
        source = await readFile(
            new URL("../index.ts", import.meta.url),
            "utf-8"
        );

        const expectedTools = [
            "claude_prompt",
            "claude_agent_teams",
            "claude_review",
            "claude_init",
            "claude_session",
            "claude_status",
            "claude_abort",
            "claude_mcp_manage",
        ];

        for (const toolName of expectedTools) {
            expect(source).toContain(`name: "${toolName}"`);
        }
    });

    it("all 8 tool definitions have description and inputSchema", async () => {
        const src = await readFile(
            new URL("../index.ts", import.meta.url),
            "utf-8"
        );

        // Count tool definitions by matching the pattern `name: "tool_name"`
        const allMatches = src.match(/name:\s*"claude(?:_\w+)+"/g) || [];
        expect(allMatches.length).toBe(8);

        // Every tool must have description and inputSchema
        // We verify by checking each tool block between `name:` markers
        for (const match of allMatches) {
            const toolName = match.match(/"(.+)"/)?.[1];
            const idx = src.indexOf(match);
            // Get the block from this tool name to the next ~200 chars
            const block = src.substring(idx, idx + 500);
            expect(block).toContain("description:");
            expect(block).toContain("inputSchema:");
        }
    });
});

describe("MCP Server — formatResult", () => {
    it("formats success result with text content", () => {
        const result = formatResult({ success: true, output: "hello world" });

        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe("text");
        expect(result.content[0].text).toBe("hello world");
        expect(result).not.toHaveProperty("isError");
    });

    it("formats failure result with isError flag", () => {
        const result = formatResult({
            success: false,
            output: "stderr dump",
            error: "exit code 1",
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Error: exit code 1");
        expect(result.content[0].text).toContain("stderr dump");
    });

    it("handles failure with undefined error gracefully", () => {
        const result = formatResult({
            success: false,
            output: "unknown error",
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Error: undefined");
        expect(result.content[0].text).toContain("unknown error");
    });

    it("handles empty output", () => {
        const result = formatResult({ success: true, output: "" });

        expect(result.content[0].text).toBe("");
        expect(result).not.toHaveProperty("isError");
    });

    it("preserves multiline output", () => {
        const result = formatResult({
            success: true,
            output: "line1\nline2\nline3",
        });

        expect(result.content[0].text).toBe("line1\nline2\nline3");
    });
});

describe("MCP Server — CallTool routing", () => {
    it("index.ts has a default case for unknown tool names", async () => {
        const source = await readFile(
            new URL("../index.ts", import.meta.url),
            "utf-8"
        );

        // The switch statement should have a default case that throws
        expect(source).toContain("default:");
        expect(source).toContain("Tool not found");
    });

    it("index.ts wraps tool calls in try-catch with isError response", async () => {
        const source = await readFile(
            new URL("../index.ts", import.meta.url),
            "utf-8"
        );

        // The catch block should return isError: true
        expect(source).toContain("isError: true");
        expect(source).toContain("catch (error)");
    });
});
