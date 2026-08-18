# Known limitations

- MarketScope V1 uses exact listing IDs, with canonical URL fallback when an ID is unavailable. A seller who deletes and reposts an item creates a new listing that MarketScope treats as new.
- UNVERIFIED-SANDBOX: The extension has not been loaded in a real Chrome profile,
  so the Tailscale HTTPS request and Chrome Local Network Access behavior remain
  unverified. Load `apps/extension` as an unpacked extension, pair it with an M3
  server on a `*.ts.net` hostname, browse a saved test page, and confirm the
  service worker's `/api/extension/listings` request in DevTools.
