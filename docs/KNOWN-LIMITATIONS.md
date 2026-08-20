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
  MarketScope cannot calculate a radius from an arbitrary ZIP code because it
  does not geocode listing locations. Set the ZIP and radius in Facebook before
  saving the search URL.
- Thumbnail caching is best effort. The extension skips non-JPEG responses,
  files above 200KB, failed downloads, and failed cache uploads.
- UNVERIFIED-SANDBOX: The PWA manifest, app-shell service worker, and six
  responsive viewport projects pass in Playwright Chromium. A real iPhone or
  Android home-screen install over Tailscale HTTPS has not been tested. Serve
  MarketScope on its `*.ts.net` hostname, add it to the home screen on each
  device, launch it in standalone mode, and confirm listing views still fetch
  current API data.
- UNVERIFIED-SANDBOX: The release image builds in GitHub Actions, and its AMD64
  and ARM64 manifests allow anonymous GHCR access. Docker isn't available in
  this workspace, so the image still needs its first real `docker compose` run
  as part of the clean-machine installer test.
- UNVERIFIED-SANDBOX: The one-command installer, Docker repository setup,
  rollback trap, Tailscale HTTPS configuration, reboot persistence, rerun
  choices, update rollback, backup, restore, and uninstall have not run on a
  clean Ubuntu VM. On a fresh Ubuntu 26.04 VM, run the current release
  candidate installer. For example,
  `curl -fsSL https://github.com/owner/repository/releases/download/v0.1.0-rc.3/install.sh | sudo bash`.
  Complete setup, ingest a fixture through the paired extension, send a real
  test email, reboot, rerun the installer, run `sudo marketscope update`, run
  `sudo marketscope backup --include-history`, restore that file, and run
  `sudo marketscope uninstall`. Confirm data remains after uninstall. Repeat
  the bootstrap with
  `wget -qO- https://github.com/owner/repository/releases/download/v0.1.0-rc.3/install.sh | sudo bash`.
