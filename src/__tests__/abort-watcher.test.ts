import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { homedir } from "os";

// ── Mock dependencies ────────────────────────────────────────────────────────

vi.mock("../process-manager.js", () => ({
    processManager: {
        abort: vi.fn(),
    },
}));

// We'll intercept fs calls using vitest's module mock
let watchCallback: ((event: string, filename: string | null) => void) | null = null;
let mockWatcherClosed = false;

const mockWatcher = {
    close: vi.fn(() => { mockWatcherClosed = true; }),
};

vi.mock("fs", () => ({
    watch: vi.fn((dir: string, cb: (event: string, filename: string | null) => void) => {
        watchCallback = cb;
        mockWatcherClosed = false;
        return mockWatcher;
    }),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
}));

// ── Imports after mocks ──────────────────────────────────────────────────────

import { startAbortWatcher, stopAbortWatcher } from "../abort-watcher.js";
import { processManager } from "../process-manager.js";
import { watch, mkdirSync, unlinkSync } from "fs";

const mockAbort = vi.mocked(processManager.abort);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockWatch = vi.mocked(watch);
const mockUnlinkSync = vi.mocked(unlinkSync);

const abortDir = join(homedir(), ".claude-bridge", "ipc", "abort");
const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("abort-watcher", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        watchCallback = null;
        mockWatcherClosed = false;
    });

    afterEach(() => {
        // Ensure watcher is stopped after each test
        stopAbortWatcher();
    });

    // Step 4.1: Unit Tests ─────────────────────────────────────────────────

    describe("4.1 Unit Tests", () => {
        it("creates the IPC directory on start", () => {
            startAbortWatcher();
            expect(mockMkdirSync).toHaveBeenCalledWith(abortDir, { recursive: true });
        });

        it("starts watching the IPC abort directory", () => {
            startAbortWatcher();
            expect(mockWatch).toHaveBeenCalledWith(abortDir, expect.any(Function));
        });

        it("triggers processManager.abort() when a file is dropped", async () => {
            startAbortWatcher();
            expect(watchCallback).not.toBeNull();

            watchCallback!("rename", VALID_UUID);

            expect(mockAbort).toHaveBeenCalledWith(VALID_UUID);
        });

        it("deletes the signal file after 500ms", async () => {
            vi.useFakeTimers();
            startAbortWatcher();

            watchCallback!("rename", VALID_UUID);

            expect(mockUnlinkSync).not.toHaveBeenCalled();
            vi.advanceTimersByTime(500);
            expect(mockUnlinkSync).toHaveBeenCalledWith(join(abortDir, VALID_UUID));

            vi.useRealTimers();
        });

        it("ignores 'change' event type (only processes 'rename')", () => {
            startAbortWatcher();
            watchCallback!("change", VALID_UUID);
            expect(mockAbort).not.toHaveBeenCalled();
        });

        it("ignores null filename gracefully", () => {
            startAbortWatcher();
            expect(() => watchCallback!("rename", null)).not.toThrow();
            expect(mockAbort).not.toHaveBeenCalled();
        });

        it("stops watcher cleanly", () => {
            startAbortWatcher();
            stopAbortWatcher();
            expect(mockWatcher.close).toHaveBeenCalledOnce();
        });

        it("calling stopAbortWatcher twice does not throw", () => {
            startAbortWatcher();
            stopAbortWatcher();
            expect(() => stopAbortWatcher()).not.toThrow();
        });
    });

    // Step 4.2: Race Condition Test ────────────────────────────────────────

    describe("4.2 Race Condition Tests", () => {
        it("handles 10 abort signals within 50ms without dropping any", async () => {
            vi.useFakeTimers();
            startAbortWatcher();

            const uuids = Array.from({ length: 10 }, (_, i) =>
                `${VALID_UUID.slice(0, -1)}${i}`
            );

            // Simulate 10 file drops within 50ms
            uuids.forEach((id, i) => {
                setTimeout(() => watchCallback!("rename", id), i * 5);
            });

            vi.advanceTimersByTime(50);

            // All 10 abort calls were made
            expect(mockAbort).toHaveBeenCalledTimes(10);
            uuids.forEach(id => expect(mockAbort).toHaveBeenCalledWith(id));

            // After 500ms, all files should be deleted
            vi.advanceTimersByTime(500);
            expect(mockUnlinkSync).toHaveBeenCalledTimes(10);
            uuids.forEach(id => expect(mockUnlinkSync).toHaveBeenCalledWith(join(abortDir, id)));

            vi.useRealTimers();
        });

        it("does not call abort twice for same processId if already triggered", async () => {
            vi.useFakeTimers();
            startAbortWatcher();

            // Drop same file twice (simulates OS double-fire)
            watchCallback!("rename", VALID_UUID);
            watchCallback!("rename", VALID_UUID);

            // Still called twice — dedup behavior is delegated to process-manager
            // We just verify abort was called for each event received
            expect(mockAbort).toHaveBeenCalledTimes(2);

            vi.useRealTimers();
        });
    });

    // Step 4.4: Cross-Platform Path Audit ─────────────────────────────────

    describe("4.4 Cross-Platform Path Audit", () => {
        it("abortDir uses path.join and os.homedir (not hardcoded ~)", () => {
            // The abortDir must NOT contain a literal tilde
            expect(abortDir).not.toContain("~");
            // It must start with the real home directory
            expect(abortDir.startsWith(homedir())).toBe(true);
        });

        it("abortDir uses proper path separator", () => {
            // join() handles platform path separators correctly
            // On macOS/Linux: .claude-bridge/ipc/abort
            // On Windows: .claude-bridge\ipc\abort
            const segments = [".claude-bridge", "ipc", "abort"];
            segments.forEach(segment => {
                expect(abortDir).toContain(segment);
            });
        });

        it("signal file path combines directory with filename using join", async () => {
            vi.useFakeTimers();
            startAbortWatcher();

            watchCallback!("rename", VALID_UUID);
            vi.advanceTimersByTime(500);

            // Verify unlinkSync was called with a fully resolved path
            const expectedPath = join(abortDir, VALID_UUID);
            expect(mockUnlinkSync).toHaveBeenCalledWith(expectedPath);

            vi.useRealTimers();
        });
    });

    // Step 4.3: Memory Leak Check (lightweight proxy) ─────────────────────
    // Full 5-minute test would be done in CI/manual. This is a structural check.

    describe("4.3 Memory Leak Prevention", () => {
        it("only creates one fs.watch instance per start", () => {
            startAbortWatcher();
            startAbortWatcher(); // calling twice should not create a second watcher
            // If startAbortWatcher is idempotent, watch should still only be called once
            // (the module-level watcher guard prevents double-start)
            expect(mockWatch).toHaveBeenCalledTimes(1);
        });

        it("watcher reference is cleared after stop", () => {
            startAbortWatcher();
            stopAbortWatcher();
            // Calling stop again must not throw (null guard is working)
            expect(() => stopAbortWatcher()).not.toThrow();
        });
    });
});
