import { useEffect, useState, useSyncExternalStore } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { addLibrary, getSetting, listLibraries, listTitles, setSetting } from "../library/db";
import { libraryChanged } from "../library/store";
import { runJob } from "../library/jobs";
import { scanAll } from "../library/actions";
import { enableImdb } from "../discover/imdb";
import TmdbKeyField from "./TmdbKeyField";
import SeenPicker from "./SeenPicker";
import { IconCheck, IconLayers, IconLibrary, IconStar, IconTrophy } from "./icons";

// Shown when `onboarded` isn't set: on a fresh install, or after "Run set-up again".
let visible: boolean | null = null;
const subs = new Set<() => void>();
const setVisible = (v: boolean) => {
  visible = v;
  subs.forEach((f) => f());
};
export const restartOnboarding = () => setVisible(true);

async function decide() {
  if ((await getSetting("onboarded")) === "true") {
    // Set up before 2.1: say what 2.1 added, once.
    if ((await getSetting("seen_whats_new_21")) !== "true" && (await listLibraries()).length) whatsNew = true;
    return setVisible(false);
  }
  // A v1.x user (library or key already there) skips set-up and sees "What's new" once.
  const [libs, key] = await Promise.all([listLibraries(), getSetting("tmdb_key")]);
  if (libs.length || key) {
    await setSetting("onboarded", "true");
    if ((await getSetting("seen_whats_new_2")) !== "true") {
      whatsNew = true;
      from1x = true;
    }
    return setVisible(false);
  }
  setVisible(true);
}
export let whatsNew = false;
/** Upgrading straight from 1.x: the card also covers 2.0. */
let from1x = false;

function useVisible() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      if (visible === null) decide();
      return () => subs.delete(f);
    },
    () => visible,
  );
}

const STEPS = ["welcome", "library", "tmdb", "imdb", "watched"] as const;
type Step = (typeof STEPS)[number];

export default function Onboarding() {
  const show = useVisible();
  const [step, setStep] = useState<Step>("welcome");
  const [folders, setFolders] = useState<string[]>([]);
  const [hasKey, setHasKey] = useState(false);
  const [imdbOn, setImdbOn] = useState(false);
  const [picker, setPicker] = useState(false);
  useEffect(() => {
    if (!show) return;
    setStep("welcome");
    listLibraries().then((l) => setFolders(l.map((x) => x.path)));
    getSetting("tmdb_key").then((k) => setHasKey(!!k));
  }, [show]);
  if (!show) return null;

  const i = STEPS.indexOf(step);
  const next = () => {
    const n = STEPS[i + 1];
    // IMDb ratings and suggestions both need TMDB, so without a key set-up ends here.
    if (!n || ((n === "imdb" || n === "watched") && !hasKey)) return void finish();
    setStep(n);
  };
  const finish = async () => {
    await setSetting("onboarded", "true");
    await setSetting("seen_whats_new_2", "true");
    await setSetting("seen_whats_new_21", "true");
    setVisible(false);
  };

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label="Set up Off Player">
      <div className="ob-glow" aria-hidden />
      <div className="ob-card" key={step}>
        <div className="ob-steps" aria-hidden>
          {STEPS.map((s, n) => <span key={s} className={n <= i ? "on" : ""} />)}
        </div>

        {step === "welcome" && (
          <>
            <span className="mark huge" aria-hidden />
            <h1>Welcome to Off Player</h1>
            <p className="ob-lead">Two things, one app.</p>
            <div className="ob-two">
              <div><IconLibrary /><b>Watch what you own</b><span>Your shows and movies with artwork, resume, and next episode.</span></div>
              <div><IconTrophy /><b>Find what's next</b><span>Suggestions, filters, top lists and franchises in story order.</span></div>
            </div>
            <div className="ob-actions">
              <button className="btn primary big" onClick={next}>Get started</button>
            </div>
          </>
        )}

        {step === "library" && (
          <>
            <h1>Your library</h1>
            <p className="ob-lead">Point Off Player at a folder of shows or movies. It reads seasons and episodes from the file names and remembers where you stopped. Scanning carries on while you finish set-up.</p>
            {folders.length > 0 && (
              <ul className="ob-folders">
                {folders.map((f) => <li key={f}><IconCheck /> {f}</li>)}
              </ul>
            )}
            <div className="ob-actions">
              <button
                className="btn primary big"
                onClick={async () => {
                  const picked = await open({ directory: true, multiple: false, title: "Add a folder to your library" });
                  if (typeof picked !== "string") return;
                  const lib = await addLibrary(picked);
                  libraryChanged();
                  runJob((r) => scanAll([lib], r));
                  setFolders((f) => [...f, picked]);
                }}
              >
                {folders.length ? "Add another folder" : "Add a folder"}
              </button>
              <button className="btn big" onClick={next}>{folders.length ? "Continue" : "I'll do this later"}</button>
            </div>
          </>
        )}

        {step === "tmdb" && (
          <>
            <h1>Artwork and Discover</h1>
            <p className="ob-lead">Posters, episode names, suggestions, top lists and collections come from TMDB, a free film and TV database. It needs a free key, which stays on this PC.</p>
            <TmdbKeyField steps onSaved={() => setHasKey(true)} />
            <div className="ob-actions">
              <button className="btn primary big" onClick={next} disabled={!hasKey}>Continue</button>
              <button className="btn big" onClick={() => (hasKey ? next() : finish())}>Skip for now</button>
            </div>
            {!hasKey && <p className="fine">Without a key your library still plays; it just has no artwork and Discover stays empty.</p>}
          </>
        )}

        {step === "imdb" && (
          <>
            <h1>IMDb ratings <span className="opt">optional</span></h1>
            <p className="ob-lead">Show IMDb ratings next to TMDB's and rank Top Lists by IMDb. Off Player downloads IMDb's public rating files once (about 240 MB) and keeps roughly 100,000 ratings on this PC, refreshed weekly. Nothing is sent to IMDb.</p>
            <div className="ob-actions">
              <button
                className={`btn big ${imdbOn ? "" : "primary"}`}
                disabled={imdbOn}
                onClick={() => {
                  setImdbOn(true);
                  enableImdb();
                  next();
                }}
              >
                <IconStar /> {imdbOn ? "Downloading…" : "Turn on IMDb ratings"}
              </button>
              <button className="btn big" onClick={next}>Not now</button>
            </div>
            <p className="fine">IMDb allows this for personal, non-commercial use. You can turn it off any time in Settings.</p>
          </>
        )}

        {step === "watched" && (
          <>
            <h1>What have you watched?</h1>
            <p className="ob-lead">Pick a few shows and movies you've seen and liked. Off Player uses them to suggest what to watch next. Five or more works best.</p>
            <div className="ob-actions">
              <button className="btn primary big" onClick={() => setPicker(true)}><IconLayers /> Pick titles</button>
              <button className="btn big" onClick={finish}>Skip and start</button>
            </div>
          </>
        )}
      </div>
      {picker && (
        <SeenPicker
          onClose={() => {
            setPicker(false);
            finish();
          }}
        />
      )}
    </div>
  );
}

/** One-time card for people upgrading. */
export function WhatsNew({ onClose }: { onClose: () => void }) {
  return (
    <div className="whats-new">
      <div>
        <b>New in Off Player</b>
        <span>
          {from1x && "Browse with real filters, Top Lists, franchises in story order, IMDb ratings, and one search for everything. "}
          Skip intro: Off Player finds each show's title sequence from your files and offers to skip it (press S).
        </span>
      </div>
      <button
        className="btn small"
        onClick={async () => {
          await setSetting("seen_whats_new_2", "true");
          await setSetting("seen_whats_new_21", "true");
          onClose();
        }}
      >
        Got it
      </button>
    </div>
  );
}

export async function hasLibrary() {
  return (await listTitles()).length > 0;
}
