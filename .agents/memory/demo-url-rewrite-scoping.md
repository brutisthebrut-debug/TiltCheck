---
name: Demo URL rewrite scoping
description: How the demo board's /api → /api/demo rewrite is scoped per QueryClient and the synchronous-fetch invariant it depends on.
---

The demo world's URL rewrite is no longer a module-global switch: the demo mounts a `UrlRewriteScopedQueryClient` (shared api client lib) that wraps every resolved queryFn/mutationFn in `runWithUrlRewrite`, so only requests issued through that client are remapped to `/api/demo/...`.

**Why:** The old `setUrlRewrite` global set on /demo mount and cleared on unmount could misroute requests if both worlds ever fetched while the demo was mounted (background refetch, prefetch, rapid navigation). Per-client scoping makes cross-world routing impossible by construction.

**How to apply:**
- The scoping relies on a synchronous window: the rewrite is set, the fn is called, and the rewrite is restored — safe only because generated API functions call `customFetch` synchronously and `customFetch` applies the rewrite before its first `await`. Never add an `await` before the rewrite application in `customFetch`, and never make generated wrappers async-before-fetch.
- Any new fetch path in the demo must go through the demo's QueryClient (useQuery/useMutation/fetchQuery under its provider); a bare `customFetch`/`fetch` call from demo code will hit the real API.
- Regression test: edgeboard `src/pages/__tests__/demoWorldIsolation.test.tsx` (rapid /demo↔app navigation, cross-world fetch while demo mounted).
- Note: the other demo toggles (odds-format sync, billing sync, crew actions) are still module-global switches set/cleared by DemoApp effects.
