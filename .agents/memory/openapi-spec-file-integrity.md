---
name: OpenAPI spec file integrity under concurrent tasks
description: openapi.yaml can pick up a duplicated tail when parallel tasks touch it; verify before codegen
---

# OpenAPI spec file integrity under concurrent tasks

**Rule:** Before running codegen on `lib/api-spec/openapi.yaml`, sanity-check the file for a duplicated tail (e.g. `grep -c "BetUpdate:"` should be 1, or compare `wc -l` against expectations). If schema names appear twice, restore with `git checkout -- lib/api-spec/openapi.yaml` and re-apply edits.

**Why:** During parallel task work (multiple tasks editing validation in the same spec), the working-tree copy of openapi.yaml ended up with its last ~520 lines duplicated (schemas from mid-BetInput onward appended again). Edits then matched twice and codegen would have produced garbage.

**How to apply:** Any time you edit the shared spec while other tasks are in progress, check for duplicate top-level schema keys before and after editing, and prefer unique multi-line anchors for Edit operations.
