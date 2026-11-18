// Genres and categories. Pure data, no network, so scoring can use it in tests.
//
// TMDB uses different genre ids for series and movies (and merges some for
// series, e.g. "Action & Adventure"), so each category maps to both.

export type Category = { name: string; tv?: number[]; movie?: number[] };

export const CATEGORIES: Category[] = [
  { name: "Action & Adventure", tv: [10759], movie: [28, 12] },
  { name: "Animation", tv: [16], movie: [16] },
  { name: "Comedy", tv: [35], movie: [35] },
  { name: "Crime", tv: [80], movie: [80] },
  { name: "Documentary", tv: [99], movie: [99] },
  { name: "Drama", tv: [18], movie: [18] },
  { name: "Family & Kids", tv: [10751, 10762], movie: [10751] },
  { name: "Fantasy & Sci-Fi", tv: [10765], movie: [878, 14] },
  { name: "History", movie: [36] },
  { name: "Horror", movie: [27] },
  { name: "Music", movie: [10402] },
  { name: "Mystery", tv: [9648], movie: [9648] },
  { name: "Romance", movie: [10749] },
  { name: "Thriller", movie: [53] },
  { name: "War", tv: [10768], movie: [10752] },
  { name: "Western", tv: [37], movie: [37] },
];

// TMDB genre names (as stored for library titles) → ids.
const NAME_TO_ID: Record<string, number> = {
  "Action": 28, "Adventure": 12, "Animation": 16, "Comedy": 35, "Crime": 80, "Documentary": 99,
  "Drama": 18, "Family": 10751, "Fantasy": 14, "History": 36, "Horror": 27, "Music": 10402,
  "Mystery": 9648, "Romance": 10749, "Science Fiction": 878, "Thriller": 53, "War": 10752,
  "Western": 37, "Action & Adventure": 10759, "Kids": 10762, "Sci-Fi & Fantasy": 10765,
  "War & Politics": 10768,
};

const ID_TO_CATEGORY = new Map<number, string>();
for (const c of CATEGORIES) for (const id of [...(c.tv ?? []), ...(c.movie ?? [])]) ID_TO_CATEGORY.set(id, c.name);

/** Category names for a set of TMDB genre ids (series and movie ids alike). */
export function categoriesOf(ids: readonly number[]): string[] {
  return [...new Set(ids.map((id) => ID_TO_CATEGORY.get(id)).filter((c): c is string => !!c))];
}

export type Genre = { id: number; name: string };

/** TMDB's movie genres (GET /genre/movie/list). */
export const MOVIE_GENRES: Genre[] = [
  { id: 28, name: "Action" }, { id: 12, name: "Adventure" }, { id: 16, name: "Animation" }, { id: 35, name: "Comedy" },
  { id: 80, name: "Crime" }, { id: 99, name: "Documentary" }, { id: 18, name: "Drama" }, { id: 10751, name: "Family" },
  { id: 14, name: "Fantasy" }, { id: 36, name: "History" }, { id: 27, name: "Horror" }, { id: 10402, name: "Music" },
  { id: 9648, name: "Mystery" }, { id: 10749, name: "Romance" }, { id: 878, name: "Science Fiction" },
  { id: 10770, name: "TV Movie" }, { id: 53, name: "Thriller" }, { id: 10752, name: "War" }, { id: 37, name: "Western" },
];

/** TMDB's series genres (GET /genre/tv/list). */
export const TV_GENRES: Genre[] = [
  { id: 10759, name: "Action & Adventure" }, { id: 16, name: "Animation" }, { id: 35, name: "Comedy" }, { id: 80, name: "Crime" },
  { id: 99, name: "Documentary" }, { id: 18, name: "Drama" }, { id: 10751, name: "Family" }, { id: 10762, name: "Kids" },
  { id: 9648, name: "Mystery" }, { id: 10763, name: "News" }, { id: 10764, name: "Reality" },
  { id: 10765, name: "Sci-Fi & Fantasy" }, { id: 10766, name: "Soap" }, { id: 10767, name: "Talk" },
  { id: 10768, name: "War & Politics" }, { id: 37, name: "Western" },
];

/** Original languages offered in Browse; the first twelve are pinned at the top. */
export const LANGUAGES: { code: string; name: string }[] = [
  { code: "en", name: "English" }, { code: "ja", name: "Japanese" }, { code: "ko", name: "Korean" }, { code: "hi", name: "Hindi" },
  { code: "es", name: "Spanish" }, { code: "fr", name: "French" }, { code: "de", name: "German" }, { code: "it", name: "Italian" },
  { code: "zh", name: "Chinese" }, { code: "ta", name: "Tamil" }, { code: "te", name: "Telugu" }, { code: "pt", name: "Portuguese" },
  { code: "ar", name: "Arabic" }, { code: "bn", name: "Bengali" }, { code: "cn", name: "Cantonese" }, { code: "cs", name: "Czech" },
  { code: "da", name: "Danish" }, { code: "nl", name: "Dutch" }, { code: "fi", name: "Finnish" }, { code: "el", name: "Greek" },
  { code: "he", name: "Hebrew" }, { code: "hu", name: "Hungarian" }, { code: "id", name: "Indonesian" }, { code: "kn", name: "Kannada" },
  { code: "ml", name: "Malayalam" }, { code: "mr", name: "Marathi" }, { code: "no", name: "Norwegian" }, { code: "fa", name: "Persian" },
  { code: "pl", name: "Polish" }, { code: "pa", name: "Punjabi" }, { code: "ro", name: "Romanian" }, { code: "ru", name: "Russian" },
  { code: "sv", name: "Swedish" }, { code: "th", name: "Thai" }, { code: "tr", name: "Turkish" }, { code: "uk", name: "Ukrainian" },
  { code: "ur", name: "Urdu" }, { code: "vi", name: "Vietnamese" },
];

/** Genre ids for TMDB genre names. */
export const genreIdsFromNames = (names: readonly string[]): number[] =>
  names.map((n) => NAME_TO_ID[n]).filter((id): id is number => id !== undefined);
