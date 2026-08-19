# Backup and restore

Create a settings and favorites backup:

```bash
sudo marketscope backup
```

Include observed listing history:

```bash
sudo marketscope backup --include-history
```

Backups are mode 0600 JSON files under `/var/backups/marketscope`. They exclude
the SMTP password, SMTP error text, session signing key, session credentials,
and extension tokens.

Restore a backup with:

```bash
sudo marketscope restore /var/backups/marketscope/marketscope-backup-YYYY-MM-DD-HHMMSS.json
```

Restore validates the complete JSON document before changing logical data. It
also creates a physical SQLite safety snapshot. If restore or the following
health check fails, the CLI puts the original database back.

Uninstall the application while preserving data and backups:

```bash
sudo marketscope uninstall
```

`sudo marketscope uninstall --purge` permanently removes the database and
backups only after the operator types the required confirmation phrase.
