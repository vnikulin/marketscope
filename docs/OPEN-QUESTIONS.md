# Open questions

## Secure session cookies and the LAN HTTP fallback

- Question: Should LAN-only HTTP expose authenticated PWA and administration routes, or only non-authenticated desktop access?
- Why this is load bearing: The required `Secure` session cookie does not travel over ordinary LAN HTTP. The architecture also describes LAN HTTP as a degraded desktop fallback.
- Assumption: M3 follows the explicit authentication requirement and always sets `Secure` on the session cookie.
- What breaks if the assumption is wrong: Supporting authenticated administration over LAN HTTP would require a different transport or cookie policy and would weaken the current security boundary.

## Chrome Local Network Access and a Tailscale destination

- Question: Does current target Chrome allow an extension service worker with
  `https://*.ts.net/*` host permission to fetch a `*.ts.net` name that resolves
  to a Tailscale `100.64.0.0/10` address without a Local Network Access prompt?
- Why this is load bearing: The required transport depends on that fetch, and a
  service worker cannot itself present Chrome's Local Network Access prompt.
- Assumption: M4 implements the specified service-worker transport and persists
  failed uploads. It does not claim that the live Chrome and Tailscale path is
  verified.
- What breaks if the assumption is wrong: Pairing and ingest over Tailscale may
  need a user-gesture permission step or a transport change. The content script
  must not fetch the server directly.

## OAuth email provider sign-in after V1

- Question: Should a later milestone replace the V1 SMTP-only requirement with
  Google and Microsoft OAuth2 mail delivery?
- Why this is load bearing: OAuth needs registered provider applications,
  redirect URLs for each deployment, refresh-token storage, token revocation,
  and a mail transport that differs from the current SMTP password flow.
- Assumption: V1 keeps Gmail, Microsoft 365, and custom SMTP configuration as
  required by the specification. It does not show nonfunctional OAuth buttons.
- What breaks if the assumption is wrong: The email data model, setup UI,
  backup exclusions, security documentation, and notification transport all
  need a coordinated redesign.
