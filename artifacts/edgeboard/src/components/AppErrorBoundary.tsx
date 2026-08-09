import React from "react"
import { AlertTriangle, RefreshCcw, LayoutDashboard } from "lucide-react"
import { Button } from "./ui/button"

type State = {
  hasError: boolean
  message?: string
}

/**
 * Last-resort UI for unexpected render failures. A beta reviewer should never
 * be left staring at a blank page with no way back into the product.
 */
export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : undefined,
    }
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // Keep the diagnostic in the browser console for beta debugging without
    // exposing a stack trace in the user-facing recovery screen.
    console.error("TiltCheck render failure", error, info)
  }

  private retry = () => {
    this.setState({ hasError: false, message: undefined })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="dark flex min-h-[100dvh] items-center justify-center bg-background p-6 font-mono text-foreground">
        <div className="w-full max-w-lg rounded-2xl border border-destructive/30 bg-card p-6 text-center shadow-2xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.24em] text-destructive">
            The tape hit an error
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">TiltCheck didn't load this screen cleanly.</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
            Your data wasn't changed by this screen failure. Retry the view, or return to the board and keep moving.
          </p>

          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Button onClick={this.retry} className="gap-2">
              <RefreshCcw className="h-4 w-4" />
              Retry screen
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                window.location.assign(import.meta.env.BASE_URL || "/")
              }}
            >
              <LayoutDashboard className="h-4 w-4" />
              Back to board
            </Button>
          </div>

          {import.meta.env.DEV && this.state.message && (
            <p className="mt-5 break-words rounded-lg bg-background/60 p-3 text-left text-[10px] text-muted-foreground">
              {this.state.message}
            </p>
          )}
        </div>
      </div>
    )
  }
}
