import { useState } from "react"
import { Layers, UserCheck, Sparkles, LogOut, Wallet } from "lucide-react"
import { useClerk, useUser as useClerkUser } from "@clerk/react"
import {
  useListUnclaimedUsers,
  useClaimProfile,
  useUpdateUser,
  getGetCurrentUserQueryKey,
  getListUsersQueryKey,
  getListUnclaimedUsersQueryKey,
  type User,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  SPORTS,
  SPORTSBOOKS,
  setDefaultSportsbook,
  setFavoriteSports,
} from "@/lib/preferences"
import { setFirstRunSetupActive } from "@/hooks/use-first-run"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

export default function ClaimProfile() {
  const queryClient = useQueryClient()
  const { signOut } = useClerk()
  const { user: clerkUser } = useClerkUser()
  const { data: unclaimed = [], isLoading } = useListUnclaimedUsers()
  const claim = useClaimProfile()
  const updateUser = useUpdateUser()
  const [displayName, setDisplayName] = useState("")
  const [error, setError] = useState<string | null>(null)

  // First-run setup (step 2) state — shown after a successful claim, before
  // the profile queries are refreshed and the app takes over.
  const [claimedUser, setClaimedUser] = useState<User | null>(null)
  const [bankrollInput, setBankrollInput] = useState("")
  const [sportsbook, setSportsbook] = useState("")
  const [favoriteSports, setFavoriteSportsState] = useState<string[]>([])

  const finish = () => {
    setFirstRunSetupActive(false)
    queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() })
    queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() })
    queryClient.invalidateQueries({ queryKey: getListUnclaimedUsersQueryKey() })
  }

  const onClaimed = (user: User) => {
    // Hold the profile gate on this screen until setup finishes, even if a
    // background refetch discovers the newly linked profile first.
    setFirstRunSetupActive(true)
    setClaimedUser(user)
    setBankrollInput(String(user.startingBankroll))
  }

  const onError = (e: unknown) => {
    const status = (e as { status?: number })?.status
    const code = (e as { data?: { error?: string } })?.data?.error
    if (status === 403 && code === "not_invited") {
      setError("TiltCheck is a private beta — this email isn't on the guest list. Ask whoever runs the board to add you.")
    } else if (status === 403) {
      setError("The board's at capacity right now. Ask whoever runs it to open more seats.")
    } else if (status === 409) {
      setError("That profile was just claimed. Pick another or start fresh.")
      queryClient.invalidateQueries({ queryKey: getListUnclaimedUsersQueryKey() })
    } else {
      setError("Something went wrong. Try again.")
    }
  }

  const claimExisting = (userId: number) => {
    setError(null)
    claim.mutate({ data: { userId } }, { onSuccess: onClaimed, onError })
  }

  const startFresh = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    claim.mutate(
      { data: { displayName: displayName.trim() || undefined } },
      { onSuccess: onClaimed, onError },
    )
  }

  const toggleSport = (sport: string) => {
    setFavoriteSportsState((prev) =>
      prev.includes(sport) ? prev.filter((s) => s !== sport) : [...prev, sport],
    )
  }

  const savePreferences = () => {
    setDefaultSportsbook(sportsbook || null)
    setFavoriteSports(favoriteSports)
  }

  const completeSetup = (e: React.FormEvent) => {
    e.preventDefault()
    if (!claimedUser) return
    setError(null)
    savePreferences()

    const amount = Number(bankrollInput)
    const validAmount = bankrollInput.trim() !== "" && !isNaN(amount) && amount > 0
    if (!validAmount || amount === claimedUser.startingBankroll) {
      // Nothing to save server-side — keep whatever the profile already has
      finish()
      return
    }
    updateUser.mutate(
      { id: claimedUser.id, data: { startingBankroll: amount } },
      {
        onSuccess: finish,
        onError: () => setError("Couldn't save your bankroll. You can set it later on the Bankroll page."),
      },
    )
  }

  const skipSetup = () => {
    savePreferences()
    finish()
  }

  // ── Step 2: first-run setup ─────────────────────────────────────────────
  if (claimedUser) {
    const amount = Number(bankrollInput)
    const bankrollInvalid = bankrollInput.trim() !== "" && (isNaN(amount) || amount <= 0)
    return (
      <div className="dark min-h-[100dvh] bg-background text-foreground font-mono flex flex-col items-center justify-center px-4 py-10">
        <div className="flex items-center gap-2 font-bold tracking-tight text-primary mb-2">
          <Layers className="h-6 w-6" />
          <span className="text-xl">TILTCHECK</span>
        </div>
        <p className="text-sm text-muted-foreground mb-8 text-center max-w-md">
          You&apos;re in, {claimedUser.displayName}. Set your baseline so the numbers mean something from bet one.
        </p>

        <Card className="w-full max-w-md border-border/60">
          <CardContent className="p-5">
            <form onSubmit={completeSetup} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="startingBankroll" className="flex items-center gap-2 text-sm font-bold">
                  <Wallet className="h-4 w-4 text-primary" />
                  Starting bankroll ($)
                </Label>
                <Input
                  id="startingBankroll"
                  type="number"
                  step="0.01"
                  min="0.01"
                  inputMode="decimal"
                  value={bankrollInput}
                  onChange={(e) => setBankrollInput(e.target.value)}
                  data-testid="input-starting-bankroll"
                />
                <p className="text-xs text-muted-foreground">
                  The money you&apos;re betting with. Your P/L and ROI are measured against this — you can change it later.
                </p>
                {bankrollInvalid && (
                  <p className="text-xs text-destructive">Enter an amount greater than 0.</p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-bold">Main sportsbook <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Select value={sportsbook} onValueChange={setSportsbook}>
                  <SelectTrigger data-testid="select-main-sportsbook">
                    <SelectValue placeholder="Where do you bet most?" />
                  </SelectTrigger>
                  <SelectContent>
                    {SPORTSBOOKS.map((sb) => (
                      <SelectItem key={sb} value={sb}>{sb}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">We&apos;ll pre-fill it when you log a bet.</p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-bold">Sports you bet <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <div className="flex flex-wrap gap-2">
                  {SPORTS.map((sport) => {
                    const active = favoriteSports.includes(sport)
                    return (
                      <button
                        key={sport}
                        type="button"
                        onClick={() => toggleSport(sport)}
                        data-testid={`chip-sport-${sport}`}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                        }`}
                      >
                        {sport}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <Button
                  type="submit"
                  className="w-full"
                  disabled={updateUser.isPending || bankrollInvalid}
                  data-testid="button-finish-setup"
                >
                  {updateUser.isPending ? "Saving…" : "Start tracking"}
                </Button>
                <button
                  type="button"
                  onClick={skipSetup}
                  className="mx-auto block text-xs text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="button-skip-setup"
                >
                  Skip for now
                </button>
              </div>
            </form>
          </CardContent>
        </Card>

        {error && <p className="text-sm text-destructive text-center mt-4 max-w-md">{error}</p>}
      </div>
    )
  }

  // ── Step 1: claim or create a profile ──────────────────────────────────
  return (
    <div className="dark min-h-[100dvh] bg-background text-foreground font-mono flex flex-col items-center justify-center px-4 py-10">
      <div className="flex items-center gap-2 font-bold tracking-tight text-primary mb-2">
        <Layers className="h-6 w-6" />
        <span className="text-xl">TILTCHECK</span>
      </div>
      <p className="text-sm text-muted-foreground mb-8 text-center">
        Signed in as {clerkUser?.primaryEmailAddress?.emailAddress ?? "your account"}. Who are you on the board?
      </p>

      <div className="w-full max-w-md space-y-4">
        {isLoading ? (
          <Card className="animate-pulse h-24 bg-muted/50" />
        ) : (
          unclaimed.map((u) => (
            <Card key={u.id} className="border-border/60">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-sm font-bold text-white"
                    style={{ backgroundColor: u.avatarColor }}
                  >
                    {u.displayName.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="font-bold truncate">{u.displayName}</p>
                    <p className="text-xs text-muted-foreground truncate">@{u.username}</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="gap-1.5 shrink-0"
                  disabled={claim.isPending}
                  onClick={() => claimExisting(u.id)}
                  data-testid={`button-claim-${u.id}`}
                >
                  <UserCheck className="h-4 w-4" />
                  That&apos;s me
                </Button>
              </CardContent>
            </Card>
          ))
        )}

        <Card className="border-dashed border-border/60">
          <CardContent className="p-4">
            <form onSubmit={startFresh} className="space-y-3">
              <Label htmlFor="displayName" className="flex items-center gap-2 text-sm font-bold">
                <Sparkles className="h-4 w-4 text-primary" />
                Start fresh instead
              </Label>
              <Input
                id="displayName"
                placeholder="Display name (optional)"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                data-testid="input-display-name"
              />
              <Button
                type="submit"
                variant="outline"
                className="w-full"
                disabled={claim.isPending}
                data-testid="button-start-fresh"
              >
                Create my profile
              </Button>
            </form>
          </CardContent>
        </Card>

        {error && <p className="text-sm text-destructive text-center">{error}</p>}

        <button
          type="button"
          onClick={() => signOut({ redirectUrl: basePath || "/" })}
          className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <LogOut className="h-3 w-3" />
          Sign out
        </button>
      </div>
    </div>
  )
}
