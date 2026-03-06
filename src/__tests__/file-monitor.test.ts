import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// file-monitor uses module-level state, so we import directly
import {
    startMonitoring,
    stopMonitoring,
    getSignals,
} from "../file-monitor.js";

describe("file-monitor", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "claude-bridge-test-"));
    });

    afterEach(async () => {
        await stopMonitoring();
        await rm(tmpDir, { recursive: true, force: true });
    });

    // ─── classifyFile routing via live chokidar ──────────────────────────

    it("detects ESCALATION.md and triggers onEscalation callback", async () => {
        const escalationFn = vi.fn();
        const doneFn = vi.fn();
        const messageFn = vi.fn();
        const allDoneFn = vi.fn();

        startMonitoring(tmpDir, 1, {
            onEscalation: escalationFn,
            onDone: doneFn,
            onMessage: messageFn,
            onAllDone: allDoneFn,
        });

        // Wait for watcher to be ready
        await new Promise((r) => setTimeout(r, 600));

        await writeFile(join(tmpDir, "ESCALATION.md"), "Agent stuck on error X");

        // Wait for chokidar + awaitWriteFinish
        await new Promise((r) => setTimeout(r, 1500));

        expect(escalationFn).toHaveBeenCalledOnce();
        expect(escalationFn.mock.calls[0][0]).toContain("ESCALATION.md");
        expect(escalationFn.mock.calls[0][1]).toContain("Agent stuck");
    });

    it("detects agentName-DONE.md and triggers onDone callback", async () => {
        const doneFn = vi.fn();
        const allDoneFn = vi.fn();

        startMonitoring(tmpDir, 2, {
            onEscalation: vi.fn(),
            onDone: doneFn,
            onMessage: vi.fn(),
            onAllDone: allDoneFn,
        });

        await new Promise((r) => setTimeout(r, 600));

        await writeFile(join(tmpDir, "frontend-DONE.md"), "Frontend done");

        await new Promise((r) => setTimeout(r, 1500));

        expect(doneFn).toHaveBeenCalledOnce();
        expect(doneFn.mock.calls[0][0]).toBe("frontend"); // agentName
        expect(doneFn.mock.calls[0][2]).toContain("Frontend done"); // content
    });

    it("detects sender-to-receiver.md and triggers onMessage callback", async () => {
        const messageFn = vi.fn();

        startMonitoring(tmpDir, 1, {
            onEscalation: vi.fn(),
            onDone: vi.fn(),
            onMessage: messageFn,
            onAllDone: vi.fn(),
        });

        await new Promise((r) => setTimeout(r, 600));

        await writeFile(
            join(tmpDir, "frontend-to-backend.md"),
            "Need API endpoint"
        );

        await new Promise((r) => setTimeout(r, 1500));

        expect(messageFn).toHaveBeenCalledOnce();
        expect(messageFn.mock.calls[0][0]).toBe("frontend"); // from
        expect(messageFn.mock.calls[0][1]).toBe("backend"); // to
    });

    it("ignores non-.md files", async () => {
        const doneFn = vi.fn();
        const escalationFn = vi.fn();
        const messageFn = vi.fn();

        startMonitoring(tmpDir, 1, {
            onEscalation: escalationFn,
            onDone: doneFn,
            onMessage: messageFn,
            onAllDone: vi.fn(),
        });

        await new Promise((r) => setTimeout(r, 600));

        await writeFile(join(tmpDir, "data.json"), '{"test": true}');
        await writeFile(join(tmpDir, "notes.txt"), "some notes");

        await new Promise((r) => setTimeout(r, 1500));

        expect(doneFn).not.toHaveBeenCalled();
        expect(escalationFn).not.toHaveBeenCalled();
        expect(messageFn).not.toHaveBeenCalled();
    });

    it("onAllDone fires when all agents complete", async () => {
        const allDoneFn = vi.fn();

        startMonitoring(tmpDir, 2, {
            onEscalation: vi.fn(),
            onDone: vi.fn(),
            onMessage: vi.fn(),
            onAllDone: allDoneFn,
        });

        await new Promise((r) => setTimeout(r, 600));

        // Write first agent done
        await writeFile(join(tmpDir, "frontend-DONE.md"), "done");
        await new Promise((r) => setTimeout(r, 1200));

        expect(allDoneFn).not.toHaveBeenCalled();

        // Write second agent done
        await writeFile(join(tmpDir, "backend-DONE.md"), "done");
        await new Promise((r) => setTimeout(r, 1200));

        expect(allDoneFn).toHaveBeenCalledOnce();
        expect(allDoneFn.mock.calls[0][0]).toHaveLength(2);
    });

    // ─── getSignals() ────────────────────────────────────────────────────

    it("getSignals() returns accumulated file paths", async () => {
        startMonitoring(tmpDir, 1, {
            onEscalation: vi.fn(),
            onDone: vi.fn(),
            onMessage: vi.fn(),
            onAllDone: vi.fn(),
        });

        await new Promise((r) => setTimeout(r, 600));

        await writeFile(join(tmpDir, "test-DONE.md"), "done");
        await new Promise((r) => setTimeout(r, 1500));

        const signals = getSignals();
        expect(signals.length).toBeGreaterThanOrEqual(1);
        expect(signals[0]).toContain("test-DONE.md");
    });

    // ─── stopMonitoring() ────────────────────────────────────────────────

    it("stopMonitoring() resets state", async () => {
        startMonitoring(tmpDir, 1, {
            onEscalation: vi.fn(),
            onDone: vi.fn(),
            onMessage: vi.fn(),
            onAllDone: vi.fn(),
        });

        await stopMonitoring();

        // After stopping, signals should be cleared
        expect(getSignals()).toEqual([]);
    });

    // ─── double start guard ──────────────────────────────────────────────

    it("double startMonitoring() throws", () => {
        startMonitoring(tmpDir, 1, {
            onEscalation: vi.fn(),
            onDone: vi.fn(),
            onMessage: vi.fn(),
            onAllDone: vi.fn(),
        });

        expect(() =>
            startMonitoring(tmpDir, 1, {
                onEscalation: vi.fn(),
                onDone: vi.fn(),
                onMessage: vi.fn(),
                onAllDone: vi.fn(),
            })
        ).toThrow("File monitor is already running");
    });
});
