# Upgrade MarketScope

Develop and test changes on Windows. Push the changes, then create a semantic
version tag only after the required test suites pass:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

The release workflow publishes `v0.1.0` and `latest` container tags plus the
installer bundle. On Ubuntu, install the latest published release with:

```bash
sudo marketscope update
```

To select a specific published version:

```bash
sudo marketscope update v0.1.0
```

The update command creates a logical backup and a physical SQLite snapshot,
downloads the checksummed CLI and Compose bundle, pulls the image, applies
startup migrations, restarts the service, and waits for the health check. It
restores the previous database, image, CLI, and Compose file if the health
check fails.

Changes to the unpacked Chrome extension remain separate. Build the extension
on Windows and click **Reload** on `chrome://extensions`. A shared filter change
requires both the Ubuntu update and an extension reload.
