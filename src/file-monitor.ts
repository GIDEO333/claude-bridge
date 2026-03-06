import { watch, FSWatcher } from "chokidar";
import { readFile } from "fs/promises";
import { basename } from "path";

export interface MonitorCallbacks {
    onEscalation: (filePath: string, content: string) => void;
    onDone: (agentName: string, filePath: string, content: string) => void;
    onMessage: (from: string, to: string, filePath: string, content: string) => void;
    onAllDone: (doneFiles: string[]) => void;
}

let watcher: FSWatcher | null = null;
let detectedSignals: string[] = [];
let doneFiles: string[] = [];
let expectedAgents = 0;

async function readFileContent(filePath: string): Promise<string> {
    try {
        return await readFile(filePath, "utf-8");
    } catch {
        return "";
    }
}

function classifyFile(filePath: string, callbacks: MonitorCallbacks): void {
    const fileName = basename(filePath);

    // Only process .md files
    if (!fileName.endsWith(".md")) return;

    detectedSignals.push(filePath);

    if (fileName === "ESCALATION.md") {
        readFileContent(filePath).then((content) => {
            callbacks.onEscalation(filePath, content);
        });
        return;
    }

    // Match pattern: agentName-DONE.md
    const doneMatch = fileName.match(/^(.+)-DONE\.md$/);
    if (doneMatch) {
        const agentName = doneMatch[1];
        readFileContent(filePath).then((content) => {
            doneFiles.push(filePath);
            callbacks.onDone(agentName, filePath, content);

            if (expectedAgents > 0 && doneFiles.length >= expectedAgents) {
                callbacks.onAllDone([...doneFiles]);
            }
        });
        return;
    }

    // Match pattern: sender-to-receiver.md
    const messageMatch = fileName.match(/^(.+)-to-(.+)\.md$/);
    if (messageMatch) {
        const from = messageMatch[1];
        const to = messageMatch[2];
        readFileContent(filePath).then((content) => {
            callbacks.onMessage(from, to, filePath, content);
        });
        return;
    }
}

export function startMonitoring(
    mailboxPath: string,
    agentCount: number,
    callbacks: MonitorCallbacks
): void {
    if (watcher) {
        throw new Error("File monitor is already running. Call stopMonitoring() first.");
    }

    detectedSignals = [];
    doneFiles = [];
    expectedAgents = agentCount;

    watcher = watch(mailboxPath, {
        ignoreInitial: true,
        depth: 0,
        persistent: true,
        awaitWriteFinish: {
            stabilityThreshold: 500,
            pollInterval: 100,
        },
    });

    watcher.on("add", (filePath) => {
        classifyFile(filePath, callbacks);
    });

    watcher.on("error", (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`File monitor error: ${msg}`);
    });
}

export async function stopMonitoring(): Promise<void> {
    if (watcher) {
        await watcher.close();
        watcher = null;
    }
    detectedSignals = [];
    doneFiles = [];
    expectedAgents = 0;
}

export function getSignals(): string[] {
    return [...detectedSignals];
}
