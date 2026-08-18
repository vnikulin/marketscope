# MarketScope fixture collection toolkit

Tooling to unblock the M4 checkpoint: 50 sanitized, real Marketplace card
snapshots in `tests/fixtures/marketplace/`.

**Collection stays manual on purpose.** These scripts do not log into Facebook,
do not scroll, and do not fetch anything. They read markup your own browsing
already rendered, then take the sanitization tedium off your hands.

## Files

| File | Runs where | Does |
|---|---|---|
| `collect-cards.js` | Chrome DevTools console | Reads the cards currently on screen, finds each card root, downloads `cards.json` |
| `sanitize_fixtures.py` | Your machine (Python 3.8+, stdlib only) | `sanitize` raw markup into numbered fixtures; `verify` a corpus for leaks and coverage |

## Workflow

One capture per **page**, not per listing -- each `cards.json` holds every card
that page was showing, so 3-5 collection runs usually covers all 50 fixtures.

Keep captures **outside the repo**. They are raw Facebook markup with real
seller names, IDs and photo URLs -- the thing M4 forbids committing.

```bash
# 1. Browse Marketplace by hand. Paste collect-cards.js into the console on
#    each page. Save the downloads to a scratch folder outside the repo.

# 2. Sanitize every capture in one pass. Numbering is automatic.
python tools/marketscope-fixtures/sanitize_fixtures.py sanitize \
  --from-json C:/Dev/_scratch/marketscope-raw -o tests/fixtures/marketplace

# ...or name captures individually:
python tools/marketscope-fixtures/sanitize_fixtures.py sanitize \
  --from-json caps/cards-01.json caps/cards-02.json -o tests/fixtures/marketplace

# ...or from files saved by hand with Copy > Copy outerHTML:
python tools/marketscope-fixtures/sanitize_fixtures.py sanitize \
  raw-cards/ -o tests/fixtures/marketplace

# 2b. Some buckets cannot be collected: the console helper only sees cards
#     that have an item link, and most listings carry a price and an image.
#     Derive those by removing one part from real captured markup:
python tools/marketscope-fixtures/sanitize_fixtures.py sanitize \
  --from-json C:/Dev/_scratch/marketscope-raw -o tests/fixtures/marketplace \
  --derive-variants 2

# 3. Check the corpus.
python tools/marketscope-fixtures/sanitize_fixtures.py verify \
  tests/fixtures/marketplace --target 50

# 4. Delete the captures.
```

Fixture numbering continues after the highest file already in the output
directory, so a later run adds to the corpus rather than overwriting it.
Pass `--start N` to force a number.

Cards captured twice on overlapping pages are dropped automatically, but only
**within a single run** -- the check hashes raw markup, which sanitized output
no longer matches. Prefer one final run over all your captures; use
`--allow-duplicates` if you deliberately want repeats for duplicate-insertion
tests.

`verify` exits non-zero until the corpus is both leak-free and representative,
so it drops straight into CI or a pre-commit hook.

## What sanitization does

Removed or replaced:

- `<script>`, `<style>`, `<noscript>`, `<iframe>`, `<link>`, `<meta>`, comments
- `data-ft`, `data-gt`, `data-store`, `data-sigil`, `data-lynx-uri`, `nonce`,
  every `on*` handler, and any non-structural attribute over 300 chars
- Tracking query params (`__tn__`, `__cft__`, `fbclid`, `ref`, `lsd`, `eav`, …)
- Real listing IDs → sequential synthetic IDs from `1000000000000001`
- Seller/profile links → `/marketplace/profile/2000000000000001/` (the link
  still exists, so "has a seller" stays testable)
- All image URLs → `https://scontent.fixture.fbcdn.net/v/fixture-NNN.jpg`
- Emails, phone numbers, street addresses, bare URLs in visible text
- Real city/state → a fixture city, mapped **consistently within a card**
- Titles and descriptions → synthetic words

Preserved, because the parser is tested against it:

- Full DOM nesting, tag order, and visible-text placement
- `class`, `id`, `role`, `aria-*`, `data-testid`, `dir`, `style`
- Prices verbatim (`$1,450` stays `$1,450`)
- Badges: Sponsored, Shipping available, Free, Used - Good, Just listed, …
- Distances ("3 miles away") and relative times ("Listed 2 days ago")
- Non-ASCII scripts — CJK stays CJK, Cyrillic stays Cyrillic, emoji untouched

The scrubber protects prices, badges, distances and locations from the
obfuscation pass, so a card's `aria-label` still agrees with its visible spans.
Output is deterministic: same input, byte-identical fixtures.

## Coverage matrix

`verify` counts these buckets and fails below the minimum:

| Bucket | Min |
|---|---|
| sponsored | 3 |
| shipping | 3 |
| free_price | 2 |
| missing_price | 2 |
| missing_image | 2 |
| missing_seller | 2 |
| missing_location | 2 |
| long_title | 2 |
| non_ascii | 3 |
| malformed | 2 |

The rest of the 50 should be ordinary listings across whatever DOM variants
Marketplace serves you — vary your search terms and view modes to catch them.

## Caveats

- **Read the output before committing.** Automated scrubbing is a first pass.
  It cannot know that a title was itself identifying, or that a listing photo
  had a face in it. `sanitize` prints a per-file changelog for exactly this.
- `cards.json` is raw, unsanitized page markup. Keep it out of the repo and
  delete it once fixtures are generated. Add it to `.gitignore`.
- `html.parser` lowercases tag and attribute names. Harmless for HTML
  fixtures, but note it if you ever diff against a raw capture.
- Confirm the console helper is acceptable under your own M4 rules. If the
  brief's "no automated collection" clause is meant strictly, skip
  `collect-cards.js`, use Copy → Copy outerHTML by hand into a folder, and
  point `sanitize` at the folder. The sanitizer never touches Facebook and is
  fine either way.
## Coverage exception

No sponsored fixture: Marketplace served zero sponsored cards to this account
across four collection sessions (confirmed via
`document.body.innerText.match(/sponsored/gi)?.length` returning 0). Not
fabricated, since the brief forbids synthetic fixtures. Run verify with
`--waive sponsored`.