ALTER TABLE notifications
  ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX notifications_due_idx
  ON notifications(state, next_attempt_at, created_at);

CREATE TABLE notification_watchlists (
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  watchlist_id TEXT NOT NULL,
  watchlist_name TEXT NOT NULL,
  relevance INTEGER NOT NULL CHECK (relevance BETWEEN 0 AND 100),
  PRIMARY KEY (notification_id, watchlist_id)
);
