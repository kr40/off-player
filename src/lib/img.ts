import { convertFileSrc } from "@tauri-apps/api/core";

/** URL for a locally cached image (artwork or thumbnail), or undefined. */
export const img = (path: string | null | undefined) => (path ? convertFileSrc(path) : undefined);

/** TMDB-hosted image, used only in the Fix match search results. */
export const tmdbImg = (path: string | null | undefined, size = "w185") =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;
