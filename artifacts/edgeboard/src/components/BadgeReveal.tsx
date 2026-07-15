import { useEffect } from "react"
import { AnimatePresence, motion } from "framer-motion"
import type { BadgeStatus } from "@workspace/api-client-react"

/**
 * Full-screen, skippable reveal for a freshly earned badge. Same contract as
 * SettleMoment: the badge is already persisted server-side by the time this
 * shows, auto-dismisses, and any tap dismisses immediately.
 */
export function BadgeReveal({ badge, onDone }: { badge: BadgeStatus | null; onDone: () => void }) {
  useEffect(() => {
    if (!badge) return
    const t = setTimeout(onDone, 3500)
    return () => clearTimeout(t)
  }, [badge, onDone])

  return (
    <AnimatePresence>
      {badge && (
        <motion.div
          key={badge.id}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-background/80 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onDone}
          data-testid={`badge-reveal-${badge.id}`}
          role="status"
          aria-live="polite"
        >
          <motion.div
            className="mx-6 flex max-w-sm flex-col items-center gap-4 rounded-2xl border-2 border-yellow-500/50 bg-card px-8 py-10 text-center shadow-[0_0_60px_rgba(234,179,8,0.2)] glow-amber relative overflow-hidden"
            initial={{ scale: 0.7, y: 24 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
          >
            <div className="absolute inset-0 bg-gradient-to-t from-yellow-500/10 to-transparent pointer-events-none" />
            <div className="relative z-10 text-[11px] font-bold uppercase tracking-[0.2em] text-[#ff9900] text-glow-warning">
              Badge earned
            </div>
            <motion.div
              className="relative z-10 text-7xl leading-none drop-shadow-[0_0_15px_rgba(255,255,255,0.4)]"
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 12, delay: 0.15 }}
            >
              {badge.emoji}
            </motion.div>
            <div className="relative z-10 text-2xl font-bold text-glow-primary">{badge.name}</div>
            <p className="relative z-10 text-sm text-foreground/80 font-medium">{badge.description}</p>
            <div className="relative z-10 mt-2 text-[10px] uppercase tracking-widest font-mono text-muted-foreground/60">
              Tap anywhere to dismiss
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
