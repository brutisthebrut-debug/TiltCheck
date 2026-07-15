import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useCreateCrew, useJoinCrew, useActivateCrew } from "@workspace/api-client-react"
import { useCrews, getCrewActionsEnabled } from "@/hooks/use-crews"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { UpgradeCard } from "@/components/UpgradeCard"
import { CrewManageDialog } from "@/components/CrewManageDialog"
import { Shield, Check, ChevronsUpDown, Plus, KeyRound, Settings2 } from "lucide-react"

function errorStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === "number" ? status : null
}

function is402(error: unknown): boolean {
  return errorStatus(error) === 402
}

/**
 * The crew picker: shows which crew's board you're looking at and lets you
 * switch, start a new crew, or join one with a code. Free accounts run one
 * crew — the create/join dialogs swap to the Pro pitch when the server says
 * the cap is hit (402), never deciding the cap client-side.
 */
export function CrewSwitcher({ className = "" }: { className?: string }) {
  const { crews, activeCrew, isLoading } = useCrews()
  const queryClient = useQueryClient()
  const actionsEnabled = getCrewActionsEnabled()

  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [name, setName] = useState("")
  const [code, setCode] = useState("")

  const activate = useActivateCrew()
  const create = useCreateCrew()
  const join = useJoinCrew()

  // Switching crews changes what every social surface should show — nuke the
  // whole cache rather than hand-picking keys and missing one.
  const afterCrewChange = () => queryClient.invalidateQueries()

  const handleActivate = (crewId: number) => {
    if (crewId === activeCrew?.id) return
    activate.mutate({ id: crewId }, { onSuccess: afterCrewChange })
  }

  const handleCreate = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    create.mutate(
      { data: { name: trimmed } },
      {
        onSuccess: () => {
          setCreateOpen(false)
          setName("")
          create.reset()
          afterCrewChange()
        },
      },
    )
  }

  const handleJoin = () => {
    const trimmed = code.trim()
    if (!trimmed) return
    join.mutate(
      { data: { inviteCode: trimmed } },
      {
        onSuccess: () => {
          setJoinOpen(false)
          setCode("")
          join.reset()
          afterCrewChange()
        },
      },
    )
  }

  if (isLoading) return null

  const label = activeCrew?.name ?? "No crew yet"

  return (
    <div className={className}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-between gap-2 border-border/60 bg-background/60 font-medium"
            data-testid="button-crew-switcher"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Shield className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate">{label}</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
            Your crews
          </DropdownMenuLabel>
          {crews.length === 0 && (
            <DropdownMenuItem disabled data-testid="item-no-crews">
              Not in a crew yet
            </DropdownMenuItem>
          )}
          {crews.map((crew) => (
            <DropdownMenuItem
              key={crew.id}
              onSelect={() => handleActivate(crew.id)}
              data-testid={`item-crew-${crew.id}`}
            >
              <span className="flex-1 truncate">{crew.name}</span>
              <span className="text-xs text-muted-foreground">{crew.memberCount}</span>
              {crew.id === activeCrew?.id && <Check className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          ))}
          {actionsEnabled && (
            <>
              <DropdownMenuSeparator />
              {activeCrew && (
                <DropdownMenuItem onSelect={() => setManageOpen(true)} data-testid="item-manage-crew">
                  <Settings2 className="h-4 w-4" />
                  Manage {activeCrew.name}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setCreateOpen(true)} data-testid="item-create-crew">
                <Plus className="h-4 w-4" />
                Start a new crew
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setJoinOpen(true)} data-testid="item-join-crew">
                <KeyRound className="h-4 w-4" />
                Join with a code
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Create crew */}
      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) create.reset() }}>
        <DialogContent className="dark sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Start a new crew</DialogTitle>
            <DialogDescription>
              You get a fresh board and an invite code to drag your friends onto it.
            </DialogDescription>
          </DialogHeader>
          {is402(create.error) ? (
            <UpgradeCard feature="Running more than one crew" compact />
          ) : (
            <div className="space-y-3">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="Crew name"
                maxLength={40}
                data-testid="input-crew-name"
              />
              {create.isError && (
                <p className="text-sm text-chart-2" data-testid="text-create-crew-error">
                  Couldn't create the crew — give it another shot.
                </p>
              )}
              <Button
                onClick={handleCreate}
                disabled={create.isPending || !name.trim()}
                className="w-full"
                data-testid="button-create-crew"
              >
                {create.isPending ? "Creating..." : "Create crew"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Join crew */}
      <Dialog open={joinOpen} onOpenChange={(open) => { setJoinOpen(open); if (!open) join.reset() }}>
        <DialogContent className="dark sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Join a crew</DialogTitle>
            <DialogDescription>
              Punch in the invite code from whoever's board you're joining.
            </DialogDescription>
          </DialogHeader>
          {is402(join.error) ? (
            <UpgradeCard feature="Running more than one crew" compact />
          ) : (
            <div className="space-y-3">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                placeholder="Invite code"
                maxLength={16}
                className="font-mono tracking-widest uppercase"
                data-testid="input-invite-code"
              />
              {join.isError && (
                <p className="text-sm text-chart-2" data-testid="text-join-crew-error">
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
                data-testid="button-join-crew"
              >
                {join.isPending ? "Joining..." : "Join crew"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Manage the active crew: roster, leave, kick, transfer, delete */}
      {activeCrew && (
        <CrewManageDialog crew={activeCrew} open={manageOpen} onOpenChange={setManageOpen} />
      )}
    </div>
  )
}
