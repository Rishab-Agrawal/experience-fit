# experience-fit

## Standard

Code and design, from architecture down to single lines, as a very experienced senior engineer would write them: no bloat, nothing stale, no over-engineering, easy to maintain. The `ponytail` skill is a useful guide, not the whole standard.

- Check if there are any standard/official way of doing what you are trying to do, rather than reinventing the wheel with sub-par quality.
- Comments: as crisp as possible. Never history, past mistakes or what changed.
- Keep diffs as small as possible. Not so commits are tiny: a small diff is evidence that nothing is bloated or over-engineered.
- When something goes stale, remove it in the same change.
- Lasting knowledge that the code, git and skills don't already hold goes in this file, never in Claude's auto-memory. Only what's necessary, as crisp as possible.
- Ensure you do not ask me to do anything which you can do yourself. Only stop if it there is something which you truly cannot handle, or if my input is genuinely required. If it is not about input but a step that I need to do, check if there is a way for the step to be done at the end so that you can do as much of it as possible without stopping.

## Problems are symptoms

A bug, bloat or over-engineering usually points to something larger: weak design, a missing concept, a wrong abstraction. Goodhart's law applies: fixing only the instance treats the measure as the target. Find and fix the root cause.
## Project

- Node runs the `.ts` sources directly (type stripping): relative imports end in `.ts`, type-only imports use `import type`, no enums or namespaces.
- `src/extract.ts` creates the Anthropic client on import (needs `ANTHROPIC_API_KEY`), so tests only `import type` from it.
