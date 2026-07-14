/**
 * Shared odds math for EdgeBoard.
 *
 * Storage canon: American odds as a whole number (int), magnitude >= 100.
 * Everything else (decimal 1.91, fractional 10/11) converts to/from that.
 *
 * Two ways to combine a parlay:
 *  - exact:      multiply exact decimal conversions of each American price.
 *                This is what the server stores and what payouts are based on.
 *  - book-style: multiply each leg's price rounded to 2 decimals first.
 *                This matches what books like bet365 display, since they show
 *                (and multiply) 2-decimal prices.
 */

export type OddsFormat = "american" | "decimal" | "fractional";

export const MIN_ODDS_MAGNITUDE = 100;

/** American odds are never between -99 and +99. */
export function isValidAmericanOdds(odds: number): boolean {
  return (
    Number.isFinite(odds) &&
    Number.isInteger(odds) &&
    Math.abs(odds) >= MIN_ODDS_MAGNITUDE
  );
}

/** Exact decimal price for an American price. e.g. -110 -> 1.9090909... */
export function americanToDecimal(american: number): number {
  if (american > 0) return american / 100 + 1;
  return 100 / Math.abs(american) + 1;
}

/** Nearest whole American price for a decimal price. e.g. 1.91 -> -110 */
export function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

/** Decimal price rounded the way books display it (2 dp). */
export function bookDecimal(american: number): number {
  return roundTo(americanToDecimal(american), 2);
}

/** Exact combined decimal for a parlay of American prices. */
export function combineDecimalExact(americanLegs: number[]): number {
  return americanLegs.reduce((acc, o) => acc * americanToDecimal(o), 1);
}

/** Book-style combined decimal: multiply each leg's 2-dp displayed price. */
export function combineDecimalBookStyle(americanLegs: number[]): number {
  return americanLegs.reduce((acc, o) => acc * bookDecimal(o), 1);
}

/** Combined American price for a parlay (exact math, rounded once at the end). */
export function combineAmerican(americanLegs: number[]): number {
  return decimalToAmerican(combineDecimalExact(americanLegs));
}

/** Total payout (stake included) using exact math — matches the server. */
export function parlayPayoutExact(americanLegs: number[], stake: number): number {
  return combineDecimalExact(americanLegs) * stake;
}

/** Total payout (stake included) for a single American price. */
export function payoutFromAmerican(american: number, stake: number): number {
  return americanToDecimal(american) * stake;
}

// ── Fractional ────────────────────────────────────────────────────────────────

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

/**
 * Fractional (UK) representation of an American price, reduced.
 * +150 -> "3/2", -110 -> "10/11", +100 -> "1/1" (evens).
 */
export function americanToFractional(american: number): string {
  let num: number;
  let den: number;
  if (american > 0) {
    num = american;
    den = 100;
  } else {
    num = 100;
    den = Math.abs(american);
  }
  const g = gcd(num, den);
  return `${num / g}/${den / g}`;
}

// ── Parsing user input ────────────────────────────────────────────────────────

export type ParsedOdds =
  | { ok: true; american: number }
  | { ok: false; error: string };

const AMERICAN_ERROR =
  "American odds are -100 or lower, or +100 or higher (e.g. -110, +150).";
const DECIMAL_ERROR = "Decimal odds must be greater than 1.00 (e.g. 1.91, 2.50).";
const FRACTIONAL_ERROR = "Enter fractional odds like 10/11 or 6/4.";

/**
 * Parse what the user typed, in the format they chose, into a stored American
 * price. Decimal and fractional prices snap to the nearest whole American price.
 */
export function parseOddsInput(raw: string, format: OddsFormat): ParsedOdds {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Odds are required." };

  if (format === "american") {
    if (!/^[+-]?\d+$/.test(text)) return { ok: false, error: AMERICAN_ERROR };
    const value = Number(text);
    if (!isValidAmericanOdds(value)) return { ok: false, error: AMERICAN_ERROR };
    return { ok: true, american: value };
  }

  if (format === "decimal") {
    if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, error: DECIMAL_ERROR };
    const value = Number(text);
    if (!Number.isFinite(value) || value <= 1) return { ok: false, error: DECIMAL_ERROR };
    const american = decimalToAmerican(value);
    if (!isValidAmericanOdds(american)) return { ok: false, error: DECIMAL_ERROR };
    return { ok: true, american };
  }

  // fractional
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (!m) return { ok: false, error: FRACTIONAL_ERROR };
  const num = Number(m[1]);
  const den = Number(m[2]);
  if (num <= 0 || den <= 0) return { ok: false, error: FRACTIONAL_ERROR };
  const decimal = num / den + 1;
  const american = decimalToAmerican(decimal);
  if (!isValidAmericanOdds(american)) return { ok: false, error: FRACTIONAL_ERROR };
  return { ok: true, american };
}

// ── Display ───────────────────────────────────────────────────────────────────

export function formatAmerican(american: number): string {
  return american > 0 ? `+${american}` : `${american}`;
}

export function formatDecimalOdds(american: number): string {
  return bookDecimal(american).toFixed(2);
}

/** Render a stored American price in the user's preferred format. */
export function formatOddsAs(american: number, format: OddsFormat): string {
  switch (format) {
    case "decimal":
      return formatDecimalOdds(american);
    case "fractional":
      return americanToFractional(american);
    default:
      return formatAmerican(american);
  }
}

function roundTo(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round((value + Number.EPSILON) * f) / f;
}
