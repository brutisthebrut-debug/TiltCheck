/**
 * Minimal RFC 4180 CSV writer.
 *
 * - Fields containing commas, double quotes, or line breaks are wrapped in
 *   double quotes with embedded quotes doubled, so files open cleanly in
 *   Excel / Google Sheets.
 * - CRLF row separators (what Excel expects).
 * - Free-text fields whose first non-whitespace character is a formula
 *   trigger (= + - @ tab CR) are prefixed with a single quote to neutralize
 *   CSV/formula injection when the file is opened in a spreadsheet. Numbers
 *   are emitted as-is, so negative amounts are unaffected.
 */

export type CsvValue = string | number | boolean | null | undefined;

const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

export function csvField(value: CsvValue, opts: { guardFormulas?: boolean } = {}): string {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";

  let text = value;
  const firstMeaningful = text.trimStart()[0];
  if (opts.guardFormulas !== false && firstMeaningful !== undefined && FORMULA_TRIGGERS.has(firstMeaningful)) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Render a header row plus data rows into a single CSV string. */
export function toCsv(header: string[], rows: CsvValue[][]): string {
  const lines = [header.map((h) => csvField(h, { guardFormulas: false })).join(",")];
  for (const row of rows) {
    lines.push(row.map((v) => csvField(v)).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
