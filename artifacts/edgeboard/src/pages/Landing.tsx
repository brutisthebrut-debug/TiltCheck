import { Link } from "wouter"
import {
  Layers,
  NotebookPen,
  Scale,
  TrendingDown,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  Flame,
} from "lucide-react"
import { Button } from "@/components/ui/button"

const PILLARS = [
  {
    icon: NotebookPen,
    title: "LOG THE WHY",
    text: "Every bet gets a rationale and a 1\u201310 conviction score before tipoff. No why, no wager.",
  },
  {
    icon: Scale,
    title: "GRADE THE DECISION",
    text: "After the result, grade your reasoning \u2014 sound or flawed. Winning a bad bet still counts against you here.",
  },
  {
    icon: TrendingDown,
    title: "FIND THE LEAK",
    text: "TiltCheck surfaces your most expensive bad habit: tilt bets, bad prices, markets you misread.",
  },
]

const STEPS = [
  {
    n: "01",
    title: "Log the bet before the game",
    text: "Sport, pick, price, stake \u2014 plus the part every app skips: why you like it, and how sure you are.",
  },
  {
    n: "02",
    title: "Settle it and grade yourself",
    text: "Won or lost is half the story. Was the read right? Did you chase? Tag what actually happened.",
  },
  {
    n: "03",
    title: "Watch the patterns surface",
    text: "Confidence vs. results, sport by sport, leak by leak. Plus a head-to-head board to keep your crew honest.",
  },
]

/** Stylized, hand-built preview of the in-app dashboard (no real data). */
function DashboardMock() {
  return (
    <div className="w-full max-w-3xl rounded-xl border border-primary/40 bg-card/80 shadow-[0_0_80px_-20px_hsl(var(--primary)/0.4)] overflow-hidden text-left relative">
      <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 to-transparent pointer-events-none" />
      {/* Window chrome */}
      <div className="relative z-10 flex items-center gap-2 border-b border-border/60 px-4 py-2.5 bg-background/50 backdrop-blur-sm">
        <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-green-500/70" />
        <span className="ml-3 text-[10px] uppercase tracking-widest text-muted-foreground">
          tiltcheck // dashboard
        </span>
      </div>

      <div className="p-4 md:p-5 space-y-4">
        {/* Stat chips */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "RECORD", value: "23\u201317", accent: "text-foreground" },
            { label: "ROI", value: "+8.4%", accent: "text-green-500" },
            { label: "REASONING GRADE", value: "B+", accent: "text-primary" },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-border/60 bg-background/60 p-3">
              <p className="text-[9px] md:text-[10px] tracking-widest text-muted-foreground">{s.label}</p>
              <p className={`mt-1 text-lg md:text-2xl font-bold ${s.accent}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Insight callout */}
        <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/10 p-3">
          <Flame className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-xs md:text-sm leading-relaxed">
            <span className="font-bold text-primary">LEAK DETECTED:</span> You're 2&ndash;9 on
            late-night unders. That habit has cost you <span className="font-bold">$340</span> this
            month.
          </p>
        </div>

        {/* Fake bet rows */}
        <div className="space-y-2">
          {[
            { pick: "Knicks -3.5", conf: 8, result: "won", note: "Rest edge, line moved with me", up: true },
            { pick: "Sox ML +140", conf: 4, result: "lost", note: "Chased the early slate. Graded: tilt", up: false },
            { pick: "Chiefs u47.5", conf: 7, result: "won", note: "Weather + pace. Sound read", up: true },
          ].map((b) => (
            <div
              key={b.pick}
              className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-2.5"
            >
              {b.up ? (
                <ArrowUpRight className="h-4 w-4 shrink-0 text-green-500" />
              ) : (
                <ArrowDownRight className="h-4 w-4 shrink-0 text-destructive" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs md:text-sm font-bold">{b.pick}</p>
                <p className="truncate text-[10px] md:text-xs text-muted-foreground">{b.note}</p>
              </div>
              <div className="hidden sm:flex items-center gap-1" aria-hidden>
                {Array.from({ length: 10 }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-3 w-1 rounded-sm ${i < b.conf ? "bg-primary" : "bg-muted"}`}
                  />
                ))}
              </div>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] md:text-[10px] font-bold uppercase tracking-wider ${
                  b.up ? "bg-green-500/15 text-green-500" : "bg-destructive/15 text-destructive"
                }`}
              >
                {b.result}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Landing() {
  return (
    <div className="dark min-h-[100dvh] bg-background text-foreground font-mono flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border/60">
        <div className="flex items-center gap-2 font-bold tracking-tight text-primary">
          <Layers className="h-5 w-5" />
          <span>TILTCHECK</span>
        </div>
        <Button asChild variant="outline" size="sm" className="border-primary/30 text-primary hover:bg-primary/10">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="flex flex-col items-center px-6 pt-14 pb-10 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs uppercase tracking-widest text-primary">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            Your crew&apos;s decision room
          </div>

          <h1 className="max-w-3xl text-4xl md:text-6xl font-bold leading-tight tracking-tight">
            Your record says <span className="text-primary text-glow-primary">50/50</span>.
            <br />
            Your reasoning knows better.
          </h1>

          <p className="mt-6 max-w-xl text-base md:text-lg text-muted-foreground leading-relaxed">
            TiltCheck is a flight recorder for your betting decisions. It doesn&apos;t give you
            picks &mdash; it shows you the patterns behind your wins, losses, and the lies you tell
            yourself at &minus;110.
          </p>

          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="gap-2 text-base px-8" data-testid="button-hero-cta">
              <Link href="/sign-in">
                Get on the board
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="gap-2 text-base px-8 border-primary/30 text-primary hover:bg-primary/10"
              data-testid="button-hero-demo"
            >
              <Link href="/demo">View the demo board</Link>
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground/70">
            Sign in with Google. No picks. No touts. Just your own tape.
          </p>
        </section>

        {/* Product preview */}
        <section className="flex justify-center px-4 pb-16">
          <DashboardMock />
        </section>

        {/* Pillars */}
        <section className="mx-auto max-w-4xl px-6 pb-16">
          <div className="grid gap-4 md:grid-cols-3 text-left">
            {PILLARS.map((p) => (
              <div key={p.title} className="rounded-lg border border-border/60 bg-card p-5">
                <p.icon className="h-5 w-5 text-primary" />
                <h3 className="mt-3 text-sm font-bold tracking-widest text-foreground">{p.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{p.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="border-t border-border/60 bg-card/40">
          <div className="mx-auto max-w-4xl px-6 py-16">
            <h2 className="text-center text-xs uppercase tracking-[0.3em] text-muted-foreground">
              How it works
            </h2>
            <div className="mt-10 grid gap-8 md:grid-cols-3 text-left">
              {STEPS.map((s) => (
                <div key={s.n}>
                  <p className="text-3xl font-bold text-primary/40">{s.n}</p>
                  <h3 className="mt-2 text-sm font-bold">{s.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{s.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="flex flex-col items-center px-6 py-16 text-center">
          <h2 className="max-w-xl text-2xl md:text-3xl font-bold leading-snug tracking-tight">
            Your crew, one board, every excuse on the record.
          </h2>
          <Button asChild size="lg" className="mt-8 gap-2 text-base px-8" data-testid="button-footer-cta">
            <Link href="/sign-in">
              Sign in with Google
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="ghost" className="mt-3 text-muted-foreground" data-testid="button-footer-demo">
            <Link href="/demo">Not sure yet? Poke around the demo board</Link>
          </Button>
        </section>
      </main>

      <footer className="px-6 py-5 text-center text-xs text-muted-foreground/60 border-t border-border/60">
        TILTCHECK // decision tracking for people who grade their own homework
      </footer>
    </div>
  )
}
