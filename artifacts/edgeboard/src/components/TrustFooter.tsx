import { Link } from "wouter"

/** Responsible-gambling note + trust page links. */
export function ResponsibleGamblingNote({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs text-muted-foreground ${className}`} data-testid="text-responsible-gambling">
      If betting stops feeling like a choice, support is available through the National Problem
      Gambling Helpline — call or text{" "}
      <a href="tel:18006973738" className="text-primary underline-offset-2 hover:underline">
        1-800-MY-RESET
      </a>{" "}
      or visit{" "}
      <a
        href="https://www.ncpgambling.org/help-treatment/about-the-national-problem-gambling-helpline/"
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline-offset-2 hover:underline"
        data-testid="link-gambling-help"
      >
        NCPG
      </a>
      . Free, confidential support is available 24/7.
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
