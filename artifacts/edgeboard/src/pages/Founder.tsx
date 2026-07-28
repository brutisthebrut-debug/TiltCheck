import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useUser } from "@/contexts/UserContext"
import {
  useGetAdminOverview,
  getGetAdminOverviewQueryKey,
  useListInvites,
  getListInvitesQueryKey,
  useCreateInvite,
  useDeleteInvite,
  type AdminMember,
} from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { QueryErrorCard } from "@/components/QueryErrorCard"
import { formatCurrency, formatDate } from "@/lib/format"
import {
  Activity,
  CheckCircle2,
  Circle,
  Crown,
  Loader2,
  Lock,
  LockOpen,
  Mail,
  Trash2,
  UserCheck,
} from "lucide-react"

function StatCard({ label, value, sub, testid }: { label: string; value: string; sub?: string; testid: string }) {
  return (
    <Card data-testid={`card-${testid}`}>
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-mono">{label}</p>
        <p className="mt-1 text-2xl font-bold font-mono" data-testid={`text-${testid}`}>{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function MemberRow({ m }: { m: AdminMember }) {
  const evidence = [
    { label: "first play", complete: m.firstPlayAt != null },
    { label: "process review", complete: m.firstReviewAt != null },
    { label: "7-day return", complete: m.returnedWithin7Days },
    { label: "Crew joined", complete: m.crewMemberships > 0 },
  ]

  return (
    <div className="py-3 space-y-2" data-testid={`row-member-${m.userId}`}>
      <div className="flex items-center gap-3">
        <span
          className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white"
          style={{ backgroundColor: m.avatarColor }}
        >
          {m.displayName.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium truncate">{m.displayName}</p>
            {m.isFounder && <Crown className="h-3.5 w-3.5 shrink-0 text-yellow-500" aria-label="Founder" />}
            {!m.linked && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                unclaimed
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">{m.email ?? "no email on file"}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-mono">
            {m.playsLogged} plays
            {m.playsThisWeek > 0 && <span className="text-primary"> · {m.playsThisWeek} this wk</span>}
          </p>
          <p className="text-xs text-muted-foreground font-mono">
            {m.reviewedPlays} reviewed
            {m.lastPlayAt ? ` · last ${formatDate(m.lastPlayAt)}` : " · no plays yet"}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 pl-12">
        {evidence.map((item) => (
          <Badge
            key={item.label}
            variant="outline"
            className={item.complete ? "text-emerald-500 border-emerald-500/40 gap-1" : "text-muted-foreground gap-1"}
          >
            {item.complete ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
            {item.label}
          </Badge>
        ))}
      </div>
    </div>
  )
}

export default function Founder() {
  const { activeUser } = useUser()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  const overviewQuery = useGetAdminOverview({
    query: { enabled: !!activeUser?.isFounder, queryKey: getGetAdminOverviewQueryKey() },
  })
  const invitesQuery = useListInvites({
    query: { enabled: !!activeUser?.isFounder, queryKey: getListInvitesQueryKey() },
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() })
    queryClient.invalidateQueries({ queryKey: getListInvitesQueryKey() })
  }

  const createInvite = useCreateInvite({
    mutation: {
      onSuccess: () => {
        setEmail("")
        setFormError(null)
        refresh()
      },
      onError: (e) => {
        const msg = (e as { data?: { error?: string } })?.data?.error
        setFormError(msg ?? "Couldn't add that email — try again.")
      },
    },
  })
  const deleteInvite = useDeleteInvite({ mutation: { onSuccess: refresh } })

  if (!activeUser?.isFounder) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center text-center px-6">
        <Lock className="h-8 w-8 text-muted-foreground mb-3" />
        <h1 className="text-lg font-bold">Founder access only</h1>
        <p className="mt-1 text-sm text-muted-foreground">This page is reserved for whoever runs the board.</p>
      </div>
    )
  }

  const overview = overviewQuery.data
  const invites = invitesQuery.data ?? []

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) return
    createInvite.mutate({ data: { email: trimmed } })
  }

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold font-mono tracking-tight flex items-center gap-2">
          <Crown className="h-6 w-6 text-yellow-500" /> Beta Ops
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Who's in, who has beta access, and whether the product loop is sticking.
        </p>
      </div>

      {overviewQuery.error ? (
        <QueryErrorCard
          title="The beta overview didn't load."
          onRetry={() => overviewQuery.refetch()}
          isRetrying={overviewQuery.isFetching}
          testId="error-admin-overview"
        />
      ) : !overview ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Beta door status */}
          <Card data-testid="card-beta-status">
            <CardContent className="pt-6 flex items-center gap-3">
              {overview.betaLocked ? (
                <Lock className="h-5 w-5 text-primary shrink-0" />
              ) : (
                <LockOpen className="h-5 w-5 text-yellow-500 shrink-0" />
              )}
              <div>
                <p className="text-sm font-medium" data-testid="text-beta-status">
                  {overview.betaLocked ? "Beta is invite-only" : "Beta door is open"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {overview.betaLocked
                    ? "Only emails on the invite list below can create a profile. People already in stay in."
                    : "Anyone with the link can join. Add the first invite email below to lock it down."}
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label="Beta evidence"
              value={`${overview.betaQualifiedMembers}/${overview.betaTesterTarget}`}
              sub="completed product loop"
              testid="beta-evidence"
            />
            <StatCard label="Waiting to join" value={String(overview.invitesOutstanding)} sub="allowed, not signed up" testid="invites-open" />
            <StatCard label="Plays this week" value={String(overview.playsThisWeek)} sub={`${overview.totalPlays} all time`} testid="plays-week" />
            <StatCard
              label="Wagered this week"
              value={formatCurrency(overview.wageredThisWeek)}
              sub={`${formatCurrency(overview.totalWagered)} all time`}
              testid="wagered-week"
            />
          </div>

          {/* Invite management */}
          <Card data-testid="card-invites">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="h-4 w-4 text-primary" /> Beta access list
              </CardTitle>
              <CardDescription>
                Emails allowed to claim a seat. Removing one doesn't kick out anyone who already joined.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={submit} className="flex gap-2">
                <Input
                  type="email"
                  inputMode="email"
                  placeholder="friend@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    setFormError(null)
                  }}
                  data-testid="input-invite-email"
                />
                <Button type="submit" disabled={createInvite.isPending || !email.trim()} data-testid="button-add-invite">
                  {createInvite.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Allow"}
                </Button>
              </form>
              {formError && (
                <p className="text-sm text-destructive" data-testid="text-invite-error">{formError}</p>
              )}

              {invitesQuery.error ? (
                <QueryErrorCard
                  title="The invite list didn't load."
                  onRetry={() => invitesQuery.refetch()}
                  isRetrying={invitesQuery.isFetching}
                  testId="error-invites"
                />
              ) : invites.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2" data-testid="text-no-invites">
                  No access list yet — the door is open until you add an email.
                </p>
              ) : (
                <div className="divide-y divide-border/50">
                  {invites.map((inv) => (
                    <div key={inv.id} className="flex items-center gap-3 py-2.5" data-testid={`row-invite-${inv.id}`}>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-mono truncate">{inv.email}</p>
                        <p className="text-xs text-muted-foreground">added {formatDate(inv.createdAt)}</p>
                      </div>
                      {inv.claimed ? (
                        <Badge variant="outline" className="text-emerald-500 border-emerald-500/40 gap-1">
                          <UserCheck className="h-3 w-3" /> joined
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">waiting</Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteInvite.mutate({ id: inv.id })}
                        disabled={deleteInvite.isPending}
                        aria-label={`Remove beta access for ${inv.email}`}
                        data-testid={`button-remove-invite-${inv.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Crew activity */}
          <Card data-testid="card-members">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4 text-primary" /> Crew activity
              </CardTitle>
              <CardDescription>
                Product evidence for each tester. Observed comprehension and invite behavior still belong in the beta runbook.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-border/50">
                {overview.members.map((m) => (
                  <MemberRow key={m.userId} m={m} />
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
