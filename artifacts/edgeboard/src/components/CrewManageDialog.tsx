import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useGetCurrentUser,
  getGetCurrentUserQueryKey,
  useListCrewMembers,
  getListCrewMembersQueryKey,
  useLeaveCrew,
  useRemoveCrewMember,
  useTransferCrewOwnership,
  useDeleteCrew,
} from "@workspace/api-client-react"
import type { Crew } from "@/hooks/use-crews"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Crown, UserMinus, LogOut, Trash2, Shield } from "lucide-react"

type PendingAction =
  | { type: "leave" }
  | { type: "delete" }
  | { type: "remove"; userId: number; name: string }
  | { type: "transfer"; userId: number; name: string }

/**
 * Crew management: the roster plus the churn tools. Members can walk; the
 * owner can kick dead accounts, hand off the keys, or shut the whole board
 * down. Every destructive move goes through an inline confirm — the server
 * enforces all of it, this is just the front door.
 */
export function CrewManageDialog({
  crew,
  open,
  onOpenChange,
}: {
  crew: Crew
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const { data: me } = useGetCurrentUser({
    query: { queryKey: getGetCurrentUserQueryKey(), enabled: open },
  })
  const { data: members = [], isPending: rosterLoading } = useListCrewMembers(crew.id, {
    query: { queryKey: getListCrewMembersQueryKey(crew.id), enabled: open },
  })

  const [pending, setPending] = useState<PendingAction | null>(null)
  const [failed, setFailed] = useState(false)

  const leave = useLeaveCrew()
  const remove = useRemoveCrewMember()
  const transfer = useTransferCrewOwnership()
  const del = useDeleteCrew()
  const busy = leave.isPending || remove.isPending || transfer.isPending || del.isPending

  const isOwner = crew.role === "owner"

  const close = (next: boolean) => {
    if (!next) {
      setPending(null)
      setFailed(false)
    }
    onOpenChange(next)
  }

  // Membership changed — every social surface is stale. Nuke the cache.
  const afterChange = (closeDialog: boolean) => {
    setPending(null)
    setFailed(false)
    if (closeDialog) onOpenChange(false)
    queryClient.invalidateQueries()
  }

  const runPending = () => {
    if (!pending) return
    setFailed(false)
    const onError = () => setFailed(true)
    if (pending.type === "leave") {
      leave.mutate({ id: crew.id }, { onSuccess: () => afterChange(true), onError })
    } else if (pending.type === "delete") {
      del.mutate({ id: crew.id }, { onSuccess: () => afterChange(true), onError })
    } else if (pending.type === "remove") {
      remove.mutate({ id: crew.id, userId: pending.userId }, { onSuccess: () => afterChange(false), onError })
    } else {
      transfer.mutate(
        { id: crew.id, data: { userId: pending.userId } },
        { onSuccess: () => afterChange(false), onError },
      )
    }
  }

  const confirmCopy =
    pending?.type === "leave"
      ? `Walk away from ${crew.name}? Your bets stay yours — you just drop off this board.`
      : pending?.type === "delete"
        ? `Shut down ${crew.name} for everyone? The board's gone for good; everyone's bets stay their own.`
        : pending?.type === "remove"
          ? `Kick ${pending.name} off the board? Their slot frees up and their bets go with them.`
          : pending?.type === "transfer"
            ? `Hand the keys to ${pending.name}? You stay on the board as a regular member.`
            : ""

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="dark sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            {crew.name}
          </DialogTitle>
          <DialogDescription>
            {isOwner ? "Run the roster: kick, hand off the keys, or shut it down." : "The roster, and the door."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1" data-testid="list-crew-members">
          {rosterLoading && <p className="text-sm text-muted-foreground">Loading the roster...</p>}
          {members.map((m) => (
            <div
              key={m.userId}
              className="flex items-center gap-2 rounded-md border border-border/40 bg-background/40 px-3 py-2"
              data-testid={`row-member-${m.userId}`}
            >
              <span className="flex-1 truncate text-sm font-medium">
                {m.displayName}
                {m.userId === me?.id && <span className="text-muted-foreground"> (you)</span>}
              </span>
              {m.role === "owner" && (
                <span className="flex items-center gap-1 text-xs text-primary">
                  <Crown className="h-3 w-3" /> owner
                </span>
              )}
              {isOwner && m.userId !== me?.id && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={busy}
                    onClick={() => setPending({ type: "transfer", userId: m.userId, name: m.displayName })}
                    data-testid={`button-transfer-${m.userId}`}
                  >
                    <Crown className="h-3.5 w-3.5" />
                    Make owner
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-chart-2"
                    disabled={busy}
                    onClick={() => setPending({ type: "remove", userId: m.userId, name: m.displayName })}
                    data-testid={`button-remove-${m.userId}`}
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>

        {pending ? (
          <div className="space-y-2 rounded-md border border-chart-2/40 bg-chart-2/5 p-3">
            <p className="text-sm" data-testid="text-confirm-action">
              {confirmCopy}
            </p>
            {failed && (
              <p className="text-sm text-chart-2" data-testid="text-manage-error">
                That didn't go through — give it another shot.
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={runPending}
                disabled={busy}
                data-testid="button-confirm-action"
              >
                {busy ? "Working..." : "Do it"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPending(null)
                  setFailed(false)
                }}
                disabled={busy}
                data-testid="button-cancel-action"
              >
                Never mind
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end border-t border-border/40 pt-3">
            {isOwner ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-chart-2"
                onClick={() => setPending({ type: "delete" })}
                data-testid="button-delete-crew"
              >
                <Trash2 className="h-4 w-4" />
                Shut this crew down
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-chart-2"
                onClick={() => setPending({ type: "leave" })}
                data-testid="button-leave-crew"
              >
                <LogOut className="h-4 w-4" />
                Leave crew
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
