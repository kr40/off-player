import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getSetting, setSetting } from "../library/db";
import { testTmdbKey } from "../library/metadata";
import { runJob } from "../library/jobs";
import { runMetadata } from "../library/actions";
import { clearDiscoverCache } from "../discover/api";

/** Paste, verify and save a TMDB key. Used by Settings and first-run setup. */
export default function TmdbKeyField({ onSaved, steps }: { onSaved?: () => void; steps?: boolean }) {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [state, setState] = useState<{ kind: "idle" | "testing" | "ok" | "err"; msg?: string }>({ kind: "idle" });

  useEffect(() => {
    getSetting("tmdb_key").then((k) => {
      setSaved(k);
      setKey(k ?? "");
    });
  }, []);

  const save = async () => {
    const k = key.trim();
    if (!k) {
      await setSetting("tmdb_key", null);
      setSaved(null);
      setState({ kind: "idle" });
      return;
    }
    setState({ kind: "testing" });
    try {
      await testTmdbKey(k);
      await setSetting("tmdb_key", k);
      setSaved(k);
      clearDiscoverCache();
      setState({ kind: "ok", msg: "Key works. Fetching posters and episode info in the background." });
      runJob((r) => runMetadata(r));
      onSaved?.();
    } catch (e) {
      setState({ kind: "err", msg: /401|Invalid API key/i.test(String(e)) ? "TMDB says this key isn't valid. Check you copied all of it." : String(e) });
    }
  };

  return (
    <div className="field">
      {steps && (
        <ol className="key-steps">
          <li>Create a free account at TMDB (themoviedb.org). <button className="link" onClick={() => openUrl("https://www.themoviedb.org/signup")}>Open TMDB</button></li>
          <li>Go to Settings → API and ask for a developer key for personal use. <button className="link" onClick={() => openUrl("https://www.themoviedb.org/settings/api")}>Open the API page</button></li>
          <li>Copy the <b>API Key</b> or the <b>API Read Access Token</b> and paste it here.</li>
        </ol>
      )}
      <label htmlFor="tmdb">TMDB API key or read access token</label>
      <div className="row-gap">
        <input
          id="tmdb"
          className="input"
          style={{ flex: 1 }}
          type={show ? "text" : "password"}
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setState({ kind: "idle" });
          }}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="Paste key"
          spellCheck={false}
          autoComplete="off"
        />
        <button className="btn" onClick={() => setShow((s) => !s)}>{show ? "Hide" : "Show"}</button>
        <button className="btn primary" onClick={save} disabled={state.kind === "testing" || key.trim() === (saved ?? "")}>
          {state.kind === "testing" ? "Checking…" : "Save"}
        </button>
      </div>
      {state.kind === "ok" && <span className="status-ok">{state.msg}</span>}
      {state.kind === "err" && <span className="status-err">{state.msg}</span>}
      {state.kind === "idle" && saved && <span className="status-ok">A key is saved.</span>}
    </div>
  );
}
