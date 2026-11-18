import ReactDOM from "react-dom/client";
import "@fontsource-variable/geist";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";

// Dev builds only: lets scripts/resolve-keywords.mjs and build-franchises.mjs
// query TMDB through the running app (which holds the key) over the debug port.
// Also exposes the intro finder's timings for measurement scripts.
if (import.meta.env.DEV) {
  Promise.all([import("./library/metadata"), import("./library/segmentScan")]).then(([m, s]) => {
    (window as unknown as { __offplayer: unknown }).__offplayer = { tmdb: m.tmdb, segmentStats: s.segmentStats };
  });
}

// No StrictMode: its double-mounted effects would initialise mpv twice.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
