# MarketScope: Codex run book

## Files

Put these three at the repo root and in `docs/`:

```
AGENTS.md            # loads every session, keep it short
docs/SPEC.md         # the full V1 spec, referenced by section number
CODEX-TASKS.md       # this file, you paste from it
```

`AGENTS.md` is small on purpose. It loads on every turn and burns context. Detail lives in `docs/SPEC.md`, and task prompts point at sections.

---

## Setup before you start

### CLI config

`~/.codex/config.toml` or `.codex/config.toml` in the repo:

```toml
model = "gpt-5.6-sol"
approval_policy = "on-request"
sandbox_mode = "workspace-write"

[sandbox_workspace_write]
network_access = true
```

Network on is a real tradeoff. Without it you cannot `npm install`, which makes M1 through M6 impossible in one pass. With it you accept prompt injection and exfiltration risk from anything the agent pulls down. Given this repo will hold your SMTP config and a Tailscale hostname, keep secrets out of the working tree entirely. Nothing sensitive in `.env`, use `.env.example` only.

Run with:

```bash
codex --sandbox workspace-write --ask-for-approval on-request
```

### If you use Codex cloud instead

The setup phase gets network and secrets. The agent phase gets neither, and secrets are stripped before the agent runs. So put all dependency installation in the setup script:

```bash
#!/usr/bin/env bash
set -euo pipefail
npm ci
npx playwright install --with-deps chromium
```

Then the agent phase runs offline against a warm `node_modules`. That is the cleaner model for this project, because the only thing the agent genuinely needs network for is package installation.

### Do the doc verification yourself first

`docs/SPEC.md` Section 21 lists nine things that must be checked against current documentation. Codex offline cannot do this, and Codex online will do it badly. Answer them yourself, write the answers into `docs/DECISIONS.md` with dates, and hand the agent settled facts.

Item 3 is the one that matters. Test whether an extension service worker `fetch` to an HTTPS `*.ts.net` hostname is affected by Chrome's Local Network Access gate. Tailscale uses `100.64.0.0/10`, which is RFC 6598 shared address space, not RFC 1918, and I do not know how current Chrome classifies it. Ten minutes with a throwaway extension answers it. If the answer is bad, the transport design changes and you want to know that before M1, not at M4.

---

## Task prompts

Paste one per session. Do not batch them. Codex drifts on long autonomous runs, and each of these has a checkpoint you can actually verify.

---

### M1. Foundation

```
Read AGENTS.md and docs/SPEC.md sections 3, 4, 5.

Build the monorepo skeleton only. No features.

- npm workspaces: apps/server, apps/web, apps/extension,
  packages/core, packages/filters, packages/shared-types
- TypeScript strict, project references, path aliases
- Vitest configured per package
- ESLint with these custom rules, and they must actually fail the build:
    1. In apps/extension: ban window.scrollTo, scrollIntoView, .click(),
       dispatchEvent, history.pushState, location.assign, location.href
       assignment, fetch, XMLHttpRequest, document.cookie, chrome.cookies
    2. In apps/extension: ban CSS selectors matching /\.[a-z0-9]{6,}/
       (Facebook generated class names)
    3. Repo-wide: ban innerHTML and insertAdjacentHTML
- Prettier, no em-dashes rule if you can express it
- packages/filters must have zero dependencies. Enforce with a test that
  reads its package.json and fails if dependencies is non-empty.

Write a deliberately-violating fixture file for each lint rule, confirm
the lint fails on it, then delete the fixtures.

Done when: npm run lint && npm run typecheck both exit 0, and you have
pasted the output showing each custom rule firing on its fixture.
```

---

### M2. Filter engine

```
Read AGENTS.md and docs/SPEC.md section 7.

Build packages/filters. Pure functions only. No I/O. No network. No
server. No UI. Nothing outside this package.

Implement in this order, with tests written before or alongside each:
1. Price normalization: $500, $1,200, 1.2K, $1.2k, 500, Free, FREE,
   "Price on request", empty, garbage. Output integer cents or null.
2. Text normalization: NFKD, strip combining marks, case fold.
3. Term matching: ALL, ANY, EXACT_PHRASE.
4. Boolean parser: recursive descent producing an AST. AND, OR, NOT,
   parentheses, quoted phrases. No eval. No regex translation. Cap depth
   at 20 and input at 1000 chars. Malformed input returns a parse error
   with a character offset and never throws past the boundary.
5. Regex evaluation in a worker_threads worker with a hard 50ms timeout
   and 4KB input cap. Test with (a+)+$ against a long non-matching string
   and confirm it times out rather than hanging.
6. Price, location, and listing-type rules including the ALLOW/BLOCK/FLAG
   unknown-value policies.
7. Relevance 0-100. Required terms gate and contribute nothing to score.
   Title matches weigh 3x body. Exact phrase weighs 2x loose.
8. evaluate() returning the FilterVerdict shape in SPEC section 7. Every
   check runs even after one fails. failedOn is the first failure in
   evaluation order.

Done when: npm run test:unit passes, coverage on packages/filters is at
least 90% lines, and the regex timeout test demonstrably completes in
under 200ms. Paste the coverage table.
```

---

### M3. Server core

```
Read AGENTS.md and docs/SPEC.md sections 5, 9, 10, 13, 14.

Build apps/server. Fastify, better-sqlite3, TypeScript.

- Migrations: numbered SQL, forward only, applied at startup, recorded in
  schema_migrations. A failing migration exits nonzero with nothing
  partially applied. Test this by inserting a deliberately broken
  migration.
- Tables per SPEC section 5.
- Auth per SPEC section 13: argon2id, HttpOnly/Secure/SameSite=Lax
  session cookie, CSRF tokens, 5-attempts-per-15-min login rate limit,
  no default password, first-run forces account creation.
- Separate bearer token for the extension, scoped to listing ingest and
  watchlist read. It must not be able to touch settings. Test that it
  cannot.
- Watchlist CRUD including duplicate, pause, resume, export, import.
- Listing ingest: dedup on source+sourceListingId, canonical URL
  fallback, price history rows on change, firstSeen/lastSeen.
- Cold-start seeding per SPEC section 10. New watchlist stores silently
  and sets seeded=true. Test that the first batch sends nothing.
- Retention pruning job. Default 30 days. Never prunes favorites.

Done when: npm run test:integration passes against a real SQLite file on
disk, including the migration-failure test and the token-scope test.
Paste the output.
```

---

### M4. Extension

```
Read AGENTS.md and docs/SPEC.md section 6.

Before writing parser code, create tests/fixtures/marketplace/ with at
least 50 saved Marketplace DOM snapshots. If the repo has none, stop and
tell me. I will collect and sanitize them. Do not synthesize fake
Facebook markup and call it a fixture corpus, and do not attempt to
reach facebook.com.

Then build apps/extension:
- Manifest V3, minimum permissions, each one justified in
  docs/PERMISSIONS.md
- Parser anchored on a[href*="/marketplace/item/"] walking up to the card
  container, plus ARIA, alt text, and visible text. Never a generated
  class name.
- MutationObserver, 150ms debounce, Set of processed IDs, no full-document
  re-walk
- Per-card try/catch. One bad card never breaks the others. Track failure
  rate; above 40% on a page, show a parser warning banner and stop
  annotating.
- Rendering: HIDE default, plus DIM and SHOW WITH WARNING, plus a SHOW
  BLOCKED toggle. Do not use display:none, it breaks Facebook's
  virtualized scroll height. Use a wrapper with visibility:hidden and a
  collapsed fixed height.
- WHY panel rendered directly from the FilterVerdict. No second code
  path. If the panel and the decision can disagree, it is wrong.
- Transport: content script posts to the service worker via
  chrome.runtime.sendMessage. Service worker does all fetch. Batch with a
  2s debounce, persist pending batches to chrome.storage.session so a
  worker termination mid-flight loses nothing. Test worker restart.
- Offline: filtering still works against cached watchlist definitions,
  uploads queue and retry.

Done when: at least 95% of fixture cards yield title, canonical URL, and
price-or-explicit-null, enforced as a CI gate that fails below that
number. Paste the parse rate. Also demonstrate a real ingest into the M3
server, or state exactly why you could not.
```

---

### M5. Notifications

```
Read AGENTS.md and docs/SPEC.md section 11.

- SMTP client with generic config, no hardcoded provider.
- Presets: Gmail (smtp.gmail.com:587 STARTTLS, app password, this is the
  recommended default), Microsoft 365 (smtp.office365.com:587 STARTTLS,
  with the inline deprecation warning from SPEC 11), Custom.
- SEND TEST EMAIL. Config is not marked complete until a send succeeds.
- Queue with states queued/sending/sent/failed/retrying. Backoff at 1m,
  5m, 15m, 1h, 6h, then dead letter. Store lastError.
- Thumbnail cache: /var/lib/marketscope/thumbnails/<sha256>.jpg, 200KB per
  image cap, 2GB total with LRU eviction. Facebook CDN URLs expire, so
  email either embeds as CID or omits images and links out. Pick one,
  implement it, document which and why in docs/DECISIONS.md.
- Cross-watchlist dedup: one listing matching three watchlists sends one
  email naming all three.

Run the eight email tests in SPEC section 19 against Mailpit. All eight
must pass. Notification failure must never block filtering or storage;
test that too.

Done when: all eight email tests pass with pasted output.
```

---

### M6. PWA

```
Read AGENTS.md and docs/SPEC.md section 12.

Build apps/web. React, Vite, TypeScript.

Views: Dashboard, Matches, Favorites, History, Blocked, Watchlists,
Watchlist editor, Settings, Diagnostics.

- Service worker caches the app shell only. Listing data always fresh.
  No offline listing browsing.
- Web app manifest, installable, correct icons.
- No push notification UI. There is no push in V1.
- WHY panel reuses the same FilterVerdict renderer as the extension where
  practical.

Playwright E2E covering: login, watchlist create/edit/duplicate/delete/
pause/resume, filter application, favorites, history, blocked view,
settings, email test, diagnostics, backup download, restore upload,
service worker registration, manifest validity.

Viewports: iPhone portrait, iPhone landscape, Android portrait, Android
landscape, tablet, desktop. All six.

Done when: the Playwright suite passes on all six viewports. Paste the
run summary.
```

---

### M7. Packaging

```
Read AGENTS.md and docs/SPEC.md sections 15, 16, 17, 18.

You cannot run Docker or test install.sh in this sandbox. Produce the
artifacts, shellcheck them, unit test what you can, and write every
untestable step into docs/KNOWN-LIMITATIONS.md marked
UNVERIFIED-SANDBOX with the exact command I should run.

- docker-compose.yml, single server service. Bind mount
  /var/lib/marketscope. Comment shm_size:2gb as a note for V2's browser
  container.
- Multi-stage Dockerfile. Native deps compiled at build, not at runtime.
- install.sh per SPEC section 15. Ubuntu 22.04 and 24.04 only, refuse
  anything else. Docker from the official apt repo with GPG verification.
  systemctl enable --now docker, or restart:unless-stopped will not
  survive a reboot. Trap errors and roll back. Rerun offers upgrade,
  repair, reconfigure, cancel and never destroys data.
- marketscope CLI: status, diagnose, logs, update, backup, restore,
  repair, uninstall. No stop-facebook, there is nothing to stop.
  uninstall preserves data; --purge requires a typed confirmation.
- Backup per SPEC section 14: secrets excluded by default. The SMTP
  password, session signing key, and extension tokens never appear in
  marketscope-backup-*.json. Add a test that greps a generated backup for
  the SMTP password and fails if found.
- Restore validates schema and version, snapshots the current database
  first, rolls back on failure.
- Diagnostics screen and EXPORT DIAGNOSTICS with secrets redacted. Test
  the redaction.

Done when: shellcheck is clean, backup and restore round-trip in
integration tests, the secret-leak greps pass, and
docs/KNOWN-LIMITATIONS.md lists every step I still have to verify on real
hardware.
```

---

### M8. Hardening and docs

```
Read AGENTS.md and docs/SPEC.md sections 19, 22.

Security suite, all of SPEC 19's security section:
- Unauthenticated access on every route
- Extension token attempting a settings write
- CSRF on every state-changing route
- Session expiry
- SQL injection through every string input
- XSS through listing title, description, seller name, rendered in both
  the extension overlay and the PWA
- Malicious imageUrl including javascript: and non-fbcdn hosts
- Malformed and oversized request bodies
- Invalid backup files
- Rate limiting
- Grep diagnostics export and all log output for the SMTP password

Write the docs listed in SPEC section 22. FACEBOOK-SAFETY.md must contain
the verbatim block from SPEC section 2 with the date I verified it.

KNOWN-LIMITATIONS.md must include: no relist detection, no scheduled
monitoring, no push, price history only reflects prices seen while
browsing, distance only when Facebook renders it, thumbnail cache is best
effort, plus everything marked UNVERIFIED-SANDBOX.

Finish with a completion report mapping each of the 13 items in SPEC
section 23 to either "verified, here is the output" or "not verified,
here is why and here is the command to run".

Done when: full CI green and the completion report is written. Do not
claim any item you did not actually observe.
```

---

## After M8

Everything Codex could not verify is yours. The clean-VM install test is the big one, and it is the only way to find out whether "one command install" is true. Fresh Ubuntu 24.04, no Docker, no Node. Run the documented command, then work SPEC section 23 top to bottom.

Expect M4 to be where this stalls. The fixture corpus is real work you have to do by hand, and the 95% parse gate is a number I picked rather than derived. If real Marketplace pages land at 88% because a chunk of cards are ad units with no price, adjust the gate. Do not adjust the fixtures.
