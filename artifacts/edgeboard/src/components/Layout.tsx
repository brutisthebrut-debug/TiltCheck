import * as React from "react"
import { Link, useLocation } from "wouter"
import { useUser } from "@/contexts/UserContext"
import { useClerk } from "@clerk/react"
import { useGetNeedsSettling, getGetNeedsSettlingQueryKey } from "@workspace/api-client-react"
import {
  LayoutDashboard,
  ListOrdered,
  Layers,
  BarChart2,
  BookOpen,
  Users,
  Wallet,
  LogOut,
  Crown,
  Crosshair,
  CircleUser,
  Newspaper,
  Menu,
  X,
} from "lucide-react"
import { Button } from "./ui/button"
import { BadgeWatcher } from "./BadgeWatcher"
import { ArcCredit } from "./ArcCredit"
import { CrewSwitcher } from "./CrewSwitcher"
import { isRecapUnseen } from "@/lib/recapTeaser"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

const navItems = [
  { name: "Dashboard", shortName: "Home", href: "/", icon: LayoutDashboard },
  { name: "Bets", shortName: "Bets", href: "/bets", icon: ListOrdered },
  { name: "Parlays", shortName: "Parlays", href: "/parlays", icon: Layers },
  { name: "Stats", shortName: "Stats", href: "/stats", icon: BarChart2 },
  { name: "Recap", shortName: "Recap", href: "/recap", icon: Newspaper },
  { name: "Lessons", shortName: "Lessons", href: "/lessons", icon: BookOpen },
  { name: "Edge Finder", shortName: "Edge", href: "/edge", icon: Crosshair },
  { name: "Workspace", shortName: "Crew", href: "/workspace", icon: Users },
  { name: "Bankroll", shortName: "Bankroll", href: "/bankroll", icon: Wallet },
]

// A phone bottom bar needs restraint. Keep the four highest-frequency surfaces
// persistent and put the rest behind one explicit More sheet instead of
// squeezing nine destinations into a single row.
const mobilePrimaryItems = navItems.filter((item) =>
  ["Dashboard", "Bets", "Stats", "Recap"].includes(item.name),
)
const mobileMoreItems = navItems.filter(
  (item) => !mobilePrimaryItems.some((primary) => primary.href === item.href),
)

function routeIsActive(location: string, href: string) {
  return location === href || (href !== "/" && location.startsWith(href))
}

/** Purple pulse on the Recap nav slot while this week's tape is unopened. */
function RecapUnreadDot({ className = "" }: { className?: string }) {
  return (
    <span
      className={`h-2 w-2 rounded-full bg-chart-5 shadow-[0_0_6px_hsl(var(--chart-5)/0.9)] animate-pulse ${className}`}
      data-testid="dot-recap-unread"
      aria-label="New weekly recap ready"
    />
  )
}

function NeedsSettlingBadge({ count, className = "" }: { count: number; className?: string }) {
  if (count <= 0) return null
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[#ff9900] glow-amber text-[10px] font-bold text-black leading-none ${className}`}
      data-testid="badge-needs-settling"
      aria-label={`${count} plays need settling`}
    >
      {count > 99 ? "99+" : count}
    </span>
  )
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation()
  const { activeUser } = useUser()
  const { signOut } = useClerk()
  const [mobileMoreOpen, setMobileMoreOpen] = React.useState(false)

  React.useEffect(() => {
    setMobileMoreOpen(false)
  }, [location])

  // "Needs settling" is judged against the bettor's own day, not UTC.
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const { data: needsSettling } = useGetNeedsSettling(
    { tz: browserTz },
    { query: { enabled: !!activeUser, queryKey: getGetNeedsSettlingQueryKey({ tz: browserTz }) } }
  )
  const settleCount = needsSettling?.count ?? 0

  // New week's tape unopened → dot on the Recap nav slot.
  const recapUnread = !!activeUser && isRecapUnseen(activeUser.recapSeenWeek)

  const sidebarNavItems = [
    ...(activeUser?.isFounder ? [...navItems, { name: "Founder", href: "/founder", icon: Crown }] : navItems),
    { name: "Account", href: "/account", icon: CircleUser },
  ]

  const moreIsActive = mobileMoreItems.some((item) => routeIsActive(location, item.href))
  const handleSignOut = () => signOut({ redirectUrl: basePath || "/" })

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row dark">
      {/* Sidebar (Desktop) */}
      <aside className="hidden w-64 flex-col border-r bg-card md:flex">
        <div className="flex h-16 items-center px-6 border-b border-border/50 bg-card/50 backdrop-blur-sm">
          <div className="flex items-center gap-2 font-mono font-bold tracking-tight text-primary text-glow-primary">
            <Layers className="h-6 w-6 drop-shadow-[0_0_8px_hsl(var(--primary)/0.6)]" />
            <span className="text-xl">TILTCHECK</span>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-4">
          <CrewSwitcher className="mb-4" />
          <div className="mb-6 space-y-2">
            <Button asChild className="w-full justify-start gap-2" variant="default">
              <Link href="/bets/new">
                <span className="font-mono text-base leading-none">+</span>
                New Bet
              </Link>
            </Button>
            <Button asChild className="w-full justify-start gap-2 border-primary/20 hover:bg-primary/10 text-primary" variant="outline">
              <Link href="/parlays/new">
                <span className="font-mono text-base leading-none">+</span>
                New Parlay
              </Link>
            </Button>
          </div>

          <div className="space-y-1">
            {sidebarNavItems.map((item) => {
              const isActive = routeIsActive(location, item.href)
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? "bg-primary/15 text-primary glow-primary border border-primary/30"
                      : "text-muted-foreground border border-transparent hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <item.icon className={`h-4 w-4 ${isActive ? "text-primary" : ""}`} />
                  <span className="flex-1">{item.name}</span>
                  {item.href === "/" && <NeedsSettlingBadge count={settleCount} />}
                  {item.href === "/recap" && recapUnread && <RecapUnreadDot />}
                </Link>
              )
            })}
          </div>
        </nav>

        <div className="px-4 pb-2">
          <ArcCredit />
        </div>

        <div className="border-t border-border/50 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white"
                style={{ backgroundColor: activeUser?.avatarColor ?? "#6366f1" }}
              >
                {activeUser?.displayName?.charAt(0).toUpperCase() ?? "?"}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate" data-testid="text-signed-in-name">
                  {activeUser?.displayName ?? ""}
                </p>
                <p className="text-xs text-muted-foreground truncate">@{activeUser?.username ?? ""}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={handleSignOut}
              aria-label="Sign out"
              data-testid="button-sign-out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Header (Mobile) */}
      <header className="flex h-14 items-center justify-between border-b border-border/50 bg-card/80 backdrop-blur-md px-4 md:hidden">
        <div className="flex items-center gap-2 font-mono font-bold text-primary text-glow-primary">
          <Layers className="h-5 w-5 drop-shadow-[0_0_8px_hsl(var(--primary)/0.6)]" />
          <span>TILTCHECK</span>
        </div>

        <div className="flex items-center gap-2">
          {activeUser?.isFounder && (
            <Link
              href="/founder"
              className={`h-8 w-8 rounded-md flex items-center justify-center ${
                location === "/founder" ? "text-yellow-500 bg-yellow-500/10" : "text-muted-foreground"
              }`}
              aria-label="Founder dash"
              data-testid="link-founder-mobile"
            >
              <Crown className="h-4 w-4" />
            </Link>
          )}
          <Link
            href="/account"
            aria-label="Account"
            data-testid="link-account-mobile"
            className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
            style={{ backgroundColor: activeUser?.avatarColor ?? "#6366f1" }}
          >
            {activeUser?.displayName?.charAt(0).toUpperCase() ?? "?"}
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            onClick={handleSignOut}
            aria-label="Sign out"
            data-testid="button-sign-out-mobile"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto" style={{ paddingBottom: "calc(4.75rem + env(safe-area-inset-bottom))" }}>
        <div className="mx-auto max-w-5xl p-4 md:p-8 md:pb-8">
          {children}
        </div>
      </main>

      {/* Secondary mobile navigation sheet */}
      {mobileMoreOpen && (
        <div
          className="fixed inset-x-3 z-[55] rounded-xl border border-border/80 bg-card/95 p-3 shadow-2xl backdrop-blur-xl md:hidden"
          style={{ bottom: "calc(4.6rem + env(safe-area-inset-bottom))" }}
          data-testid="mobile-more-menu"
        >
          <div className="mb-3 flex items-center justify-between px-1">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">More from your tape</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Deeper review, crew, and bankroll tools</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setMobileMoreOpen(false)}
              aria-label="Close more navigation"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2">
            <Button asChild size="sm" className="justify-start gap-2">
              <Link href="/bets/new"><span className="text-base leading-none">+</span> New Bet</Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="justify-start gap-2 border-primary/20 text-primary">
              <Link href="/parlays/new"><span className="text-base leading-none">+</span> New Parlay</Link>
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {mobileMoreItems.map((item) => {
              const isActive = routeIsActive(location, item.href)
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-3 text-xs font-medium transition-colors ${
                    isActive
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border/60 bg-background/60 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.name}</span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Five-slot mobile bottom navigation */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 grid grid-cols-5 border-t border-border/50 bg-card/95 backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Primary navigation"
      >
        {mobilePrimaryItems.map((item) => {
          const isActive = routeIsActive(location, item.href)
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex min-w-0 flex-col items-center gap-0.5 px-1 pb-1 pt-2 text-[10px] font-medium transition-all duration-200 ${
                isActive ? "text-primary text-glow-primary" : "text-muted-foreground"
              }`}
            >
              <span className="relative">
                <item.icon className={`h-5 w-5 shrink-0 ${isActive ? "drop-shadow-[0_0_8px_hsl(var(--primary)/0.6)]" : ""}`} />
                {item.href === "/" && (
                  <NeedsSettlingBadge count={settleCount} className="absolute -top-1.5 -right-2.5" />
                )}
                {item.href === "/recap" && recapUnread && (
                  <RecapUnreadDot className="absolute -top-0.5 -right-1" />
                )}
              </span>
              <span className="truncate">{item.shortName ?? item.name}</span>
            </Link>
          )
        })}

        <button
          type="button"
          onClick={() => setMobileMoreOpen((open) => !open)}
          className={`flex min-w-0 flex-col items-center gap-0.5 px-1 pb-1 pt-2 text-[10px] font-medium transition-all duration-200 ${
            mobileMoreOpen || moreIsActive ? "text-primary text-glow-primary" : "text-muted-foreground"
          }`}
          aria-expanded={mobileMoreOpen}
          aria-controls="mobile-more-menu"
          data-testid="button-mobile-more"
        >
          <Menu className={`h-5 w-5 ${mobileMoreOpen || moreIsActive ? "drop-shadow-[0_0_8px_hsl(var(--primary)/0.6)]" : ""}`} />
          <span>More</span>
        </button>
      </nav>

      <BadgeWatcher />
    </div>
  )
}
