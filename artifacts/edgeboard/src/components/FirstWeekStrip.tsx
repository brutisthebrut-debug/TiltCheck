import { useState } from "react"
import { Link } from "wouter"
import { useUser } from "@/contexts/UserContext"
import { Button } from "@/components/ui/button"
import { Newspaper, Crosshair, BookOpen, Trophy, X, Compass } from "lucide-react"

/** Accounts older than this stop seeing the tour strip even if never dismissed. */
const MAX_ACCOUNT_AGE_DAYS = 14

const storageKey = (userId: number) => `tiltcheck.tour-strip.dismissed.${userId}`

function isDismissed(userId: number): boolean {
  try {
    return localStorage.getItem(storageKey(userId)) === "1"
  } catch {
    return false
  }
}

const STOPS = [
  { href: "/recap", icon: Newspaper, label: "Weekly Recap", line: "Your week, reviewed — every Monday" },
  { href: "/edge", icon: Crosshair, label: "Edge Finder", line: "Where you make money vs. donate it" },
  { href: "/lessons", icon: BookOpen, label: "Lessons", line: "Your post-mortems, searchable" },
  { href: "/workspace", icon: Trophy, label: "Trophy Case", line: "Badges to earn, crew to beat" },
]

/**
 * A compact "where to look" tour for first-week accounts. Dismissable, and
 * once dismissed it never comes back (per user, per device). Ages out on its
 * own after two weeks either way.
 */
export function FirstWeekStrip() {
  const { activeUser } = useUser()
  const [dismissed, setDismissed] = useState(() => (activeUser ? isDismissed(activeUser.id) : false))

  if (!activeUser || dismissed) return null

  const ageDays = (Date.now() - new Date(activeUser.createdAt).getTime()) / 86_400_000
  if (!(ageDays >= 0 && ageDays <= MAX_ACCOUNT_AGE_DAYS)) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(storageKey(activeUser.id), "1")
    } catch {
      // Private-mode storage failure just means it shows again next visit.
    }
  }

  return (
    <div
      className="rounded-lg border border-primary/30 bg-primary/5 p-4"
      data-testid="strip-first-week"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Compass className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold text-primary">New here? The good stuff lives in these corners</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 -mt-1 -mr-1 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={dismiss}
          aria-label="Dismiss tour"
          data-testid="button-dismiss-first-week"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {STOPS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group flex items-start gap-2 rounded-md border border-border/60 bg-background/60 px-3 py-2 transition-colors hover:border-primary/50"
            data-testid={`link-tour${s.href.replace(/\//g, "-")}`}
          >
            <s.icon className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
            <span className="min-w-0">
              <span className="block text-xs font-bold group-hover:text-primary transition-colors">{s.label}</span>
              <span className="block text-[11px] text-muted-foreground truncate">{s.line}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
