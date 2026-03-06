import { execFile } from "child_process";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

export interface CliCompatManifest {
    testedVersion: string;
    minVersion: string;
    lastChecked: string;
    usedFlags: Record<string, { usedBy: string[]; purpose: string }>;
    usedCommands: Record<string, { usedBy: string[]; purpose: string }>;
    usedEnvVars: Record<string, { usedBy: string[]; purpose: string }>;
    knownFlags: string[];
    knownCommands: string[];
}

export interface CompatReport {
    installedVersion: string;
    testedVersion: string;
    isCompatible: boolean;
    versionMatch: boolean;
    addedFlags: string[];
    removedFlags: string[];
    addedCommands: string[];
    removedCommands: string[];
    affectedTools: string[];
    warnings: string[];
}

/**
 * Load the cli-compat.json manifest from project root.
 */
export async function loadManifest(): Promise<CliCompatManifest> {
    const thisFile = fileURLToPath(import.meta.url);
    const projectRoot = join(dirname(thisFile), "..");
    const manifestPath = join(projectRoot, "cli-compat.json");
    const raw = await readFile(manifestPath, "utf-8");
    return JSON.parse(raw);
}

/**
 * Run `claude --version` and parse the version string.
 * Returns version like "2.1.59" or null if CLI not found.
 */
export async function detectCliVersion(): Promise<string | null> {
    const claudePath = process.env.CLAUDE_CLI_PATH || "claude";

    return new Promise((resolve) => {
        execFile(claudePath, ["--version"], { timeout: 10000 }, (error, stdout) => {
            if (error) {
                resolve(null);
                return;
            }
            // Output is like "2.1.59 (Claude Code)" — extract semver
            const match = stdout.trim().match(/^(\d+\.\d+\.\d+)/);
            resolve(match ? match[1] : null);
        });
    });
}

/**
 * Run `claude --help` and extract all flags and commands.
 */
export async function captureCliSurface(): Promise<{ flags: string[]; commands: string[] }> {
    const claudePath = process.env.CLAUDE_CLI_PATH || "claude";

    return new Promise((resolve) => {
        execFile(claudePath, ["--help"], { timeout: 10000 }, (error, stdout) => {
            if (error) {
                resolve({ flags: [], commands: [] });
                return;
            }

            const lines = stdout.split("\n");
            const flags: string[] = [];
            const commands: string[] = [];
            let inCommands = false;

            for (const line of lines) {
                const trimmed = line.trim();

                if (trimmed === "Commands:") {
                    inCommands = true;
                    continue;
                }

                if (inCommands) {
                    // Command lines look like: "  mcp    Configure and manage MCP servers"
                    const cmdMatch = trimmed.match(/^(\S+(?:\|\S+)?)\s{2,}/);
                    if (cmdMatch) {
                        commands.push(cmdMatch[1]);
                    }
                } else {
                    // Flag lines look like: "  -p, --print   Print response and exit"
                    const flagMatch = trimmed.match(/^(-[\w-]+(?:,\s*--[\w-]+)?)/);
                    if (flagMatch) {
                        flags.push(flagMatch[1]);
                    }
                }
            }

            resolve({ flags, commands });
        });
    });
}

/**
 * Compare installed version semver with min version.
 */
export function isVersionAboveMin(installed: string, minVersion: string): boolean {
    const parse = (v: string) => v.split(".").map(Number);
    const [aMaj, aMin, aPatch] = parse(installed);
    const [bMaj, bMin, bPatch] = parse(minVersion);

    if (aMaj !== bMaj) return aMaj > bMaj;
    if (aMin !== bMin) return aMin > bMin;
    return aPatch >= bPatch;
}

/**
 * Generate a full compatibility report by comparing installed CLI with manifest.
 */
export async function getCompatReport(): Promise<CompatReport> {
    const manifest = await loadManifest();
    const installedVersion = await detectCliVersion();

    if (!installedVersion) {
        return {
            installedVersion: "NOT_FOUND",
            testedVersion: manifest.testedVersion,
            isCompatible: false,
            versionMatch: false,
            addedFlags: [],
            removedFlags: [],
            addedCommands: [],
            removedCommands: [],
            affectedTools: [],
            warnings: ["Claude CLI not found. Is it installed and in PATH?"],
        };
    }

    const versionMatch = installedVersion === manifest.testedVersion;
    const aboveMin = isVersionAboveMin(installedVersion, manifest.minVersion);

    // Capture current CLI surface
    const current = await captureCliSurface();

    // Diff flags
    const addedFlags = current.flags.filter(
        (f) => !manifest.knownFlags.some((known) => known.includes(f) || f.includes(known))
    );
    const removedFlags = manifest.knownFlags.filter(
        (known) => !current.flags.some((f) => known.includes(f) || f.includes(known))
    );

    // Diff commands
    const addedCommands = current.commands.filter(
        (c) => !manifest.knownCommands.includes(c.split("|")[0])
    );
    const removedCommands = manifest.knownCommands.filter(
        (known) => !current.commands.some((c) => c.split("|")[0] === known)
    );

    // Find affected tools
    const affectedTools: string[] = [];
    for (const removedFlag of removedFlags) {
        for (const [flag, info] of Object.entries(manifest.usedFlags)) {
            if (flag.includes(removedFlag) || removedFlag.includes(flag)) {
                affectedTools.push(...info.usedBy);
            }
        }
    }
    for (const removedCmd of removedCommands) {
        for (const [cmd, info] of Object.entries(manifest.usedCommands)) {
            if (cmd.includes(removedCmd)) {
                affectedTools.push(...info.usedBy);
            }
        }
    }

    const warnings: string[] = [];
    if (!versionMatch) {
        warnings.push(
            `Version mismatch: installed ${installedVersion}, tested ${manifest.testedVersion}`
        );
    }
    if (!aboveMin) {
        warnings.push(
            `Installed version ${installedVersion} is below minimum ${manifest.minVersion}`
        );
    }
    if (removedFlags.length > 0) {
        warnings.push(`${removedFlags.length} flags removed since v${manifest.testedVersion}`);
    }
    if (affectedTools.length > 0) {
        warnings.push(`Affected tools: ${[...new Set(affectedTools)].join(", ")}`);
    }

    return {
        installedVersion,
        testedVersion: manifest.testedVersion,
        isCompatible: aboveMin && removedFlags.length === 0,
        versionMatch,
        addedFlags,
        removedFlags,
        addedCommands,
        removedCommands,
        affectedTools: [...new Set(affectedTools)],
        warnings,
    };
}

/**
 * Run on startup — log warnings if compatibility issues detected.
 */
export async function startupVersionCheck(): Promise<void> {
    try {
        const report = await getCompatReport();

        if (!report.isCompatible) {
            console.error(`[claude-bridge] ⚠️  CLI compatibility issue detected:`);
            for (const w of report.warnings) {
                console.error(`[claude-bridge]   - ${w}`);
            }
        } else if (!report.versionMatch) {
            console.error(
                `[claude-bridge] ℹ️  CLI version ${report.installedVersion} (tested: ${report.testedVersion}) — compatible`
            );
        }
    } catch (error) {
        // Non-fatal: don't block server startup
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[claude-bridge] ℹ️  Could not check CLI version: ${msg}`);
    }
}
