-- Skip intro (2.1): where the intro and end credits are in each video.
-- Keyed like `playback`, by the file's fingerprint, so renames and moves keep markers.
-- A 'manual' row with NULL start and end means "the user says there is none".
CREATE TABLE segments (
  fingerprint  TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('intro', 'credits')),
  start_s      REAL,
  end_s        REAL,
  source       TEXT NOT NULL CHECK (source IN ('manual', 'chapter', 'audio')),
  confidence   REAL,              -- audio only: share of compared neighbours that agreed
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (fingerprint, kind, source)
);

-- One row per analysed file, including "nothing found", so work is not repeated.
CREATE TABLE segment_scans (
  fingerprint  TEXT PRIMARY KEY,
  version      INTEGER NOT NULL,  -- analysis version at the time
  scanned_at   INTEGER NOT NULL,
  error        TEXT               -- why the file could not be analysed, if so
);
