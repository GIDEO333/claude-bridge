import { ChildProcess } from "child_process";

export interface AgentConfig {
    role: string;
    owns: string[];
    forbidden: string[];
    spawnPrompt: string;
}

export interface TeamConfig {
    mode: 1 | 2;
    agents: AgentConfig[];
    claudeMdPath: string;
    mailboxPath: string;
    timeoutMs: number;
}

export interface TeamStatus {
    timestamp: number;
    mode: number;
    agents: (ProcessStatus & { role: string })[];
    mailboxPath: string;
}

export interface ProcessStatus {
    processId: string;
    status: "running" | "exited" | "stuck";
    exitCode?: number;
    uptime: number; // in milliseconds
    lastOutputLine: string;
    mailboxSignals: string[];
    stuckDetection: boolean;
    teamContext?: TeamStatus;
}

export interface ToolResult {
    success: boolean;
    output: string;
    error?: string;
    processId?: string;
}

export interface ManagedProcess {
    id: string;
    process: ChildProcess;
    startedAt: Date;
    lastOutputAt: Date;
    outputBuffer: string[];
    exitCode: number | null;
    timeoutHandle?: NodeJS.Timeout;
}
