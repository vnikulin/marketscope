CREATE TABLE users (
  id TEXT PRIMARY KEY,
  singleton INTEGER NOT NULL DEFAULT 1 UNIQUE CHECK (singleton = 1),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE extension_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE watchlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  search_url TEXT NOT NULL,
  term_mode TEXT NOT NULL CHECK (term_mode IN ('ALL', 'ANY', 'EXACT_PHRASE', 'BOOLEAN')),
  required_terms_json TEXT NOT NULL,
  boolean_expression TEXT,
  optional_terms_json TEXT NOT NULL,
  excluded_terms_json TEXT NOT NULL,
  regex_patterns_json TEXT NOT NULL,
  price_rules_json TEXT NOT NULL,
  location_rules_json TEXT NOT NULL,
  listing_type_rules_json TEXT NOT NULL,
  relevance_threshold INTEGER NOT NULL CHECK (relevance_threshold BETWEEN 0 AND 100),
  email_enabled INTEGER NOT NULL CHECK (email_enabled IN (0, 1)),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  ignore_older_than_days INTEGER CHECK (ignore_older_than_days IS NULL OR ignore_older_than_days > 0),
  alert_on_price_change TEXT NOT NULL CHECK (alert_on_price_change IN ('DECREASE', 'ANY', 'NEVER')),
  seeded INTEGER NOT NULL DEFAULT 0 CHECK (seeded IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE listings (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source = 'facebook'),
  listing_key TEXT NOT NULL,
  source_listing_id TEXT,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  price_text TEXT,
  location TEXT,
  distance_miles REAL,
  image_url TEXT,
  image_hash TEXT,
  seller_name TEXT,
  sponsored INTEGER NOT NULL CHECK (sponsored IN (0, 1)),
  shipping INTEGER NOT NULL CHECK (shipping IN (0, 1)),
  local_pickup INTEGER CHECK (local_pickup IS NULL OR local_pickup IN (0, 1)),
  posted_at_text TEXT,
  posted_at_estimate INTEGER,
  raw_text TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  last_alerted INTEGER,
  UNIQUE (source, listing_key)
);

CREATE INDEX listings_last_seen_idx ON listings(last_seen);

CREATE TABLE listing_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  price_cents INTEGER,
  observed_at INTEGER NOT NULL
);

CREATE INDEX listing_price_history_listing_idx
  ON listing_price_history(listing_id, observed_at);

CREATE TABLE watchlist_matches (
  watchlist_id TEXT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  verdict_json TEXT NOT NULL,
  relevance INTEGER NOT NULL CHECK (relevance BETWEEN 0 AND 100),
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  initial_seed INTEGER NOT NULL CHECK (initial_seed IN (0, 1)),
  PRIMARY KEY (watchlist_id, listing_id)
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('queued', 'sending', 'sent', 'failed', 'retrying', 'dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE ignore_rules (
  id TEXT PRIMARY KEY,
  listing_id TEXT REFERENCES listings(id) ON DELETE CASCADE,
  rule_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX ignore_rules_listing_idx ON ignore_rules(listing_id);

CREATE TABLE favorites (
  listing_id TEXT PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO settings (key, value_json, updated_at)
VALUES ('retentionDays', '30', 0);
