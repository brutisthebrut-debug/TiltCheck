import type { Request, Response, NextFunction } from "express";

/**
 * Gates the paid insight layer (leak profile + tilt check, edge finder,
 * head-to-head, reasoning insights). Must run after requireAuth.
 *
 * - Demo world stays open — the demo IS the sales pitch.
 * - Founders ride free.
 * - Everyone else needs a live server-verified horizon (users.proUntil),
 *   which only the billing routes write after confirming the membership with
 *   the payment provider. No client state can flip this gate.
 */
export function requirePro(req: Request, res: Response, next: NextFunction): void {
  const user = req.currentUser;
  if (!user) {
    res.status(403).json({ error: "No bettor profile linked to this account" });
    return;
  }
  if (user.isDemo || user.isFounder) {
    next();
    return;
  }
  if (user.proUntil && user.proUntil.getTime() > Date.now()) {
    next();
    return;
  }
  res.status(402).json({
    error: "pro_required",
    message: "TiltCheck Pro unlocks the insight layer — leak reads, edge finder, and head-to-head.",
  });
}
