-- v2.0: Browse, Top Lists, IMDb ratings, Collections.

-- TMDB responses kept on disk (list pages, collections, people), so lists and
-- collections reopen instantly and work offline. Caller decides freshness.
-- Rows older than 180 days are purged at start-up (TMDB's terms).
CREATE TABLE api_cache (
  key        TEXT PRIMARY KEY,      -- path + sorted params
  fetched_at INTEGER NOT NULL,
  body       TEXT NOT NULL          -- JSON, already reduced to the fields used
);

-- Link between TMDB titles and IMDb ids, both directions.
CREATE TABLE ext_ids (
  tmdb_type  TEXT NOT NULL,
  tmdb_id    INTEGER NOT NULL,
  imdb_id    TEXT,                  -- NULL = looked up, none exists
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (tmdb_type, tmdb_id)
);
CREATE INDEX ext_ids_imdb ON ext_ids (imdb_id);
-- IMDb ids TMDB does not know (so /find is not repeated).
CREATE TABLE imdb_unmatched (tconst TEXT PRIMARY KEY, checked_at INTEGER NOT NULL);

-- IMDb ratings, imported on this PC from IMDb's public files (opt-in).
CREATE TABLE imdb_titles (
  tconst   TEXT PRIMARY KEY,
  kind     TEXT NOT NULL,           -- 'movie' | 'series'
  title    TEXT NOT NULL,
  year     INTEGER,
  runtime  INTEGER,
  genres   TEXT,                    -- comma-separated IMDb genre names
  rating   REAL NOT NULL,
  votes    INTEGER NOT NULL,
  weighted REAL NOT NULL
);
CREATE INDEX imdb_rank ON imdb_titles (kind, weighted DESC);
CREATE INDEX imdb_votes ON imdb_titles (kind, votes DESC);

-- Per-collection choices. key = 'franchise:dune' | 'tmdb:10' (TMDB collection id).
CREATE TABLE collection_state (
  key       TEXT PRIMARY KEY,
  order_id  TEXT,                   -- 'release' | 'story' | custom
  followed  INTEGER NOT NULL DEFAULT 0,
  opened_at INTEGER
);

CREATE TABLE saved_filters (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  params     TEXT NOT NULL,         -- JSON of the Browse filter state
  created_at INTEGER NOT NULL
);

-- Watched entries are refreshed like the watchlist (TMDB's six-month cache rule).
ALTER TABLE seen ADD COLUMN refreshed_at INTEGER;

-- Original language of library titles (anime detection) and their TMDB collection.
ALTER TABLE titles ADD COLUMN orig_lang TEXT;
ALTER TABLE titles ADD COLUMN collection_id INTEGER;
