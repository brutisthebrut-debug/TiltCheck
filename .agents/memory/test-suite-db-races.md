---
name: Test-suite DB races
description: Why api-server tests take a pg advisory lock and what full DB wipes must cover
---

# Test-suite DB races

**Rule 1:** The api-server vitest suite serializes whole-suite runs with a session-level Postgres advisory lock in its vitest `globalSetup`. Never remove it, and any new integration-test package hitting the shared dev DB needs the same guard.

**Why:** Completion validation (and any overlapping manual run) can execute the suite twice concurrently against the one shared dev database. The recap/narrative test files do unscoped full-table wipes for determinism, so two concurrent runs corrupt each other: users vanish mid-test (claim tests got 404 instead of 409), inserts hit FK 23503 (500 instead of 201), and `delete from "users"` fails on freshly inserted children. Symptoms are order-dependent and look like unrelated random test flakes — a *different* file fails each run.

**Rule 2:** Any unscoped `delete from users` wipe must first delete every FK child *without* ON DELETE CASCADE — notably `invites` (`invited_by_id` has no cascade). `recap_narratives` cascades; bets/parlays/transactions/user_badges are already in the wipe lists.

**How to apply:** If validation or CI fails with `delete from "users"` FK errors, vanished rows mid-test, or expected-4xx-got-404/500 flakes that don't reproduce locally, suspect a concurrent suite run or a missing child-table delete before blaming the feature under test. Note the `pg` types are not importable inside api-server tests across the package boundary — use structural types or `@workspace/db` exports.
