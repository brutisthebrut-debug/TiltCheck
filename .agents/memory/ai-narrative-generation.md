---
name: AI narrative generation pattern
description: Rules for LLM-generated content endpoints (weekly tape review) — lazy client import, GET-triggered spend controls, testing pitfalls
---

# AI narrative generation (weekly tape review)

**Rule:** never import the `@workspace/integrations-openai-ai-server` client at module top-level in server code — it throws at import when the AI env vars are missing, which turns "AI unavailable" into "API server won't boot". Lazy `await import(...)` inside the generation function; the route's try/catch degrades to `narrative: null`.

**Why:** graceful degradation was a hard requirement — the recap page must work unchanged if generation fails; a completion review flagged the boot crash.

**How to apply:** any future LLM feature: (1) lazy-import the client, (2) cache results in the DB with a unique index per natural key, (3) singleflight concurrent misses via an in-process promise map — chain `.catch(() => {}).finally(cleanup)` on the side-channel or you get unhandled rejections, (4) bound spend on the public demo mount (demo only generates for the latest completed week), (5) prompt receives a compact computed-facts JSON only — never raw DB rows — with a facts-only/no-picks system prompt.

**Testing:** `vi.mock` the integrations package in EVERY test file whose app requests could reach the endpoint (demo tests too — otherwise a test makes a real paid call). Supertest requests are lazy: to test concurrency, call `.then()` to start them, then `vi.waitFor` until the mock was hit.
