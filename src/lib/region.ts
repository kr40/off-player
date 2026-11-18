// Country for "where to watch" and streaming filters: the user's saved choice,
// else the system locale's. Never sent anywhere except as TMDB's watch_region.
import { useEffect, useState } from "react";
import { getSetting } from "../library/db";

export function localRegion(): string {
  try {
    return new Intl.Locale(navigator.language).maximize().region ?? "US";
  } catch {
    return "US";
  }
}

export function useRegion(): string {
  const [r, setR] = useState(localRegion);
  useEffect(() => {
    getSetting("watch_region").then((v) => v && setR(v));
  }, []);
  return r;
}
