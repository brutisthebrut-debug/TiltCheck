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
          className="fixed inset-0 z-[70] flex items-center justify-center bg-background/80 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onDone}
          data-testid={`badge-reveal-${badge.id}`}
          role="status"
          aria-live="polite"
        >
          <motion.div
            className="mx-6 flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-primary/30 bg-card px-8 py-10 text-center shadow-2xl"
            initial={{ scale: 0.7, y: 24 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
              Badge earned
            </div>
            <motion.div
              className="text-6xl leading-none"
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 12, delay: 0.15 }}
            >
              {badge.emoji}
            </motion.div>
            <div className="text-xl font-bold">{badge.name}</div>
            <p className="text-sm text-muted-foreground">{badge.description}</p>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
              Tap anywhere to dismiss
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
