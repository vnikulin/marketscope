# Known limitations

- MarketScope V1 uses exact listing IDs, with canonical URL fallback when an ID is unavailable. A seller who deletes and reposts an item creates a new listing that MarketScope treats as new.
- UNVERIFIED-SANDBOX: The extension has not been loaded in a real Chrome profile,
  so the Tailscale HTTPS request and Chrome Local Network Access behavior remain
  unverified. Load `apps/extension` as an unpacked extension, pair it with an M3
  server on a `*.ts.net` hostname, browse a saved test page, and confirm the
  service worker's `/api/extension/listings` request in DevTools.
- MarketScope does not run scheduled Marketplace monitoring and does not send
  push notifications in V1.
- Price history contains only prices that MarketScope observed while the user
  browsed Marketplace. Distance is available only when Facebook renders it.
- Thumbnail caching is best effort. The extension skips non-JPEG responses,
  files above 200KB, failed downloads, and failed cache uploads.
- UNVERIFIED-SANDBOX: Windows application control blocked the official Mailpit
  v1.30.7 executable after its published SHA-256 hash was verified. The eight
  Mailpit tests are present but skipped when `MAILPIT_BIN` is unset. On a host
  that permits Mailpit, run:

  ```powershell
  $env:MAILPIT_BIN = (Get-Command mailpit).Source
  npm run test:integration -- --reporter=verbose
  ```
