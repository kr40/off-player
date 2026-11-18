-- Folders the user has added.
CREATE TABLE libraries (
  id         INTEGER PRIMARY KEY,
  path       TEXT NOT NULL UNIQUE,
  added_at   INTEGER NOT NULL,
  last_scan  INTEGER
);

-- A show or movie. `key` is the normalised name, so a show split across
-- several folders (one per season) becomes one title.
CREATE TABLE titles (
  id        INTEGER PRIMARY KEY,
  key       TEXT NOT NULL UNIQUE,
  kind      TEXT NOT NULL CHECK (kind IN ('show', 'movie')),
  name      TEXT NOT NULL,
  year      INTEGER,
  tmdb_id   INTEGER,
  added_at  INTEGER NOT NULL
);

-- Every video file found. `role` is episode, movie, extra or unknown.
CREATE TABLE files (
  id             INTEGER PRIMARY KEY,
  library_id     INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  title_id       INTEGER REFERENCES titles(id) ON DELETE SET NULL,
  path           TEXT NOT NULL UNIQUE,
  rel            TEXT NOT NULL,
  size           INTEGER NOT NULL,
  mtime          INTEGER NOT NULL,
  fingerprint    TEXT,
  role           TEXT NOT NULL,
  season         INTEGER,
  episode        INTEGER,
  episode_end    INTEGER,
  episode_title  TEXT,
  extra_group    TEXT,
  duration       REAL,
  video_codec    TEXT,
  width          INTEGER,
  height         INTEGER,
  bit_depth      INTEGER,
  audio          TEXT,   -- JSON array from ffprobe
  subs           TEXT,   -- JSON array of embedded subtitle streams
  sidecar_subs   TEXT,   -- JSON array of {path, lang}
  chapters       INTEGER,
  probe_error    TEXT,
  added_at       INTEGER NOT NULL,
  seen_at        INTEGER NOT NULL
);
CREATE INDEX files_title ON files (title_id, season, episode);
CREATE INDEX files_fingerprint ON files (fingerprint);

-- Watch state, keyed by fingerprint so renames and moves keep history.
CREATE TABLE playback (
  fingerprint  TEXT PRIMARY KEY,
  position     REAL NOT NULL DEFAULT 0,
  duration     REAL,
  watched      INTEGER NOT NULL DEFAULT 0,
  last_played  INTEGER,
  aid          TEXT,
  sid          TEXT
);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT
);
