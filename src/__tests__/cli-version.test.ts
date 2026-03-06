import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    isVersionAboveMin,
    loadManifest,
    detectCliVersion,
    captureCliSurface,
    getCompatReport,
    startupVersionCheck,
    type CliCompatManifest,
} from "../cli-version.js";

describe("cli-version — isVersionAboveMin (pure logic)", () => {
    it("returns true for exact match", () => {
        expect(isVersionAboveMin("2.1.59", "2.1.59")).toBe(true);
    });

    it("returns true for higher patch", () => {
        expect(isVersionAboveMin("2.1.60", "2.1.59")).toBe(true);
    });

    it("returns true for higher minor", () => {
        expect(isVersionAboveMin("2.2.0", "2.1.59")).toBe(true);
    });

    it("returns true for higher major", () => {
        expect(isVersionAboveMin("3.0.0", "2.1.59")).toBe(true);
    });

    it("returns false for lower version", () => {
        expect(isVersionAboveMin("1.9.0", "2.0.0")).toBe(false);
    });

    it("returns false for lower patch", () => {
        expect(isVersionAboveMin("2.1.58", "2.1.59")).toBe(false);
    });
});

describe("cli-version — loadManifest", () => {
    it("loads and parses cli-compat.json", async () => {
        const manifest = await loadManifest();

        expect(manifest.testedVersion).toBe("2.1.59");
        expect(manifest.minVersion).toBe("2.0.0");
        expect(manifest.knownFlags).toBeInstanceOf(Array);
        expect(manifest.knownFlags.length).toBeGreaterThan(30);
        expect(manifest.knownCommands).toBeInstanceOf(Array);
        expect(manifest.knownCommands).toContain("mcp");
        expect(manifest.usedFlags).toHaveProperty("-p, --print");
        expect(manifest.usedCommands).toHaveProperty("mcp add");
        expect(manifest.usedEnvVars).toHaveProperty("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS");
    });

    it("usedFlags map to real tool names", async () => {
        const manifest = await loadManifest();

        for (const [flag, info] of Object.entries(manifest.usedFlags)) {
            expect(info.usedBy.length).toBeGreaterThan(0);
            expect(info.purpose).toBeTruthy();
        }
    });
});

describe("cli-version — detectCliVersion (real CLI)", () => {
    it("detects installed Claude CLI version", async () => {
        const version = await detectCliVersion();

        // Should be a semver string like "2.1.59"
        if (version) {
            expect(version).toMatch(/^\d+\.\d+\.\d+$/);
        }
        // If null, CLI is not installed — still a valid result
    });
});

describe("cli-version — captureCliSurface (real CLI)", () => {
    it("captures flags and commands from --help", async () => {
        const surface = await captureCliSurface();

        if (surface.flags.length > 0) {
            // Should contain known flags
            expect(surface.flags.some((f) => f.includes("--print") || f.includes("-p"))).toBe(true);
            expect(surface.flags.some((f) => f.includes("--version") || f.includes("-v"))).toBe(true);
        }

        if (surface.commands.length > 0) {
            expect(surface.commands.some((c) => c.includes("mcp"))).toBe(true);
        }
    });
});

describe("cli-version — getCompatReport", () => {
    it("generates a structured compatibility report", async () => {
        const report = await getCompatReport();

        // Should have required fields
        expect(report).toHaveProperty("installedVersion");
        expect(report).toHaveProperty("testedVersion", "2.1.59");
        expect(report).toHaveProperty("isCompatible");
        expect(report).toHaveProperty("versionMatch");
        expect(report).toHaveProperty("addedFlags");
        expect(report).toHaveProperty("removedFlags");
        expect(report).toHaveProperty("addedCommands");
        expect(report).toHaveProperty("removedCommands");
        expect(report).toHaveProperty("affectedTools");
        expect(report).toHaveProperty("warnings");

        // Arrays should be arrays
        expect(report.addedFlags).toBeInstanceOf(Array);
        expect(report.removedFlags).toBeInstanceOf(Array);
        expect(report.warnings).toBeInstanceOf(Array);
    });

    it("reports compatible when same version", async () => {
        const report = await getCompatReport();

        if (report.installedVersion === "2.1.59") {
            expect(report.versionMatch).toBe(true);
        }
    });
});

describe("cli-version — startupVersionCheck", () => {
    it("does not throw even if CLI is missing", async () => {
        // startupVersionCheck is designed to be non-fatal
        await expect(startupVersionCheck()).resolves.not.toThrow();
    });
});
