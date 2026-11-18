-- Titles saved from Discover to watch later. Enough is stored to show the
-- card without the network (the poster is cached to disk when saved).
CREATE TABLE watchlist (
  tmdb_type     TEXT NOT NULL,
  tmdb_id       INTEGER NOT NULL,
  name          TEXT NOT NULL,
  poster        TEXT,
  poster_local  TEXT,
  backdrop      TEXT,
  date          TEXT,
  overview      TEXT,
  rating        REAL,
  votes         INTEGER NOT NULL DEFAULT 0,
  added_at      INTEGER NOT NULL,
  PRIMARY KEY (tmdb_type, tmdb_id)
);
