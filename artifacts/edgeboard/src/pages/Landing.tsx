import { Link } from "wouter"
import { Layers, NotebookPen, Scale, TrendingDown, ArrowRight } from "lucide-react"
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
    text: "EdgeBoard surfaces your most expensive bad habit: tilt bets, bad prices, markets you misread.",
  },
]

export default function Landing() {
  return (
    <div className="dark min-h-[100dvh] bg-background text-foreground font-mono flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border/60">
        <div className="flex items-center gap-2 font-bold tracking-tight text-primary">
          <Layers className="h-5 w-5" />
          <span>EDGEBOARD</span>
        </div>
        <Button asChild variant="outline" size="sm" className="border-primary/30 text-primary hover:bg-primary/10">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-14 text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs uppercase tracking-widest text-primary">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          Private beta &mdash; two seats, no waitlist
        </div>

        <h1 className="max-w-3xl text-4xl md:text-6xl font-bold leading-tight tracking-tight">
          Your record says <span className="text-primary">50/50</span>.
          <br />
          Your reasoning knows better.
        </h1>

        <p className="mt-6 max-w-xl text-base md:text-lg text-muted-foreground leading-relaxed">
          EdgeBoard is a flight recorder for your betting decisions. It doesn&apos;t give you
          picks &mdash; it shows you the patterns behind your wins, losses, and lies you tell
          yourself at &minus;110.
        </p>

        <Button asChild size="lg" className="mt-10 gap-2 text-base px-8">
          <Link href="/sign-in">
            Sign in with Google
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
        <p className="mt-3 text-xs text-muted-foreground/70">No picks. No touts. Just your own tape.</p>

        {/* Pillars */}
        <div className="mt-16 grid w-full max-w-4xl gap-4 md:grid-cols-3 text-left">
          {PILLARS.map((p) => (
            <div key={p.title} className="rounded-lg border border-border/60 bg-card p-5">
              <p.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 text-sm font-bold tracking-widest text-foreground">{p.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{p.text}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="px-6 py-5 text-center text-xs text-muted-foreground/60 border-t border-border/60">
        EDGEBOARD // decision tracking for people who grade their own homework
      </footer>
    </div>
  )
}
