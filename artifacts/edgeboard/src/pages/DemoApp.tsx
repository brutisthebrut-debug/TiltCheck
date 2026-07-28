import { useEffect, useState } from 'react';
import { QueryClientProvider, MutationCache } from '@tanstack/react-query';
import { Route, Switch, Link } from 'wouter';
import { UrlRewriteScopedQueryClient } from '@workspace/api-client-react';
import { setOddsFormatServerSync } from '@/hooks/use-odds-format';
import { setLessonsFiltersServerSync } from '@/hooks/use-lessons-filters';
import { setBillingServerSync } from '@/hooks/use-pro';
import { setCrewActionsEnabled } from '@/hooks/use-crews';
import { Layout } from '@/components/Layout';
import { UserProvider } from '@/contexts/UserContext';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Sparkles, ArrowRight, Lock } from 'lucide-react';

import Dashboard from './Dashboard';
import Bets from './Bets';
import BetDetail from './BetDetail';
import Parlays from './Parlays';
import ParlayDetail from './ParlayDetail';
import Stats from './Stats';
import Lessons from './Lessons';
import EdgeFinder from './EdgeFinder';
import Workspace from './Workspace';
import Bankroll from './Bankroll';
import Recap from './Recap';

// Remaps every generated API call onto the public, read-only demo mount.
// The demo world is a fictional seeded crew — same endpoints, same shapes.
const demoRewrite = (url: string) =>
  url.startsWith('/api/') ? `/api/demo/${url.slice('/api/'.length)}` : url;

/**
 * The public demo board: the real app pages, backed by /api/demo (a seeded,
 * fictional crew, strictly read-only). No sign-in required. Gets its own
 * QueryClient — scoped so demo data can never bleed into a signed-in
 * session's cache, and the demo rewrite can never touch the real app's
 * requests (the rewrite rides on this client, not a module-global switch).
 */
export default function DemoApp() {
  // useState initializers run before the first render's queries fire, so the
  // toggles are in place before any hook fetches.
  const [queryClient] = useState(() => {
    // Odds-format choice stays on this device — never PATCH the read-only
    // demo API, never let the demo persona's preference overwrite it.
    setOddsFormatServerSync(false);
    setLessonsFiltersServerSync(false);
    // The demo world always has full access and the
    // read-only demo API has no billing routes to ask.
    setBillingServerSync(false);
    // The demo crew is sealed: visitors can see it but never create/join/switch.
    setCrewActionsEnabled(false);
    return new UrlRewriteScopedQueryClient(demoRewrite, {
      mutationCache: new MutationCache({
        onError: (_error, _variables, _context, mutation) => {
          // Background best-effort writes (like the recap "seen" marker) fire
          // automatically — the visitor didn't do anything, so no scolding.
          if (mutation.options.mutationKey?.[0] === 'markRecapSeen') return;
          toast({
            title: 'This board is a demo',
            description: 'The demo is read-only — get on the board to log your own plays.',
            variant: 'destructive',
          });
        },
      }),
    });
  });

  useEffect(() => {
    setOddsFormatServerSync(false);
    setLessonsFiltersServerSync(false);
    setBillingServerSync(false);
    setCrewActionsEnabled(false);
    return () => {
      setOddsFormatServerSync(true);
      setLessonsFiltersServerSync(true);
      setBillingServerSync(true);
      setCrewActionsEnabled(true);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="dark bg-background min-h-[100dvh] font-mono">
        <DemoBanner />
        <UserProvider>
          <Layout>
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/bets" component={Bets} />
              <Route path="/bets/new" component={DemoNudge} />
              <Route path="/bets/:id" component={BetDetail} />
              <Route path="/parlays" component={Parlays} />
              <Route path="/parlays/new" component={DemoNudge} />
              <Route path="/parlays/:id" component={ParlayDetail} />
              <Route path="/stats" component={Stats} />
              <Route path="/lessons" component={Lessons} />
              <Route path="/edge" component={EdgeFinder} />
              <Route path="/workspace" component={Workspace} />
              <Route path="/bankroll" component={Bankroll} />
              <Route path="/recap" component={Recap} />
              <Route path="/account" component={DemoNudge} />
              <Route path="/founder" component={DemoNudge} />
              <Route component={DemoNudge} />
            </Switch>
          </Layout>
        </UserProvider>
      </div>
    </QueryClientProvider>
  );
}

function DemoBanner() {
  return (
    <div
      className="sticky top-0 z-[60] flex items-center justify-center gap-2 border-b border-primary/50 bg-primary/10 px-3 py-2 text-center backdrop-blur-md glow-primary"
      data-testid="banner-demo"
    >
      <Sparkles className="h-4 w-4 shrink-0 text-primary drop-shadow-[0_0_6px_hsl(var(--primary)/0.8)]" />
      <p className="text-[11px] text-foreground/90 sm:text-xs">
        <span className="font-bold text-primary text-glow-primary">DEMO BOARD</span>
        <span className="text-muted-foreground font-medium"> — a fictional crew, real product. </span>
        <Link href="~/sign-up" className="font-bold text-primary underline underline-offset-4 hover:text-primary/80 transition-colors" data-testid="link-demo-signup">
          Get on the board
        </Link>
      </p>
    </div>
  );
}

/** Shown wherever the demo can't follow (logging plays, founder dash). */
function DemoNudge() {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center text-center" data-testid="page-demo-nudge">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
        <Lock className="h-6 w-6 text-primary" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight">This part's for the crew</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        The demo board is read-only. Sign up to log your own bets, build parlays, and track
        your bankroll with your crew.
      </p>
      <Button asChild size="lg" className="mt-6 gap-2">
        <Link href="~/sign-up">
          Get on the board
          <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
      <Button asChild variant="ghost" className="mt-2 text-muted-foreground">
        <Link href="/">Back to the demo dashboard</Link>
      </Button>
    </div>
  );
}
