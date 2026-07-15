---
name: Frontend component tests in edgeboard
description: How jsdom/component tests are wired in the edgeboard vitest setup and the gotchas hit setting it up.
---

The edgeboard package runs vitest with `environment: "node"` by default; component tests opt into jsdom per-file with a `// @vitest-environment jsdom` docblock and live under `src/**/__tests__/*.test.tsx`.

**Why:** Two setup gotchas cost an extra iteration:
- Vitest doesn't apply the Vite React plugin, so `.tsx` tests fail with `ReferenceError: React is not defined` unless `esbuild: { jsx: "automatic" }` is set in vitest.config.ts (already done).
- Generated react-query hooks (`@workspace/api-client-react`) are easiest to control via `vi.mock` of the whole module; the page still needs a real `QueryClientProvider` wrapper because it calls `useQueryClient`.

**How to apply:** For new component tests, copy the pattern in `src/pages/__tests__/recapTape.test.tsx` — mock the hook module + `@/contexts/UserContext`, wrap in QueryClientProvider, assert by `data-testid`.
