import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Layout } from './components/Layout';
import { UserProvider } from './contexts/UserContext';

import Dashboard from './pages/Dashboard';
import Bets from './pages/Bets';
import NewBet from './pages/NewBet';
import BetDetail from './pages/BetDetail';
import Parlays from './pages/Parlays';
import NewParlay from './pages/NewParlay';
import ParlayDetail from './pages/ParlayDetail';
import Stats from './pages/Stats';
import Workspace from './pages/Workspace';
import Bankroll from './pages/Bankroll';

const queryClient = new QueryClient();

function NotFound() {
  return (
    <div className="flex h-[50vh] flex-col items-center justify-center text-center">
      <h1 className="text-4xl font-bold text-primary mb-2">404</h1>
      <p className="text-xl text-muted-foreground">Page not found</p>
    </div>
  );
}

function Router() {
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
        <Route path="/workspace" component={Workspace} />
        <Route path="/bankroll" component={Bankroll} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <UserProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
      </UserProvider>
    </QueryClientProvider>
  );
}

export default App;
