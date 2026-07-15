/**
 * American odds validation shared across bet and parlay routes.
 *
 * American odds are never between -99 and +99: a price of 0, +50, or -20
 * does not exist. JSON Schema (and therefore the generated Zod schemas)
 * cannot express this "dead zone" directly, so routes enforce it here on
 * top of the spec's magnitude bounds.
 *
 * The math itself lives in @workspace/odds so the web client's builder
 * previews use the exact same formulas as the server.
 */
export {
  MIN_ODDS_MAGNITUDE,
  isValidAmericanOdds,
  americanToDecimal,
  decimalToAmerican,
  combineAmerican,
  combineDecimalExact,
  activeLegOdds,
} from "@workspace/odds";

export const INVALID_ODDS_MESSAGE =
  "Odds must be valid American odds: -100 or lower, or +100 or higher (values between -99 and +99 are not real prices).";
