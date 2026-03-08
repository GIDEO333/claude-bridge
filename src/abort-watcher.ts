import { watch, FSWatcher, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { processManager } from "./process-manager.js";

const abortDir = join(homedir(), ".claude-bridge", "ipc", "abort");
let watcher: FSWatcher | null = null;

export function startAbortWatcher() {
    if (watcher !== null) {
        return; // Already watching — prevent double-registration
    }
    mkdirSync(abortDir, { recursive: true });

    watcher = watch(abortDir, (eventType, filename) => {
        if (filename && eventType === 'rename') {
            const processId = filename;
            const fullPath = join(abortDir, filename);

            try {
                processManager.abort(processId);
                setTimeout(() => {
                    try {
                        unlinkSync(fullPath);
                        console.error(`[abort-watcher] Aborted process ${processId}`);
                    } catch (e) {
                        // Ignore if already deleted
                    }
                }, 500);
            } catch (err) {
                console.error(`[abort-watcher] Error handling abort for ${processId}:`, err);
            }
        }
    });
}

export function stopAbortWatcher() {
    if (watcher) {
        watcher.close();
        watcher = null;
    }
}
