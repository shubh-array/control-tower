# control-tower-pr-review

Cursor plugin pack for Control Tower `primaryReview` sessions.

Loaded by the daemon via `--plugin-dir` pointing at this directory. Safety and output contract **hashes** for run identity remain sourced from `src/app-safety/contracts.ts`; the `.mdc` rule bodies must stay byte-compatible with those contract texts (enforced by tests).

## Layout

- `rules/` — always-on safety/output contracts + agent-decides domain guidance
- `skills/control-tower-pr-review/` — review workflow skill
- `prompt.md` — thin CLI invocation prompt (not the full harness body)

No agents, hooks, or MCP servers in this plugin (Phase 1 ask-mode cage).
