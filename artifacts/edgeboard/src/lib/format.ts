import { format } from 'date-fns';

export function formatOdds(odds: number): string {
  if (odds > 0) {
    return `+${odds}`;
  }
  return odds.toString();
}

export function formatCurrency(amount: number, hideDecimalsIfZero = true): string {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: hideDecimalsIfZero && amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return formatter.format(amount);
}

export function formatDate(dateString: string): string {
  try {
    return format(new Date(dateString), 'MMM d, yyyy');
  } catch (e) {
    return dateString;
  }
}

export function formatDateTime(dateString: string): string {
  try {
    return format(new Date(dateString), 'MMM d, h:mm a');
  } catch (e) {
    return dateString;
  }
}

export function calculatePotentialPayout(stake: number, odds: number): number {
  if (odds < 0) {
    return stake * (100 / Math.abs(odds)) + stake;
  } else if (odds > 0) {
    return stake * (odds / 100) + stake;
  }
  return stake;
}

export function calculateProfit(stake: number, odds: number): number {
  return calculatePotentialPayout(stake, odds) - stake;
}
