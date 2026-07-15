---
name: Frontend component tests in edgeboard
description: How jsdom/component tests are wired in the edgeboard vitest setup and the gotchas hit setting it up.
---

The edgeboard package runs vitest with `environment: "node"` by default; component tests opt into jsdom per-file with a `// @vitest-environment jsdom` docblock and live under `src/**/__tests__/*.test.tsx`.

**Why:** Two setup gotchas cost an extra iteration:
- Vitest doesn't apply the Vite React plugin, so `.tsx` tests fail with `ReferenceError: React is not defined` unless `esbuild: { jsx: "automatic" }` is set in vitest.config.ts (already done).
- Generated react-query hooks (`@workspace/api-client-react`) are easiest to control via `vi.mock` of the whole module; the page still needs a real `QueryClientProvider` wrapper because it calls `useQueryClient`.

**How to apply:** For new component tests, copy the pattern in `src/pages/__tests__/recapTape.test.tsx` — mock the hook module + `@/contexts/UserContext`, wrap in QueryClientProvider, assert by `data-testid`.

When a test file mounts many pages at once, don't enumerate every generated export — mock `@workspace/api-client-react` with a Proxy that fabricates exports by naming convention (`use{Get,List}*` → query result, `use*` → mutation, `*QueryKey` → key fn, else raw fetch fn). Handle `then`/`default`/symbols by returning undefined and `__esModule: true`, and build shared state via `vi.hoisted`. See `src/pages/__tests__/queryErrorCards.test.tsx`. Pages that use raw fetch fns through `useInfiniteQuery` (Bets/Parlays) are the easy place to test real refetch-after-failure loops.
