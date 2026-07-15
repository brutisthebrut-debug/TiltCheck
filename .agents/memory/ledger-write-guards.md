---
name: Ledger write guards
description: Concurrency rule for any mutation that touches settled bets/parlays or the bankroll ledger
---

Any write that settles a play or edits its money numbers must enforce the state check **in the UPDATE's WHERE clause** (`status = 'pending' AND settled_at IS NULL`) and 409 when no row returns — a pre-read check alone is a TOCTOU race.

**Why:** Settle routes insert a bankroll ledger row; two concurrent settles that both pass a read-then-write pre-check would double-book the balance, and a recompute/correction landing mid-settle would overwrite ledger-recorded payouts. Architect review rejected a recompute endpoint for exactly this.

**How to apply:** Bet settle, parlay settle, parlay leg correction, and parlay odds recompute all use this pattern (conditional update + `if (!row) throw {statusCode: 409}` inside the transaction). Any new mutation on bets/parlays/transactions must follow it.
