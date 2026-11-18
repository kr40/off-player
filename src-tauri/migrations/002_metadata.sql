-- TMDB metadata. Image columns hold local file paths in the app's data folder.
ALTER TABLE titles ADD COLUMN tmdb_type TEXT;            -- 'tv' | 'movie'
ALTER TABLE titles ADD COLUMN match_state TEXT NOT NULL DEFAULT 'pending'; -- pending | auto | confirmed | none
ALTER TABLE titles ADD COLUMN match_confidence REAL;     -- 0..1
ALTER TABLE titles ADD COLUMN tmdb_name TEXT;
ALTER TABLE titles ADD COLUMN tmdb_year INTEGER;
ALTER TABLE titles ADD COLUMN overview TEXT;
ALTER TABLE titles ADD COLUMN tagline TEXT;
ALTER TABLE titles ADD COLUMN genres TEXT;               -- JSON array of names
ALTER TABLE titles ADD COLUMN rating REAL;
ALTER TABLE titles ADD COLUMN poster TEXT;
ALTER TABLE titles ADD COLUMN backdrop TEXT;
ALTER TABLE titles ADD COLUMN logo TEXT;
ALTER TABLE titles ADD COLUMN meta_updated INTEGER;

-- Which TMDB episode a file is (may differ from the parsed number).
ALTER TABLE files ADD COLUMN meta_season INTEGER;
ALTER TABLE files ADD COLUMN meta_episode INTEGER;
-- Frame grab used when TMDB has no still.
ALTER TABLE files ADD COLUMN thumb TEXT;

CREATE TABLE seasons_meta (
  title_id       INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  season         INTEGER NOT NULL,
  name           TEXT,
  overview       TEXT,
  poster         TEXT,
  air_date       TEXT,
  episode_count  INTEGER,
  PRIMARY KEY (title_id, season)
);

CREATE TABLE episodes_meta (
  title_id  INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  season    INTEGER NOT NULL,
  episode   INTEGER NOT NULL,
  name      TEXT,
  overview  TEXT,
  still     TEXT,
  air_date  TEXT,
  runtime   INTEGER,
  rating    REAL,
  PRIMARY KEY (title_id, season, episode)
);

-- Matches the user picked by hand, keyed by title key so they survive the
-- title being removed and re-added.
CREATE TABLE match_overrides (
  key        TEXT PRIMARY KEY,
  tmdb_type  TEXT NOT NULL,
  tmdb_id    INTEGER NOT NULL
);
