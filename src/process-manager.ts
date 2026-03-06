import { spawn, ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import { ManagedProcess, ProcessStatus } from "./types.js";

class ProcessManager {
    private processes = new Map<string, ManagedProcess>();

    public spawn(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): string {
        const id = randomUUID();
        const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });

        const managedProcess: ManagedProcess = {
            id,
            process: child,
            startedAt: new Date(),
            lastOutputAt: new Date(),
            outputBuffer: [],
            exitCode: null,
        };

        if (timeoutMs > 0) {
            managedProcess.timeoutHandle = setTimeout(() => {
                this.abort(id);
            }, timeoutMs);
        }

        const handleOutput = (data: Buffer) => {
            managedProcess.lastOutputAt = new Date();
            const lines = data.toString().split("\n");
            // Remove empty lines at the end if there's trailing newline
            if (lines.length > 0 && lines[lines.length - 1] === "") {
                lines.pop();
            }
            managedProcess.outputBuffer.push(...lines);
            if (managedProcess.outputBuffer.length > 1000) {
                managedProcess.outputBuffer = managedProcess.outputBuffer.slice(-1000);
            }
        };

        if (child.stdout) child.stdout.on("data", handleOutput);
        if (child.stderr) child.stderr.on("data", handleOutput);

        child.on("close", (code, signal) => {
            // When killed by signal (SIGTERM/SIGKILL), code is null.
            // Use 128 as sentinel to mark signal-killed processes as exited.
            managedProcess.exitCode = code ?? (signal ? 128 : null);
            if (managedProcess.timeoutHandle) {
                clearTimeout(managedProcess.timeoutHandle);
            }
        });

        child.on("error", (error) => {
            managedProcess.outputBuffer.push(`Error: ${error.message}`);
        });

        this.processes.set(id, managedProcess);
        return id;
    }

    public getStatus(processId: string): ProcessStatus {
        const p = this.processes.get(processId);
        if (!p) {
            throw new Error(`Process ${processId} not found`);
        }

        const isRunning = p.exitCode === null;
        let stuckDetection = false;
        if (isRunning) {
            const timeSinceLastOutput = Date.now() - p.lastOutputAt.getTime();
            if (timeSinceLastOutput > 3 * 60 * 1000) { // 3 min
                stuckDetection = true;
            }
        }

        const statusStr = !isRunning ? "exited" : stuckDetection ? "stuck" : "running";

        return {
            processId,
            status: statusStr,
            exitCode: p.exitCode ?? undefined,
            uptime: Date.now() - p.startedAt.getTime(),
            lastOutputLine: p.outputBuffer[p.outputBuffer.length - 1] ?? "",
            mailboxSignals: [], // Populated by tools that use file-monitor
            stuckDetection,
        };
    }

    public getOutput(processId: string, lines?: number): string[] {
        const p = this.processes.get(processId);
        if (!p) return [];
        if (lines !== undefined && lines > 0) {
            return p.outputBuffer.slice(-lines);
        }
        return p.outputBuffer;
    }

    public abort(processId: string): void {
        const p = this.processes.get(processId);
        if (!p || p.exitCode !== null) return;

        // SIGTERM
        p.process.kill("SIGTERM");

        // Wait 5s, then SIGKILL if still alive
        setTimeout(() => {
            if (p.exitCode === null) {
                p.process.kill("SIGKILL");
            }
        }, 5000);
    }

    public cleanup(): void {
        for (const [_, p] of this.processes) {
            if (p.exitCode === null) {
                p.process.kill("SIGKILL");
            }
        }
        this.processes.clear();
    }

    public waitForExit(processId: string): Promise<number | null> {
        const p = this.processes.get(processId);
        if (!p) return Promise.reject(new Error("Process not found"));
        if (p.exitCode !== null) return Promise.resolve(p.exitCode);

        return new Promise((resolve) => {
            p.process.on("close", resolve);
        });
    }
}

export const processManager = new ProcessManager();
