import { useState, useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useCreateCrew, useJoinCrew } from "@workspace/api-client-react"
import { useCrews } from "@/hooks/use-crews"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { UpgradeCard } from "@/components/UpgradeCard"
import { Layers, KeyRound, Plus } from "lucide-react"

function errorStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === "number" ? status : null
}

/**
 * The first-run crew step: right after a bettor claims their profile (or
 * lands from a /join/CODE invite link), walk them onto a board — join with a
 * code or start their own crew. Always skippable; the Workspace card remains
 * as the fallback nudge.
 *
 * If the bettor already runs with a crew and didn't arrive via an invite
 * link, there's nothing to do — it finishes itself silently.
 */
export function CrewOnboarding({
  initialCode,
  onDone,
}: {
  initialCode?: string | null
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const { crews, isLoading } = useCrews()
  const join = useJoinCrew()
  const create = useCreateCrew()

  const [code, setCode] = useState(initialCode ?? "")
  const [name, setName] = useState("")

  // Someone who claimed a profile that's already on a board doesn't need the
  // walk-in — unless they followed an invite link, which is an explicit ask.
  const shouldAutoFinish = !isLoading && crews.length > 0 && !initialCode
  const finishedRef = useRef(false)
  useEffect(() => {
    if (shouldAutoFinish && !finishedRef.current) {
      finishedRef.current = true
      onDone()
    }
  }, [shouldAutoFinish, onDone])

  const finish = () => {
    if (finishedRef.current) return
    finishedRef.current = true
    // Joining/creating a crew changes what every social surface shows.
    queryClient.invalidateQueries()
    onDone()
  }

  const handleJoin = () => {
    const trimmed = code.trim()
    if (!trimmed) return
    join.mutate({ data: { inviteCode: trimmed } }, { onSuccess: finish })
  }

  const handleCreate = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    create.mutate({ data: { name: trimmed } }, { onSuccess: finish })
  }

  if (isLoading || shouldAutoFinish) {
    return (
      <div className="dark flex min-h-[100dvh] items-center justify-center bg-background font-mono">
        <p className="text-sm text-muted-foreground animate-pulse">LOADING…</p>
      </div>
    )
  }

  const capHit = errorStatus(join.error) === 402 || errorStatus(create.error) === 402

  return (
    <div className="dark min-h-[100dvh] bg-background text-foreground font-mono flex flex-col items-center justify-center px-4 py-10">
      <div className="flex items-center gap-2 font-bold tracking-tight text-primary mb-2">
        <Layers className="h-6 w-6" />
        <span className="text-xl">TILTCHECK</span>
      </div>
      <p className="text-sm text-muted-foreground mb-8 text-center max-w-md">
        {initialCode
          ? "You came in on an invite — one tap and you're on their board."
          : "Last thing: this whole app is about the board. Get on one."}
      </p>

      <div className="w-full max-w-md space-y-4">
        {capHit ? (
          <UpgradeCard feature="Running more than one crew" />
        ) : (
          <>
            <Card className={initialCode ? "border-primary/60 glow-primary" : "border-border/60"}>
              <CardContent className="p-4 space-y-3">
                <Label htmlFor="onboardInviteCode" className="flex items-center gap-2 text-sm font-bold">
                  <KeyRound className="h-4 w-4 text-primary" />
                  Got an invite code?
                </Label>
                <Input
                  id="onboardInviteCode"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                  placeholder="Invite code"
                  maxLength={16}
                  className="font-mono tracking-widest uppercase"
                  data-testid="input-onboard-invite-code"
                />
                {join.isError && (
                  <p className="text-sm text-chart-2" data-testid="text-onboard-join-error">
                    {errorStatus(join.error) === 404
                      ? "No crew behind that code. Check it with whoever sent it."
                      : errorStatus(join.error) === 409
                        ? "You're already running with this crew."
                        : "Couldn't join — give it another shot."}
                  </p>
                )}
                <Button
                  onClick={handleJoin}
                  disabled={join.isPending || !code.trim()}
                  className="w-full"
                  data-testid="button-onboard-join"
                >
                  {join.isPending ? "Joining..." : "Join the crew"}
                </Button>
              </CardContent>
            </Card>

            <Card className="border-dashed border-border/60">
              <CardContent className="p-4 space-y-3">
                <Label htmlFor="onboardCrewName" className="flex items-center gap-2 text-sm font-bold">
                  <Plus className="h-4 w-4 text-primary" />
                  Or start your own crew
                </Label>
                <Input
                  id="onboardCrewName"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  placeholder="Crew name"
                  maxLength={40}
                  data-testid="input-onboard-crew-name"
                />
                {create.isError && (
                  <p className="text-sm text-chart-2" data-testid="text-onboard-create-error">
                    Couldn't create the crew — give it another shot.
                  </p>
                )}
                <Button
                  onClick={handleCreate}
                  variant="outline"
                  disabled={create.isPending || !name.trim()}
                  className="w-full"
                  data-testid="button-onboard-create"
                >
                  {create.isPending ? "Creating..." : "Create crew"}
                </Button>
              </CardContent>
            </Card>
          </>
        )}

        <button
          type="button"
          onClick={finish}
          className="mx-auto block text-xs text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-skip-crew-setup"
        >
          Skip for now
        </button>
      </div>
    </div>
  )
}
