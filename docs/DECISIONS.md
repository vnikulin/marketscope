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

## 2026-08-19 M5 SMTP provider checks

- Google still supports 16-digit app passwords for accounts with 2-Step
  Verification. Some managed, security-key-only, and Advanced Protection
  accounts can't create them. Source: [Google Account Help](https://support.google.com/accounts/answer/185833?hl=en).
- Microsoft revised the Exchange Online SMTP AUTH basic authentication
  schedule on January 27, 2026. Behavior stays unchanged through December 2026. Microsoft will disable it by default for existing tenants at the end
  of December 2026, but administrators can re-enable it. Microsoft plans to
  announce the final removal date in the second half of 2027. Source:
  [Exchange Team announcement](https://techcommunity.microsoft.com/blog/exchange/updated-exchange-online-smtp-auth-basic-authentication-deprecation-timeline/4489835).
- MarketScope uses Nodemailer 9.0.4 for generic SMTP. It was the current npm
  release checked on August 19, 2026. Source:
  [Nodemailer on npm](https://www.npmjs.com/package/nodemailer).
- Custom SMTP accepts `NONE` only for an explicitly selected custom server.
  Mailpit listens without encryption by default, and some local relays do the
  same. Gmail and Microsoft 365 always select STARTTLS. Source:
  [Mailpit sending documentation](https://mailpit.axllent.org/docs/usage/sending-messages/).

## 2026-08-19 M5 notification and thumbnail behavior

- Saving SMTP settings clears their verified state. A successful test message
  sets `verifiedAt`. The worker leaves queued alerts untouched until that field
  exists.
- A first delivery failure uses state `failed`. Later scheduled attempts use
  `retrying`. The sixth failed attempt moves the notification to `dead` after
  the required 1 minute, 5 minute, 15 minute, 1 hour, and 6 hour delays.
- Notification rows snapshot the listing and matching watchlist names at queue
  time. A later watchlist rename or deletion can't change an already queued
  email.
- Email stays plain text and omits images. CID attachments would increase every
  message size, while a normal link to the local cache may not load when the
  mail client is outside the tailnet. The thumbnail cache remains available to
  the later PWA milestone.
- The extension service worker downloads only HTTPS JPEG responses from
  `fbcdn.net` subdomains after listing ingest succeeds. It rejects responses
  above 200KB. The server stores SHA-256-named files and applies a 2GB LRU cap.

## 2026-08-19 M5 Ubuntu Mailpit checkpoint

- Commit `78088c7` was tested on an x86-64 Ubuntu machine with Node.js 24.19.0,
  npm 11.17.0, and Mailpit 1.30.7. The Mailpit archive matched its published
  SHA-256 digest before installation.
- `npm run lint` and `npm run typecheck` exited successfully.
- `MAILPIT_BIN="$HOME/.local/bin/mailpit" npm run test:integration -- --reporter=verbose`
  passed all 9 test files and all 26 tests in 23.55 seconds. No tests were
  skipped. All eight M5 email cases passed against Mailpit.

## 2026-08-19 M6 PWA data and navigation

- The PWA uses hash routes. A saved or installed app can open any view through
  the same cached app shell without requiring server rewrite rules for each
  client route.
- Listing API responses include the persisted `FilterVerdict` from
  `watchlist_matches`. The Matches and Blocked views derive their state from
  that verdict, and the WHY panel renders the same object.
- Listing data always bypasses the service worker cache. The service worker
  caches the HTML, built JavaScript, built CSS, manifest, and icons only.
- The Fastify process serves the compiled web directory directly. It sends
  hashed assets with immutable cache headers and sends the app shell and
  service worker with `no-cache`.

## 2026-08-19 M6 backup and restore

- The PWA exports a versioned JSON backup. It includes settings without SMTP
  secrets, watchlists, favorites, ignore rules, and optional observed history.
- Restore validates the complete payload before changing data. It saves a
  SQLite snapshot first, then applies the logical restore in one transaction.
  It does not restore an SMTP password or verified email state.

## 2026-08-19 M6 viewport coverage

- A focused responsive test opens every primary view in iPhone portrait,
  iPhone horizontal, Android portrait, Android horizontal, tablet, and desktop
  projects. The state-changing workflow runs once in the desktop project so
  backup restore and watchlist mutations cannot make viewport projects depend
  on execution order.

## 2026-08-19 Extension worker packaging

- Chrome loads static manifest content scripts as classic scripts. The content
  bundle therefore can't contain `import.meta`, even when it only creates a
  module worker.
- Vite gives the regex worker a stable packaged filename. The content script
  resolves that file with `chrome.runtime.getURL`, and the manifest exposes only
  that worker file to Facebook pages.
- Every extension build parses the emitted content bundle as a classic script.
  It also checks that the packaged worker exists and that the manifest exposes
  only that worker file to Facebook pages.

## 2026-08-19 Blocked cards and dashboard focus

- MarketScope can't stop Facebook from loading a listing. That would violate
  the zero-request observer boundary. Hide mode uses CSS visibility and a fixed
  two-pixel block size instead. It never uses `display: none`, which can break
  Facebook's virtualized feed.
- The Dashboard shows recent listings that passed at least one watchlist.
  History still records every observed listing, and Blocked keeps rejected
  listings available with their WHY details.
- A watchlist using ANY term mode requires at least one required term. ALL
  continues to require every term.
- The Dashboard links to the authenticated new-watchlist editor. New watchlists
  default to ANY term mode and keep the existing safe rule defaults.
- MarketScope does not submit searches to Facebook. Each watchlist exposes its
  saved opaque URL as an Open search link, and only the user's click opens it.
  The extension token remains unable to create or edit watchlists.

## 2026-08-19 Toolbar enable switch

- The Chrome toolbar popup stores one local enabled flag. Disabled is explicit;
  a missing flag keeps MarketScope enabled for existing installations.
- Disabling stops the observer and removes controls, warnings, annotations, and
  card visibility rules from the open Marketplace page. Enabling starts a new
  observer against the current page without navigating or reloading Facebook.

## 2026-08-19 Match tags and ZIP radius

- A matched listing card shows only watchlist names whose verdict passed. WHY
  still shows every evaluation, and a blocked card keeps every failed watchlist
  name for diagnosis.
- MarketScope cannot calculate distance from an arbitrary ZIP code without
  coordinates or geocoding. Users set ZIP and radius in Facebook before saving
  the opaque search URL. MarketScope applies its maximum-distance rule only to
  distances Facebook rendered on the listing.

## 2026-08-19 Listing layouts

- Dashboard, Matches, Favorites, History, and Blocked share List and Tiles
  controls. The PWA stores the choice in browser local storage and applies it
  when the user moves between listing views.

## 2026-08-19 Marketplace quick add

- The extension adds an "Add current search to MarketScope" context-menu item
  on Facebook Marketplace pages. It opens the local watchlist editor with the
  current page URL, name, and comma-separated query terms prefilled.
- The user reviews and saves the form. The extension doesn't create Facebook
  requests or silently create a watchlist with inferred settings.

## 2026-08-19 Listing cleanup and listing-based drafts

- Clear blocked results permanently deletes blocked, non-favorited listings.
  SQLite foreign keys remove their match, price, and notification records.
  Favorites are preserved and the result reports how many were kept.
- Every PWA listing can create a watchlist draft. The draft prefills a manual
  Facebook search URL, title terms, maximum price, city, and state. The user
  reviews the form before saving it.
- Provider OAuth sign-in remains outside V1 because the specification requires
  SMTP and explicitly excludes OAuth2 XOAUTH2.

## 2026-08-19 PWA shell updates and listing detail layout

- PWA navigations use the network first and refresh the cached app shell. The
  cached shell remains an offline fallback. Hashed assets remain cache first.
  This prevents an installed PWA from remaining on an old bundle after builds.
- Listing views offer Details, List, and Tiles. Details keeps the full card,
  adds seller and observation metadata, and places the title below a full-width
  image. List removes descriptions and uses smaller images. Tiles uses the grid.
- Listing thumbnails use `object-fit: contain` inside fixed frames so the full
  photo remains visible instead of cropping its edges.
- Gmail configuration states that Google performs the MFA step. MarketScope
  accepts the resulting 16-digit app password and verifies it with a test send.

## 2026-08-19 CSRF recovery and image preview sizing

- An authenticated write that receives `CSRF_REJECTED` refreshes the
  session-bound token and retries once. Another dashboard tab can rotate the
  shared session token, so the first tab must recover without losing form data.
  Pre-authentication setup and login requests keep their explicit tokens and
  never enter this retry path.
- Details uses the same fixed-height, contained thumbnail treatment as Tiles.
  It keeps the full image visible but no longer expands the preview to the
  width and height of the listing card.

## 2026-08-19 Compact tiles and thumbnail selection

- Tiles use smaller cards than Details at every tested viewport. Phone
  portrait uses two columns with 130-pixel thumbnail frames. Details keeps its
  existing single-column size and metadata. This supersedes the earlier
  statement that Details and Tiles use the same thumbnail treatment.
- A Marketplace card can contain an unrelated image before its listing photo.
  The parser checks each image candidate and selects the first HTTPS
  `fbcdn.net` source. It never accepts another host.
- The seeded E2E preview has no captured Facebook image bytes, so it displays
  the MarketScope placeholder. Real listing photos appear only after the
  extension downloads and uploads an allowed JPEG thumbnail.

## 2026-08-19 M7 release and update channel

- A semantic version tag starts the release workflow. It tests the repository,
  publishes AMD64 and ARM64 images to GitHub Container Registry, and attaches a
  rendered installer plus a checksummed Linux bundle to the GitHub release.
- The image receives both its immutable release tag and the moving `latest`
  tag. Normal installs follow `latest`. `marketscope update v1.2.3` can pin or
  roll forward to a specific release.
- Updates preserve the previous image ID, a physical SQLite snapshot, the
  Compose file, and the CLI. A failed pull restarts the old version. A failed
  health check restores all four before restarting.
- Maintenance commands stop the server before another process opens SQLite.
  This preserves the one-owner rule. Logical backups omit SMTP credentials,
  SMTP errors, session material, and extension tokens.
- Docker's current Ubuntu instructions support 22.04 and 24.04 and use the
  official `docker.sources` repository with `Signed-By`. MarketScope follows
  those steps and enables the daemon with systemd. Source checked August 19,
  2026: [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
- GitHub Actions publishes to GHCR with the repository `GITHUB_TOKEN` and
  `packages: write`. Anonymous Ubuntu installs require the resulting container
  package to be public. Source checked August 19, 2026:
  [publishing Docker images](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
  and [GHCR permissions](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages).
- Tailscale Serve proxies the loopback listener with
  `tailscale serve --bg http://127.0.0.1:3000`. The background flag preserves
  the Serve configuration across reboots. Source checked August 19, 2026:
  [Tailscale Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve).
- The installer writes a random session signing key as a mode 0600 file. The
  server uses it as the HMAC key for session and CSRF token hashes. Extension
  tokens keep their existing SHA-256 storage format.
- Playwright never reuses the stateful E2E API server. Every run starts with a
  new temporary SQLite database, so an earlier workflow can't leave favorites,
  deleted listings, or restored data behind for the next run.
- CI runs E2E in Microsoft's Playwright image pinned to the repository's exact
  Playwright version. Hosted-runner browser installation can stall after the
  full Chromium download, and the extension test requires that full Chromium
  channel. Static checks, non-browser tests, release packaging, and the Docker
  build stay in a separate native runner job. Feature branches run CI through
  pull requests. Direct push CI is limited to `main`, so the same commit doesn't
  consume duplicate runners. The browser image gets `build-essential` before
  `npm ci` because Node 24 rebuilds the native `better-sqlite3` binding there.
