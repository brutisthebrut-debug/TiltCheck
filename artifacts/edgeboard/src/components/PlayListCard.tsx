import { Link } from "wouter"
import { Badge } from "@/components/ui/badge"
import type { ReactNode } from "react"

/**
 * Stacked card presentation for a bet or parlay on narrow screens, where the
 * table layout would force horizontal scrolling. One tap target for the whole
 * card (a real link, so it's keyboard- and screen-reader-friendly).
 */
export function PlayListCard({
  href,
  title,
  subtitle,
  date,
  bettor,
  odds,
  stake,
  status,
  testId,
}: {
  href: string
  title: string
  subtitle: string
  date: string
  bettor?: string
  odds: ReactNode
  stake: string
  status: string
  testId?: string
}) {
  return (
    <Link
      href={href}
      className="block rounded-lg border bg-card px-4 py-3 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold truncate">{title}</p>
          <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
        </div>
        <Badge variant={status as never} className="shrink-0">{status.toUpperCase()}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{date}</span>
        <span className="truncate">{bettor}</span>
        <span className="ml-auto flex items-center gap-3">
          <span className="font-mono text-foreground">{odds}</span>
          <span className="font-mono text-foreground">{stake}</span>
        </span>
      </div>
    </Link>
  )
}

/** Shared loading skeleton for the mobile card list. */
export function PlayListCardSkeleton() {
  return (
    <div className="rounded-lg border bg-card px-4 py-3 space-y-2">
      <div className="h-4 w-40 bg-muted animate-pulse rounded" />
      <div className="h-3 w-56 bg-muted animate-pulse rounded" />
      <div className="h-3 w-32 bg-muted animate-pulse rounded" />
    </div>
  )
}
