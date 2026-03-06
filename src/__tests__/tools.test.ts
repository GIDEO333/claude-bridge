import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Schema imports (pure Zod, no side effects) ──────────────────────────
import { claudePromptSchema } from "../tools/claude-prompt.js";
import { claudeReviewSchema } from "../tools/claude-review.js";
import { claudeInitSchema } from "../tools/claude-init.js";
import { claudeSessionSchema } from "../tools/claude-session.js";
import { claudeMcpSchema } from "../tools/claude-mcp.js";
import { claudeAbortSchema } from "../tools/claude-abort.js";
import { claudeTeamsSchema } from "../tools/claude-teams.js";
import { claudeStatusSchema } from "../tools/claude-status.js";

// ── Execution imports ───────────────────────────────────────────────────
import { executeClaudePrompt } from "../tools/claude-prompt.js";
import { executeClaudeReview } from "../tools/claude-review.js";
import { executeClaudeInit } from "../tools/claude-init.js";
import { executeClaudeSession } from "../tools/claude-session.js";
import { executeClaudeMcp } from "../tools/claude-mcp.js";
import { executeClaudeAbort } from "../tools/claude-abort.js";
import { executeClaudeTeams } from "../tools/claude-teams.js";
import { executeClaudeStatus } from "../tools/claude-status.js";

// We mock the processManager to avoid spawning real Claude CLI
vi.mock("../process-manager.js", () => {
    const mockPM = {
        spawn: vi.fn().mockReturnValue("mock-uuid-1234"),
        waitForExit: vi.fn().mockResolvedValue(0),
        getOutput: vi.fn().mockReturnValue(["mock output line"]),
        getStatus: vi.fn().mockReturnValue({
            processId: "mock-uuid-1234",
            status: "running",
            uptime: 5000,
            lastOutputLine: "mock output",
            mailboxSignals: [],
            stuckDetection: false,
        }),
        abort: vi.fn(),
        cleanup: vi.fn(),
    };
    return { processManager: mockPM };
});

// Mock file-monitor for tools that use it
vi.mock("../file-monitor.js", () => ({
    startMonitoring: vi.fn(),
    stopMonitoring: vi.fn().mockResolvedValue(undefined),
    getSignals: vi.fn().mockReturnValue([]),
}));

// Mock fs/promises for teams
vi.mock("fs/promises", () => ({
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
}));

// Get the mocked processManager for assertions
import { processManager } from "../process-manager.js";
const mockPM = vi.mocked(processManager);

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1: SCHEMA VALIDATION TESTS
// ═══════════════════════════════════════════════════════════════════════

describe("Zod Schema Validation", () => {
    // ── claude-prompt ────────────────────────────────────────────────────

    describe("claudePromptSchema", () => {
        it("accepts valid input with prompt only", () => {
            const result = claudePromptSchema.parse({ prompt: "echo test" });
            expect(result.prompt).toBe("echo test");
        });

        it("accepts all optional fields", () => {
            const result = claudePromptSchema.parse({
                prompt: "test",
                cwd: "/tmp",
                outputFormat: "json",
            });
            expect(result.outputFormat).toBe("json");
        });

        it("rejects missing prompt", () => {
            expect(() => claudePromptSchema.parse({})).toThrow();
        });

        it("rejects invalid outputFormat", () => {
            expect(() =>
                claudePromptSchema.parse({ prompt: "x", outputFormat: "xml" })
            ).toThrow();
        });
    });

    // ── claude-review ────────────────────────────────────────────────────

    describe("claudeReviewSchema", () => {
        it("accepts valid input", () => {
            const result = claudeReviewSchema.parse({
                targetPath: "/src/index.ts",
            });
            expect(result.targetPath).toBe("/src/index.ts");
        });

        it("accepts with reviewType", () => {
            const result = claudeReviewSchema.parse({
                targetPath: "/src",
                reviewType: "security",
            });
            expect(result.reviewType).toBe("security");
        });

        it("rejects invalid reviewType", () => {
            expect(() =>
                claudeReviewSchema.parse({
                    targetPath: "/src",
                    reviewType: "invalid",
                })
            ).toThrow();
        });

        it("rejects missing targetPath", () => {
            expect(() => claudeReviewSchema.parse({})).toThrow();
        });
    });

    // ── claude-init ──────────────────────────────────────────────────────

    describe("claudeInitSchema", () => {
        it("accepts valid input", () => {
            const result = claudeInitSchema.parse({ cwd: "/tmp/project" });
            expect(result.cwd).toBe("/tmp/project");
        });

        it("accepts with projectName", () => {
            const result = claudeInitSchema.parse({
                cwd: "/tmp",
                projectName: "my-project",
            });
            expect(result.projectName).toBe("my-project");
        });

        it("rejects missing cwd", () => {
            expect(() => claudeInitSchema.parse({})).toThrow();
        });
    });

    // ── claude-session ───────────────────────────────────────────────────

    describe("claudeSessionSchema", () => {
        it("accepts continue action", () => {
            const result = claudeSessionSchema.parse({ action: "continue" });
            expect(result.action).toBe("continue");
        });

        it("accepts resume with sessionId", () => {
            const result = claudeSessionSchema.parse({
                action: "resume",
                sessionId: "abc-123",
            });
            expect(result.sessionId).toBe("abc-123");
        });

        it("accepts list action", () => {
            const result = claudeSessionSchema.parse({ action: "list" });
            expect(result.action).toBe("list");
        });

        it("rejects invalid action", () => {
            expect(() =>
                claudeSessionSchema.parse({ action: "restart" })
            ).toThrow();
        });
    });

    // ── claude-mcp ───────────────────────────────────────────────────────

    describe("claudeMcpSchema", () => {
        it("accepts list action", () => {
            const result = claudeMcpSchema.parse({ action: "list" });
            expect(result.action).toBe("list");
        });

        it("accepts add with serverName and configCommand", () => {
            const result = claudeMcpSchema.parse({
                action: "add",
                serverName: "test-server",
                configCommand: "node",
                configArgs: "server.js",
            });
            expect(result.serverName).toBe("test-server");
        });

        it("rejects invalid action", () => {
            expect(() =>
                claudeMcpSchema.parse({ action: "restart" })
            ).toThrow();
        });
    });

    // ── claude-abort ─────────────────────────────────────────────────────

    describe("claudeAbortSchema", () => {
        it("accepts valid processId", () => {
            const result = claudeAbortSchema.parse({
                processId: "uuid-abc-123",
            });
            expect(result.processId).toBe("uuid-abc-123");
        });

        it("rejects missing processId", () => {
            expect(() => claudeAbortSchema.parse({})).toThrow();
        });
    });

    // ── claude-status ────────────────────────────────────────────────────

    describe("claudeStatusSchema", () => {
        it("accepts valid processId", () => {
            const result = claudeStatusSchema.parse({
                processId: "uuid-abc-123",
            });
            expect(result.processId).toBe("uuid-abc-123");
        });

        it("rejects missing processId", () => {
            expect(() => claudeStatusSchema.parse({})).toThrow();
        });
    });

    // ── claude-teams ─────────────────────────────────────────────────────

    describe("claudeTeamsSchema", () => {
        it("accepts valid multi-agent config as JSON string", () => {
            const result = claudeTeamsSchema.parse({
                mode: 1,
                agents: JSON.stringify([
                    {
                        role: "frontend",
                        owns: ["src/ui"],
                        forbidden: ["src/api"],
                        spawnPrompt: "Build the UI",
                    },
                ]),
                claudeMdPath: "/project/CLAUDE.md",
                mailboxPath: "/project/.agent-teams/mailbox/",
            });
            expect(result.mode).toBe(1);
            expect(result.agents).toHaveLength(1);
        });

        it("rejects empty agents array", () => {
            expect(() =>
                claudeTeamsSchema.parse({
                    mode: 1,
                    agents: "[]",
                    claudeMdPath: "/CLAUDE.md",
                    mailboxPath: "/mailbox/",
                })
            ).toThrow();
        });

        it("rejects invalid mode", () => {
            expect(() =>
                claudeTeamsSchema.parse({
                    mode: 3,
                    agents: JSON.stringify([
                        {
                            role: "test",
                            owns: [],
                            forbidden: [],
                            spawnPrompt: "test",
                        },
                    ]),
                    claudeMdPath: "/CLAUDE.md",
                    mailboxPath: "/mailbox/",
                })
            ).toThrow();
        });

        it("rejects missing required fields", () => {
            expect(() => claudeTeamsSchema.parse({})).toThrow();
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 2: TOOL EXECUTION TESTS (mocked processManager)
// ═══════════════════════════════════════════════════════════════════════

describe("Tool Execution (mocked)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset defaults
        mockPM.spawn.mockReturnValue("mock-uuid-1234");
        mockPM.waitForExit.mockResolvedValue(0);
        mockPM.getOutput.mockReturnValue(["mock output"]);
        mockPM.getStatus.mockReturnValue({
            processId: "mock-uuid-1234",
            status: "running" as const,
            uptime: 5000,
            lastOutputLine: "mock output",
            mailboxSignals: [],
            stuckDetection: false,
        });
    });

    // ── executeClaudePrompt ──────────────────────────────────────────────

    describe("executeClaudePrompt", () => {
        it("returns success with output on exit code 0", async () => {
            mockPM.getOutput.mockReturnValue(["hello world"]);

            const result = await executeClaudePrompt({ prompt: "echo hello" });

            expect(result.success).toBe(true);
            expect(result.output).toBe("hello world");
            expect(result.processId).toBe("mock-uuid-1234");
            expect(mockPM.spawn).toHaveBeenCalledOnce();
        });

        it("returns failure on non-zero exit code", async () => {
            mockPM.waitForExit.mockResolvedValue(1);
            mockPM.getOutput.mockReturnValue(["error occurred"]);

            const result = await executeClaudePrompt({ prompt: "bad" });

            expect(result.success).toBe(false);
            expect(result.error).toContain("exited with code 1");
        });

        it("passes outputFormat to CLI args", async () => {
            await executeClaudePrompt({
                prompt: "test",
                outputFormat: "json",
            });

            const spawnArgs = mockPM.spawn.mock.calls[0][1];
            expect(spawnArgs).toContain("--output-format");
            expect(spawnArgs).toContain("json");
        });
    });

    // ── executeClaudeReview ──────────────────────────────────────────────

    describe("executeClaudeReview", () => {
        it("returns success with review output", async () => {
            mockPM.getOutput.mockReturnValue(["## Review Report", "No issues"]);

            const result = await executeClaudeReview({
                targetPath: "/src/index.ts",
            });

            expect(result.success).toBe(true);
            expect(result.output).toContain("Review Report");
        });

        it("includes reviewType in the prompt", async () => {
            await executeClaudeReview({
                targetPath: "/src",
                reviewType: "security",
            });

            const spawnArgs = mockPM.spawn.mock.calls[0][1];
            const prompt = spawnArgs[1]; // -p <prompt>
            expect(prompt).toContain("security");
        });
    });

    // ── executeClaudeInit ────────────────────────────────────────────────

    describe("executeClaudeInit", () => {
        it("returns claudeMdPath on success", async () => {
            const testCwd = process.env.HOME || "/Users/testuser";
            const result = await executeClaudeInit({ cwd: `${testCwd}/project` });

            expect(result.success).toBe(true);
            expect(result.claudeMdPath).toBe(`${testCwd}/project/CLAUDE.md`);
        });

        it("includes projectName in prompt when provided", async () => {
            const testCwd = process.env.HOME || "/Users/testuser";
            await executeClaudeInit({
                cwd: testCwd,
                projectName: "my-app",
            });

            const spawnArgs = mockPM.spawn.mock.calls[0][1];
            const prompt = spawnArgs[1];
            expect(prompt).toContain("my-app");
        });

        it("returns failure on non-zero exit", async () => {
            mockPM.waitForExit.mockResolvedValue(1);
            const testCwd = process.env.HOME || "/Users/testuser";

            const result = await executeClaudeInit({ cwd: testCwd });

            expect(result.success).toBe(false);
            expect(result.error).toContain("exited with code 1");
        });
    });

    // ── executeClaudeSession ─────────────────────────────────────────────

    describe("executeClaudeSession", () => {
        it("continue returns processId without waiting", async () => {
            const result = await executeClaudeSession({ action: "continue" });

            expect(result.success).toBe(true);
            expect(result.processId).toBe("mock-uuid-1234");
            // continue should NOT call waitForExit
            expect(mockPM.waitForExit).not.toHaveBeenCalled();
        });

        it("resume requires sessionId", async () => {
            const result = await executeClaudeSession({ action: "resume" });

            expect(result.success).toBe(false);
            expect(result.error).toContain("sessionId is required");
        });

        it("resume with sessionId returns processId", async () => {
            const result = await executeClaudeSession({
                action: "resume",
                sessionId: "abc-123",
            });

            expect(result.success).toBe(true);
            expect(result.processId).toBe("mock-uuid-1234");
        });

        it("list waits for exit and returns output", async () => {
            mockPM.getOutput.mockReturnValue(["session-1", "session-2"]);

            const result = await executeClaudeSession({ action: "list" });

            expect(result.success).toBe(true);
            expect(mockPM.waitForExit).toHaveBeenCalled();
            expect(result.output).toContain("session-1");
        });
    });

    // ── executeClaudeMcp ─────────────────────────────────────────────────

    describe("executeClaudeMcp", () => {
        it("list builds correct args", async () => {
            await executeClaudeMcp({ action: "list" });

            const spawnArgs = mockPM.spawn.mock.calls[0][1];
            expect(spawnArgs).toEqual(["mcp", "list"]);
        });

        it("add validates serverName and config", async () => {
            const result = await executeClaudeMcp({ action: "add" });

            expect(result.success).toBe(false);
            expect(result.error).toContain("serverName");
        });

        it("add builds correct args with configCommand", async () => {
            await executeClaudeMcp({
                action: "add",
                serverName: "my-server",
                configCommand: "node",
                configArgs: "server.js",
            });

            const spawnArgs = mockPM.spawn.mock.calls[0][1];
            expect(spawnArgs).toContain("add");
            expect(spawnArgs).toContain("my-server");
            expect(spawnArgs).toContain("node");
            expect(spawnArgs).toContain("server.js");
        });

        it("remove validates serverName", async () => {
            const result = await executeClaudeMcp({ action: "remove" });

            expect(result.success).toBe(false);
            expect(result.error).toContain("serverName");
        });
    });

    // ── executeClaudeAbort ───────────────────────────────────────────────

    describe("executeClaudeAbort", () => {
        it("sends abort for running process", async () => {
            const result = await executeClaudeAbort({
                processId: "mock-uuid-1234",
            });

            expect(result.success).toBe(true);
            expect(result.message).toContain("Abort signal sent");
            expect(mockPM.abort).toHaveBeenCalledWith("mock-uuid-1234");
        });

        it("returns success for already exited process", async () => {
            mockPM.getStatus.mockReturnValue({
                processId: "mock-uuid-1234",
                status: "exited" as const,
                exitCode: 0,
                uptime: 1000,
                lastOutputLine: "",
                mailboxSignals: [],
                stuckDetection: false,
            });

            const result = await executeClaudeAbort({
                processId: "mock-uuid-1234",
            });

            expect(result.success).toBe(true);
            expect(result.message).toContain("already exited");
            expect(mockPM.abort).not.toHaveBeenCalled();
        });

        it("handles errors gracefully", async () => {
            mockPM.getStatus.mockImplementation(() => {
                throw new Error("Process not found");
            });

            const result = await executeClaudeAbort({
                processId: "invalid-id",
            });

            expect(result.success).toBe(false);
            expect(result.message).toContain("Process not found");
        });
    });

    // ── executeClaudeStatus ──────────────────────────────────────────────

    describe("executeClaudeStatus", () => {
        it("returns process status with mailbox signals", async () => {
            const result = await executeClaudeStatus({
                processId: "mock-uuid-1234",
            });

            expect(result.success).toBe(true);
            expect(result.data?.processId).toBe("mock-uuid-1234");
            expect(result.data?.status).toBe("running");
        });

        it("handles unknown process gracefully", async () => {
            mockPM.getStatus.mockImplementation(() => {
                throw new Error("Process xyz not found");
            });

            const result = await executeClaudeStatus({
                processId: "xyz",
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain("not found");
        });
    });

    // ── executeClaudeTeams ───────────────────────────────────────────────

    describe("executeClaudeTeams", () => {
        it("spawns N agents and returns processIds", async () => {
            mockPM.spawn
                .mockReturnValueOnce("proc-1")
                .mockReturnValueOnce("proc-2");

            const result = await executeClaudeTeams({
                mode: 1,
                agents: [
                    {
                        role: "frontend",
                        owns: ["src/ui"],
                        forbidden: ["src/api"],
                        spawnPrompt: "Build UI",
                    },
                    {
                        role: "backend",
                        owns: ["src/api"],
                        forbidden: ["src/ui"],
                        spawnPrompt: "Build API",
                    },
                ] as any,
                claudeMdPath: "/project/CLAUDE.md",
                mailboxPath: "/tmp/test-mailbox",
                timeoutMs: 60000,
            });

            expect(result.success).toBe(true);
            expect(result.processIds).toEqual(["proc-1", "proc-2"]);
            expect(mockPM.spawn).toHaveBeenCalledTimes(2);
            expect(result.output).toContain("Scatter-Gather");
            expect(result.output).toContain("frontend");
            expect(result.output).toContain("backend");
        });

        it("uses --dangerously-skip-permissions flag", async () => {
            await executeClaudeTeams({
                mode: 2,
                agents: [
                    {
                        role: "reviewer",
                        owns: ["/tmp"],
                        forbidden: [],
                        spawnPrompt: "Review code",
                    },
                ] as any,
                claudeMdPath: "/CLAUDE.md",
                mailboxPath: "/tmp/mailbox",
                timeoutMs: 60000,
            });

            const spawnArgs = mockPM.spawn.mock.calls[0][1];
            expect(spawnArgs).toContain("--dangerously-skip-permissions");
        });

        it("sets CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS env var", async () => {
            await executeClaudeTeams({
                mode: 1,
                agents: [
                    {
                        role: "test",
                        owns: [],
                        forbidden: [],
                        spawnPrompt: "test",
                    },
                ] as any,
                claudeMdPath: "/CLAUDE.md",
                mailboxPath: "/tmp/mailbox",
                timeoutMs: 60000,
            });

            const env = mockPM.spawn.mock.calls[0][3];
            expect(env).toHaveProperty(
                "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
                "1"
            );
        });

        it("mode 2 shows 'Reflection' in output", async () => {
            const result = await executeClaudeTeams({
                mode: 2,
                agents: [
                    {
                        role: "reviewer",
                        owns: [],
                        forbidden: [],
                        spawnPrompt: "review",
                    },
                ] as any,
                claudeMdPath: "/CLAUDE.md",
                mailboxPath: "/tmp/mailbox",
                timeoutMs: 60000,
            });

            expect(result.output).toContain("Reflection");
        });

        it("builds ownership constraint prompt for each agent", async () => {
            await executeClaudeTeams({
                mode: 1,
                agents: [
                    {
                        role: "frontend",
                        owns: ["src/ui"],
                        forbidden: ["src/api"],
                        spawnPrompt: "Build the UI",
                    },
                ] as any,
                claudeMdPath: "/CLAUDE.md",
                mailboxPath: "/tmp/mailbox",
                timeoutMs: 60000,
            });

            const spawnArgs = mockPM.spawn.mock.calls[0][1];
            const prompt = spawnArgs[2]; // --dangerously-skip-permissions -p <prompt>
            expect(prompt).toContain("You are frontend");
            expect(prompt).toContain("src/ui");
            expect(prompt).toContain("FORBIDDEN");
            expect(prompt).toContain("src/api");
            expect(prompt).toContain("Build the UI");
        });

        it("calls mkdir to ensure mailbox directory exists", async () => {
            const { mkdir } = await import("fs/promises");
            const mockMkdir = vi.mocked(mkdir);

            await executeClaudeTeams({
                mode: 1,
                agents: [
                    {
                        role: "test",
                        owns: [],
                        forbidden: [],
                        spawnPrompt: "test",
                    },
                ] as any,
                claudeMdPath: "/CLAUDE.md",
                mailboxPath: "/tmp/test-mailbox-dir",
                timeoutMs: 60000,
            });

            expect(mockMkdir).toHaveBeenCalledWith(
                "/tmp/test-mailbox-dir",
                { recursive: true }
            );
        });

        it("calls startMonitoring with correct agent count", async () => {
            const { startMonitoring } = await import("../file-monitor.js");
            const mockStartMon = vi.mocked(startMonitoring);

            await executeClaudeTeams({
                mode: 1,
                agents: [
                    {
                        role: "a",
                        owns: [],
                        forbidden: [],
                        spawnPrompt: "task-a",
                    },
                    {
                        role: "b",
                        owns: [],
                        forbidden: [],
                        spawnPrompt: "task-b",
                    },
                ] as any,
                claudeMdPath: "/CLAUDE.md",
                mailboxPath: "/tmp/mb",
                timeoutMs: 60000,
            });

            expect(mockStartMon).toHaveBeenCalledOnce();
            expect(mockStartMon.mock.calls[0][0]).toBe("/tmp/mb"); // mailboxPath
            expect(mockStartMon.mock.calls[0][1]).toBe(2); // agentCount
        });
    });

    // ── ADDITIONAL MISSING TESTS ─────────────────────────────────────────

    describe("executeClaudeReview — extra", () => {
        it("returns failure on non-zero exit code", async () => {
            mockPM.waitForExit.mockResolvedValue(1);
            mockPM.getOutput.mockReturnValue(["review error"]);

            const result = await executeClaudeReview({
                targetPath: "/src/index.ts",
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain("exited with code 1");
        });

        it("includes targetPath in review prompt", async () => {
            await executeClaudeReview({
                targetPath: "/path/to/file.ts",
            });

            const spawnArgs = mockPM.spawn.mock.calls[0][1];
            const prompt = spawnArgs[1]; // -p <prompt>
            expect(prompt).toContain("/path/to/file.ts");
        });
    });

    describe("executeClaudeSession — extra", () => {
        it("continue passes -c flag to spawn", async () => {
            await executeClaudeSession({ action: "continue" });

            const spawnArgs = mockPM.spawn.mock.calls[0][1];
            expect(spawnArgs).toContain("-c");
        });

        it("resume passes -r with sessionId to spawn", async () => {
            await executeClaudeSession({
                action: "resume",
                sessionId: "session-xyz",
            });

            const spawnArgs = mockPM.spawn.mock.calls[0][1];
            expect(spawnArgs).toContain("-r");
            expect(spawnArgs).toContain("session-xyz");
        });

        it("list returns failure on non-zero exit code", async () => {
            mockPM.waitForExit.mockResolvedValue(1);
            mockPM.getOutput.mockReturnValue(["error listing"]);

            const result = await executeClaudeSession({ action: "list" });

            expect(result.success).toBe(false);
            expect(result.error).toContain("exited with code 1");
        });
    });

    describe("executeClaudeMcp — extra", () => {
        it("remove with valid serverName builds correct args", async () => {
            mockPM.getOutput.mockReturnValue(["removed"]);

            const result = await executeClaudeMcp({
                action: "remove",
                serverName: "old-server",
            });

            expect(result.success).toBe(true);
            const spawnArgs = mockPM.spawn.mock.calls[0][1];
            expect(spawnArgs).toContain("remove");
            expect(spawnArgs).toContain("old-server");
        });

        it("mcp command failure returns error", async () => {
            mockPM.waitForExit.mockResolvedValue(1);
            mockPM.getOutput.mockReturnValue(["mcp error"]);

            const result = await executeClaudeMcp({ action: "list" });

            expect(result.success).toBe(false);
            expect(result.error).toContain("exited with code 1");
        });
    });
});

