---
name: Stale TS project references in artifact typecheck
description: tsc --noEmit in an artifact can report phantom "no exported member" errors from @workspace lib packages
---

# Stale TS project references

`tsc --noEmit` inside an artifact (e.g. edgeboard) resolves `@workspace/api-zod` / `@workspace/api-client-react` through TypeScript project references, which read the libs' `dist/` declaration output — not `src/`. The lib packages have no `build` script, so after codegen or parallel-task edits the dist can be stale and the typecheck reports "has no exported member" errors for symbols that exist in src.

**Why:** composite projects with `emitDeclarationOnly` + `outDir: dist`; nothing rebuilds them automatically.

**How to apply:** if artifact typecheck errors point at `@workspace/*` exports that clearly exist in `lib/*/src`, run `pnpm exec tsc -b lib/db lib/api-zod lib/api-client-react lib/weeks` from the repo root first, then re-run the artifact typecheck. (`lib/db` can also go stale — e.g. phantom "property does not exist" errors on schema columns that clearly exist in `lib/db/src/schema`.)
