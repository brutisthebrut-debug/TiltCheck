import { useState } from "react"
import { Layers, UserCheck, Sparkles, LogOut } from "lucide-react"
import { useClerk, useUser as useClerkUser } from "@clerk/react"
import {
  useListUnclaimedUsers,
  useClaimProfile,
  getGetCurrentUserQueryKey,
  getListUsersQueryKey,
  getListUnclaimedUsersQueryKey,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

export default function ClaimProfile() {
  const queryClient = useQueryClient()
  const { signOut } = useClerk()
  const { user: clerkUser } = useClerkUser()
  const { data: unclaimed = [], isLoading } = useListUnclaimedUsers()
  const claim = useClaimProfile()
  const [displayName, setDisplayName] = useState("")
  const [error, setError] = useState<string | null>(null)

  const finish = () => {
    queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() })
    queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() })
    queryClient.invalidateQueries({ queryKey: getListUnclaimedUsersQueryKey() })
  }

  const onError = (e: unknown) => {
    const status = (e as { status?: number })?.status
    if (status === 403) {
      setError("The beta is full right now — all seats are taken. Ping the pilot to open more.")
    } else if (status === 409) {
      setError("That profile was just claimed. Pick another or start fresh.")
      queryClient.invalidateQueries({ queryKey: getListUnclaimedUsersQueryKey() })
    } else {
      setError("Something went wrong. Try again.")
    }
  }

  const claimExisting = (userId: number) => {
    setError(null)
    claim.mutate({ data: { userId } }, { onSuccess: finish, onError })
  }

  const startFresh = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    claim.mutate(
      { data: { displayName: displayName.trim() || undefined } },
      { onSuccess: finish, onError },
    )
  }

  return (
    <div className="dark min-h-[100dvh] bg-background text-foreground font-mono flex flex-col items-center justify-center px-4 py-10">
      <div className="flex items-center gap-2 font-bold tracking-tight text-primary mb-2">
        <Layers className="h-6 w-6" />
        <span className="text-xl">EDGEBOARD</span>
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
