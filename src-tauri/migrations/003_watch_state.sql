-- Removing a show from Continue Watching hides its rows until it's played again.
ALTER TABLE playback ADD COLUMN dismissed INTEGER NOT NULL DEFAULT 0;
CREATE INDEX playback_last ON playback (last_played);

-- Per-show audio and subtitle choice, keyed by title key so it survives rescans.
-- Values are JSON descriptors (language, external, title), not track ids,
-- because ids differ from file to file.
CREATE TABLE title_prefs (
  key    TEXT PRIMARY KEY,
  audio  TEXT,
  subs   TEXT
);
