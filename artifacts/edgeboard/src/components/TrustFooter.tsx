import { Link } from "wouter"

/**
 * Responsible-gambling note + trust page links, shown on the sign-up screen
 * and the account page. Deliberately small and non-preachy: one line, one
 * real resource.
 */
export function ResponsibleGamblingNote({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs text-muted-foreground ${className}`} data-testid="text-responsible-gambling">
      If betting stops feeling like a choice, talk to someone — call or text the National
      Problem Gambling Helpline at{" "}
      <a href="tel:1-800-522-4700" className="text-primary underline-offset-2 hover:underline">
        1-800-522-4700
      </a>{" "}
      or visit{" "}
      <a
        href="https://www.ncpgambling.org/help-treatment/"
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline-offset-2 hover:underline"
        data-testid="link-gambling-help"
      >
        ncpgambling.org
      </a>
      . Free, confidential, 24/7.
    </p>
  )
}

/** Privacy + terms links for the sign-up screen. */
export function TrustLinks() {
  return (
    <p className="text-xs text-muted-foreground">
      By signing up you agree to the{" "}
      <Link href="/terms" className="text-primary underline-offset-2 hover:underline" data-testid="link-terms">
        terms
      </Link>{" "}
      and{" "}
      <Link href="/privacy" className="text-primary underline-offset-2 hover:underline" data-testid="link-privacy">
        privacy policy
      </Link>
      .
    </p>
  )
}
