import { useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Redirect, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { shadcn } from '@clerk/themes';
import { Layout } from './components/Layout';
import { Toaster } from './components/ui/toaster';
import { UserProvider, useUser } from './contexts/UserContext';
import { useFirstRunSetupActive } from './hooks/use-first-run';
import { CrewOnboarding } from './components/CrewOnboarding';
import { getPendingInviteCode, setPendingInviteCode, clearPendingInviteCode } from './lib/pending-invite';

import Landing from './pages/Landing';
import ClaimProfile from './pages/ClaimProfile';
import Dashboard from './pages/Dashboard';
import Bets from './pages/Bets';
import NewBet from './pages/NewBet';
import BetDetail from './pages/BetDetail';
import Parlays from './pages/Parlays';
import NewParlay from './pages/NewParlay';
import ParlayDetail from './pages/ParlayDetail';
import Stats from './pages/Stats';
import Lessons from './pages/Lessons';
import EdgeFinder from './pages/EdgeFinder';
import Workspace from './pages/Workspace';
import Bankroll from './pages/Bankroll';
import Recap from './pages/Recap';
import Account from './pages/Account';
import Founder from './pages/Founder';
import DemoApp from './pages/DemoApp';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import { ResponsibleGamblingNote, TrustLinks } from './components/TrustFooter';

const queryClient = new QueryClient();

// Register the push notification service worker once at module load.
// Runs only when supported; failures are non-fatal (push works progressively).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // In Vite dev the public dir is served at root; in production the app is
    // mounted under BASE_URL (e.g. /edgeboard/) and the SW lives there too.
    const swPath = import.meta.env.DEV
      ? "/sw.js"
      : `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker.register(swPath, { scope: import.meta.env.BASE_URL }).catch(() => {
      // SW registration failures are silent — push is a progressive enhancement.
    });
  });
}

// Clerk's publishable key is intentionally safe to embed in the browser build.
// The secret key remains server-only.
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

// Clerk passes full paths to routerPush/routerReplace, but wouter's
// setLocation prepends the base — strip it to avoid doubling.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: 'hsl(220 90% 60%)',
    colorForeground: 'hsl(0 0% 95%)',
    colorMutedForeground: 'hsl(240 5% 65%)',
    colorDanger: 'hsl(0 84% 60%)',
    colorBackground: 'hsl(240 5% 8%)',
    colorInput: 'hsl(240 5% 6%)',
    colorInputForeground: 'hsl(0 0% 95%)',
    colorNeutral: 'hsl(0 0% 95%)',
    fontFamily: "'Space Mono', monospace",
    borderRadius: '0.5rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[hsl(240_5%_8%)] border border-[hsl(240_5%_15%)] rounded-2xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[hsl(0_0%_95%)] font-bold tracking-tight',
    headerSubtitle: 'text-[hsl(240_5%_65%)]',
    socialButtonsBlockButtonText: 'text-[hsl(0_0%_95%)] font-medium',
    formFieldLabel: 'text-[hsl(0_0%_95%)]',
    footerActionLink: 'text-[hsl(220_90%_60%)] hover:text-[hsl(220_90%_70%)]',
    footerActionText: 'text-[hsl(240_5%_65%)]',
    dividerText: 'text-[hsl(240_5%_65%)]',
    identityPreviewEditButton: 'text-[hsl(220_90%_60%)]',
    formFieldSuccessText: 'text-[hsl(142_70%_45%)]',
    alertText: 'text-[hsl(0_0%_95%)]',
    logoBox: 'justify-center',
    logoImage: 'h-8',
    socialButtonsBlockButton: 'bg-[hsl(240_5%_12%)] border border-[hsl(240_5%_18%)] hover:bg-[hsl(240_5%_15%)]',
    formButtonPrimary: 'bg-[hsl(220_90%_60%)] hover:bg-[hsl(220_90%_55%)] text-white font-bold',
    formFieldInput: 'bg-[hsl(240_5%_6%)] border-[hsl(240_5%_18%)] text-[hsl(0_0%_95%)]',
    footerAction: 'justify-center',
    dividerLine: 'bg-[hsl(240_5%_18%)]',
    alert: 'bg-[hsl(240_5%_12%)] border border-[hsl(240_5%_18%)]',
    otpCodeFieldInput: 'bg-[hsl(240_5%_6%)] border-[hsl(240_5%_18%)] text-[hsl(0_0%_95%)]',
    formFieldRow: 'gap-2',
    main: 'gap-5',
  },
};

function SignInPage() {
  return (
    <div className="dark flex min-h-[100dvh] items-center justify-center bg-background px-4 font-mono">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="dark flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-4 py-8 font-mono">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
      <div className="w-[440px] max-w-full space-y-2 text-center">
        <TrustLinks />
        <ResponsibleGamblingNote />
      </div>
    </div>
  );
}

// Keeps the webview up-to-date when the signed-in user changes.
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function LoadingScreen() {
  return (
    <div className="dark flex min-h-[100dvh] items-center justify-center bg-background font-mono">
      <p className="text-sm text-muted-foreground animate-pulse">LOADING…</p>
    </div>
  );
}

/** Signed-in shell: resolves the bettor profile, gates on the claim screen. */
function AuthedApp() {
  return (
    <UserProvider>
      <ProfileGate />
    </UserProvider>
  );
}

function ProfileGate() {
  const { activeUser, isLoading, needsClaim } = useUser();
  const firstRunSetupActive = useFirstRunSetupActive();
  // Bumped when a pending invite is consumed/skipped so the gate re-reads
  // storage and lets the app through.
  const [, setInviteHandledAt] = useState(0);

  // Keep the claim/setup screen up while first-run setup is in progress,
  // even if a background refetch already resolved the linked profile.
  if (needsClaim || firstRunSetupActive) return <ClaimProfile />;
  if (isLoading || !activeUser) return <LoadingScreen />;

  // An invite link (/join/CODE) followed by someone who already has a
  // profile: hand them straight to the join step, pre-filled. (Fresh signups
  // consume the code inside the claim flow instead.)
  const pendingCode = getPendingInviteCode();
  if (pendingCode) {
    return (
      <CrewOnboarding
        initialCode={pendingCode}
        onDone={() => {
          clearPendingInviteCode();
          setInviteHandledAt(Date.now());
        }}
      />
    );
  }

  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/bets" component={Bets} />
        <Route path="/bets/new" component={NewBet} />
        <Route path="/bets/:id" component={BetDetail} />
        <Route path="/parlays" component={Parlays} />
        <Route path="/parlays/new" component={NewParlay} />
        <Route path="/parlays/:id" component={ParlayDetail} />
        <Route path="/stats" component={Stats} />
        <Route path="/lessons" component={Lessons} />
        <Route path="/edge" component={EdgeFinder} />
        <Route path="/workspace" component={Workspace} />
        <Route path="/bankroll" component={Bankroll} />
        <Route path="/recap" component={Recap} />
        <Route path="/account" component={Account} />
        <Route path="/founder" component={Founder} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

/**
 * Invite deep link: /join/CODE. Stashes the code so it survives the whole
 * Clerk sign-up round-trip, then routes by auth state — signed-out visitors
 * go create an account (the claim flow's crew step picks the code up),
 * signed-in bettors land on the pre-filled join screen via ProfileGate.
 */
function JoinRoute({ code }: { code: string }) {
  // Written synchronously during render (idempotent) so the code is stashed
  // before the Redirect's effect fires.
  if (code) setPendingInviteCode(decodeURIComponent(code));

  return (
    <>
      <Show when="signed-in">
        <Redirect to="/" replace />
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-up" replace />
      </Show>
    </>
  );
}

function NotFound() {
  return (
    <div className="flex h-[50vh] flex-col items-center justify-center text-center">
      <h1 className="text-4xl font-bold text-primary mb-2">404</h1>
      <p className="text-xl text-muted-foreground">Page not found</p>
    </div>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: 'Back to the board',
            subtitle: 'Sign in to TiltCheck',
          },
        },
        signUp: {
          start: {
            title: 'Get on the board',
            subtitle: 'Your crew\u2019s private book — decision tracking for sharps',
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <Toaster />
        <Switch>
          {/* REQUIRED — "/sign-in/*?" and "/sign-up/*?" verbatim for OAuth sub-paths */}
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          {/* Public demo board — works signed-out AND signed-in; it brings its
              own QueryClient so it never touches the real session's cache. */}
          <Route path="/demo" nest>
            <DemoApp />
          </Route>
          {/* Crew invite deep link — pre-fills the join flow through sign-up. */}
          <Route path="/join/:code">{(params) => <JoinRoute code={params.code} />}</Route>
          {/* Trust pages — public, reachable signed-out from the sign-up screen. */}
          <Route path="/privacy" component={Privacy} />
          <Route path="/terms" component={Terms} />
          <Route>
            <Show when="signed-in">
              <AuthedApp />
            </Show>
            <Show when="signed-out">
              <Landing />
            </Show>
          </Route>
        </Switch>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
