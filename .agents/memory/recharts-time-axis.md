---
name: Recharts numeric time axis ticks
description: Numeric (scale="time") XAxis in recharts v2 needs an explicit ticks array or it renders a tick per point.
---

# Recharts numeric time axis ticks

**Rule:** For a recharts XAxis with `type="number"` + `scale="time"` over many data points, pass an explicit evenly-spaced `ticks` array (~5 values from dataMin to dataMax). `minTickGap`/`interval` do not prevent per-point ticks here.

**Why:** Without explicit ticks it generated a tick per data point — overlapping labels and React "duplicate key" console errors (seen on the bankroll balance-over-time chart).

**How to apply:** Compute `ticks` from the first/last timestamp before rendering; guard the single-point case (one tick).
