---
name: Dark mode class placement
description: Why the 'dark' class must live on <html>, not inner div wrappers — invisible-text bug pattern
---

# Dark mode class placement

**Rule:** the `dark` class must be on `<html>` (index.html), never only on inner `<div className="dark ...">` wrappers.

**Why:** `body { @apply text-foreground }` resolves `hsl(var(--foreground))` at the body level. If `.dark` only exists on descendants, body resolves against `:root` light-mode variables and every element that *inherits* its color (page h1s, unstyled bold values) renders near-black on the dark background. Elements with explicit `text-*` classes re-resolve inside `.dark` scope and look fine — which makes the bug look random (only some text invisible). Bit EdgeBoard on Dashboard/Recap titles and streak values (fixed 2026-07-15).

**How to apply:** dark-only apps: `<html class="dark">`. Leftover inner `dark` wrappers are harmless duplicates. When debugging "some text is invisible but other text is fine," check which elements rely on inherited color vs explicit classes before hunting per-component.
