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
  Users,
  Wallet,
  LogOut,
  Crown,
  Crosshair,
  CircleUser,
} from "lucide-react"
import { Button } from "./ui/button"
import { BadgeWatcher } from "./BadgeWatcher"
import { CrewSwitcher } from "./CrewSwitcher"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

const navItems = [
  { name: "Dashboard", shortName: "Home", href: "/", icon: LayoutDashboard },
  { name: "Bets", shortName: "Bets", href: "/bets", icon: ListOrdered },
  { name: "Parlays", shortName: "Parlays", href: "/parlays", icon: Layers },
  { name: "Stats", shortName: "Stats", href: "/stats", icon: BarChart2 },
  { name: "Edge Finder", shortName: "Edge", href: "/edge", icon: Crosshair },
  { name: "Workspace", shortName: "Crew", href: "/workspace", icon: Users },
  { name: "Bankroll", shortName: "Bankroll", href: "/bankroll", icon: Wallet },
]

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

  const { data: needsSettling } = useGetNeedsSettling(
    { query: { enabled: !!activeUser, queryKey: getGetNeedsSettlingQueryKey() } }
  )
  const settleCount = needsSettling?.count ?? 0

  // Founder-only page joins the sidebar nav; the mobile bottom bar keeps the
  // core six (founders can reach the dash from the desktop nav or /founder).
  // Account (Pro status + billing) rides the sidebar too — mobile reaches it
  // from the header avatar.
  const sidebarNavItems = [
    ...(activeUser?.isFounder ? [...navItems, { name: "Founder", href: "/founder", icon: Crown }] : navItems),
    { name: "Account", href: "/account", icon: CircleUser },
  ]

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
          {/* Which crew's board you're on — leaderboard, head-to-head, recap. */}
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
              const isActive = location === item.href || 
                               (item.href !== '/' && location.startsWith(item.href));
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
                  <item.icon className={`h-4 w-4 ${isActive ? 'text-primary' : ''}`} />
                  <span className="flex-1">{item.name}</span>
                  {item.href === "/" && <NeedsSettlingBadge count={settleCount} />}
                </Link>
              )
            })}
          </div>
        </nav>

        {/* Signed-in identity */}
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

      {/* Main Content — extra bottom padding so content clears the bottom nav + safe area */}
      <main className="flex-1 overflow-y-auto" style={{ paddingBottom: 'calc(4rem + env(safe-area-inset-bottom))' }}>
        <div className="mx-auto max-w-5xl p-4 md:p-8 md:pb-8" style={{ paddingBottom: undefined }}>
          {children}
        </div>
      </main>

      {/* Bottom Nav (Mobile) — sits at the very bottom with safe-area inset */}
      <nav 
        className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-border/50 bg-card/90 backdrop-blur-md md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {navItems.map((item) => {
          const isActive = location === item.href || 
                           (item.href !== '/' && location.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 px-1 pt-2 pb-1 text-[9px] font-medium transition-all duration-200 min-w-0 ${
                isActive
                  ? "text-primary text-glow-primary"
                  : "text-muted-foreground"
              }`}
            >
              <span className="relative">
                <item.icon className={`h-5 w-5 shrink-0 ${isActive ? 'drop-shadow-[0_0_8px_hsl(var(--primary)/0.6)]' : ''}`} />
                {item.href === "/" && (
                  <NeedsSettlingBadge count={settleCount} className="absolute -top-1.5 -right-2.5" />
                )}
              </span>
              <span className="truncate">{item.shortName ?? item.name}</span>
            </Link>
          )
        })}
      </nav>

      {/* Pops the reveal for newly earned badges anywhere in the app */}
      <BadgeWatcher />
    </div>
  )
}
