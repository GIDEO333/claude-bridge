import { executeClaudePrompt } from "./dist/tools/claude-prompt.js";
import { executeClaudeStatus } from "./dist/tools/claude-status.js";
import { executeClaudeReview } from "./dist/tools/claude-review.js";
import { executeClaudeInit } from "./dist/tools/claude-init.js";
import fs from "fs/promises";

async function run() {
    try {
        console.log("=== Testing claude_prompt ===");
        const p1 = await executeClaudePrompt({ prompt: "echo test" });
        console.log(p1);

        if (p1.processId) {
            console.log("\n=== Testing claude_status ===");
            const s1 = await executeClaudeStatus({ processId: p1.processId });
            console.log(s1);
        }

        console.log("\n=== Testing claude_init ===");
        await fs.mkdir("/tmp/test-project", { recursive: true });
        const i1 = await executeClaudeInit({ cwd: "/tmp/test-project" });
        console.log(JSON.stringify(i1, null, 2));

        console.log("\n=== Testing claude_review ===");
        await fs.writeFile("/tmp/test-project/test.txt", "hello world");
        const r1 = await executeClaudeReview({ targetPath: "/tmp/test-project/test.txt" });
        console.log(JSON.stringify(r1, null, 2));

    } catch (e) {
        console.error("Test failed", e);
    }
}

run();
