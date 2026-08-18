# Decisions

## 2026-08-18 Documentation layout

- The bootstrap task places `CODEX-TASKS.md` in `docs/`. This task-specific requirement overrides the older run book text that places it at the repository root.

## 2026-08-18 Extension network lint scope

- The extension lint rule bans `fetch` and `XMLHttpRequest` by default. It allows them only in service worker and background paths. SPEC section 3 requires the service worker to handle server and thumbnail requests, while content scripts must never make network requests. All DOM automation and credential APIs remain banned across the extension.
