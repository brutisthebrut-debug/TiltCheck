import { useState } from "react"
import { UserPlus, Copy, Check } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

const PITCH =
  "Our crew logs every bet on TiltCheck — the reasoning, the receipts, the leaks. Come put your record where your mouth is:"

function inviteLink(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "")
  return `${window.location.origin}${base || "/"}`
}

/** "Bring your crew" moment — a one-line pitch plus a copyable invite link. */
export function InviteCard() {
  const [copied, setCopied] = useState(false)
  const link = inviteLink()

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(`${PITCH} ${link}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable (rare) — the link is visible to copy by hand.
    }
  }

  return (
    <Card className="border-primary/20 bg-primary/5" data-testid="card-invite">
      <CardContent className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="h-9 w-9 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
            <UserPlus className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm">Bring your crew</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Anyone with the link can sign in with Google and get on the board.
            </p>
            <p className="text-xs font-mono text-muted-foreground/80 truncate mt-1" data-testid="text-invite-link">
              {link}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
          onClick={copyInvite}
          data-testid="button-copy-invite"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied!" : "Copy invite"}
        </Button>
      </CardContent>
    </Card>
  )
}
