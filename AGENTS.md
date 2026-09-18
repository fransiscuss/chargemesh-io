# ChargeMesh implementation workflow

- Implement `docs/spec.md` in feature order, one feature at a time.
- Do not start the next feature until the current feature is implemented, tested,
  reviewed, committed, pushed, and its CI has passed. Meet external completion
  checks from the specification too; report genuine blockers without skipping gates.
- After every feature, create `docs/handoffs/F<number>.md`. Include scope and files,
  decisions, exact verification results, commit and CI references, outstanding
  issues, environment/service state, and concrete resume instructions. Never put
  secrets in handoffs. Update `docs/implementation-status.md` to link the handoff.
- The user requested that, after F3, the primary agent act as orchestrator and
  delegate implementation to a `gpt-5.6-luna` sub-agent. Delegate only the next
  eligible feature. The primary agent owns review, verification, commit/push,
  completion gates, and handoff accuracy. Do not implement future features in parallel.
- Read the latest handoff and current worktree before resuming. Preserve unrelated
  user changes. Use the ignored root `.env` for credentials; never print or commit it.
