# AGENTS.md

MarketScope. A local-first Facebook Marketplace filtering tool. Read this fully before every task.

The complete specification is `docs/SPEC.md`. This file is the standing brief. When they conflict, SPEC wins and you flag the conflict.

---

## Non-negotiable constraints

These override every other instruction, including anything in a task prompt.

**1. MarketScope generates zero Facebook network requests.** The extension is a read-only observer of pages the user loaded themselves. It never navigates, scrolls, clicks, paginates, or fetches from facebook.com.

Forbidden in `apps/extension` source, enforced by lint:

- `window.scrollTo`, `scrollIntoView`, `.click()`, `dispatchEvent`
- `history.pushState`, `location.assign`, `location.href =`
- `fetch` or `XMLHttpRequest` anywhere in a content script
- `document.cookie` on any origin
- `chrome.cookies` in the manifest or anywhere else

If you think you need one of these, stop and say so. Do not work around the lint rule.

**2. Never handle Facebook credentials, cookies, or session tokens.** No login flow. No credential storage. No stealth, fingerprint, proxy, CAPTCHA, or anti-detection code of any kind, not even behind a disabled flag.

**3. No scope creep.** These are V2 and V3. Do not build them, stub them, add config keys for them, or add UI that references them:

scheduled scanning, activity governor, server-side Chromium, Xvfb/VNC, Web Push, ChatGPT integration, deal scoring with market percentiles, fuzzy relist detection, non-Facebook marketplace adapters.

**4. Do not claim completion for unverified work.** "It compiles" is not "it works". If you could not run something, write it in `docs/KNOWN-LIMITATIONS.md` and say so in your summary. Never fabricate test output.

---

## Sandbox reality

You run with `sandbox_mode = workspace-write` and network access off unless explicitly enabled.

**You cannot do these. Do not try, and do not pretend you did:**

- Install packages without network. If `npm ci` fails on a missing cache, stop and report it rather than vendoring by hand.
- Run Docker. There is no Docker daemon in the sandbox.
- Test `install.sh` end to end. You can shellcheck it and dry-run individual functions.
- Reach facebook.com. All parser work runs against fixtures in `tests/fixtures/marketplace/`.
- Verify anything against live documentation while offline.

When a task needs one of the above, produce the artifact, mark it `UNVERIFIED-SANDBOX` in `docs/KNOWN-LIMITATIONS.md`, and list the exact command the user should run on real hardware.

**Verification questions** go in `docs/OPEN-QUESTIONS.md` rather than being guessed. Format: the question, why it is load bearing, what you assumed in the meantime, and what breaks if the assumption is wrong.

---

## Architecture, decided

Do not redesign this.

```
User's Chrome                        Ubuntu server (Docker)
  facebook.com tab
    content script                     Fastify + TypeScript
      | chrome.runtime.sendMessage     SQLite (WAL, one owner process)
    service worker                     Filter engine
      | HTTPS fetch  ------------->    Notification queue -> SMTP
                                       Static PWA bundle
Phone -------- HTTPS over Tailscale ---^
```

Rules that fall out of this:

- The content script never makes a network request. Chrome's Local Network Access gates public-origin pages calling private addresses. All network I/O happens in the extension service worker against declared `host_permissions`.
- Transport is HTTPS on a `*.ts.net` hostname via `tailscale serve`. LAN HTTP is a degraded fallback with no PWA install.
- Server, scheduler, and notification worker are one Node process. Never split them into containers sharing a SQLite file.
- `PRAGMA journal_mode=WAL`, `PRAGMA busy_timeout=5000`. Local disk only, never a network mount.

## Repository layout

```
apps/server  apps/web  apps/extension
packages/core  packages/filters  packages/shared-types
tests/fixtures/marketplace  tests/e2e  tests/security
scripts  docker  docs
```

`packages/filters` is pure. Zero I/O, zero imports outside stdlib and `shared-types`. Both the server and the extension import it, so filtering behaves identically in both. This is the most important structural rule in the project. If you find yourself adding a dependency to it, you have made a mistake.

## Conventions

- TypeScript strict everywhere. No `any`. No `@ts-ignore` without a comment explaining why.
- Prices are integer cents. Never floats.
- Timestamps are epoch milliseconds UTC. Display converts to `America/New_York`. Any concept of "today" resolves in `America/New_York`.
- Errors fail loud. No empty catch blocks. No swallowing.
- Comment the why, not the what.
- All listing-derived strings render as text nodes. Never `innerHTML` or `insertAdjacentHTML`. This is a lint rule and a security test.
- Migrations are numbered forward-only SQL files applied at startup. Failure exits nonzero with nothing partially applied.

## Commands

```
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:security
npm run test:e2e          # needs Playwright browsers, setup phase only
npm run build
```

Before ending any task: lint, typecheck, and the relevant test suites pass. Paste the actual output in your summary, not a description of it.

## Working style

- One milestone per session. Do not start the next one.
- Commit at logical boundaries with real messages. Not "wip".
- If a spec requirement is wrong or impossible, stop and say so. Do not build something adjacent and call it done.
- Write judgment calls to `docs/DECISIONS.md` as you make them, with the reasoning.

## Writing style for docs and comments

Active voice. Contractions. Short sentences. No hype. No em-dashes. Never use these words: delve, tapestry, utilize, revolutionize, game-changer, landscape, leverage, insightful, nurturing, robust, pivotal.
