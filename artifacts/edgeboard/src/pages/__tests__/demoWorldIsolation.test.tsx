// @vitest-environment jsdom
//
// Demo/real world isolation regression test.
//
// The demo board remaps every generated API call onto the read-only demo
// mount (/api/demo/...). That rewrite used to be a module-global switch set
// on entering /demo and cleared on leaving — safe only while exactly one
// world renders at a time. It is now scoped to the demo's own QueryClient
// (UrlRewriteScopedQueryClient), so a request can never hit the wrong world
// no matter how the two worlds' renders and fetches interleave.
//
// These tests use the REAL generated hooks and a stubbed global fetch that
// records every URL, then hammer the exact scenarios the old global switch
// could get wrong: rapid navigation between /demo and the signed-in app,
// and real-app requests fired while the demo is mounted.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Switch, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  UrlRewriteScopedQueryClient,
  useGetCurrentUser,
  getGetCurrentUserQueryKey,
  getCurrentUser,
} from "@workspace/api-client-react";

// Same rewrite the demo board uses (kept in sync with DemoApp.tsx).
const demoRewrite = (url: string) =>
  url.startsWith("/api/") ? `/api/demo/${url.slice("/api/".length)}` : url;

// ── Fetch stub ───────────────────────────────────────────────────────────────
// Records every requested URL and answers with a world-specific payload so
// cache bleed is observable in the data, not just the URLs.

let requestedUrls: string[] = [];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  requestedUrls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      requestedUrls.push(url);
      if (url.startsWith("/api/demo/")) {
        return jsonResponse({ id: 999, displayName: "Demo Persona" });
      }
      return jsonResponse({ id: 1, displayName: "Real Bettor" });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ── Harness ──────────────────────────────────────────────────────────────────
// A miniature App.tsx: the real world under its plain QueryClient, the demo
// world under its rewrite-scoped client, switched by route — same shape as
// the real router (each world brings its own provider).

function WorldProbe() {
  const { data } = useGetCurrentUser();
  return <div data-testid="probe">{data?.displayName ?? "loading"}</div>;
}

function Harness({
  realClient,
  demoClient,
}: {
  realClient: QueryClient;
  demoClient: QueryClient;
}) {
  return (
    <Switch>
      <Route path="/demo" nest>
        <QueryClientProvider client={demoClient}>
          <WorldProbe />
        </QueryClientProvider>
      </Route>
      <Route>
        <QueryClientProvider client={realClient}>
          <WorldProbe />
        </QueryClientProvider>
      </Route>
    </Switch>
  );
}

function makeClients() {
  const realClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const demoClient = new UrlRewriteScopedQueryClient(demoRewrite, {
    defaultOptions: { queries: { retry: false } },
  });
  return { realClient, demoClient };
}

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

describe("demo/real world isolation", () => {
  it("routes each world's requests to its own API mount", async () => {
    const { realClient, demoClient } = makeClients();
    const { hook, navigate } = memoryLocation({ path: "/", record: true });

    const { getByTestId } = render(
      <Router hook={hook}>
        <Harness realClient={realClient} demoClient={demoClient} />
      </Router>,
    );

    await waitFor(() => expect(getByTestId("probe").textContent).toBe("Real Bettor"));
    expect(requestedUrls).toEqual(["/api/users/me"]);

    await act(async () => navigate("/demo"));
    await waitFor(() => expect(getByTestId("probe").textContent).toBe("Demo Persona"));
    expect(requestedUrls).toEqual(["/api/users/me", "/api/demo/users/me"]);
  });

  it("keeps every request in the right world across rapid /demo ↔ app navigation", async () => {
    const { realClient, demoClient } = makeClients();
    const { hook, navigate } = memoryLocation({ path: "/" });

    // Force a refetch on every remount so each hop issues a fresh request.
    realClient.setDefaultOptions({ queries: { retry: false, staleTime: 0, gcTime: 0 } });
    demoClient.setDefaultOptions({ queries: { retry: false, staleTime: 0, gcTime: 0 } });

    render(
      <Router hook={hook}>
        <Harness realClient={realClient} demoClient={demoClient} />
      </Router>,
    );

    // Hammer the switch without waiting for in-flight fetches to settle —
    // exactly the interleaving that flips a module-global rewrite mid-flight.
    for (let i = 0; i < 5; i++) {
      await act(async () => navigate("/demo"));
      await act(async () => navigate("/"));
    }
    await flush();
    await flush();

    expect(requestedUrls.length).toBeGreaterThan(2);
    for (const url of requestedUrls) {
      // Every URL must be exactly one world — no half-rewritten or
      // wrong-world requests.
      expect(
        url === "/api/users/me" || url === "/api/demo/users/me",
        `unexpected URL: ${url}`,
      ).toBe(true);
    }

    // No cache bleed in either direction: each client only ever holds its
    // own world's payload.
    const realData = realClient.getQueryData<{ displayName: string }>(getGetCurrentUserQueryKey());
    const demoData = demoClient.getQueryData<{ displayName: string }>(getGetCurrentUserQueryKey());
    if (realData) expect(realData.displayName).toBe("Real Bettor");
    if (demoData) expect(demoData.displayName).toBe("Demo Persona");
  });

  it("real-app requests fired WHILE the demo is mounted still hit the real API", async () => {
    const { realClient, demoClient } = makeClients();
    const { hook, navigate } = memoryLocation({ path: "/" });

    const { getByTestId } = render(
      <Router hook={hook}>
        <Harness realClient={realClient} demoClient={demoClient} />
      </Router>,
    );
    await waitFor(() => expect(getByTestId("probe").textContent).toBe("Real Bettor"));

    // Enter the demo and let it fetch.
    await act(async () => navigate("/demo"));
    await waitFor(() => expect(getByTestId("probe").textContent).toBe("Demo Persona"));

    requestedUrls = [];

    // The future-feature scenario the old global switch could not survive:
    // a background refetch/prefetch on the REAL client while the demo is
    // mounted (and its rewrite is "active").
    const fetched = await act(() =>
      realClient.fetchQuery({
        queryKey: getGetCurrentUserQueryKey(),
        queryFn: ({ signal }) => getCurrentUser({ signal }),
        staleTime: 0,
      }),
    );

    expect(requestedUrls).toEqual(["/api/users/me"]);
    expect((fetched as unknown as { displayName: string }).displayName).toBe("Real Bettor");

    // And the mirror image: a demo-client fetch is rewritten even though the
    // fetch was triggered imperatively, outside any render of the demo tree.
    requestedUrls = [];
    await act(() =>
      demoClient.fetchQuery({
        queryKey: [...getGetCurrentUserQueryKey(), "imperative"],
        queryFn: ({ signal }) => getCurrentUser({ signal }),
      }),
    );
    expect(requestedUrls).toEqual(["/api/demo/users/me"]);

    // Caches stayed disjoint.
    expect(
      realClient.getQueryData<{ displayName: string }>(getGetCurrentUserQueryKey())?.displayName,
    ).toBe("Real Bettor");
    expect(
      demoClient.getQueryData<{ displayName: string }>(getGetCurrentUserQueryKey())?.displayName,
    ).toBe("Demo Persona");
  });
});
