//! IMDb ratings from IMDb's public data files (https://datasets.imdbws.com/),
//! which IMDb provides for personal, non-commercial use. Downloaded on this PC
//! only when the user turns the feature on; never bundled or redistributed.
//!
//! The files are streamed and decompressed on the fly, so nothing large is
//! written to disk. Kept titles (movies and series with enough votes) are sent
//! to the front end in batches over a channel; the front end writes them to
//! SQLite (the SQL plugin owns the database connection).

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::ipc::Channel;

const HOST: &str = "https://datasets.imdbws.com";
/// Titles with fewer votes are skipped (new releases pass this within days).
const MIN_VOTES: u32 = 250;
/// Votes at which a title's own rating counts as much as the average.
const WEIGHT_M: f64 = 25_000.0;
const BATCH: usize = 2_000;

static CANCEL: AtomicBool = AtomicBool::new(false);
static RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Row {
    pub tconst: String,
    pub kind: &'static str,
    pub title: String,
    pub year: Option<u16>,
    pub runtime: Option<u16>,
    pub genres: String,
    pub rating: f32,
    pub votes: u32,
    pub weighted: f32,
}

#[derive(Serialize, Clone)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum ImdbEvent {
    /// Download progress: `file` is "ratings" or "titles"; bytes are compressed bytes.
    Progress { file: &'static str, done: u64, total: u64 },
    Batch { rows: Vec<Row> },
    Done { count: usize },
}

/// Ask a running import to stop at the next chunk.
#[tauri::command]
pub fn imdb_cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// Download, filter and stream IMDb ratings to the front end.
#[tauri::command]
pub async fn imdb_sync(on_event: Channel<ImdbEvent>) -> Result<usize, String> {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Err("An IMDb update is already running".into());
    }
    CANCEL.store(false, Ordering::SeqCst);
    let res = tauri::async_runtime::spawn_blocking(move || sync_blocking(&on_event))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    RUNNING.store(false, Ordering::SeqCst);
    res
}

fn cancelled() -> Result<(), String> {
    if CANCEL.load(Ordering::SeqCst) { Err("Cancelled".into()) } else { Ok(()) }
}

/// Counts compressed bytes as they are read, for progress.
struct Counting<R: Read, F: FnMut(u64)> {
    inner: R,
    done: u64,
    last: u64,
    report: F,
}
impl<R: Read, F: FnMut(u64)> Read for Counting<R, F> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.done += n as u64;
        if self.done - self.last > 1 << 20 || n == 0 {
            self.last = self.done;
            (self.report)(self.done);
        }
        Ok(n)
    }
}

fn open(file: &str) -> Result<(reqwest::blocking::Response, u64), String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("OffPlayer/2.0")
        .timeout(std::time::Duration::from_secs(900))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .get(format!("{HOST}/{file}"))
        .send()
        .map_err(|e| format!("IMDb data unreachable: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("IMDb data: HTTP {}", res.status().as_u16()));
    }
    let total = res.content_length().unwrap_or(0);
    Ok((res, total))
}

fn sync_blocking(ch: &Channel<ImdbEvent>) -> Result<usize, String> {
    // 1. Ratings (small): keep titles with enough votes.
    let (res, total) = open("title.ratings.tsv.gz")?;
    let reader = Counting {
        inner: res,
        done: 0,
        last: 0,
        report: |done| {
            let _ = ch.send(ImdbEvent::Progress { file: "ratings", done, total });
        },
    };
    let ratings = parse_ratings(BufReader::new(flate2::read::MultiGzDecoder::new(reader)))?;

    // 2. Titles (large): keep movies and series that have a kept rating.
    let (res, total) = open("title.basics.tsv.gz")?;
    let reader = Counting {
        inner: res,
        done: 0,
        last: 0,
        report: |done| {
            let _ = ch.send(ImdbEvent::Progress { file: "titles", done, total });
        },
    };
    let mut rows = parse_basics(BufReader::new(flate2::read::MultiGzDecoder::new(reader)), &ratings)?;
    weigh(&mut rows);

    let count = rows.len();
    for chunk in rows.chunks(BATCH) {
        cancelled()?;
        ch.send(ImdbEvent::Batch { rows: chunk.to_vec() }).map_err(|e| e.to_string())?;
    }
    let _ = ch.send(ImdbEvent::Done { count });
    Ok(count)
}

/// tconst "tt0111161" → 111161.
fn tnum(s: &str) -> Option<u32> {
    s.strip_prefix("tt")?.parse().ok()
}

pub fn parse_ratings(r: impl BufRead) -> Result<HashMap<u32, (f32, u32)>, String> {
    let mut map = HashMap::with_capacity(400_000);
    for (i, line) in r.lines().enumerate() {
        if i % 200_000 == 0 {
            cancelled()?;
        }
        let line = line.map_err(|e| e.to_string())?;
        if i == 0 {
            continue; // header
        }
        let mut f = line.split('\t');
        let (Some(id), Some(rating), Some(votes)) = (f.next(), f.next(), f.next()) else { continue };
        let (Some(id), Ok(rating), Ok(votes)) = (tnum(id), rating.parse::<f32>(), votes.parse::<u32>()) else { continue };
        if votes >= MIN_VOTES {
            map.insert(id, (rating, votes));
        }
    }
    Ok(map)
}

fn field(s: &str) -> Option<&str> {
    if s == "\\N" || s.is_empty() { None } else { Some(s) }
}

pub fn parse_basics(r: impl BufRead, ratings: &HashMap<u32, (f32, u32)>) -> Result<Vec<Row>, String> {
    let mut rows = Vec::with_capacity(ratings.len());
    for (i, line) in r.lines().enumerate() {
        if i % 200_000 == 0 {
            cancelled()?;
        }
        let line = line.map_err(|e| e.to_string())?;
        if i == 0 {
            continue;
        }
        // tconst, titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres
        let f: Vec<&str> = line.split('\t').collect();
        if f.len() < 9 {
            continue;
        }
        let Some(&(rating, votes)) = tnum(f[0]).and_then(|n| ratings.get(&n)) else { continue };
        let kind = match f[1] {
            "movie" | "tvMovie" => "movie",
            "tvSeries" | "tvMiniSeries" => "series",
            _ => continue,
        };
        if f[4] == "1" {
            continue;
        }
        rows.push(Row {
            tconst: f[0].to_string(),
            kind,
            title: f[2].to_string(),
            year: field(f[5]).and_then(|y| y.parse().ok()),
            runtime: field(f[7]).and_then(|y| y.parse().ok()),
            genres: field(f[8]).unwrap_or("").to_string(),
            rating,
            votes,
            weighted: 0.0,
        });
    }
    Ok(rows)
}

/// Weighted rating, per kind: WR = v/(v+m)·R + m/(v+m)·C, C = mean rating of that kind.
pub fn weigh(rows: &mut [Row]) {
    let mut sum: HashMap<&'static str, (f64, f64)> = HashMap::new();
    for r in rows.iter() {
        let e = sum.entry(r.kind).or_insert((0.0, 0.0));
        e.0 += r.rating as f64;
        e.1 += 1.0;
    }
    for r in rows.iter_mut() {
        let (s, n) = sum[r.kind];
        let c = s / n;
        let v = r.votes as f64;
        r.weighted = ((v / (v + WEIGHT_M)) * r.rating as f64 + (WEIGHT_M / (v + WEIGHT_M)) * c) as f32;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATINGS: &str = "tconst\taverageRating\tnumVotes\n\
tt0111161\t9.3\t3000000\n\
tt0000001\t5.7\t2100\n\
tt0000002\t8.0\t12\n\
tt0903747\t9.5\t2400000\n\
tt0000009\t7.0\t5000\n";

    const BASICS: &str = "tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres\n\
tt0111161\tmovie\tThe Shawshank Redemption\tThe Shawshank Redemption\t0\t1994\t\\N\t142\tDrama\n\
tt0000001\tshort\tCarmencita\tCarmencita\t0\t1894\t\\N\t1\tDocumentary,Short\n\
tt0000002\tmovie\tFew Votes\tFew Votes\t0\t1999\t\\N\t\\N\tDrama\n\
tt0903747\ttvSeries\tBreaking Bad\tBreaking Bad\t0\t2008\t2013\t49\tCrime,Drama,Thriller\n\
tt0000009\tmovie\tAdult\tAdult\t1\t2000\t\\N\t90\t\\N\n";

    #[test]
    fn parses_filters_and_weighs() {
        let ratings = parse_ratings(RATINGS.as_bytes()).unwrap();
        assert!(ratings.contains_key(&111161));
        assert!(!ratings.contains_key(&2), "below the vote floor");
        let mut rows = parse_basics(BASICS.as_bytes(), &ratings).unwrap();
        let ids: Vec<_> = rows.iter().map(|r| r.tconst.as_str()).collect();
        assert_eq!(ids, ["tt0111161", "tt0903747"], "shorts, low-vote and adult titles dropped");
        assert_eq!(rows[0].kind, "movie");
        assert_eq!(rows[0].runtime, Some(142));
        assert_eq!(rows[1].kind, "series");
        assert_eq!(rows[1].genres, "Crime,Drama,Thriller");
        weigh(&mut rows);
        // One title per kind: C equals its own rating, so WR equals R.
        assert!((rows[0].weighted - 9.3).abs() < 1e-4);
    }

    #[test]
    fn weighted_pulls_low_vote_titles_to_the_mean() {
        let mk = |id: &str, rating: f32, votes: u32| Row {
            tconst: id.into(), kind: "movie", title: id.into(), year: None, runtime: None,
            genres: String::new(), rating, votes, weighted: 0.0,
        };
        let mut rows = vec![mk("a", 9.0, 2_000_000), mk("b", 9.6, 1_500), mk("c", 6.0, 100_000)];
        weigh(&mut rows);
        assert!(rows[0].weighted > rows[1].weighted, "a well-known 9.0 beats an obscure 9.6");
        assert!(rows[1].weighted < 9.6 && rows[1].weighted > 7.0);
    }
}
