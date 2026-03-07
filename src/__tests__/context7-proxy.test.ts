import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { executeContext7Query, context7Schema, toolDefinition } from "../tools/context7-proxy.js";
import { spawn } from "child_process";
import { EventEmitter } from "events";
import { Writable, Readable } from "stream";

// Mock child_process
vi.mock("child_process", () => ({
    spawn: vi.fn(),
}));

class MockStream extends EventEmitter {
    write = vi.fn();
}

describe("Context7 Proxy Backup", () => {
    let mockProc: any;

    beforeEach(() => {
        mockProc = new EventEmitter();
        mockProc.stdout = new MockStream();
        mockProc.stderr = new MockStream();
        mockProc.stdin = { write: vi.fn() };
        mockProc.kill = vi.fn();
        
        vi.mocked(spawn).mockReturnValue(mockProc as any);
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    it("3.1 Schema validation accepts valid input", () => {
        expect(() => context7Schema.parse({ action: "query-docs", libraryId: "x", query: "test" })).not.toThrow();
        expect(() => context7Schema.parse({ action: "resolve-library-id" })).toThrow(); // missing query
    });

    it("3.2 Happy path: resolves successfully", async () => {
        const promise = executeContext7Query({ action: "query-docs", libraryId: "x", query: "test" });
        
        const responseJson = {
            jsonrpc: "2.0",
            id: 1,
            result: {
                content: [{ type: "text", text: "Here are the docs." }]
            }
        };

        mockProc.stdout.emit("data", Buffer.from(JSON.stringify(responseJson) + "\n"));
        
        const result = await promise;
        expect(result.success).toBe(true);
        expect(result.output).toBe("Here are the docs.");
        expect(mockProc.kill).toHaveBeenCalled();
    });

    it("3.3 Timeout handling: returns false after timeout", async () => {
        const promise = executeContext7Query({ action: "resolve-library-id", libraryName: "x", query: "test" });
        
        vi.advanceTimersByTime(16000);
        
        const result = await promise;
        expect(result.success).toBe(false);
        expect(result.output).toContain("Timeout");
        expect(mockProc.kill).toHaveBeenCalledWith("SIGKILL");
    });

    it("3.4 Invalid JSON response: waiting for valid line", async () => {
        const promise = executeContext7Query({ action: "query-docs", libraryId: "x", query: "test" });
        
        mockProc.stdout.emit("data", Buffer.from("Syntax Error\n"));
        mockProc.stdout.emit("data", Buffer.from("Still Garbled\n"));
        
        const responseJson = { jsonrpc: "2.0", id: 1, error: { message: "Internal error" } };
        mockProc.stdout.emit("data", Buffer.from(JSON.stringify(responseJson) + "\n"));
        
        const result = await promise;
        expect(result.success).toBe(false);
        expect(result.output).toContain("Internal error");
    });

    it("3.5 Spawn failure catches error", async () => {
        const promise = executeContext7Query({ action: "query-docs", libraryId: "x", query: "test" });
        
        mockProc.emit("error", new Error("ENOENT"));
        
        const result = await promise;
        expect(result.success).toBe(false);
        expect(result.output).toContain("ENOENT");
    });
});
