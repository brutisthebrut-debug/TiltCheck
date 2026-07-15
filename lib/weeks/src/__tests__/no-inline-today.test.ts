import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guard: all "today as YYYY-MM-DD" math must go through `dayOf` from
 * `@workspace/weeks`. Any inline copy — `toISOString().slice(0, 10)`,
 * `toISOString().split("T")[0]`, a date library's
 * `format(new Date(), "yyyy-MM-dd")`, or the `en-CA`/`sv-SE` locale trick —
 * would silently drift if the shared timezone rules ever change, so this
 * test greps the workspace source and fails on any new copy.
 */

// lib/weeks/src/__tests__ -> repo root is four levels up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

// Only these locations may contain the patterns:
//  - lib/weeks/src: the shared helper itself (`dayOf`) and this guard's
//    own regression fixtures below
//  - artifacts/api-server/src/lib/dates.ts: intentional round-trip
//    validation of a submitted date string, not a "today" calculation
const ALLOWED = [join("lib", "weeks", "src"), join("artifacts", "api-server", "src", "lib", "dates.ts")];

// Each entry is one idiom that yields a date-only string and therefore a
// second, driftable definition of "today" when used outside @workspace/weeks.
const INLINE_TODAY_PATTERNS: ReadonlyArray<{ name: string; regex: RegExp }> = [
  {
    // .toISOString().slice(0, 10) / .substring(0, 10) / .substr(0, 10)
    // Date.prototype.toJSON() returns the same ISO string, so the toJSON()
    // spelling is the same hidden "today" definition and is matched too.
    name: "toISOString()/toJSON().slice(0, 10)",
    regex: /to(?:ISOString|JSON)\s*\(\s*\)\s*\.\s*(?:slice|substring|substr)\s*\(\s*0\s*,\s*10\s*\)/,
  },
  {
    // .toISOString().split("T")[0] — any quote style; toJSON() is the same
    // ISO string, so it's matched too.
    name: 'toISOString()/toJSON().split("T")[0]',
    regex: /to(?:ISOString|JSON)\s*\(\s*\)\s*\.\s*split\s*\(\s*["'`]T["'`]\s*\)\s*\[\s*0\s*\]/,
  },
  {
    // date-fns style: format(new Date(), "yyyy-MM-dd")
    // Only a no-argument `new Date()` (i.e. "now") counts — formatting an
    // existing date value for display is fine.
    name: 'format(new Date(), "yyyy-MM-dd")',
    regex: /\bformat\s*\(\s*new\s+Date\s*\(\s*\)\s*,\s*["'`](?:yyyy-MM-dd|YYYY-MM-DD)["'`]/,
  },
  {
    // dayjs()/moment() with a date-only format token
    name: 'dayjs()/moment().format("YYYY-MM-DD")',
    regex: /\b(?:dayjs|moment)\s*\(\s*\)\s*\.\s*format\s*\(\s*["'`](?:YYYY-MM-DD|yyyy-MM-dd)["'`]/,
  },
  {
    // Hand-built date string from parts: `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
    // (template literal or string concatenation, local or UTC getters). The
    // local-getter form is the worst offender: it uses the device's timezone,
    // so it disagrees with the UTC `dayOf()` near midnight. We require a
    // hyphen joiner right after getFullYear() (`}-` in a template literal or
    // a quoted "-" in concatenation) followed by getMonth() and getDate()
    // nearby, so legitimate standalone getter uses (e.g. showing just the
    // year, or `new Date(y, m, d)` construction) don't match.
    name: "hand-built `${getFullYear()}-${getMonth()+1}-${getDate()}` string",
    regex:
      /get(?:UTC)?FullYear\s*\(\s*\)[\s\S]{0,40}?(?:\}\s*-|["'`]\s*-|-\s*["'`])[\s\S]{0,80}?get(?:UTC)?Month\s*\(\s*\)[\s\S]{0,120}?get(?:UTC)?Date\s*\(\s*\)/,
  },
  {
    // JSON.stringify(new Date()) yields the ISO timestamp wrapped in quotes
    // ("2026-07-15T…"), so .slice(1, 11) / .substring(1, 11) — or the
    // equivalent .substr(1, 10) — extracts the same YYYY-MM-DD string with
    // the offsets shifted by one. Same hidden "today" definition, matched
    // regardless of what's stringified (any Date-valued expression counts;
    // one nesting level of parens like `new Date()` is handled).
    name: "JSON.stringify(new Date()).slice(1, 11)",
    regex:
      /JSON\s*\.\s*stringify\s*\((?:[^()]|\([^()]*\))*\)\s*\.\s*(?:(?:slice|substring)\s*\(\s*1\s*,\s*11\s*\)|substr\s*\(\s*1\s*,\s*10\s*\))/,
  },
  {
    // Locale trick: en-CA and sv-SE default date formats are YYYY-MM-DD, so
    // `new Date().toLocaleDateString("en-CA")` or
    // `new Intl.DateTimeFormat("sv-SE").format(...)` are hidden `dayOf` copies.
    name: 'toLocaleDateString/Intl.DateTimeFormat with "en-CA"/"sv-SE"',
    regex: /(?:toLocaleDateString|Intl\s*\.\s*DateTimeFormat)\s*\(\s*["'`](?:en-CA|sv-SE)["'`]/,
  },
];

// Two-step spelling of the same idioms: the ISO string is stored in a
// variable first, then sliced on a later line —
//   const iso = new Date().toISOString();
//   const today = iso.slice(0, 10);
// The intermediate variable breaks the single-expression regexes above, so
// we pair up (a) variables assigned directly from `toISOString()`/`toJSON()`
// (statement must END with the call — further chaining is already covered
// by the one-liner patterns) with (b) a later date-shaped extraction applied
// to that exact variable name in the same file. Same for
// `JSON.stringify(...)` variables followed by the quote-shifted
// `.slice(1, 11)` / `.substr(1, 10)`.
const ISO_VAR_ASSIGNMENT =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\r\n]*?\bto(?:ISOString|JSON)\s*\(\s*\)\s*;?\s*$/gm;
const STRINGIFY_VAR_ASSIGNMENT =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*JSON\s*\.\s*stringify\s*\((?:[^()]|\([^()]*\))*\)\s*;?\s*$/gm;

function isoSliceOf(name: string): RegExp {
  // NAME.slice(0, 10) / .substring(0, 10) / .substr(0, 10) / .split("T")[0]
  return new RegExp(
    String.raw`\b${name}\s*\.\s*(?:(?:slice|substring|substr)\s*\(\s*0\s*,\s*10\s*\)|split\s*\(\s*["'` +
      "`" +
      String.raw`]T["'` +
      "`" +
      String.raw`]\s*\)\s*\[\s*0\s*\])`,
  );
}

function stringifySliceOf(name: string): RegExp {
  // NAME.slice(1, 11) / .substring(1, 11) / .substr(1, 10) — offsets shifted
  // by the leading quote JSON.stringify wraps around the ISO timestamp.
  return new RegExp(
    String.raw`\b${name}\s*\.\s*(?:(?:slice|substring)\s*\(\s*1\s*,\s*11\s*\)|substr\s*\(\s*1\s*,\s*10\s*\))`,
  );
}

/**
 * Returns a description for each variable that is assigned an ISO timestamp
 * (or a JSON-stringified one) and later has a date-only prefix extracted
 * from it — the two-step spelling of the inline-"today" idioms.
 */
function findTwoStepToday(content: string): string[] {
  const findings: string[] = [];
  for (const match of content.matchAll(ISO_VAR_ASSIGNMENT)) {
    const name = match[1];
    if (isoSliceOf(name).test(content)) {
      findings.push(`two-step toISOString()/toJSON() then \`${name}.slice(0, 10)\`-style extraction`);
    }
  }
  for (const match of content.matchAll(STRINGIFY_VAR_ASSIGNMENT)) {
    const name = match[1];
    if (stringifySliceOf(name).test(content)) {
      findings.push(`two-step JSON.stringify(...) then \`${name}.slice(1, 11)\`-style extraction`);
    }
  }
  return findings;
}

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
  it("finds no date-only 'today' formatting outside the allowed files", () => {
    const offenders: string[] = [];
    for (const sourceDir of SOURCE_DIRS) {
      for (const file of walk(join(REPO_ROOT, sourceDir))) {
        const relPath = relative(REPO_ROOT, file);
        if (isAllowed(relPath)) continue;
        const content = readFileSync(file, "utf8");
        for (const { name, regex } of INLINE_TODAY_PATTERNS) {
          if (regex.test(content)) offenders.push(`${relPath} (${name})`);
        }
        for (const finding of findTwoStepToday(content)) {
          offenders.push(`${relPath} (${finding})`);
        }
      }
    }
    expect(
      offenders,
      `Inline "today" date math found in: ${offenders.join(", ")}. ` +
        `Use dayOf() from @workspace/weeks instead of formatting new Date() ` +
        `to YYYY-MM-DD inline, so all "today" calculations share one timezone rule.`,
    ).toEqual([]);
  });

  it("still sees the shared helper and the allowed round-trip validation (sanity check)", () => {
    // If these files stop containing the pattern, the allowlist is stale and
    // should be cleaned up — and the guard above is proven to actually match.
    const isoSlice = INLINE_TODAY_PATTERNS[0].regex;
    for (const allowedFile of [
      join(REPO_ROOT, "lib", "weeks", "src", "index.ts"),
      join(REPO_ROOT, "artifacts", "api-server", "src", "lib", "dates.ts"),
    ]) {
      expect(isoSlice.test(readFileSync(allowedFile, "utf8")), allowedFile).toBe(true);
    }
  });

  // Regression fixtures: each pattern must catch the idiom it targets and
  // must NOT flag legitimate display formatting of an existing date value.
  const shouldMatch: Array<[string, string]> = [
    ["toISOString()/toJSON().slice(0, 10)", "const t = new Date().toISOString().slice(0, 10);"],
    ["toISOString()/toJSON().slice(0, 10)", "const t = now.toISOString().substring(0, 10);"],
    ["toISOString()/toJSON().slice(0, 10)", "const t = new Date().toJSON().slice(0, 10);"],
    ["toISOString()/toJSON().slice(0, 10)", "const t = now.toJSON().substring(0, 10);"],
    ["toISOString()/toJSON().slice(0, 10)", "const t = now.toJSON().substr(0, 10);"],
    ['toISOString()/toJSON().split("T")[0]', "const t = new Date().toISOString().split('T')[0];"],
    ['toISOString()/toJSON().split("T")[0]', 'const t = new Date().toISOString().split("T")[0];'],
    ['toISOString()/toJSON().split("T")[0]', "const t = new Date().toJSON().split('T')[0];"],
    ['toISOString()/toJSON().split("T")[0]', 'const t = new Date().toJSON().split("T")[0];'],
    ['format(new Date(), "yyyy-MM-dd")', "const t = format(new Date(), 'yyyy-MM-dd');"],
    ['dayjs()/moment().format("YYYY-MM-DD")', "const t = dayjs().format('YYYY-MM-DD');"],
    ['dayjs()/moment().format("YYYY-MM-DD")', "const t = moment().format('YYYY-MM-DD');"],
    [
      "JSON.stringify(new Date()).slice(1, 11)",
      "const t = JSON.stringify(new Date()).slice(1, 11);",
    ],
    [
      "JSON.stringify(new Date()).slice(1, 11)",
      "const t = JSON.stringify(now).substring(1, 11);",
    ],
    ["JSON.stringify(new Date()).slice(1, 11)", "const t = JSON.stringify(now).substr(1, 10);"],
    [
      'toLocaleDateString/Intl.DateTimeFormat with "en-CA"/"sv-SE"',
      "const t = new Date().toLocaleDateString('en-CA');",
    ],
    [
      'toLocaleDateString/Intl.DateTimeFormat with "en-CA"/"sv-SE"',
      "const t = new Intl.DateTimeFormat('sv-SE').format(new Date());",
    ],
    [
      "hand-built `${getFullYear()}-${getMonth()+1}-${getDate()}` string",
      "const t = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;",
    ],
    [
      "hand-built `${getFullYear()}-${getMonth()+1}-${getDate()}` string",
      "const t = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());",
    ],
    [
      "hand-built `${getFullYear()}-${getMonth()+1}-${getDate()}` string",
      'const t = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;',
    ],
  ];

  const shouldNotMatch: string[] = [
    // Display formatting of an existing date value, not a "today" calculation:
    "return format(new Date(dateString), 'MMM d, yyyy');",
    "return format(new Date(dateString), 'MMM d, h:mm a');",
    // Locale display formatting that doesn't produce YYYY-MM-DD:
    "d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });",
    // Full ISO timestamp kept intact:
    "const ts = new Date().toISOString();",
    "const ts = new Date().toJSON();",
    // toJSON on a non-Date value with unrelated arguments:
    "const body = payload.toJSON().slice(1);",
    // Ordinary JSON serialization, no date-shaped slice:
    "const body = JSON.stringify(payload);",
    "const body = JSON.stringify(payload, null, 2);",
    "const preview = JSON.stringify(data).slice(0, 100);",
    // Trimming the quotes off a stringified non-date value:
    "const inner = JSON.stringify(key).slice(1, -1);",
    // Splitting something other than the ISO timestamp:
    "const parts = header.split('T')[0];",
    // Legitimate standalone getter uses — showing just the year:
    "const year = d.getFullYear();",
    "const label = `${d.getFullYear()} season`;",
    // Constructing a Date from parts (no string assembly, comma-joined):
    "return new Date(d.getFullYear(), d.getMonth(), d.getDate());",
    // Arithmetic between getters (minus sign but no string joiner):
    "const age = now.getFullYear() - birth.getFullYear();",
  ];

  it.each(shouldMatch)("pattern %s catches: %s", (name, snippet) => {
    const pattern = INLINE_TODAY_PATTERNS.find((p) => p.name === name)!;
    expect(pattern.regex.test(snippet)).toBe(true);
  });

  it.each(shouldNotMatch)("no pattern falsely flags: %s", (snippet) => {
    for (const { name, regex } of INLINE_TODAY_PATTERNS) {
      expect(regex.test(snippet), `${name} should not match: ${snippet}`).toBe(false);
    }
  });

  // Two-step regression fixtures: the ISO string is stored in a variable
  // first and sliced on a later line. Each caught snippet is one file's
  // worth of content; each safe snippet must produce zero findings.
  const twoStepShouldMatch: string[] = [
    'const iso = new Date().toISOString();\nconst today = iso.slice(0, 10);',
    'const iso = now.toISOString()\nconst today = iso.substring(0, 10);',
    'let stamp = new Date().toJSON();\nconst day = stamp.substr(0, 10);',
    "const iso = new Date().toISOString();\nconst today = iso.split('T')[0];",
    'const iso = new Date().toISOString();\nconst today = iso.split("T")[0];',
    // Slicing can come before the assignment textually (e.g. in a helper
    // defined above) — same file, same variable name, still a hidden "today".
    'function day() { return iso.slice(0, 10); }\nconst iso = new Date().toISOString();',
    'const wrapped = JSON.stringify(new Date());\nconst today = wrapped.slice(1, 11);',
    'const wrapped = JSON.stringify(now);\nconst today = wrapped.substring(1, 11);',
    'const wrapped = JSON.stringify(new Date());\nconst today = wrapped.substr(1, 10);',
  ];

  const twoStepShouldNotMatch: string[] = [
    // ISO string kept whole — no date-only extraction:
    'const iso = new Date().toISOString();\nreturn res.json({ createdAt: iso });',
    // Slicing a variable that was never assigned an ISO timestamp:
    'const header = req.headers.etag;\nconst prefix = header.slice(0, 10);',
    // ISO variable sliced with non-date-shaped offsets (time-of-day, etc.):
    'const iso = new Date().toISOString();\nconst hour = iso.slice(11, 13);',
    'const iso = new Date().toISOString();\nconst year = iso.slice(0, 4);',
    // Different variable is sliced than the one holding the ISO string:
    'const iso = new Date().toISOString();\nconst prefix = other.slice(0, 10);',
    // Stringified non-date trimmed of quotes, not sliced to a date:
    'const inner = JSON.stringify(key);\nconst body = inner.slice(1, -1);',
    // Stringify result sliced for a preview, not a date:
    'const s = JSON.stringify(data);\nconst preview = s.slice(0, 100);',
    // splitting a non-ISO variable on "T":
    "const header = req.headers.x;\nconst parts = header.split('T')[0];",
    // Assignment keeps chaining past the call (one-liner patterns own this):
    'const today = new Date().toISOString().slice(0, 10);\nconst other = today.trim();',
  ];

  it.each(twoStepShouldMatch)("two-step detector catches: %s", (snippet) => {
    expect(findTwoStepToday(snippet).length, snippet).toBeGreaterThan(0);
  });

  it.each(twoStepShouldNotMatch)("two-step detector does not flag: %s", (snippet) => {
    expect(findTwoStepToday(snippet), snippet).toEqual([]);
  });
});
