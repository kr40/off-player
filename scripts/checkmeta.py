import sqlite3, sys
c = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
q = lambda s, *a: c.execute(s, a).fetchall()
print("saved key rows:", q("SELECT COUNT(*) FROM settings WHERE key = 'tmdb_key'")[0][0])
print("thumbs set:", q("SELECT COUNT(*) FROM files WHERE thumb IS NOT NULL")[0][0])
print("match states:", q("SELECT match_state, COUNT(*) FROM titles GROUP BY 1"))
print("titles:", q("SELECT name, tmdb_id, tmdb_name, tmdb_year, ROUND(match_confidence, 2), poster IS NOT NULL, backdrop IS NOT NULL, logo IS NOT NULL FROM titles ORDER BY name"))
print("episodes_meta:", q("SELECT t.name, COUNT(*), SUM(em.still IS NOT NULL) FROM episodes_meta em JOIN titles t ON t.id = em.title_id GROUP BY 1"))
print("files mapped:", q("SELECT t.name, SUM(f.meta_season IS NOT NULL), COUNT(*) FROM files f JOIN titles t ON t.id = f.title_id WHERE f.role = 'episode' GROUP BY 1"))
print("remapped (number differs):", q("SELECT t.name, f.season, f.episode, f.meta_episode, f.episode_title FROM files f JOIN titles t ON t.id = f.title_id WHERE f.meta_episode IS NOT NULL AND f.meta_episode <> f.episode"))
print("title vs tmdb name mismatches:", q("""
  SELECT t.name, f.season, f.episode, f.episode_title, em.name FROM files f
  JOIN titles t ON t.id = f.title_id
  JOIN episodes_meta em ON em.title_id = f.title_id AND em.season = f.meta_season AND em.episode = f.meta_episode
  WHERE f.episode_title IS NOT NULL AND lower(replace(replace(f.episode_title, '’', ''), '''', '')) <> lower(replace(replace(em.name, '’', ''), '''', ''))
  LIMIT 40"""))
