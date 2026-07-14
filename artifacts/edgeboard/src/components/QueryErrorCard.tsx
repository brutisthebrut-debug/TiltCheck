import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { WifiOff, RotateCw } from "lucide-react"

interface QueryErrorCardProps {
  /** Headline, e.g. "The dashboard didn't load." */
  title: string
  /** Supporting line under the headline. */
  message?: string
  onRetry: () => void
  isRetrying?: boolean
  testId: string
}

/**
 * Shared "data didn't load" card — same pattern as the weekly recap's
 * error card. Keeps page chrome intact; only the data area shows this.
 */
export function QueryErrorCard({
  title,
  message = "Not a bad beat — just a connection problem. Give it another run.",
  onRetry,
  isRetrying = false,
  testId,
}: QueryErrorCardProps) {
  return (
    <Card className="border-dashed border-2 border-muted" data-testid={testId}>
      <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <WifiOff className="h-8 w-8 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-muted-foreground text-sm mt-1">{message}</p>
        </div>
        <Button
          variant="outline"
          data-testid={`${testId}-retry`}
          disabled={isRetrying}
          onClick={onRetry}
        >
          <RotateCw className={`h-4 w-4 mr-2 ${isRetrying ? "animate-spin" : ""}`} />
          {isRetrying ? "Retrying…" : "Retry"}
        </Button>
      </CardContent>
    </Card>
  )
}
