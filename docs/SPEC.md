# BUILD MARKETSCOPE V1

## 0. Rules of engagement

You are building a working product, not a design document. Do not respond with architecture, pseudocode, mockups, or scaffolding. Write code, run it, fix it, test it, package it.

Rules:

1. Build in the milestone order in Section 20. Stop at each checkpoint and report actual command output. Do not skip ahead.
2. Do not mark anything complete because it compiles. Complete means you ran it and pasted the output.
3. If something cannot be verified in this environment, say so explicitly in `KNOWN-LIMITATIONS.md`. Do not fabricate test results.
4. Do not ask clarifying questions for things you can reasonably decide. Make the call, write it in `docs/DECISIONS.md`, keep going.
5. Anything in Section 21 must be checked against current official documentation before you write code that depends on it. Do not guess at versions, API shapes, or browser behavior.
6. If a requirement here turns out to be wrong or impossible, stop and say so. Do not silently build something adjacent.

---

## 1. What this is

MarketScope filters Facebook Marketplace listings that my browser has already loaded, scores them, remembers them, and emails me when something new matches.

V1 is deliberately narrow. It does one thing well.

### In scope for V1

- Chromium Manifest V3 extension that filters and annotates Marketplace pages I browse normally
- Zero automated Facebook requests. None. The extension only processes bytes the browser already fetched
- Precision filter engine: required terms, optional terms, exclusions, exact phrase, Boolean, regex, price, location, listing type
- WHY debugger showing exactly why every listing passed or failed
- Watchlists stored server side, applied client side
- Deduplication by listing ID, price history, first seen and last seen
- Email notification on new matches
- Responsive PWA for browsing matches, favorites, history, and blocked listings from a phone
- Local auth, local SQLite, local everything
- One-command install on a clean Ubuntu box
- Backup, restore, update, uninstall via CLI
- Real test suite

### Explicitly NOT in scope for V1

Do not build these. Do not stub them. Do not add config keys for them. Do not mention them in the UI.

- Scheduled or automated Marketplace scanning of any kind
- Server-side Chromium, Xvfb, VNC, noVNC
- Activity governor and scan budgets
- Web Push
- ChatGPT / Custom GPT integration
- Deal scoring with market percentiles
- Fuzzy relist detection
- Craigslist, eBay, OfferUp, Mercari, Kijiji

These are V2 and V3. The architecture must not make them hard to add later, but V1 ships without them.

---

## 2. Account safety

This is not negotiable and overrides every other requirement.

MarketScope V1 generates zero Facebook requests. The extension is a read-only observer of pages I loaded myself.

Do not implement, and do not add hooks for:

- CAPTCHA solving or bypass
- Anti-bot or fingerprint evasion
- Proxy or account rotation
- Cookie, session token, or credential extraction
- Stealth browser modifications
- Synthetic mouse movement or typing
- Automated scrolling, pagination, or navigation of any kind
- Automated recovery from security checkpoints

Do not ask for or store my Facebook credentials. Do not touch my Facebook cookies. Do not read `document.cookie` on facebook.com. The extension has no reason to and the manifest must not request permission to.

The extension must never call `window.scrollTo`, `element.click()`, `history.pushState`, or dispatch synthetic events on facebook.com. If you need to hide a card, do it with CSS. Add an ESLint rule that fails the build if any of those appear in extension source.

`FACEBOOK-SAFETY.md` must state, verbatim:

```
Meta does not publish a numeric Marketplace request threshold that
guarantees an account will not be restricted.

MarketScope V1 generates zero automated Marketplace requests. It only
processes listings that your browser has already loaded because you
navigated to a page yourself.

MarketScope makes no guarantee against account restriction.
```

Include the date this was last verified.

---

## 3. Architecture

Decided. Do not redesign this.

```
My laptop / desktop                   Ubuntu server (always on)
-------------------                   -------------------------
Chrome or Edge
  facebook.com tab
    content script  --postMessage-->
  service worker    --HTTPS fetch-->  MarketScope server (Docker)
                                        Node LTS + Fastify
                                        SQLite (WAL)
                                        Filter engine
                                        Notification queue
                                        SMTP client
                                        REST API
                                        Static PWA bundle
                                            |
Phone / tablet  ------HTTPS------------------+
```

Key decisions and why:

**The content script never makes network requests.** Chrome 142 shipped Local Network Access, which gates requests from public-origin pages to loopback, RFC1918, and `.local` addresses. A `fetch()` from inside facebook.com's origin to your server will prompt or fail. The content script sends messages to the extension service worker via `chrome.runtime.sendMessage`, and the service worker does all network I/O against a declared `host_permissions` entry. Verify this actually works on your target Chrome version before building on it. Write the verification into `tests/integration/transport.spec.ts`.

**Transport is HTTPS over Tailscale.** Use `tailscale serve` to expose the server on the tailnet with a real Let's Encrypt certificate on the `*.ts.net` hostname. This is required, not optional, because:

- The PWA needs a secure context for service workers and install-to-homescreen
- A publicly trusted certificate avoids self-signed cert handling in the extension and on iOS
- A `ts.net` hostname is a normal public DNS name, which sidesteps the messiest parts of Local Network Access

LAN-only HTTP is supported as a degraded fallback for desktop browser use, with the PWA install path documented as unavailable in that mode.

**One process owns SQLite.** Server, scheduler, and notification worker are the same Node process. Do not split them into containers sharing a database file. Set `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout=5000`. The database lives on local disk, never a network mount.

**Docker, not a .deb, for V1.** The server has native dependencies (`better-sqlite3`, argon2). Containerizing removes host build toolchain requirements entirely. The installer's job is to install Docker and start the stack. Revisit the `.deb` route in V2 if the container adds friction.

### Stack

- TypeScript, strict mode, everywhere
- Node.js current LTS (verify the version, do not assume)
- Fastify for the API
- `better-sqlite3` for storage
- React + Vite for the PWA
- Manifest V3 extension, plain TypeScript, no framework
- Vitest for unit and integration
- Playwright for PWA end to end and extension fixture tests
- Docker Compose, single service plus a Mailpit service in the dev profile only

No Postgres. No Redis. No message queue. No Kubernetes.

---

## 4. Repository

```
marketscope/
  apps/
    server/
    web/
    extension/
  packages/
    core/              shared domain logic
    filters/           filter engine, pure functions, zero I/O
    shared-types/
  tests/
    fixtures/
      marketplace/     saved DOM snapshots, 50 minimum
    e2e/
    security/
  scripts/
  docker/
  docs/
  docker-compose.yml
  install.sh
  .env.example
  README.md
```

`packages/filters` must have no imports outside the standard library and `shared-types`. It is pure, synchronous, and fully unit tested. Both the server and the extension import it. This is the single most important structural rule in the project, because it means filtering behaves identically in the browser and on the server.

---

## 5. Data model

```ts
export interface MarketplaceListing {
  source: 'facebook';
  sourceListingId: string;
  url: string;                    // canonical, query string stripped
  title: string;
  description?: string;
  price?: number;                 // cents, integer
  priceText?: string;             // raw, as displayed
  location?: string;
  distanceMiles?: number;
  imageUrl?: string;              // fbcdn, expires
  imageHash?: string;             // sha256 of cached bytes, V1: unused
  sellerName?: string;
  sponsored: boolean;
  shipping: boolean;
  localPickup?: boolean;
  postedAtText?: string;          // "Listed 2 hours ago"
  postedAtEstimate?: number;      // epoch ms, derived, may be null
  rawText: string;
  firstSeen: number;              // epoch ms UTC
  lastSeen: number;
}
```

All timestamps are epoch milliseconds UTC. Every display of a date converts to `America/New_York`. Any concept of "today" resolves in `America/New_York`, not server local time and not UTC.

Prices are stored as integer cents. Never floats.

Tables: `listings`, `listing_price_history`, `watchlists`, `watchlist_matches`, `notifications`, `ignore_rules`, `favorites`, `users`, `sessions`, `schema_migrations`.

Migrations are numbered SQL files applied in order at startup, recorded in `schema_migrations`. Migrations are forward only. On failure, the process exits nonzero without partially applying.

---

## 6. Extension

Manifest V3. Requested permissions must be the minimum that works. Justify every one in `docs/PERMISSIONS.md`.

### Parsing

Facebook's markup changes and its class names are generated garbage. Anchor on:

- `a[href*="/marketplace/item/"]` as the seed, then walk up to the nearest stable card container
- ARIA roles and `aria-label`
- Image `alt` text
- Visible text content and its structural position
- `<span>` text matching currency patterns for price

Never select on a generated class name. Add a lint rule that fails on selectors matching `/\.[a-z0-9]{6,}/`.

Use a `MutationObserver` on the results container. Debounce at 150ms. Keep a `Set` of processed listing IDs so you never reprocess a card. Do not re-walk the whole document on every mutation.

A parser exception on one card must never break the others. Wrap per-card parsing in try/catch, increment a failure counter, and keep going. If the failure rate across a page exceeds 40%, show a parser warning banner and stop annotating.

### Rendering

Rejected cards default to `HIDE`. Also support `DIM` and `SHOW WITH WARNING`, plus a `SHOW BLOCKED LISTINGS` toggle.

Do not use `display: none` to hide cards. Facebook's feed is virtualized and removing cards from layout flow breaks its scroll height calculation. Use a wrapper with `visibility: hidden` and a collapsed fixed height, or an opaque overlay.

Every rejected card keeps its rejection reason attached and reachable through the WHY panel.

### Security

All listing-derived strings render as text nodes. Never `innerHTML`. Never `insertAdjacentHTML`. Validate `imageUrl` against an fbcdn hostname allowlist before it goes anywhere near a `src` attribute. Add these as security tests, not just conventions.

### Transport

Content script to service worker via `chrome.runtime.sendMessage`. Service worker to server via `fetch` with a bearer token stored in `chrome.storage.local`, obtained from a pairing flow in the PWA.

MV3 service workers terminate after roughly 30 seconds idle. Do not hold state in the worker. Batch listing uploads with a 2 second debounce and write pending batches to `chrome.storage.session` so a termination mid-flight does not lose data.

Handle offline gracefully. If the server is unreachable, filtering still works locally against the cached watchlist definitions. Queue uploads and retry.

---

## 7. Filter engine

Pure functions in `packages/filters`. Input is a listing plus a watchlist. Output is a structured verdict.

```ts
export interface FilterVerdict {
  passed: boolean;
  checks: FilterCheck[];
  relevance: number;    // 0-100
  failedOn?: string;    // human readable, first failing check
}

export interface FilterCheck {
  rule: string;         // "Required: Garmin"
  passed: boolean;
  detail?: string;
}
```

Every check runs even after one fails, so the WHY panel shows the complete picture. `failedOn` is the first failure in evaluation order.

### Term matching

Modes: `ALL`, `ANY`, `EXACT_PHRASE`, `BOOLEAN`.

Boolean grammar: `AND`, `OR`, `NOT`, parentheses, quoted phrases. Example:

```
("GPSMAP 1042xsv" OR "1042xsv") AND Garmin AND NOT case
```

Write a real recursive descent parser producing an AST. Do not use `eval`. Do not translate to regex. Cap AST depth at 20 and expression length at 1000 characters. Malformed input returns a parse error with a character offset, never throws past the boundary.

Matching is case insensitive and diacritic insensitive. Normalize with `String.prototype.normalize('NFKD')` and strip combining marks. Match on `title + ' ' + description + ' ' + rawText`.

### Regex

User-supplied regex is a denial of service vector. Syntax validation does not fix catastrophic backtracking. `(a+)+$` parses fine and hangs.

Run every user regex in a `worker_threads` worker with a hard 50ms timeout and a 4KB input cap. If it times out, the check fails with detail `regex timeout` and the watchlist gets flagged in the UI. Test this with a known pathological pattern in `tests/security/`.

### Price

Normalize: `$500`, `$1,200`, `1.2K`, `500`, `Free`, `FREE`, `$1.2k`, `Price on request`. Output integer cents or null.

Rules: min, max, include free, exclude free, and an unknown-price policy of `ALLOW`, `BLOCK`, or `FLAG`.

### Location

Allowed cities, blocked cities, allowed states, blocked states, max distance when Facebook gave us one, and an unknown-location policy of `ALLOW`, `BLOCK`, or `FLAG`.

Distance is only available when Facebook renders it. Do not geocode. Do not call any external service.

### Listing type

Independent toggles for sponsored, shipping, local pickup, dealer, sold, pending.

Defaults: sponsored BLOCK, shipping BLOCK, local pickup ALLOW.

### Relevance

0 to 100, computed as: required terms are a gate and contribute nothing to score. Optional terms contribute proportionally to how many matched, weighted by term. Title matches weigh three times body matches. Exact phrase matches weigh twice loose matches.

This is a relevance score, not a deal score. There is no deal score in V1. Do not add one.

---

## 8. WHY debugger

Available on every listing, passed or blocked, in both the extension overlay and the PWA.

```
Required: Garmin              PASS
Required: 1042xsv             PASS
Excluded: case                FAIL   matched in title
Price <= $700                 PASS   $450
Allowed location              PASS   Freeport, NY
Sponsored                     PASS   not sponsored
Shipping                      PASS   local pickup
Relevance                     94

FINAL: BLOCKED
Reason: excluded keyword "case"
```

This is rendered directly from the `FilterVerdict`. No separate code path. If the WHY panel and the actual filter decision can disagree, you built it wrong.

---

## 9. Watchlists

Fields: name, search URL, term mode, required terms, optional terms, excluded terms, regex patterns, price rules, location rules, listing type rules, relevance threshold, email enabled, enabled, ignore listings older than N days.

Operations: create, edit, duplicate, pause, resume, delete, export, import.

No priority field. No interval field. No scan settings. Those belong to V2's scheduler, which does not exist.

`SAVE CURRENT SEARCH` captures the current Marketplace URL from the active tab. Do not parse or reverse engineer Facebook's query parameters. Store the URL as an opaque string used only for display and for the `OPEN SEARCH` link.

---

## 10. Deduplication and history

Primary key: `source + sourceListingId`.

Fallback when the ID is unparseable: canonical URL with query string stripped.

V1 does exact matching only. Do not build fuzzy relist detection. Note in `KNOWN-LIMITATIONS.md` that a seller who deletes and reposts creates a new listing that MarketScope treats as new.

Track `firstSeen`, `lastSeen`, `lastAlerted`, and a price history row on every observed price change.

### Cold start

The first time a watchlist runs against a page, everything matches and everything is new. Do not send 200 emails.

First observation of a watchlist seeds silently. Store the listings, send nothing, and show in the UI:

```
Seeded 214 listings. Notifications begin with the next new match.
```

Add an explicit `seeded: boolean` column on `watchlists`. Test this.

### Notification dedup

One listing matching three watchlists sends one email listing all three watchlist names. Not three emails.

Never re-alert on an unchanged listing. Options per watchlist: alert on price decrease, alert on any price change, never re-alert.

### Retention

7, 30, 90 days, or forever. Default 30. A daily job prunes listings past retention that are not favorited and not referenced by an ignore rule.

---

## 11. Email

Generic SMTP. Configured entirely through the UI. Never require editing `.env`.

Fields: hostname, port, TLS or STARTTLS, username, password, sender, recipients.

Presets:

- **Gmail**: `smtp.gmail.com:587` STARTTLS, requires an app password. This is the recommended default.
- **Microsoft 365**: `smtp.office365.com:587` STARTTLS. Add an inline warning: Microsoft is disabling SMTP AUTH basic authentication by default for existing Exchange Online tenants at the end of December 2026, with a final removal date to be announced in the second half of 2027. Administrators can re-enable it. If this preset stops working, that is why. Do not implement OAuth2 XOAUTH2 in V1.
- **Custom SMTP**

Do not mark email configuration complete until a test send actually succeeds. `SEND TEST EMAIL` is a required button.

Message format:

```
Subject: MarketScope: Garmin GPSMAP 1042xsv - $450

Garmin GPSMAP 1042xsv

Price: $450
Location: Freeport, NY
Watchlist: Garmin 1042
Relevance: 96
First seen: 2 minutes ago

OPEN LISTING  <url>
```

### Images in email

Facebook CDN image URLs are signed and expire, often within hours. An email with a hotlinked fbcdn image will show a broken image by the time I read it.

Cache the thumbnail bytes locally on first observation, store under `/var/lib/marketscope/thumbnails/<sha256>.jpg`, cap at 200KB per image and 2GB total with LRU eviction. Serve from the MarketScope server. In email, either embed as a CID attachment or omit images entirely and link out. Pick one, implement it, document it.

The extension fetches the thumbnail from the service worker with `host_permissions` for `*.fbcdn.net`, not from the content script, to avoid canvas tainting and page-origin restrictions.

### Delivery

Queue with states: queued, sending, sent, failed, retrying. Exponential backoff at 1m, 5m, 15m, 1h, 6h, then dead letter. Store `lastError`.

Notification failure must never block filtering or storage.

---

## 12. PWA

Responsive, installable, single page React app.

Views: Dashboard, Matches, Favorites, History, Blocked, Watchlists, Watchlist editor, Settings, Diagnostics.

Test at: iPhone portrait and landscape, Android portrait and landscape, tablet, desktop. Playwright viewport tests for each.

Service worker caches the app shell only. Listing data is always fetched fresh. Do not build offline listing browsing in V1.

No Web Push in V1. Email is the notification channel. Do not add a push settings screen that does nothing.

---

## 13. Authentication

Single administrator account. No multi-user, no roles, no invites.

- Argon2id password hashing with sane parameters. Document the parameters chosen.
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, 30 day expiry, rotated on privilege change
- CSRF token on all state-changing requests
- Login rate limit: 5 attempts per 15 minutes per IP, then exponential lockout
- No default password. First run forces account creation before anything else works.

The extension authenticates with a separate bearer token, not the session cookie. Generate it in Settings, show it once, store its hash. Revocable. It is scoped to listing ingest and watchlist read only, and cannot change settings or read secrets.

---

## 14. Secrets

The SMTP password lives in SQLite. Be honest about this rather than pretending to encrypt it with a key sitting next to it.

- Database file mode 0600, owned by the service user
- `/var/lib/marketscope` mode 0700
- Document in `SECURITY.md` that root on the server can read the SMTP credential
- **Backups exclude secrets by default.** The SMTP password, the session signing key, and extension tokens are never written to `marketscope-backup-*.json`. Restore prompts for SMTP credentials again. Add an `--include-secrets` flag that requires an explicit passphrase and encrypts the file.

That last point is a hard requirement. A backup that silently contains an SMTP password will end up synced to cloud storage.

---

## 15. Installation

Target:

```bash
curl -fsSL https://<host>/install.sh | sudo bash
```

Note the bootstrap problem: a minimal Ubuntu Server image may not have `curl`. Document a `wget -qO-` equivalent alongside it. Do not claim zero prerequisites when the install command itself is a prerequisite.

Assume the box has Ubuntu 22.04, 24.04, or 26.04 and nothing else. Pin those versions. If the detected release is anything else, refuse with a clear message rather than trying.

The installer:

1. Detects Ubuntu release and architecture, refuses unsupported combinations
2. Checks RAM (2GB minimum) and free disk (10GB minimum)
3. Checks Internet reachability
4. Detects an existing install and offers upgrade, repair, reconfigure, cancel
5. Installs base packages from Ubuntu repos
6. Installs Docker Engine and the Compose plugin from Docker's official apt repository, verifying the GPG key
7. Runs `systemctl enable --now docker`. Without this, `restart: unless-stopped` does not survive a reboot
8. Creates `/opt/marketscope`, `/var/lib/marketscope`, `/var/log/marketscope`, `/var/backups/marketscope` with correct ownership and modes
9. Generates the session signing key and writes it 0600
10. Pulls or builds images, starts the stack, applies migrations
11. Installs the `marketscope` CLI to `/usr/local/bin`
12. Offers Tailscale install and `tailscale serve` configuration
13. Runs health checks
14. Prints the access URL

Do not disable UFW. If a firewall rule is genuinely needed, print it and apply the minimum.

Do not leave half-installed state. Trap errors and roll back to the previous state or exit with a clear description of what to clean up.

Rerunning the installer must never destroy data.

### Compose notes

Set `shm_size: 2gb` on any container running a browser. Not needed in V1 since there is no server-side browser, but note it in `docker-compose.yml` comments for V2.

Bind mount `/var/lib/marketscope` to the container's data path. Persistent data never lives inside the container.

---

## 16. CLI

```bash
marketscope status
marketscope diagnose
marketscope logs [-f]
marketscope update
marketscope backup
marketscope restore <file>
marketscope repair
marketscope uninstall
```

`uninstall` preserves data by default. Removing data requires `--purge` and a typed confirmation.

`update` backs up the database first, pulls, migrates, restarts, health checks, and rolls back on failure.

No `stop-facebook` or `start-facebook` in V1. There is no Facebook automation to stop.

---

## 17. Diagnostics

Screen showing: server version, extension version, database status and size, migration state, last listing ingested, listings in last 24h, parser success rate over the last 500 cards, SMTP status and last send, notification queue depth, thumbnail cache size, disk free, uptime.

Actions: `TEST PARSER` against bundled fixtures, `TEST EMAIL`, `EXPORT DIAGNOSTICS` as a JSON bundle with secrets redacted.

Parser success rate below 85% over 500 cards shows a persistent warning:

```
FACEBOOK PARSER WARNING

Marketplace page structure may have changed. Filtering accuracy is
degraded. Check for a MarketScope update.
```

---

## 18. Backup and restore

Export `marketscope-backup-YYYY-MM-DD.json` containing settings (minus secrets), watchlists, favorites, ignore rules, and optionally history.

Validate schema and version before restore. Refuse an invalid backup. Snapshot the current database to `/var/backups/marketscope` before applying a restore, and roll back on failure.

Never overwrite a working database with an unvalidated file.

---

## 19. Testing

Testing is a deliverable, not a phase you skip when you run low on time. Report actual output.

### Unit (Vitest, `packages/filters` and `packages/core`)

Price normalization including every format in Section 7. Required, optional, exact phrase, and Boolean term matching. Boolean parser including malformed input, deep nesting, and length limits. Exclusions. Regex including a catastrophic backtracking pattern that must time out rather than hang. Location rules. Unknown-value policies. Listing normalization. Deduplication. Relevance scoring. Price history. Notification dedup across watchlists. Cold start seeding. Retention pruning.

Coverage gate: `packages/filters` at 90% lines, enforced in CI.

### Integration (Vitest + real SQLite)

API against a real database file. Migrations forward from empty. Migration failure exits nonzero and leaves no partial state. Auth, session expiry, CSRF rejection, login rate limiting. SMTP send through Mailpit. SMTP retry and backoff on induced failure. Backup and restore round trip. Restore rejection of a corrupt file. Extension token scope enforcement. Restart recovery with a queue mid-flight.

### Email (Mailpit)

1. A matching listing queues an email
2. Mailpit receives it
3. Subject is correct
4. Listing URL in the body is correct
5. Reobserving the same unchanged listing sends nothing
6. Price decrease triggers per the configured rule
7. Induced SMTP failure retries with backoff and eventually dead letters
8. A listing matching three watchlists sends one email naming all three

### Parser (fixtures)

Save at least 50 real Marketplace DOM snapshots to `tests/fixtures/marketplace/`. Sanitize them: strip cookies, tokens, user IDs, and anything identifying. Commit them.

Cover: normal card, sponsored, shipping, missing price, free, missing image, missing location, missing seller, very long title, non-ASCII title, malformed card, a DOM variant, dynamically inserted card, duplicate insertion.

**CI gate: at least 95% of fixture cards must yield title, canonical URL, and a price-or-explicit-null.** Below that, the build fails. Without a numeric bar, "the parser works" means nothing.

### Extension behavior

HIDE, DIM, SHOW, blocked toggle, WHY output correctness, parser exception isolation, MutationObserver debounce, reprocessing suppression, service worker restart mid-batch.

### PWA end to end (Playwright)

Login, dashboard, watchlist create, edit, duplicate, delete, pause, resume, filter application, favorites, history, blocked view, settings, email test, diagnostics, backup download, restore upload, service worker registration, manifest validity, and each of the six viewports in Section 12.

### Security

Unauthenticated API access on every route. Extension token attempting a settings write. CSRF on every state-changing route. Session expiry. SQL injection through every string input. XSS through listing title, description, and seller name, rendered in both the extension overlay and the PWA. Malicious `imageUrl` values including `javascript:` and non-fbcdn hosts. Malformed JSON bodies. Oversized bodies. Invalid backup files. Rate limiting. Grep the diagnostics export and all log output for the SMTP password and confirm it never appears.

### Clean install

Required before you call this done. A fresh supported Ubuntu LTS machine with no Docker, no Node, no MarketScope.

Run the documented install command. Then verify: first run wizard completes, extension pairs, a listing ingests, an email sends, reboot persistence, second installer run offers upgrade/repair without data loss, backup, restore, uninstall preserving data.

Do not claim one-command install unless this exact sequence succeeded. Paste the output.

### CI

Lint, typecheck, unit, integration, security, PWA end to end, extension build, server build, web build. No live Facebook account. No network calls to facebook.com from CI.

---

## 20. Build order

Stop at each checkpoint. Report actual command output before continuing.

**M1. Foundation.** Monorepo, TypeScript config, Vitest, lint rules including the anti-automation and anti-generated-selector rules from Sections 2 and 6. Checkpoint: `npm run lint && npm run typecheck` clean.

**M2. Filter engine.** `packages/filters` complete with full unit tests including the regex timeout and Boolean parser edge cases. No I/O, no server, no UI. Checkpoint: coverage report at 90%+ on the package.

**M3. Server core.** Fastify, SQLite, migrations, auth, watchlist CRUD, listing ingest, dedup, history. Checkpoint: integration suite passing against a real database.

**M4. Extension.** Manifest, content script, parser against fixtures, service worker transport, overlay rendering, WHY panel. Checkpoint: 95% fixture parse rate, and a real ingest into the M3 server.

**M5. Notifications.** Queue, SMTP, Mailpit tests, thumbnail cache, cold start seeding, cross-watchlist dedup. Checkpoint: all eight email tests passing.

**M6. PWA.** All views, responsive, service worker, install manifest. Checkpoint: Playwright suite passing on all six viewports.

**M7. Packaging.** Docker Compose, install.sh, CLI, backup, restore, update, uninstall, diagnostics. Checkpoint: clean VM install test with pasted output.

**M8. Hardening and docs.** Security suite, docs, CHANGELOG, KNOWN-LIMITATIONS. Checkpoint: full CI green.

---

## 21. Verify before building

Do not rely on training data for any of these. Check current official documentation and record what you found and the date in `docs/DECISIONS.md`.

1. Current Node.js LTS version, and the `better-sqlite3` version compatible with it
2. Manifest V3 service worker lifetime behavior and current `chrome.storage.session` limits
3. **Chrome Local Network Access current behavior**, specifically whether an extension service worker fetch with declared `host_permissions` to a `*.ts.net` hostname over HTTPS is affected. This is load bearing. Write an actual test, do not assume
4. Whether Chrome still permits unpacked extension loading without a per-launch nag, and the current Chrome Web Store unlisted publishing requirements and fee. Document the chosen distribution path in `INSTALL-EXTENSION.md`
5. `tailscale serve` current syntax and whether HTTPS certificate provisioning still works as expected on a free tailnet
6. Docker Engine apt repository setup steps for Ubuntu 22.04, 24.04, and 26.04
7. Current Gmail app password status and SMTP requirements
8. Current Exchange Online SMTP AUTH basic authentication timeline, to confirm the warning text in Section 11 is still accurate
9. Playwright's current support for loading a Manifest V3 extension in a persistent context, including whether headless works

---

## 22. Documentation

```
README.md
ARCHITECTURE.md
INSTALL-UBUNTU.md
INSTALL-EXTENSION.md
INSTALL-MOBILE.md
FACEBOOK-SAFETY.md
EMAIL-SETUP.md
TAILSCALE.md
BACKUP-RESTORE.md
UPGRADE.md
TROUBLESHOOTING.md
SECURITY.md
TESTING.md
KNOWN-LIMITATIONS.md
DECISIONS.md
CHANGELOG.md
```

`KNOWN-LIMITATIONS.md` must include, at minimum: no relist detection, no scheduled monitoring, no push notifications, price history only reflects prices observed while browsing, distance only available when Facebook renders it, thumbnail cache is best effort, and anything you could not verify.

`DECISIONS.md` records every judgment call you made under Section 0 rule 4, and every finding from Section 21 with the date checked.

---

## 23. Definition of done

Not done because files exist, containers start, or tests compile. Done when I can do all of the following on real hardware:

1. Install on a clean supported Ubuntu LTS machine with one command
2. Complete the first run wizard and create an admin account
3. Configure SMTP and receive a real test email
4. Install the extension in my daily browser and pair it with the server
5. Browse Facebook Marketplace normally and see irrelevant listings hidden, with zero requests generated by MarketScope. Verify this in DevTools Network with the extension filter on
6. Click WHY on any listing and see the complete pass/fail breakdown
7. Create a watchlist, see it seed silently, and receive an email on the next genuinely new match
8. Confirm a repeat observation of the same listing sends nothing
9. Open the PWA on my phone, install it to the home screen, and browse matches
10. Reboot the server and have everything come back
11. Back up, restore, and update through the CLI
12. Uninstall without losing data
13. See the full test suite pass, with output

For anything on this list you could not verify, say exactly what and why. Do not mark it done.
