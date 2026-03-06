import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawn } from "child_process";

// We need to test ProcessManager in isolation.
// Because process-manager.ts exports a singleton, we re-import each test suite fresh.
// For unit tests we use real system commands (echo, sleep, cat) — no Claude dependency.

// Helper: create a fresh ProcessManager per test
async function createProcessManager() {
    // Dynamic import to get the class each time
    const mod = await import("../process-manager.js");
    return mod.processManager;
}

describe("ProcessManager", () => {
    let pm: Awaited<ReturnType<typeof createProcessManager>>;

    beforeEach(async () => {
        pm = await createProcessManager();
    });

    afterEach(() => {
        pm.cleanup();
    });

    // ─── spawn() ─────────────────────────────────────────────────────────

    it("spawn() returns a UUID string", () => {
        const id = pm.spawn("echo", ["hello"], "/tmp", {}, 0);
        expect(id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        );
    });

    // ─── waitForExit() ───────────────────────────────────────────────────

    it("waitForExit() resolves with exit code 0 on success", async () => {
        const id = pm.spawn("echo", ["hello"], "/tmp", {}, 0);
        const exitCode = await pm.waitForExit(id);
        expect(exitCode).toBe(0);
    });

    it("waitForExit() resolves with non-zero exit code on failure", async () => {
        const id = pm.spawn("bash", ["-c", "exit 42"], "/tmp", {}, 0);
        const exitCode = await pm.waitForExit(id);
        expect(exitCode).toBe(42);
    });

    it("waitForExit() rejects for unknown process ID", async () => {
        await expect(pm.waitForExit("non-existent-id")).rejects.toThrow(
            "Process not found"
        );
    });

    // ─── getOutput() ─────────────────────────────────────────────────────

    it("getOutput() captures stdout", async () => {
        const id = pm.spawn("echo", ["hello world"], "/tmp", {}, 0);
        await pm.waitForExit(id);
        const output = pm.getOutput(id);
        expect(output).toContain("hello world");
    });

    it("getOutput(lines) slices to the last N lines", async () => {
        const id = pm.spawn(
            "bash",
            ["-c", "for i in $(seq 1 20); do echo line-$i; done"],
            "/tmp",
            {},
            0
        );
        await pm.waitForExit(id);
        const last5 = pm.getOutput(id, 5);
        expect(last5).toHaveLength(5);
        expect(last5[0]).toBe("line-16");
        expect(last5[4]).toBe("line-20");
    });

    it("getOutput() returns empty array for unknown process", () => {
        const output = pm.getOutput("non-existent");
        expect(output).toEqual([]);
    });

    // ─── getStatus() ─────────────────────────────────────────────────────

    it("getStatus() returns 'running' for an active process", async () => {
        const id = pm.spawn("sleep", ["5"], "/tmp", {}, 0);
        const status = pm.getStatus(id);
        expect(status.status).toBe("running");
        expect(status.processId).toBe(id);
        expect(status.uptime).toBeGreaterThanOrEqual(0);
        expect(status.exitCode).toBeUndefined();
    });

    it("getStatus() returns 'exited' after process completes", async () => {
        const id = pm.spawn("echo", ["done"], "/tmp", {}, 0);
        await pm.waitForExit(id);
        const status = pm.getStatus(id);
        expect(status.status).toBe("exited");
        expect(status.exitCode).toBe(0);
    });

    it("getStatus() throws for unknown process ID", () => {
        expect(() => pm.getStatus("bogus-id")).toThrow("Process bogus-id not found");
    });

    // ─── stderr captured ─────────────────────────────────────────────────

    it("captures stderr output alongside stdout", async () => {
        const id = pm.spawn(
            "bash",
            ["-c", "echo out-msg; echo err-msg >&2"],
            "/tmp",
            {},
            0
        );
        await pm.waitForExit(id);
        const output = pm.getOutput(id);
        expect(output).toContain("out-msg");
        expect(output).toContain("err-msg");
    });

    // ─── abort() ─────────────────────────────────────────────────────────

    it("abort() terminates a running process", async () => {
        const id = pm.spawn("sleep", ["60"], "/tmp", {}, 0);

        // Verify it's running
        expect(pm.getStatus(id).status).toBe("running");

        // Abort it
        pm.abort(id);

        // Wait for process to actually exit
        await pm.waitForExit(id);
        // Small delay for the 'close' handler to update exitCode
        await new Promise((r) => setTimeout(r, 50));
        expect(pm.getStatus(id).status).toBe("exited");
    });

    it("abort() is a no-op for already exited process", async () => {
        const id = pm.spawn("echo", ["quick"], "/tmp", {}, 0);
        await pm.waitForExit(id);

        // Should not throw
        expect(() => pm.abort(id)).not.toThrow();
    });

    // ─── timeout ─────────────────────────────────────────────────────────

    it("timeout auto-aborts the process", async () => {
        // Spawn with a 500ms timeout
        const id = pm.spawn("sleep", ["60"], "/tmp", {}, 500);

        // Wait for process to be killed by timeout
        await pm.waitForExit(id);
        // Small delay for the 'close' handler to update exitCode
        await new Promise((r) => setTimeout(r, 50));

        const status = pm.getStatus(id);
        expect(status.status).toBe("exited");
    });

    // ─── cleanup() ───────────────────────────────────────────────────────

    it("cleanup() kills all running processes", async () => {
        const id1 = pm.spawn("sleep", ["60"], "/tmp", {}, 0);
        const id2 = pm.spawn("sleep", ["60"], "/tmp", {}, 0);

        expect(pm.getStatus(id1).status).toBe("running");
        expect(pm.getStatus(id2).status).toBe("running");

        pm.cleanup();

        // After cleanup, getStatus should throw since processes map is cleared
        expect(() => pm.getStatus(id1)).toThrow();
        expect(() => pm.getStatus(id2)).toThrow();
    });

    // ─── output buffer cap ───────────────────────────────────────────────

    it("output buffer is capped at 1000 lines", async () => {
        // Generate 1200 lines
        const id = pm.spawn(
            "bash",
            ["-c", "for i in $(seq 1 1200); do echo line-$i; done"],
            "/tmp",
            {},
            0
        );
        await pm.waitForExit(id);
        const output = pm.getOutput(id);
        expect(output.length).toBeLessThanOrEqual(1000);
        // Should contain the latest lines, not the earliest
        expect(output[output.length - 1]).toBe("line-1200");
    });

    // ─── stuck detection ──────────────────────────────────────────────────

    it("detects stuck process after 3 minutes of silence", async () => {
        const id = pm.spawn("sleep", ["300"], "/tmp", {}, 0);

        // Manually set lastOutputAt to 4 minutes ago to simulate silence
        expect(pm.getStatus(id).status).toBe("running");

        // Access internal state to tweak lastOutputAt
        const mod = await import("../process-manager.js");
        const internalPM = mod.processManager as any;
        const proc = internalPM.processes?.get(id);
        if (proc) {
            proc.lastOutputAt = new Date(Date.now() - 4 * 60 * 1000); // 4 min ago
        }

        const status = pm.getStatus(id);
        expect(status.status).toBe("stuck");
        expect(status.stuckDetection).toBe(true);
    });
});
