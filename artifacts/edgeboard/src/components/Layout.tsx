import * as React from "react"
import { Link, useLocation } from "wouter"
import { useUser } from "@/contexts/UserContext"
import { 
  LayoutDashboard, 
  ListOrdered, 
  Layers, 
  BarChart2, 
  Users, 
  Wallet,
} from "lucide-react"
import { Button } from "./ui/button"

const navItems = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Bets", href: "/bets", icon: ListOrdered },
  { name: "Parlays", href: "/parlays", icon: Layers },
  { name: "Stats", href: "/stats", icon: BarChart2 },
  { name: "Workspace", href: "/workspace", icon: Users },
  { name: "Bankroll", href: "/bankroll", icon: Wallet },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation()
  const { activeUser, allUsers, setActiveUser } = useUser()

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row dark">
      {/* Sidebar (Desktop) */}
      <aside className="hidden w-64 flex-col border-r bg-card md:flex">
        <div className="flex h-16 items-center px-6 border-b">
          <div className="flex items-center gap-2 font-mono font-bold tracking-tight text-primary">
            <Layers className="h-6 w-6" />
            <span className="text-xl">EDGEBOARD</span>
          </div>
        </div>

        <div className="p-4 border-b border-border/50">
          <label className="text-xs text-muted-foreground font-medium mb-2 block uppercase tracking-wider">Active Bettor</label>
          <select 
            className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            value={activeUser?.id || ""}
            onChange={(e) => {
              const user = allUsers.find(u => u.id === Number(e.target.value));
              if (user) setActiveUser(user);
            }}
          >
            {allUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName}
              </option>
            ))}
          </select>
        </div>

        <nav className="flex-1 space-y-1 p-4">
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
            {navItems.map((item) => {
              const isActive = location === item.href || 
                               (item.href !== '/' && location.startsWith(item.href));
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <item.icon className={`h-4 w-4 ${isActive ? 'text-primary' : ''}`} />
                  {item.name}
                </Link>
              )
            })}
          </div>
        </nav>
      </aside>

      {/* Header (Mobile) */}
      <header className="flex h-14 items-center justify-between border-b bg-card px-4 md:hidden">
        <div className="flex items-center gap-2 font-mono font-bold text-primary">
          <Layers className="h-5 w-5" />
          <span>EDGEBOARD</span>
        </div>
        
        <select 
          className="bg-background border border-input rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring max-w-[140px]"
          value={activeUser?.id || ""}
          onChange={(e) => {
            const user = allUsers.find(u => u.id === Number(e.target.value));
            if (user) setActiveUser(user);
          }}
        >
          {allUsers.map((user) => (
            <option key={user.id} value={user.id}>
              {user.displayName}
            </option>
          ))}
        </select>
      </header>

      {/* Main Content — extra bottom padding so content clears the bottom nav + safe area */}
      <main className="flex-1 overflow-y-auto" style={{ paddingBottom: 'calc(4rem + env(safe-area-inset-bottom))' }}>
        <div className="mx-auto max-w-5xl p-4 md:p-8 md:pb-8" style={{ paddingBottom: undefined }}>
          {children}
        </div>
      </main>

      {/* Bottom Nav (Mobile) — sits at the very bottom with safe-area inset */}
      <nav 
        className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t bg-card md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {navItems.slice(0, 6).map((item) => {
          const isActive = location === item.href || 
                           (item.href !== '/' && location.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 px-1 pt-2 pb-1 text-[9px] font-medium transition-colors min-w-0 ${
                isActive
                  ? "text-primary"
                  : "text-muted-foreground"
              }`}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              <span className="truncate">{item.name}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
