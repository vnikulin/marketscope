# Permissions

MarketScope requests only the permissions used by M4.

## API permission

- `alarms`: Wakes the service worker for an offline upload retry. A plain timer
  can disappear when Chrome stops an idle Manifest V3 service worker.
- `storage`: Stores the extension bearer token and server URL in
  `chrome.storage.local`. Stores pending listing batches in
  `chrome.storage.session` so a Manifest V3 service worker restart does not
  lose observations. The content script never receives the bearer token.

## Required host permissions

- `https://*.ts.net/*`: Lets the extension service worker read watchlists and
  send observed listings to the MarketScope server over the required Tailscale
  HTTPS transport.
- `http://127.0.0.1/*` and `http://localhost/*`: Support local development and
  the M3 integration path. They do not grant access to other LAN devices.
- `https://www.facebook.com/marketplace/*` in `content_scripts.matches`: Runs
  the read-only parser only on Marketplace pages the user opens. It does not
  grant the service worker Facebook network access.

## Optional host permission

- `http://*/*`: Supports the documented degraded LAN HTTP fallback. MarketScope
  must request one user-selected server origin during pairing before using it.
  It is optional because the normal `*.ts.net` HTTPS path does not need it.

MarketScope does not request `tabs`, `activeTab`, `scripting`, `cookies`,
`webRequest`, or broad HTTPS access. The content script has no network API.
