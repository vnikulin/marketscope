# Marketplace fixture sanitization

Saved DOM snapshots must contain only the markup needed for parser tests.

Before committing a snapshot:

- Remove cookies, access tokens, session tokens, request headers, and credentials.
- Remove names, profile links, user IDs, seller IDs, and buyer IDs that identify a person.
- Remove messages, addresses, phone numbers, email addresses, and precise coordinates.
- Replace identifying listing text and URLs while preserving the DOM structure under test.
- Remove tracking parameters and keep only synthetic Marketplace listing IDs.
- Inspect the saved file manually for secrets and personal information.

Never collect fixtures through MarketScope automation. Save pages that a person loaded and sanitize them offline.

## Coverage exception

No sponsored fixture: Marketplace served zero sponsored cards to this account
across four collection sessions. A manual page-text check also found none. The
corpus does not fabricate sponsored markup because M4 requires real snapshots.
Run verification with `--waive sponsored`.
