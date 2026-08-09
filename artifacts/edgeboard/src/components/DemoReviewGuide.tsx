import { Link } from "wouter"
import {
  Gauge,
  BarChart3,
  BookOpenCheck,
  Newspaper,
  Users,
  ArrowRight,
} from "lucide-react"

const REVIEW_STOPS = [
  {
    n: "01",
    href: "/",
    label: "Dashboard",
    detail: "The decision mirror",
    icon: Gauge,
  },
  {
    n: "02",
    href: "/stats",
    label: "Stats",
    detail: "Confidence vs. reality",
    icon: BarChart3,
  },
  {
    n: "03",
    href: "/lessons",
    label: "Lessons",
    detail: "Repeated mistakes",
    icon: BookOpenCheck,
  },
  {
    n: "04",
    href: "/recap",
    label: "Recap",
    detail: "The return reason",
    icon: Newspaper,
  },
  {
    n: "05",
    href: "/workspace",
    label: "Crew",
    detail: "Accountability layer",
    icon: Users,
  },
]

/**
 * A lightweight, no-login review path for beta testers. The demo has a lot of
 * product surface area; this strip keeps a first-time reviewer focused on the
 * thesis instead of judging the app by whichever nav item they happen to hit.
 */
export function DemoReviewGuide() {
  return (
    <section
      className="border-b border-border/60 bg-card/70 px-3 py-3 backdrop-blur-sm"
      data-testid="demo-review-guide"
      aria-label="Suggested beta review path"
    >
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-primary">
              Reviewer mode · 7 minute path
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              Judge one thing: does seeing the quality of your decisions — not just wins and losses —
              change how you would think before the next wager?
            </p>
          </div>
          <p className="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground/70">
            No login · Read only
          </p>
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {REVIEW_STOPS.map((stop) => (
            <Link
              key={stop.href}
              href={stop.href}
              className="group flex min-w-[185px] flex-1 items-center gap-3 rounded-lg border border-border/70 bg-background/70 px-3 py-2.5 transition-colors hover:border-primary/50 hover:bg-primary/5"
              data-testid={`demo-review-stop-${stop.n}`}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
                <stop.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[9px] font-bold tracking-widest text-primary/70">{stop.n}</p>
                <p className="truncate text-xs font-bold text-foreground">{stop.label}</p>
                <p className="truncate text-[10px] text-muted-foreground">{stop.detail}</p>
              </div>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
