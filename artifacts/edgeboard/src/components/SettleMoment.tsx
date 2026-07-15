import { useEffect, useMemo } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { formatCurrency } from "@/lib/format"

export interface SettleMomentData {
  kind: "won" | "lost"
  /** Net profit on a win (payout minus stake); ignored on a loss. */
  profit?: number
  /** Amount lost (the stake); shown dryly on a loss. */
  lost?: number
}

const LOSS_LINES = [
  "The books thank you for your donation.",
  "Logged. The tape doesn't lie.",
  "That one's going in the film room.",
  "Even sharp process eats a bad beat.",
  "Your bankroll felt that. Your record will remember it.",
  "Chalk it up, learn the lesson, move on.",
]

const WIN_LINES = [
  "Cash it.",
  "That's a winner.",
  "The read was right.",
  "Ka-ching.",
  "Books pay up.",
]

// Deterministic-enough pick that still varies between settles.
function pickLine(lines: string[], seed: number) {
  return lines[Math.abs(seed) % lines.length]
}

const CONFETTI_COLORS = ["#22c55e", "#4ade80", "#facc15", "#60a5fa", "#f472b6"]

/**
 * A quick, skippable flourish after settling: a celebration on a win, a dry
 * one-liner on a loss. Renders as a fixed overlay, auto-dismisses, and any
 * tap dismisses it immediately — it never blocks the flow (the settle has
 * already saved by the time this shows).
 */
export function SettleMoment({ moment, onDone }: { moment: SettleMomentData | null; onDone: () => void }) {
  useEffect(() => {
    if (!moment) return
    const t = setTimeout(onDone, moment.kind === "won" ? 2600 : 2200)
    return () => clearTimeout(t)
  }, [moment, onDone])

  const seed = useMemo(() => (moment ? Math.floor((moment.profit ?? moment.lost ?? 0) * 100) + LOSS_LINES.length : 0), [moment])

  const confetti = useMemo(() => {
    if (!moment || moment.kind !== "won") return []
    return Array.from({ length: 30 }, (_, i) => ({
      id: i,
      x: (i / 30) * 100 + ((i * 37) % 11) - 5,
      delay: ((i * 13) % 7) / 10,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      rotate: ((i * 53) % 360) - 180,
      size: 8 + ((i * 17) % 8),
    }))
  }, [moment])

  return (
    <AnimatePresence>
      {moment && (
        <motion.div
          key="settle-moment"
          className="fixed inset-0 z-[100] flex items-center justify-center p-6 cursor-pointer"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
          onClick={onDone}
          role="status"
          aria-live="polite"
          data-testid={`settle-moment-${moment.kind}`}
        >
          {moment.kind === "won" && (
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
              {confetti.map((c) => (
                <motion.span
                  key={c.id}
                  className="absolute top-[-5%] rounded-sm"
                  style={{ left: `${c.x}%`, width: c.size, height: c.size * 0.45, backgroundColor: c.color }}
                  initial={{ y: 0, opacity: 1, rotate: 0 }}
                  animate={{ y: "110vh", opacity: [1, 1, 0.6], rotate: c.rotate }}
                  transition={{ duration: 2.4, delay: c.delay, ease: "easeIn" }}
                />
              ))}
            </div>
          )}

          <motion.div
            className="max-w-sm w-full rounded-2xl border bg-card px-8 py-10 text-center shadow-2xl relative overflow-hidden"
            style={{ 
              borderColor: moment.kind === "won" ? "hsl(var(--chart-1)/0.5)" : "hsl(var(--chart-2)/0.4)",
              boxShadow: moment.kind === "won" ? "0 0 40px hsl(var(--chart-1)/0.3)" : "0 0 40px hsl(var(--chart-2)/0.2)"
            }}
            initial={{ scale: 0.7, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 24 }}
          >
            {moment.kind === "won" && <div className="absolute inset-0 bg-gradient-to-t from-chart-1/5 to-transparent pointer-events-none" />}
            {moment.kind === "lost" && <div className="absolute inset-0 bg-gradient-to-t from-chart-2/5 to-transparent pointer-events-none" />}
            
            {moment.kind === "won" ? (
              <div className="relative z-10">
                <motion.div
                  className="text-6xl mb-4 drop-shadow-[0_0_15px_rgba(255,255,255,0.4)]"
                  initial={{ scale: 0 }}
                  animate={{ scale: [0, 1.4, 1] }}
                  transition={{ duration: 0.6, delay: 0.1 }}
                  aria-hidden
                >
                  💰
                </motion.div>
                <div className="text-2xl font-bold text-chart-1 text-glow-success">{pickLine(WIN_LINES, seed)}</div>
                {typeof moment.profit === "number" && moment.profit > 0 && (
                  <motion.div
                    className="mt-3 font-mono text-4xl font-bold text-chart-1 drop-shadow-[0_0_8px_hsl(var(--chart-1)/0.6)]"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    data-testid="settle-moment-profit"
                  >
                    +{formatCurrency(moment.profit)}
                  </motion.div>
                )}
              </div>
            ) : (
              <div className="relative z-10">
                <div className="text-5xl mb-4 opacity-80" aria-hidden>
                  🪦
                </div>
                <div className="text-xl font-bold text-chart-2 text-glow-destructive">{pickLine(LOSS_LINES, seed)}</div>
                {typeof moment.lost === "number" && moment.lost > 0 && (
                  <div className="mt-3 font-mono text-2xl font-bold text-chart-2/80 drop-shadow-[0_0_8px_hsl(var(--chart-2)/0.4)]">-{formatCurrency(moment.lost)}</div>
                )}
              </div>
            )}
            <div className="relative z-10 mt-6 text-[10px] uppercase tracking-widest text-muted-foreground font-mono">tap anywhere to continue</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
