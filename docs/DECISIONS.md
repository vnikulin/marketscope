# Decisions

## 2026-08-18 Documentation layout

- The bootstrap task places `CODEX-TASKS.md` in `docs/`. This task-specific requirement overrides the older run book text that places it at the repository root.

## 2026-08-18 Extension network lint scope

- The extension lint rule bans `fetch` and `XMLHttpRequest` by default. It allows them only in service worker and background paths. SPEC section 3 requires the service worker to handle server and thumbnail requests, while content scripts must never make network requests. All DOM automation and credential APIs remain banned across the extension.

## 2026-08-18 Filter evaluation is asynchronous

- `evaluate()` returns a promise. SPEC section 4 describes `packages/filters` as synchronous, but SPEC section 7 and M2 require every user regex to run in a worker with a hard timeout. The timeout is load bearing because it stops catastrophic backtracking. The worker requirement takes precedence over the earlier synchronous description.
- An unknown-value policy of `FLAG` passes the affected check and writes `unknown; flagged` in its detail. `FilterVerdict` has no separate flag field, so this keeps the warning visible in the WHY data without treating `FLAG` as `BLOCK`.
