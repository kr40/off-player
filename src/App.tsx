import { useCallback, useEffect, useState } from "react";
import { command } from "tauri-plugin-libmpv-api";
import Shell from "./app/Shell";
import Player, { type PlayItem } from "./components/Player";
import Onboarding from "./components/Onboarding";
import { db } from "./library/db";
import { installCardKeys } from "./app/cardKeys";
import { preloadSettings } from "./app/preload";
import "./styles/base.css";

export default function App() {
  const [playing, setPlaying] = useState<PlayItem | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const play = useCallback((item: PlayItem) => setPlaying(item), []);
  // After a page reload mpv (which lives in the native side) may still be
  // playing the previous file behind the UI. No instance yet → harmless error.
  useEffect(() => {
    command("stop").catch(() => {});
    db()
      .then(() => preloadSettings())
      .then(() => setReady(true))
      .catch((e) => setDbError(String(e)));
    return installCardKeys();
  }, []);

  if (dbError) return <DbProblem error={dbError} />;
  if (!ready) return null;
  return (
    <>
      {/* The browse UI stays mounted under the player so pages keep their place. */}
      <div style={{ display: playing ? "none" : "contents" }}>
        <Shell onPlay={play} playing={!!playing} />
      </div>
      {playing && <Player key={playing.path} item={playing} onClose={() => setPlaying(null)} onSwitch={play} />}
      {!playing && <Onboarding />}
    </>
  );
}

/** The database couldn't be opened: most often it was upgraded by a newer Off Player. */
function DbProblem({ error }: { error: string }) {
  const newer = /previously applied but (is )?missing|was previously applied/i.test(error);
  return (
    <div className="crash">
      <div className="crash-card">
        <h2>{newer ? "This library was saved by a newer Off Player" : "Off Player couldn't open its library"}</h2>
        <p>
          {newer
            ? "Your data is fine, but this version can't read it. Install the latest Off Player to continue; a copy of your data from before the update is in the backups folder."
            : "Your data has not been changed. Restarting the app usually helps. If it keeps happening, the automatic backups folder has recent copies."}
        </p>
        <pre>{error}</pre>
        <button className="btn" onClick={() => navigator.clipboard.writeText(error)}>Copy details</button>
      </div>
    </div>
  );
}
