import { z } from "zod";
import { spawn } from "child_process";

export const context7Schema = z.object({
    action: z.enum(["resolve-library-id", "query-docs"]),
    libraryName: z.string().optional(),
    libraryId: z.string().optional(),
    query: z.string(),
});

export const toolDefinition = {
    name: "context7_query",
    description: "Search Context7 documentation and code examples as a proxy to the official Context7 MCP. Use 'resolve-library-id' first to find the ID (requires 'query' and 'libraryName'), then 'query-docs' to get information (requires 'query' and 'libraryId').",
    inputSchema: {
        type: "object" as const,
        properties: {
            action: { type: "string", enum: ["resolve-library-id", "query-docs"], description: "The action to perform" },
            query: { type: "string", description: "The question or task you need help with" },
            libraryName: { type: "string", description: "Required for resolve-library-id" },
            libraryId: { type: "string", description: "Required for query-docs" }
        },
        required: ["action", "query"],
    },
};

export async function executeContext7Query(args: z.infer<typeof context7Schema>): Promise<{ success: boolean; output: string }> {
    if (args.action === "resolve-library-id" && !args.libraryName) {
        return { success: false, output: "Missing required argument 'libraryName' for action 'resolve-library-id'." };
    }
    if (args.action === "query-docs" && !args.libraryId) {
        return { success: false, output: "Missing required argument 'libraryId' for action 'query-docs'." };
    }

    return new Promise((resolve) => {
        const proc = spawn("/opt/homebrew/bin/npx", ["-y", "@upstash/context7-mcp"], {
            stdio: ["pipe", "pipe", "pipe"],
            cwd: process.cwd(),
        });

        let stdoutData = "";
        let stderrData = "";
        let responded = false;

        const timeoutId = setTimeout(() => {
            if (!responded) {
                responded = true;
                proc.kill("SIGKILL");
                resolve({ success: false, output: "Timeout waiting for Context7 MCP response." });
            }
        }, 15000); // 15 sec timeout for network-dependent queries

        proc.stdout.on("data", (data) => {
            if (responded) return;
            stdoutData += data.toString();
            
            // Try parsing each line of stdout, since MCP outputs JSON-RPC lines
            const lines = stdoutData.split("\n");
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.jsonrpc === "2.0" && parsed.id === 1) {
                        responded = true;
                        clearTimeout(timeoutId);
                        proc.kill();
                        
                        if (parsed.error) {
                            resolve({ success: false, output: `MCP Error: ${parsed.error.message || JSON.stringify(parsed.error)}` });
                            return;
                        }
                        if (parsed.result && parsed.result.content) {
                            const contentStr = parsed.result.content.map((c: any) => c.text).join("\n\n");
                            resolve({ success: true, output: contentStr });
                            return;
                        }
                        resolve({ success: true, output: JSON.stringify(parsed.result) });
                        return;
                    }
                } catch {
                    // Not valid JSON yet, wait for more chunks
                }
            }
        });

        proc.stderr.on("data", (data) => {
            stderrData += data.toString();
        });

        proc.on("error", (error) => {
            if (!responded) {
                responded = true;
                clearTimeout(timeoutId);
                resolve({ success: false, output: `Process spawn error: ${error.message}` });
            }
        });

        proc.on("close", (code) => {
            if (!responded) {
                responded = true;
                clearTimeout(timeoutId);
                resolve({ success: false, output: `Process closed unexpectedly with code ${code}. Stderr: ${stderrData.substring(0, 500)}` });
            }
        });

        // Construct JSON-RPC CallTool request
        const requestArgs: Record<string, string> = { query: args.query };
        if (args.action === "resolve-library-id" && args.libraryName) {
            requestArgs.libraryName = args.libraryName;
        } else if (args.action === "query-docs" && args.libraryId) {
            requestArgs.libraryId = args.libraryId;
        }

        const request = {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
                name: args.action,
                arguments: requestArgs
            }
        };

        try {
            proc.stdin.write(JSON.stringify(request) + "\n");
        } catch (e) {
            if (!responded) {
                responded = true;
                clearTimeout(timeoutId);
                resolve({ success: false, output: `Failed to write request: ${e}` });
            }
        }
    });
}
