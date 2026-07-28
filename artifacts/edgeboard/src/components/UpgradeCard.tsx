import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Sparkles } from "lucide-react"
import { useCreateBillingCheckout } from "@workspace/api-client-react"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

/**
 * The one upgrade surface, shown only when someone tries to join or create a
 * second Crew.
 * Sends the bettor to Whop's hosted checkout; the return redirect lands on
 * /account?upgraded=1 where the server verifies the payment — nothing here
 * grants access.
 */
export function UpgradeCard({ feature, compact = false }: { feature: string; compact?: boolean }) {
  const checkout = useCreateBillingCheckout()

  const startCheckout = () => {
    checkout.mutate(
      { data: { returnUrl: `${window.location.origin}${basePath}/account?upgraded=1` } },
      { onSuccess: ({ checkoutUrl }) => window.location.assign(checkoutUrl) },
    )
  }

  return (
    <Card className="border-primary/40 bg-primary/5 glow-primary" data-testid="card-upgrade-pro">
      <CardContent
        className={
          compact
            ? "flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between"
            : "flex flex-col items-center gap-4 py-10 text-center"
        }
      >
        <div className={compact ? "flex items-start gap-3 min-w-0" : "flex flex-col items-center gap-3"}>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15">
            <Sparkles className="h-5 w-5 text-primary drop-shadow-[0_0_8px_hsl(var(--primary)/0.6)]" />
          </div>
          <div className={compact ? "min-w-0" : "max-w-md"}>
            <div className="font-semibold text-primary text-glow-primary">Multi-Crew access</div>
            <p className="mt-1 text-sm text-muted-foreground">
              {feature} needs Multi-Crew access. Your first Crew and the complete decision engine stay free.
            </p>
            {checkout.isError && (
              <p className="mt-1 text-sm text-chart-2" data-testid="text-upgrade-error">
                Couldn't start checkout — give it another shot in a minute.
              </p>
            )}
          </div>
        </div>
        <Button
          onClick={startCheckout}
          disabled={checkout.isPending}
          data-testid="button-upgrade-pro"
          className="shrink-0"
        >
          {checkout.isPending ? "Opening checkout..." : "Add Multi-Crew"}
        </Button>
      </CardContent>
    </Card>
  )
}
