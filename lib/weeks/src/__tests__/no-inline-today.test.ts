import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guard: all "today as YYYY-MM-DD" math must go through `dayOf` from
 * `@workspace/weeks`. An inline `new Date().toISOString().slice(0, 10)`
 * copy would silently drift if the shared timezone rules ever change,
 * so this test greps the workspace source and fails on any new copy.
 */

// lib/weeks/src/__tests__ -> repo root is four levels up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

// Only these locations may contain the pattern:
//  - lib/weeks/src: the shared helper itself (`dayOf`)
//  - artifacts/api-server/src/lib/dates.ts: intentional round-trip
//    validation of a submitted date string, not a "today" calculation
const ALLOWED = [join("lib", "weeks", "src"), join("artifacts", "api-server", "src", "lib", "dates.ts")];

// Catches `.slice(0, 10)` / `.substring(0, 10)` chained onto toISOString(),
// with or without whitespace.
const INLINE_TODAY = /toISOString\s*\(\s*\)\s*\.\s*(?:slice|substring|substr)\s*\(\s*0\s*,\s*10\s*\)/;

const SOURCE_DIRS = ["lib", "artifacts", "scripts"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git"]);
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function* walk(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // directory doesn't exist (e.g. no scripts/) — nothing to scan
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full);
    } else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
      yield full;
    }
  }
}

function isAllowed(relPath: string): boolean {
  return ALLOWED.some((allowed) => relPath === allowed || relPath.startsWith(allowed + sep));
}

describe("no inline 'today' date math outside @workspace/weeks", () => {
  it("finds no toISOString().slice(0, 10) copies outside the allowed files", () => {
    const offenders: string[] = [];
    for (const sourceDir of SOURCE_DIRS) {
      for (const file of walk(join(REPO_ROOT, sourceDir))) {
        const relPath = relative(REPO_ROOT, file);
        if (isAllowed(relPath)) continue;
        const content = readFileSync(file, "utf8");
        if (INLINE_TODAY.test(content)) offenders.push(relPath);
      }
    }
    expect(
      offenders,
      `Inline "today" date math found in: ${offenders.join(", ")}. ` +
        `Use dayOf() from @workspace/weeks instead of toISOString().slice(0, 10) ` +
        `so all "today" calculations share one timezone rule.`,
    ).toEqual([]);
  });

  it("still sees the shared helper and the allowed round-trip validation (sanity check)", () => {
    // If these files stop containing the pattern, the allowlist is stale and
    // should be cleaned up — and the guard above is proven to actually match.
    for (const allowedFile of [
      join(REPO_ROOT, "lib", "weeks", "src", "index.ts"),
      join(REPO_ROOT, "artifacts", "api-server", "src", "lib", "dates.ts"),
    ]) {
      expect(INLINE_TODAY.test(readFileSync(allowedFile, "utf8")), allowedFile).toBe(true);
    }
  });
});
