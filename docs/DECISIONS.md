# Decisions

## 2026-08-18 Documentation layout

- The bootstrap task places `CODEX-TASKS.md` in `docs/`. This task-specific requirement overrides the older run book text that places it at the repository root.

## 2026-08-18 Extension network lint scope

- The extension lint rule bans `fetch` and `XMLHttpRequest` by default. It allows them only in service worker and background paths. SPEC section 3 requires the service worker to handle server and thumbnail requests, while content scripts must never make network requests. All DOM automation and credential APIs remain banned across the extension.

## 2026-08-18 Filter evaluation is asynchronous

- `evaluate()` returns a promise. SPEC section 4 describes `packages/filters` as synchronous, but SPEC section 7 and M2 require every user regex to run in a worker with a hard timeout. The timeout is load bearing because it stops catastrophic backtracking. The worker requirement takes precedence over the earlier synchronous description.
- An unknown-value policy of `FLAG` passes the affected check and writes `unknown; flagged` in its detail. `FilterVerdict` has no separate flag field, so this keeps the warning visible in the WHY data without treating `FLAG` as `BLOCK`.

## 2026-08-18 M3 runtime and SQLite version

- Node.js 24.19.0 is the latest LTS release. Node.js 26 remains the Current release. Source: [Node.js releases](https://nodejs.org/en/about/previous-releases).
- MarketScope uses `better-sqlite3` 13.0.3. Its package declares Node.js 22 or newer, and its N-API build supports Node.js 24. Source: [`better-sqlite3` 13.0.3 package metadata](https://raw.githubusercontent.com/WiseLibs/better-sqlite3/v13.0.3/package.json) and [13.0.3 release](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.3).
- The database starts in WAL mode with a 5,000 millisecond busy timeout. One Fastify process owns the connection.

## 2026-08-18 M3 authentication parameters

- Admin passwords use Argon2id with 64 MiB of memory, three iterations, one lane, and a 32-byte hash.
- Session and extension bearer tokens contain 32 random bytes. SQLite stores only their SHA-256 hashes. Session cookies always set `HttpOnly`, `Secure`, and `SameSite=Lax`, with a 30-day expiry.
- Setup and login obtain a short-lived pre-authentication CSRF token before submitting credentials. Authenticated state changes use a session-bound CSRF token.
- A successful login replaces the administrator's existing sessions. This rotates session credentials whenever authentication establishes a new privileged session.

## 2026-08-18 M3 watchlist and listing behavior

- Editing a watchlist resets `seeded` to false. Changed rules must seed once before later notification work can alert on new matches. Pause and resume preserve the existing seed state.
- The server assigns `firstSeen` and `lastSeen` when it receives a listing. It does not trust client-supplied observation timestamps.
- Price history includes the first observed known price. It adds another row whenever the observed price changes, including a change to or from an unknown price.
- Watchlist matches store the complete `FilterVerdict` for both passing and blocked listings. This preserves the data needed for the later Matches, History, Blocked, and WHY views.
- The M3 ingest path marks a watchlist seeded after its first non-empty observed batch. Notification queue writes remain part of M5.

## 2026-08-18 M4 extension lifecycle and storage

- Chrome's current extension documentation says Manifest V3 service workers
  normally stop after 30 seconds of inactivity, after a single request runs for
  five minutes, or when a fetch response takes more than 30 seconds. It directs
  extensions to persist state instead of relying on globals. Source:
  [extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
- `chrome.storage.session` keeps in-memory data while the extension remains
  loaded. Chrome clears it on disable, reload, update, or browser restart. Its
  current quota is 10 MB. MarketScope uses it for unsent listing batches, and a
  restart test creates a new queue instance against the same session storage.
  Source: [chrome.storage](https://developer.chrome.com/docs/extensions/reference/api/storage).
- The two-second upload debounce uses an in-worker timer. Failed uploads create
  a `chrome.alarms` wakeup at 30 seconds so a stopped worker can resume the
  persisted queue.
- The content script sends parsed listings to the service worker. Only the
  service worker calls `fetch`. Chrome's extension documentation confirms that
  extension service workers can make cross-origin requests to origins declared
  in `host_permissions`, while content-script requests remain subject to the
  page origin. Source:
  [cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).

## 2026-08-18 M4 rendering and parser behavior

- HIDE uses an opaque overlay instead of removing a rejected card from layout.
  This preserves Facebook's virtualized layout height and keeps WHY available.
  DIM changes opacity. SHOW WITH WARNING leaves the card visible. SHOW BLOCKED
  temporarily uses the warning presentation so rejection reasons stay
  reachable.
- The parser picks the highest structural ancestor that contains exactly one
  Marketplace item link. It stops before `body` and never selects a generated
  Facebook class.
- A parsed unknown price is explicit `null` inside the parser boundary. The
  upload adapter omits that field because the shared listing and M3 ingest
  contract represent unknown price as an absent optional value.
- Browser regex checks run in a packaged dedicated worker with a 50 millisecond
  timeout and a 4 KB UTF-8 input cap. Node checks keep using `worker_threads`.
  The filter check construction remains shared by both runtimes.
