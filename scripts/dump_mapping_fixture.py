"""Export file titles and TMDB episode names per show into a test fixture for
src/library/match.test.ts. Read-only on the app database.

    python -I scripts/dump_mapping_fixture.py "%APPDATA%\\com.offplayer.app\\offplayer.db"
"""
import json, sqlite3, sys, pathlib

db = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
out = {}
for (tid, name) in db.execute("SELECT id, COALESCE(tmdb_name, name) FROM titles WHERE tmdb_type = 'tv'"):
    files = [
        {"id": i, "season": s, "episode": e, "title": t}
        for (i, s, e, t) in db.execute(
            "SELECT id, season, episode, episode_title FROM files WHERE title_id = ? AND role = 'episode' ORDER BY season, episode",
            (tid,),
        )
    ]
    eps = {}
    for (s, e, n) in db.execute(
        "SELECT season, episode, name FROM episodes_meta WHERE title_id = ? ORDER BY season, episode", (tid,)
    ):
        eps.setdefault(str(s), []).append({"episode_number": e, "name": n})
    out[name] = {"files": files, "tmdb": eps}

dest = pathlib.Path(__file__).resolve().parent.parent / "src" / "library" / "__fixtures__" / "tmdb-episodes.json"
dest.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print("wrote", dest, {k: len(v["files"]) for k, v in out.items()})
