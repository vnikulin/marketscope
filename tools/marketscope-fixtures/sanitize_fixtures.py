#!/usr/bin/env python3
"""Sanitize raw Marketplace card HTML into MarketScope test fixtures.

Two subcommands:

  sanitize  Take raw outerHTML fragments (files or a JSON blob from
            collect-cards.js), strip identifying data, and emit numbered,
            wrapped fixture files.

  verify    Scan a fixture directory for leftover PII and report how much of
            the required coverage matrix the corpus actually hits.

Stdlib only -- no pip install. Deterministic: rerunning over the same inputs
produces byte-identical output.
"""

import argparse
import html
import json
import random
import re
import sys
import unicodedata
from html.parser import HTMLParser
from pathlib import Path

# --------------------------------------------------------------------------
# What gets dropped outright
# --------------------------------------------------------------------------

# Dropped along with everything inside them.
DROP_CONTAINER = {"script", "noscript", "style", "iframe", "object", "embed", "template"}
# Void elements dropped on sight.
DROP_VOID = {"link", "meta", "base"}

# Attributes that carry session/tracking payloads rather than structure.
DROP_ATTRS = {
    "data-ft", "data-gt", "data-store", "data-sigil", "data-lynx-uri",
    "data-nonce", "nonce", "data-thumb", "data-onvisible", "data-bt",
    "integrity", "crossorigin", "data-referrerpolicy",
}
# Attributes allowed to exceed the long-value cutoff (structure, not payload).
KEEP_LONG_ATTRS = {"class", "style", "d", "viewbox", "points", "transform"}
LONG_ATTR_CUTOFF = 300

# Query params that are pure tracking.
TRACKING_PARAMS = {
    "ref", "referral_code", "referral_story_type", "tracking", "__tn__",
    "__cft__", "eav", "hash", "fbclid", "mibextid", "rdid", "share_url",
    "surface", "surface_type", "extid", "__xts__", "epa", "lsd", "jazoest",
}

# --------------------------------------------------------------------------
# Patterns
# --------------------------------------------------------------------------

ITEM_RE = re.compile(r"/marketplace/item/(\d+)")
PROFILE_RES = [
    re.compile(r"/profile\.php\?id=\d+"),
    re.compile(r"/marketplace/profile/\d+"),
    re.compile(r"/people/[^/]+/\d+"),
    re.compile(r"/groups/\d+/user/\d+"),
    re.compile(r"/user/\d+"),
]
IMAGE_EXT_RE = re.compile(r"\.(?:jpe?g|png|gif|webp|bmp|avif|heic)(?:$|[?#])", re.I)
CDN_HOST_RE = re.compile(r"//[^/]*(?:fbcdn\.net|cdninstagram\.com|fbsbx\.com)", re.I)

EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
PHONE_RE = re.compile(
    r"(?<!\d)"                                        # not mid-way into a longer run
    r"(?:\+?\d{1,3}[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}"
    r"(?!\d)"                                         # ...and not truncating one either
)
ADDRESS_RE = re.compile(
    r"\b\d{1,6}\s+[A-Za-z0-9.'\-\s]{2,40}?\b"
    r"(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Ct|Court|"
    r"Way|Hwy|Pkwy|Ter|Terrace|Pl|Place|Cir|Circle)\b\.?",
    re.I,
)
BARE_URL_RE = re.compile(r"https?://\S+")

# Text that is structure/label, not identity -- preserved verbatim.
PRICE_RE = re.compile(r"^(?:[A-Z]{0,3}[\$£€¥₹₽¥]|\$)\s?[\d,.]+(?:\s?[A-Z]{3})?$")
NUMERIC_RE = re.compile(r"^[\d,.\s]+$")
DISTANCE_RE = re.compile(r"^(?:About\s+)?\d+[\d,.]*\s*(?:mi|mile|miles|km|kilometers?)\s*(?:away)?$", re.I)
RELATIVE_TIME_RE = re.compile(
    r"^(?:Listed\s+|Posted\s+|Updated\s+)?(?:about\s+|over\s+)?"
    r"(?:a|an|\d+)\s*(?:second|minute|hour|day|week|month|year)s?"
    r"(?:\s+ago)?$", re.I)
CITY_STATE_RE = re.compile(r"^[A-Z][\w'.\- ]{1,30},\s*(?:[A-Z]{2}|[A-Z][\w'.\- ]{1,25})$")

# Spans preserved verbatim even inside otherwise-scrubbed free text, so that a
# card's aria-label keeps agreeing with its visible text. A parser test is
# worthless if the label says $2,449 and the span says $1,450.
CURRENCY_SPAN_RE = re.compile(r"[A-Z]{0,3}[\$£€¥₹₽]\s?\d[\d,.]*(?:\s?[A-Z]{3})?")
DISTANCE_SPAN_RE = re.compile(
    r"\b\d+[\d,.]*\s*(?:mi|miles?|km|kilometers?)\b(?:\s+away)?", re.I)
TIME_SPAN_RE = re.compile(
    r"\b(?:a|an|\d+)\s*(?:second|minute|hour|day|week|month|year)s?\s+ago\b", re.I)
BADGE_SPAN_RE = re.compile(
    r"\b(?:Free shipping|Shipping available|Ships to you|Ships from|"
    r"Free delivery|Delivery available|Local pickup(?: only)?|Pickup only|"
    r"Sponsored|Suggested|Just listed|Price dropped|Like new|Free|New|Used|"
    r"Pending|Sold|In stock|Out of stock)\b", re.I)
INLINE_CITY_RE = re.compile(
    r"\b[A-Z][\w'.\-]+(?:\s+[A-Z][\w'.\-]+){0,3},\s*[A-Z]{2}\b")

KEEP_EXACT = {
    "free", "sponsored", "suggested", "shipping available", "free shipping",
    "ships to you", "free delivery", "pickup only", "local pickup only",
    "just listed", "new", "like new", "used", "used - like new",
    "used - good", "used - fair",
    "save", "saved", "see more", "see details", "message", "message seller",
    "make offer", "buy now", "checkout available", "pending", "sold",
    "local pickup", "delivery available", "in stock", "out of stock",
    "price dropped", "you may also like", "listing", "photo", "·", "•", "-", "—",
}

FIXTURE_CITIES = [
    "Springfield, IL", "Riverton, WY", "Fairview, OR", "Clearwater, KS",
    "Bridgeport, ME", "Ashland, NV", "Glenwood, IA", "Maplewood, VT",
]
FIXTURE_CITY_RE = re.compile("|".join(re.escape(c) for c in FIXTURE_CITIES))
# Placeholders written by redact_pii -- kept stable so verify can allowlist them
# instead of re-flagging our own scrubbing as a leak.
REDACTION_SPAN_RE = re.compile(
    r"fixture@example\.invalid|555-0100|100 Fixture St|https://example\.invalid/fixture")
PROTECT_SPANS = (CURRENCY_SPAN_RE, DISTANCE_SPAN_RE, TIME_SPAN_RE,
                 BADGE_SPAN_RE, FIXTURE_CITY_RE, REDACTION_SPAN_RE)

LOREM = """amber bracket copper drift ember fabric granite harbor indigo jasper
kettle lantern marble nectar opal pewter quartz ribbon slate timber umber velvet
willow xenon yarrow zephyr anchor basil cedar dahlia elm fern ginger hazel iris
juniper kelp linen moss nutmeg olive poppy quince rosemary sage thyme violet
walnut yarn zinnia bramble clover dune elder frost grove heath ivy larch mica
nettle onyx pine reed sorrel tansy vine wren
""".split()


def bucket_words():
    buckets = {}
    for w in LOREM:
        buckets.setdefault(len(w), []).append(w)
    return buckets


WORD_BUCKETS = bucket_words()


# --------------------------------------------------------------------------
# Text obfuscation that preserves shape
# --------------------------------------------------------------------------

def _same_block_char(ch, rng):
    """Substitute a character from the same Unicode range, so scripts survive."""
    cp = ord(ch)
    for lo, hi in (
        (0x00C0, 0x024F),  # Latin extended
        (0x0370, 0x03FF),  # Greek
        (0x0400, 0x04FF),  # Cyrillic
        (0x0590, 0x05FF),  # Hebrew
        (0x0600, 0x06FF),  # Arabic
        (0x0900, 0x097F),  # Devanagari
        (0x0E00, 0x0E7F),  # Thai
        (0x3040, 0x309F),  # Hiragana
        (0x30A0, 0x30FF),  # Katakana
        (0x4E00, 0x9FFF),  # CJK
        (0xAC00, 0xD7AF),  # Hangul
    ):
        if lo <= cp <= hi:
            for _ in range(24):
                cand = chr(rng.randint(lo, hi))
                if cand.isalpha() and unicodedata.category(cand)[0] == "L":
                    return cand
            return ch
    return ch


def obfuscate(text, rng):
    """Replace identifying words while preserving length, script and punctuation."""
    def repl_word(m):
        w = m.group(0)
        if w.isascii() and w.isalpha():
            pool = WORD_BUCKETS.get(len(w))
            if pool:
                sub = rng.choice(pool)
            else:
                sub = "".join(rng.choice("aeioulnrst") for _ in w)
            return sub.capitalize() if w[0].isupper() else sub
        out = []
        for ch in w:
            if ch.isdigit():
                out.append(rng.choice("0123456789"))
            elif ch.isalpha():
                out.append(_same_block_char(ch, rng) if not ch.isascii()
                           else rng.choice("abcdefghijklmnopqrstuvwxyz"))
            else:
                out.append(ch)
        return "".join(out)

    return re.sub(r"[^\W_]+", repl_word, text, flags=re.UNICODE)


def redact_pii(text, stats):
    """Always-on redaction, independent of title scrubbing."""
    def sub(pattern, replacement, key, s):
        s, n = pattern.subn(replacement, s)
        if n:
            stats[key] = stats.get(key, 0) + n
        return s

    text = sub(EMAIL_RE, "fixture@example.invalid", "emails", text)
    text = sub(ADDRESS_RE, "100 Fixture St", "addresses", text)
    text = sub(PHONE_RE, "555-0100", "phones", text)
    text = sub(BARE_URL_RE, "https://example.invalid/fixture", "urls", text)
    return text


def is_structural(stripped):
    low = stripped.lower()
    if low in KEEP_EXACT:
        return True
    for pat in (PRICE_RE, NUMERIC_RE, DISTANCE_RE, RELATIVE_TIME_RE):
        if pat.match(stripped):
            return True
    return False


# --------------------------------------------------------------------------
# URL rewriting
# --------------------------------------------------------------------------

class UrlRewriter:
    def __init__(self, stats):
        self.stats = stats
        self.item_ids = {}
        self.profile_ids = {}
        self.image_n = 0

    def _bump(self, key):
        self.stats[key] = self.stats.get(key, 0) + 1

    def item_id_for(self, real):
        if real not in self.item_ids:
            self.item_ids[real] = str(1000000000000001 + len(self.item_ids))
        return self.item_ids[real]

    def profile_id_for(self, real):
        if real not in self.profile_ids:
            self.profile_ids[real] = str(2000000000000001 + len(self.profile_ids))
        return self.profile_ids[real]

    def next_image(self):
        self.image_n += 1
        return f"https://scontent.fixture.fbcdn.net/v/fixture-{self.image_n:03d}.jpg"

    def rewrite_href(self, url):
        m = ITEM_RE.search(url)
        if m:
            self._bump("item_links")
            return f"/marketplace/item/{self.item_id_for(m.group(1))}/"
        for pat in PROFILE_RES:
            pm = pat.search(url)
            if pm:
                self._bump("profile_links")
                return f"/marketplace/profile/{self.profile_id_for(pm.group(0))}/"
        if IMAGE_EXT_RE.search(url) or CDN_HOST_RE.search(url):
            self._bump("images")
            return self.next_image()
        return self.strip_tracking(url)

    def rewrite_src(self, url):
        if not url or url.startswith("data:"):
            return url
        self._bump("images")
        return self.next_image()

    def rewrite_srcset(self, value):
        parts = []
        for chunk in value.split(","):
            chunk = chunk.strip()
            if not chunk:
                continue
            bits = chunk.split()
            descriptor = " ".join(bits[1:])
            parts.append((self.rewrite_src(bits[0]) + " " + descriptor).strip())
        return ", ".join(parts)

    def strip_tracking(self, url):
        if "?" not in url:
            return url.split("#")[0]
        base, _, query = url.partition("?")
        query = query.split("#")[0]
        kept = []
        for pair in query.split("&"):
            name = pair.split("=")[0]
            if name and name.lower() not in TRACKING_PARAMS:
                kept.append(pair)
        if kept:
            self._bump("tracking_params_stripped")
            return base + "?" + "&".join(kept)
        if query:
            self._bump("tracking_params_stripped")
        return base

    def rewrite_style(self, value):
        def repl(m):
            return "url(" + self.rewrite_src(m.group(1).strip("\"'")) + ")"
        return re.sub(r"url\(([^)]*)\)", repl, value)


# --------------------------------------------------------------------------
# The sanitizing parser
# --------------------------------------------------------------------------

URL_ATTRS = {"src", "data-src", "data-original", "poster", "xlink:href", "data-srcset"}


class Sanitizer(HTMLParser):
    def __init__(self, rng, scrub_titles=True, variant=None):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.rng = rng
        self.scrub_titles = scrub_titles
        # None, or one of: no-price, no-image, no-link. Variants are real
        # captured markup with one part removed -- the shapes Marketplace
        # actually serves when a listing lacks a price or an image, and
        # which the collector cannot capture directly.
        self.variant = variant
        self.stats = {}
        self.urls = UrlRewriter(self.stats)
        self.skip_tag = None
        self.skip_depth = 0
        self._city_map = {}

    # -- helpers ----------------------------------------------------------
    def _bump(self, key, n=1):
        self.stats[key] = self.stats.get(key, 0) + n

    def _city_for(self, real):
        """Map a real city consistently, so every mention in a card agrees."""
        if real not in self._city_map:
            self._city_map[real] = FIXTURE_CITIES[len(self._city_map) % len(FIXTURE_CITIES)]
            self._bump("locations_replaced")
        return self._city_map[real]

    def _scrub_free_text(self, text):
        """Obfuscate identifying words, leaving prices, badges, distances,
        relative times and (remapped) locations verbatim."""
        text = INLINE_CITY_RE.sub(lambda m: self._city_for(m.group(0)), text)

        spans = []
        for pat in PROTECT_SPANS:
            for m in pat.finditer(text):
                if m.end() > m.start():
                    spans.append([m.start(), m.end()])
        spans.sort()
        merged = []
        for s, e in spans:
            if merged and s <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], e)
            else:
                merged.append([s, e])

        out, pos = [], 0
        for s, e in merged:
            if pos < s:
                out.append(obfuscate(text[pos:s], self.rng))
            out.append(text[s:e])
            pos = e
        if pos < len(text):
            out.append(obfuscate(text[pos:], self.rng))
        return "".join(out)

    def _strip_prices(self, text):
        stripped = CURRENCY_SPAN_RE.sub("", text)
        if stripped != text:
            self._bump("prices_removed")
        return stripped

    def _clean_text(self, text, in_attr=False):
        text = redact_pii(text, self.stats)
        stripped = text.strip()
        if not stripped:
            return text
        # Whole node is a structural label (price, badge, count) -- keep as is.
        if is_structural(stripped):
            return text
        lead = text[:len(text) - len(text.lstrip())]
        trail = text[len(text.rstrip()):]
        if CITY_STATE_RE.match(stripped):
            return lead + self._city_for(stripped) + trail
        if not self.scrub_titles or len(stripped) < 2:
            return text
        self._bump("text_scrubbed")
        return lead + self._scrub_free_text(stripped) + trail

    def _clean_attrs(self, attrs):
        kept = []
        for name, value in attrs:
            lname = name.lower()
            if lname in DROP_ATTRS or lname.startswith("on"):
                self._bump("attrs_dropped")
                continue
            if value is None:
                kept.append((name, None))
                continue
            if lname == "href":
                if self.variant == "no-link" and ITEM_RE.search(value):
                    self._bump("links_broken")
                    continue
                value = self.urls.rewrite_href(value)
            elif lname == "srcset":
                value = self.urls.rewrite_srcset(value)
            elif lname in URL_ATTRS:
                value = self.urls.rewrite_src(value)
            elif lname == "style":
                value = self.urls.rewrite_style(value)
            elif lname in ("aria-label", "alt", "title", "placeholder",
                           "aria-description", "content"):
                if self.variant == "no-price":
                    value = self._strip_prices(value)
                value = self._clean_text(value, in_attr=True)
            elif len(value) > LONG_ATTR_CUTOFF and lname not in KEEP_LONG_ATTRS:
                self._bump("attrs_dropped")
                continue
            kept.append((name, value))
        return kept

    def _emit_tag(self, tag, attrs, self_closing=False):
        bits = [tag]
        for name, value in self._clean_attrs(attrs):
            if value is None:
                bits.append(name)
            else:
                bits.append(f'{name}="{html.escape(value, quote=True)}"')
        self.out.append("<" + " ".join(bits) + ("/>" if self_closing else ">"))

    # -- parser events ----------------------------------------------------
    def handle_starttag(self, tag, attrs):
        if self.skip_tag:
            if tag == self.skip_tag:
                self.skip_depth += 1
            return
        if tag in DROP_VOID:
            self._bump("elements_dropped")
            return
        if self.variant == "no-image" and tag in ("img", "source"):
            self._bump("images_removed")
            return
        if tag in DROP_CONTAINER:
            self._bump("elements_dropped")
            self.skip_tag, self.skip_depth = tag, 1
            return
        self._emit_tag(tag, attrs)

    def handle_startendtag(self, tag, attrs):
        if self.skip_tag:
            return
        if tag in DROP_VOID or tag in DROP_CONTAINER:
            self._bump("elements_dropped")
            return
        if self.variant == "no-image" and tag in ("img", "source"):
            self._bump("images_removed")
            return
        self._emit_tag(tag, attrs, self_closing=True)

    def handle_endtag(self, tag):
        if self.skip_tag:
            if tag == self.skip_tag:
                self.skip_depth -= 1
                if self.skip_depth == 0:
                    self.skip_tag = None
            return
        if tag in DROP_VOID or tag in DROP_CONTAINER:
            return
        self.out.append(f"</{tag}>")

    def handle_data(self, data):
        if self.skip_tag:
            return
        if self.variant == "no-price":
            data = self._strip_prices(data)
            if not data.strip():
                return
        self.out.append(html.escape(self._clean_text(data), quote=False))

    def handle_comment(self, data):
        self._bump("comments_dropped")

    def handle_decl(self, decl):
        pass

    def handle_pi(self, data):
        pass

    def result(self):
        return "".join(self.out)


WRAPPER = """<!doctype html>
<html lang="en">
  <body>
    <!-- MarketScope fixture: {name}
         Source: real Marketplace card markup, sanitized by
         tools/marketscope-fixtures/sanitize_fixtures.py
         Listing IDs, seller identity, media URLs and free text are synthetic.
         DOM structure, nesting, ARIA and visible-text placement are preserved. -->
{body}
  </body>
</html>
"""


def indent_fragment(fragment, spaces=4):
    pad = " " * spaces
    return "\n".join(pad + line for line in fragment.splitlines() if line.strip()) or pad + fragment


def sanitize_one(raw, name, seed, scrub_titles=True, variant=None):
    rng = random.Random(seed)
    s = Sanitizer(rng, scrub_titles=scrub_titles, variant=variant)
    s.feed(raw)
    s.close()
    body = indent_fragment(s.result())
    return WRAPPER.format(name=name, body=body), s.stats


def slugify(text):
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return text or "card"


def load_json_cards(paths):
    """Expand files and directories into (label, html) pairs, in stable order."""
    files = []
    for item in paths:
        path = Path(item)
        if path.is_dir():
            files.extend(sorted(path.glob("*.json")))
        else:
            files.append(path)
    if not files:
        sys.exit("No .json captures found.")

    raws = []
    for jf in files:
        payload = json.loads(jf.read_text(encoding="utf-8"))
        cards = payload.get("cards", payload) if isinstance(payload, dict) else payload
        for i, card in enumerate(cards):
            if isinstance(card, dict):
                raws.append((card.get("label") or f"card-{i+1}", card["html"]))
            else:
                raws.append((f"card-{i+1}", card))
        print(f"  read {len(cards):>3} card(s) from {jf.name}")
    return raws


def dedupe(raws):
    """Drop cards captured more than once across overlapping pages."""
    seen, kept, dropped = set(), [], 0
    for label, raw in raws:
        key = hash(re.sub(r"\s+", " ", raw).strip())
        if key in seen:
            dropped += 1
            continue
        seen.add(key)
        kept.append((label, raw))
    return kept, dropped


def cmd_sanitize(args):
    raws = []
    if args.from_json:
        raws = load_json_cards(args.from_json)
    else:
        src = Path(args.input)
        files = sorted(src.glob("*.html")) if src.is_dir() else [src]
        if not files:
            sys.exit(f"No .html files found in {src}")
        for f in files:
            raws.append((f.stem, f.read_text(encoding="utf-8", errors="replace")))

    if not args.allow_duplicates:
        raws, dropped = dedupe(raws)
        if dropped:
            print(f"  skipped {dropped} duplicate card(s) "
                  f"(--allow-duplicates to keep them)")

    variants = []
    if args.derive_variants:
        n = args.derive_variants
        pool = [raw for _, raw in raws[:n * 3]]
        for kind, offset in (("no-price", 0), ("no-image", n), ("no-link", 2 * n)):
            for raw in pool[offset:offset + n]:
                variants.append((kind, raw))
        print(f"  deriving {len(variants)} variant(s) from captured cards")

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    # Continue numbering after any fixtures already in the output directory,
    # so a second run adds to the corpus instead of overwriting it.
    if args.start is None:
        existing = [int(m.group(1)) for f in outdir.glob("*.html")
                    if (m := re.match(r"(\d+)-", f.name))]
        start = max(existing) + 1 if existing else 1
    else:
        start = args.start

    totals = {}
    rows = []
    queue = [(label, raw, None) for label, raw in raws]
    queue += [(kind, raw, kind) for kind, raw in variants]
    for idx, (label, raw, variant) in enumerate(queue, start=start):
        name = f"{idx:03d}-{slugify(label)}.html"
        text, stats = sanitize_one(raw, name, seed=idx,
                                   scrub_titles=not args.keep_titles,
                                   variant=variant)
        (outdir / name).write_text(text, encoding="utf-8")
        for k, v in stats.items():
            totals[k] = totals.get(k, 0) + v
        rows.append((name, stats))

    print(f"Wrote {len(rows)} fixture(s) to {outdir}\n")
    for name, stats in rows:
        summary = ", ".join(f"{k}={v}" for k, v in sorted(stats.items())) or "no changes"
        print(f"  {name}: {summary}")
    print("\nTotals: " + ", ".join(f"{k}={v}" for k, v in sorted(totals.items())))
    print("\nReview the output before committing -- automated scrubbing is a first "
          "pass, not a substitute for reading the files.")


# --------------------------------------------------------------------------
# verify
# --------------------------------------------------------------------------

LEAK_PATTERNS = [
    ("script tag", re.compile(r"<script", re.I)),
    ("email address", EMAIL_RE),
    ("phone number", PHONE_RE),
    ("session token", re.compile(r"\b(?:fb_dtsg|jazoest|lsd|access_token|__tn__|"
                                 r"__cft__|datr|c_user|xs=)\b", re.I)),
    ("real cdn url", re.compile(r"https?://(?!scontent\.fixture\.fbcdn\.net)"
                                r"[^\s\"']*(?:fbcdn\.net|cdninstagram\.com)", re.I)),
    ("facebook profile link", re.compile(r"(?:profile\.php\?id=|/people/)", re.I)),
    ("cookie header", re.compile(r"\bCookie:\s", re.I)),
]

COVERAGE_CHECKS = {
    "has_item_link": lambda t: "/marketplace/item/" in t,
    "sponsored": lambda t: re.search(r"sponsored", t, re.I) is not None,
    "shipping": lambda t: re.search(r"shipping|ships to you|free delivery",
                                    t, re.I) is not None,
    "free_price": lambda t: re.search(r">\s*Free\s*<", t, re.I) is not None,
    "has_price": lambda t: re.search(r"[\$£€¥]\s?[\d,]", t) is not None,
    "missing_price": lambda t: re.search(r"[\$£€¥]\s?[\d,]", t) is None,
    "has_image": lambda t: "fixture.fbcdn.net" in t,
    "missing_image": lambda t: "fixture.fbcdn.net" not in t,
    "has_seller_link": lambda t: "/marketplace/profile/" in t,
    "missing_seller": lambda t: "/marketplace/profile/" not in t,
    "has_location": lambda t: any(c in t for c in FIXTURE_CITIES),
    "missing_location": lambda t: not any(c in t for c in FIXTURE_CITIES),
    "long_title": lambda t: any(len(x) > 80 for x in re.findall(r">([^<>]{20,})<", t)),
    "non_ascii": lambda t: any(ord(c) > 127 for c in re.sub(r"<!--.*?-->", "", t, flags=re.S)),
    "malformed": lambda t: "/marketplace/item/" not in t,
}

# Minimum count per bucket for the corpus to be considered representative.
COVERAGE_MINIMUMS = {
    "sponsored": 3, "shipping": 3, "free_price": 2, "missing_price": 2,
    "missing_image": 2, "missing_seller": 2, "missing_location": 2,
    "long_title": 2, "non_ascii": 3, "malformed": 2,
}


# Synthetic values this tool itself writes. Removed before leak scanning so the
# checker reports real leaks rather than its own placeholders.
SAFE_STRIPPERS = [
    re.compile(r"/marketplace/(?:item|profile)/\d+/?"),
    re.compile(r"https://scontent\.fixture\.fbcdn\.net/v/fixture-\d+\.jpg"),
    re.compile(r"fixture@example\.invalid"),
    re.compile(r"\b555-0100\b"),
    re.compile(r"100 Fixture St"),
    re.compile(r"https://example\.invalid/fixture"),
]


def strip_known_synthetic(text):
    for pat in SAFE_STRIPPERS:
        text = pat.sub(" ", text)
    return text


def cmd_verify(args):
    d = Path(args.dir)
    files = sorted(f for f in d.glob("*.html"))
    if not files:
        sys.exit(f"No .html fixtures in {d}")

    leaks = []
    coverage = {k: 0 for k in COVERAGE_CHECKS}
    for f in files:
        text = f.read_text(encoding="utf-8", errors="replace")
        scannable = strip_known_synthetic(text)
        for label, pat in LEAK_PATTERNS:
            m = pat.search(scannable)
            if m:
                leaks.append((f.name, label, m.group(0)[:60]))
        for key, fn in COVERAGE_CHECKS.items():
            if fn(text):
                coverage[key] += 1

    print(f"Fixtures: {len(files)} / {args.target} required\n")

    waived = set(args.waive or [])
    unknown = waived - set(COVERAGE_CHECKS)
    if unknown:
        sys.exit(f"Unknown bucket(s) in --waive: {', '.join(sorted(unknown))}")

    print("Coverage:")
    shortfalls = []
    for key in COVERAGE_CHECKS:
        need = COVERAGE_MINIMUMS.get(key)
        mark = " "
        if need is not None:
            if coverage[key] >= need:
                mark = "+"
            elif key in waived:
                # Buckets Marketplace will not serve this account cannot be
                # collected, and inventing one is what the corpus rules forbid.
                mark = "~"
            else:
                mark = "!"
                shortfalls.append(f"{key} ({coverage[key]}/{need})")
        need_s = f"  (min {need})" if need else ""
        print(f"  {mark} {key:<20} {coverage[key]:>3}{need_s}")

    if waived:
        print("\nWaived (record the reason in the fixture README): "
              + ", ".join(sorted(waived)))

    ok = True
    if leaks:
        ok = False
        print(f"\nPossible leaks ({len(leaks)}):")
        for name, label, snippet in leaks[:40]:
            print(f"  ! {name}: {label} -> {snippet!r}")
        if len(leaks) > 40:
            print(f"  ... and {len(leaks) - 40} more")
    else:
        print("\nNo leak patterns matched.")

    if len(files) < args.target:
        ok = False
        print(f"\nShort by {args.target - len(files)} fixture(s).")
    if shortfalls:
        ok = False
        print("\nCoverage shortfalls: " + ", ".join(shortfalls))

    if ok:
        print("\nCorpus looks complete. M4 can resume.")
    return 0 if ok else 1


# --------------------------------------------------------------------------
# prune
# --------------------------------------------------------------------------

# Buckets worth protecting when trimming. Ordered scarcest-first so the rare
# cards are claimed before the quota fills up.
PRUNE_BUCKETS = [
    "malformed", "missing_price", "missing_image", "sponsored", "shipping",
    "missing_location", "long_title", "free_price", "non_ascii",
]


def cmd_prune(args):
    d = Path(args.dir)
    files = sorted(d.glob("*.html"))
    if not files:
        sys.exit(f"No .html fixtures in {d}")

    texts = {f: f.read_text(encoding="utf-8", errors="replace") for f in files}

    keep = {}
    for bucket in PRUNE_BUCKETS:
        check = COVERAGE_CHECKS[bucket]
        members = [f for f in files if check(texts[f])]
        # A bucket matched by nearly everything says nothing about which files
        # are worth keeping, so it gets no quota.
        if len(members) > len(files) * 0.8:
            continue
        for f in members[:args.per_bucket]:
            keep.setdefault(f, bucket)

    # Top up with ordinary cards, sampled evenly across the corpus. Taking them
    # in filename order would fill the quota from whichever collection page
    # sorted first, skewing the corpus toward that page's kind of listing.
    remaining = [f for f in files if f not in keep]
    need = max(0, args.target - len(keep))
    picked = []
    if need and remaining:
        step = max(1.0, len(remaining) / need)
        pos = 0.0
        while len(picked) < need and int(pos) < len(remaining):
            picked.append(remaining[int(pos)])
            pos += step
        # Even striding can land short when rounding collides; backfill.
        chosen = set(picked)
        for f in remaining:
            if len(picked) >= need:
                break
            if f not in chosen:
                picked.append(f)
                chosen.add(f)
    for f in picked:
        keep[f] = "plain"
    filler = len(picked)

    drop = [f for f in files if f not in keep]

    print(f"{len(files)} fixture(s) -> keeping {len(keep)}, dropping {len(drop)}\n")

    # Report coverage of the kept set directly. A file can satisfy several
    # buckets, so counting which bucket claimed it under-reports the rest.
    waived = set(args.waive or [])
    unknown = waived - set(COVERAGE_CHECKS)
    if unknown:
        sys.exit(f"Unknown bucket(s) in --waive: {', '.join(sorted(unknown))}")

    print("Coverage after pruning:")
    short = []
    for bucket in PRUNE_BUCKETS:
        check = COVERAGE_CHECKS[bucket]
        n = sum(1 for f in keep if check(texts[f]))
        need = COVERAGE_MINIMUMS.get(bucket)
        mark = " "
        if need is not None:
            if n >= need:
                mark = "+"
            elif bucket in waived:
                mark = "~"
            else:
                mark = "!"
                short.append(f"{bucket} ({n}/{need})")
        print(f"  {mark} {bucket:<18} {n:>3}" + (f"  (min {need})" if need else ""))
    print(f"    {'plain filler':<18} {filler:>3}")

    if short:
        print("\nPruning would break: " + ", ".join(short))
        print("Raise --target or --per-bucket, or collect the missing cards first.")
        if args.apply:
            print("Refusing to delete.")
            return 1

    if not args.apply:
        print(f"\nDry run -- nothing deleted. Re-run with --apply to delete "
              f"{len(drop)} file(s).")
        return 0

    for f in drop:
        f.unlink()
    print(f"\nDeleted {len(drop)} file(s). Re-run verify to confirm coverage held.")
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("sanitize", help="sanitize raw card HTML into fixtures")
    s.add_argument("input", nargs="?", help="raw .html file or directory of them")
    s.add_argument("--from-json", nargs="+", metavar="PATH",
                   help="one or more cards.json captures, or a directory of them")
    s.add_argument("-o", "--outdir", default="tests/fixtures/marketplace")
    s.add_argument("--start", type=int, default=None,
                   help="starting fixture number (default: continue after "
                        "the highest already in the output directory)")
    s.add_argument("--allow-duplicates", action="store_true",
                   help="keep identical cards captured on overlapping pages")
    s.add_argument("--derive-variants", type=int, default=0, metavar="N",
                   help="also emit N each of no-price, no-image and no-link "
                        "cards, derived by removing one part from captured "
                        "markup (these buckets cannot be collected directly)")
    s.add_argument("--keep-titles", action="store_true",
                   help="skip title/description scrubbing (you sanitize by hand)")
    s.set_defaults(func=cmd_sanitize)

    v = sub.add_parser("verify", help="check fixtures for leaks and coverage")
    v.add_argument("dir", nargs="?", default="tests/fixtures/marketplace")
    v.add_argument("--target", type=int, default=50)
    v.add_argument("--waive", nargs="*", default=[], metavar="BUCKET",
                   help="buckets that cannot be collected (e.g. sponsored, "
                        "when Marketplace serves none); reported as waived "
                        "rather than failing the run")
    v.set_defaults(func=cmd_verify)

    pr = sub.add_parser("prune", help="trim a corpus while keeping coverage")
    pr.add_argument("dir", nargs="?", default="tests/fixtures/marketplace")
    pr.add_argument("--target", type=int, default=70,
                    help="how many fixtures to keep (default 70)")
    pr.add_argument("--per-bucket", type=int, default=5,
                    help="how many to keep per coverage bucket (default 5)")
    pr.add_argument("--apply", action="store_true",
                    help="actually delete; without it this is a dry run")
    pr.add_argument("--waive", nargs="*", default=[], metavar="BUCKET",
                    help="buckets that cannot be collected; keeps pruning from "
                         "refusing over a gap you have already accepted")
    pr.set_defaults(func=cmd_prune)

    args = p.parse_args()
    if args.cmd == "sanitize" and not args.input and not args.from_json:
        p.error("sanitize needs an input path or --from-json")
    sys.exit(args.func(args) or 0)


if __name__ == "__main__":
    main()
