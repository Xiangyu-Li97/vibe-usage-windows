import { expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  kimiCredentialPath,
  kimiCredentialPaths,
  parseKimiUsage,
} from "../src-tauri/resources/cli/src/quotas/providers/kimi-code.js";

test("bundled CLI reads Kimi Code 2.x quota fields", () => {
  expect(parseKimiUsage({
    usages: {
      limit_5h: { used_ratio: 0.3, reset_time: "2026-09-11T18:00:00Z" },
      limit_7d: { used_ratio: 0.2, reset_time: "2026-09-17T00:00:00Z" },
    },
  })).toEqual([
    {
      id: "limit-5h", label: "5h", utilization: 30,
      resetsAt: "2026-09-11T18:00:00.000Z", windowSeconds: 18_000,
    },
    {
      id: "limit-7d", label: "7d", utilization: 20,
      resetsAt: "2026-09-17T00:00:00.000Z", windowSeconds: 604_800,
    },
  ]);
});

test("bundled CLI prefers the Kimi Code 2.x credential home", () => {
  const root = mkdtempSync(join(tmpdir(), "vibe-windows-kimi-home-"));
  const currentPath = join(root, ".kimi-code", "credentials", "kimi-code.json");
  const legacyPath = join(root, ".kimi", "credentials", "kimi-code.json");
  try {
    mkdirSync(join(root, ".kimi-code", "credentials"), { recursive: true });
    mkdirSync(join(root, ".kimi", "credentials"), { recursive: true });
    writeFileSync(currentPath, "{}");
    writeFileSync(legacyPath, "{}");

    expect(kimiCredentialPaths({}, root)).toEqual([currentPath, legacyPath]);
    expect(kimiCredentialPath({}, root)).toBe(currentPath);

    rmSync(join(root, ".kimi-code"), { recursive: true, force: true });
    expect(kimiCredentialPath({}, root)).toBe(legacyPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
