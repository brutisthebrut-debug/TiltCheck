---
name: Ledger write guards
description: Concurrency rule for any mutation that touches settled bets/parlays or the bankroll ledger
---

Any write that settles a play or edits its money numbers must enforce the state check **in the UPDATE's WHERE clause** (`status = 'pending' AND settled_at IS NULL`) and 409 when no row returns — a pre-read check alone is a TOCTOU race.

**Why:** Settle routes insert a bankroll ledger row; two concurrent settles that both pass a read-then-write pre-check would double-book the balance, and a recompute/correction landing mid-settle would overwrite ledger-recorded payouts. Architect review rejected a recompute endpoint for exactly this.

**How to apply:** Bet settle, parlay settle, parlay leg correction, and parlay odds recompute all use this pattern (conditional update + `if (!row) throw {statusCode: 409}` inside the transaction). Any new mutation on bets/parlays/transactions must follow it.

Additionally: every ledger APPEND must serialize per user. Any code path inserting a transactions row derives `balanceAfter` from the previous latest row, so it must (1) run in a db.transaction, (2) take the per-user `pg_advisory_xact_lock` via the shared ledger-lock helper as its FIRST statement, (3) read the latest balance inside the lock, and (4) stamp `createdAt` with `clock_timestamp()` explicitly.

**Why (append rule):** Without the lock, a deposit and a settle landing together read the same snapshot and both write balances from it, breaking `balanceAfter[n] = balanceAfter[n-1] + amount[n]`. The `createdAt` default (`now()`) is transaction-START time, so a lock waiter would get an earlier timestamp than the row it chains onto and break `(createdAt, id)` ordering; JS `new Date()` is app-host time and can skew across instances — use the DB's `clock_timestamp()` inside the lock.
