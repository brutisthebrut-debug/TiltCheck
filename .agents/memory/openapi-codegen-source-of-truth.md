---
name: OpenAPI codegen source of truth
description: Why API fields must be added to openapi.yaml, never to generated client files
---

# OpenAPI codegen source of truth

Rule: any API field or endpoint change must be made in `lib/api-spec/openapi.yaml`, then regenerated with `pnpm run codegen` in `lib/api-spec`. Never hand-edit files under `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/`.

**Why:** Orval runs with `clean: true`, so codegen wipes the generated folders. Fields that were once hand-added to generated output (bet review fields, sportsbook/promoNote, a transaction-type enum member) silently vanished on the next codegen run and broke the frontend typecheck; they had to be back-filled into the yaml.

**How to apply:** Before running codegen, diff the generated files against git after regeneration — any unexpected deletions mean the spec is missing fields that code depends on. Add them to the yaml and regenerate rather than restoring hand edits.
