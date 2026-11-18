-- v1.3.0: My List refresh, "already watched", and suggestions.
ALTER TABLE watchlist ADD COLUMN refreshed_at INTEGER;

-- Titles the user says they have seen (outside the library).
CREATE TABLE seen (
  tmdb_type     TEXT NOT NULL,
  tmdb_id       INTEGER NOT NULL,
  name          TEXT NOT NULL,
  poster        TEXT,
  poster_local  TEXT,
  backdrop      TEXT,
  date          TEXT,
  genres        TEXT,              -- JSON array of TMDB genre ids
  reaction      INTEGER NOT NULL DEFAULT 1,  -- 2 loved, 1 liked, -1 not for me
  seen_at       INTEGER NOT NULL,
  PRIMARY KEY (tmdb_type, tmdb_id)
);

-- "Not interested" on a suggestion.
CREATE TABLE rec_dismissed (
  tmdb_type TEXT NOT NULL, tmdb_id INTEGER NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (tmdb_type, tmdb_id)
);

-- TMDB recommendation lists per seed, so suggestions work offline and stay within rate limits.
CREATE TABLE rec_cache (
  seed_type TEXT NOT NULL, seed_id INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  results   TEXT NOT NULL,         -- JSON array of Item (+ genre ids)
  PRIMARY KEY (seed_type, seed_id)
);
