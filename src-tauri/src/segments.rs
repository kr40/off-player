//! Skip intro: where the intro and the end credits are in TV episodes, worked
//! out on this PC from the files' own audio. Nothing is sent anywhere.
//!
//! 1. `segment_fingerprint` decodes one region of one episode (its opening or
//!    closing minutes) with the bundled ffmpeg and turns it into a Chromaprint
//!    audio fingerprint, about eight 32-bit items a second, cached on disk.
//! 2. `segment_match` compares each episode of a season with its neighbours,
//!    finds the longest stretch of audio each pair shares (the theme music),
//!    and accepts it when at least two neighbours agree on where it is.
//!
//! Chapter names, database writes and scheduling live in TypeScript
//! (src/library/segments.ts).

use rusty_chromaprint::{Configuration, Fingerprinter};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Instant;
use tauri::{AppHandle, Runtime};

/// Chromaprint works at 11,025 Hz; ffmpeg resamples to it so the library doesn't have to.
const SAMPLE_RATE: u32 = 11_025;
const CACHE_MAGIC: &[u8; 4] = b"OPF1";

/// The same preset must be used for every fingerprint that is compared.
fn config() -> Configuration {
    Configuration::preset_test2()
}

/// Seconds of audio per fingerprint item (4096-sample frames, 2/3 overlap: ~0.124 s).
fn item_secs() -> f64 {
    config().item_duration_in_seconds() as f64
}

// ---------------------------------------------------------------------------
// Fingerprinting

/// Fingerprint raw mono s16le PCM at 11,025 Hz. Returns the items and the
/// seconds of audio read.
pub fn fingerprint_pcm<R: Read>(mut r: R) -> Result<(Vec<u32>, f64), String> {
    let cfg = config();
    let mut printer = Fingerprinter::new(&cfg);
    printer
        .start(SAMPLE_RATE, 1)
        .map_err(|_| "Could not start the fingerprinter".to_string())?;
    let mut buf = vec![0u8; 64 * 1024];
    let mut samples: Vec<i16> = Vec::with_capacity(buf.len() / 2 + 1);
    let mut carry: Option<u8> = None; // odd byte left over from the last read
    let mut total: u64 = 0;
    loop {
        let n = r.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        samples.clear();
        let mut bytes = &buf[..n];
        if let Some(lo) = carry.take() {
            samples.push(i16::from_le_bytes([lo, bytes[0]]));
            bytes = &bytes[1..];
        }
        let mut pairs = bytes.chunks_exact(2);
        for p in &mut pairs {
            samples.push(i16::from_le_bytes([p[0], p[1]]));
        }
        if let [b] = pairs.remainder() {
            carry = Some(*b);
        }
        total += samples.len() as u64;
        printer.consume(&samples);
    }
    printer.finish();
    Ok((printer.fingerprint().to_vec(), total as f64 / SAMPLE_RATE as f64))
}

/// Decode `length` seconds from `start` of the file's first audio track and fingerprint it.
fn decode_and_fingerprint(path: &Path, start: f64, length: f64) -> Result<Vec<u32>, String> {
    let mut cmd = crate::tools::command("ffmpeg");
    cmd.args(["-v", "error", "-nostdin"]);
    if start > 0.0 {
        cmd.args(["-ss", &format!("{start:.3}")]);
    }
    cmd.args(["-t", &format!("{length:.3}"), "-i"])
        .arg(path)
        .args(["-map", "0:a:0", "-vn", "-sn", "-dn", "-ac", "1", "-ar", "11025", "-f", "s16le", "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS: no console, and playback wins any contest for the CPU.
        cmd.creation_flags(0x0800_0000 | 0x0000_4000);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("ffmpeg not runnable ({e}). Is ffmpeg installed and on PATH?"))?;
    let stdout = child.stdout.take().ok_or("no ffmpeg output")?;
    let mut stderr = child.stderr.take().ok_or("no ffmpeg errors pipe")?;
    // Read errors on their own thread so a chatty ffmpeg can't fill the pipe and stall.
    let errors = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });
    let res = fingerprint_pcm(stdout);
    let status = child.wait().map_err(|e| e.to_string())?;
    let err = errors.join().unwrap_or_default();
    let (fp, secs) = res?;
    if !status.success() {
        let msg = err.trim();
        return Err(if msg.is_empty() { format!("ffmpeg failed ({status})") } else { msg.lines().last().unwrap_or(msg).to_string() });
    }
    if secs < 5.0 {
        return Err("No audio in this part of the file".into());
    }
    Ok(fp)
}

// ---------------------------------------------------------------------------
// Comparing two fingerprints

/// A stretch two fingerprints share: item offsets in each, length in items,
/// and the mean number of differing bits per item (0 = identical, ~16 = unrelated).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Run {
    pub a: usize,
    pub b: usize,
    pub len: usize,
    pub score: f64,
}

/// Hash buckets bigger than this (silence, a held note) say nothing about alignment.
const MAX_BUCKET: usize = 64;
/// Candidate alignments tried per pair.
const PEAKS: usize = 6;
/// Moving-average window over the per-item bit errors (~1.1 s).
const SMOOTH: usize = 9;
/// Smoothed differing bits (of 32) below which two items count as the same audio.
const MATCH_BITS: f64 = 10.0;
/// Mismatching items (~2 s) allowed inside one run, e.g. a sound effect over the theme.
const MAX_GAP: usize = 16;

/// The longest stretch of audio `a` and `b` share, at any alignment.
///
/// Candidate alignments come from a histogram of offsets between items whose
/// top 12 bits agree (as in Chromaprint's own matcher); unlike that matcher,
/// several alignments are tried, so a short shared logo can't hide the theme.
pub fn compare(a: &[u32], b: &[u32]) -> Option<Run> {
    if a.is_empty() || b.is_empty() {
        return None;
    }
    let mut buckets: HashMap<u32, Vec<u32>> = HashMap::new();
    for (j, &x) in b.iter().enumerate() {
        buckets.entry(x >> 20).or_default().push(j as u32);
    }
    let m = b.len();
    // hist[i - j + m] counts item pairs that suggest a[i] lines up with b[j].
    let mut hist = vec![0u32; a.len() + m];
    for (i, &x) in a.iter().enumerate() {
        if let Some(js) = buckets.get(&(x >> 20)) {
            if js.len() > MAX_BUCKET {
                continue;
            }
            for &j in js {
                hist[i + m - j as usize] += 1;
            }
        }
    }
    // Neighbouring offsets are summed: the same audio can straddle two item boundaries.
    let near = |d: usize| hist[d] + if d > 0 { hist[d - 1] } else { 0 } + hist.get(d + 1).copied().unwrap_or(0);
    let mut cands: Vec<(u32, usize)> = (0..hist.len()).map(|d| (near(d), d)).filter(|&(c, _)| c >= 6).collect();
    cands.sort_unstable_by(|x, y| y.0.cmp(&x.0).then(x.1.cmp(&y.1)));
    let mut picked: Vec<usize> = Vec::new();
    for (_, d) in cands {
        if picked.iter().all(|&p| p.abs_diff(d) > 3) {
            picked.push(d);
            if picked.len() == PEAKS {
                break;
            }
        }
    }
    let mut best: Option<Run> = None;
    for d in picked {
        for dd in [d.saturating_sub(1), d, d + 1] {
            if dd >= hist.len() {
                continue;
            }
            if let Some(r) = longest_run(a, b, dd as isize - m as isize) {
                let better = match best {
                    None => true,
                    Some(b0) => r.len > b0.len || (r.len == b0.len && r.score < b0.score),
                };
                if better {
                    best = Some(r);
                }
            }
        }
    }
    best
}

/// With `a[i]` aligned to `b[i - diff]`, the longest run of matching items.
fn longest_run(a: &[u32], b: &[u32], diff: isize) -> Option<Run> {
    let (oa, ob) = if diff >= 0 { (diff as usize, 0) } else { (0, diff.unsigned_abs()) };
    if oa >= a.len() || ob >= b.len() {
        return None;
    }
    let n = (a.len() - oa).min(b.len() - ob);
    let mut prefix = vec![0.0f64; n + 1];
    for k in 0..n {
        prefix[k + 1] = prefix[k] + (a[oa + k] ^ b[ob + k]).count_ones() as f64;
    }
    let half = SMOOTH / 2;
    let smoothed = |k: usize| {
        let lo = k.saturating_sub(half);
        let hi = (k + half + 1).min(n);
        (prefix[hi] - prefix[lo]) / (hi - lo) as f64
    };
    let mut best: Option<(usize, usize)> = None;
    let mut cur: Option<(usize, usize)> = None; // [start, end)
    let close = |c: (usize, usize), best: &mut Option<(usize, usize)>| {
        if best.map_or(true, |b| c.1 - c.0 > b.1 - b.0) {
            *best = Some(c);
        }
    };
    for k in 0..n {
        if smoothed(k) >= MATCH_BITS {
            continue;
        }
        cur = Some(match cur {
            Some((s, e)) if k - e <= MAX_GAP => (s, k + 1),
            Some(c) => {
                close(c, &mut best);
                (k, k + 1)
            }
            None => (k, k + 1),
        });
    }
    if let Some(c) = cur {
        close(c, &mut best);
    }
    let (s, e) = best?;
    Some(Run { a: oa + s, b: ob + s, len: e - s, score: (prefix[e] - prefix[s]) / (e - s) as f64 })
}

// ---------------------------------------------------------------------------
// A season: compare neighbours, accept what they agree on

/// Where a segment is, in seconds from the start of the fingerprinted region.
#[derive(Serialize, Debug, Clone, Copy, PartialEq)]
pub struct Found {
    pub start: f64,
    pub end: f64,
    /// Neighbours whose match agreed with this one, and neighbours compared.
    pub agreeing: u32,
    pub compared: u32,
}

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub min_len: f64,
    pub max_len: f64,
}
pub const INTRO: Limits = Limits { min_len: 15.0, max_len: 150.0 };
pub const CREDITS: Limits = Limits { min_len: 15.0, max_len: 300.0 };

/// Other episodes of the season each one is compared with, nearest first. Not
/// just the neighbours: a season can switch between versions of its theme
/// (MacGyver season 1), so the matching episodes may be far apart.
const COMPARE: usize = 30;
const AGREE_SECS: f64 = 3.0;
/// Two fingerprints that share more than this much of the shorter one are the same episode twice.
const DUPLICATE_SHARE: f64 = 0.8;
/// Item k describes audio around k·step + ITEM_DELAY: an item is computed
/// from a window of frames, not one frame. Measured on synthetic audio in
/// `finds_a_shared_theme_at_different_offsets`: without it, starts came out
/// 1.02–1.13 s early and ends 1.03–1.47 s early.
const ITEM_DELAY: f64 = 1.07;

enum PairResult {
    Duplicate,
    Nothing,
    Found(f64, f64),
}

/// For each episode (in order) of one season: where the shared segment is, if
/// at least two other episodes agree (or the season has only two episodes and
/// they match). `None` entries are episodes without a fingerprint.
pub fn find_segments(fps: &[Option<Vec<u32>>], lim: Limits) -> Vec<Option<Found>> {
    let n = fps.len();
    let have = fps.iter().filter(|f| f.is_some()).count();
    let step = item_secs();
    let mut runs: HashMap<(usize, usize), Option<Run>> = HashMap::new();
    let mut pair = |i: usize, j: usize| -> PairResult {
        let (lo, hi) = (i.min(j), i.max(j));
        let (Some(fa), Some(fb)) = (&fps[lo], &fps[hi]) else { return PairResult::Nothing };
        let run = *runs.entry((lo, hi)).or_insert_with(|| compare(fa, fb));
        let Some(r) = run else { return PairResult::Nothing };
        if r.len as f64 > DUPLICATE_SHARE * fa.len().min(fb.len()) as f64 {
            return PairResult::Duplicate;
        }
        let first = if i == lo { r.a } else { r.b };
        let start = first as f64 * step + ITEM_DELAY;
        let end = (first + r.len) as f64 * step + ITEM_DELAY;
        let len = end - start;
        if len < lim.min_len || len > lim.max_len {
            return PairResult::Nothing;
        }
        PairResult::Found(start, end)
    };
    (0..n)
        .map(|i| {
            fps[i].as_ref()?;
            let mut order = Vec::new();
            for k in 1..n {
                for j in [i.checked_add(k), i.checked_sub(k)].into_iter().flatten() {
                    if j < n && fps[j].is_some() && order.len() < COMPARE {
                        order.push(j);
                    }
                }
            }
            let mut compared = 0u32;
            let mut cands = Vec::new();
            for j in order {
                match pair(i, j) {
                    PairResult::Duplicate => {}
                    PairResult::Nothing => compared += 1,
                    PairResult::Found(s, e) => {
                        compared += 1;
                        cands.push((s, e));
                    }
                }
            }
            agree(&cands, compared, have)
        })
        .collect()
}

fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(|a, b| a.total_cmp(b));
    let n = v.len();
    if n % 2 == 1 { v[n / 2] } else { (v[n / 2 - 1] + v[n / 2]) / 2.0 }
}

/// Where the episodes agree the segment is. The start: of the groups of
/// candidates starting within AGREE_SECS of each other (at least two), the one
/// with the most agreeing seconds, count × length; so a full 72 s title
/// sequence a few episodes share beats an 18 s tail many share. The end:
/// within that group, the latest end that at least two candidates share, so
/// an episode with a longer cut of the intro gets its own length when other
/// episodes have that cut too.
fn agree(cands: &[(f64, f64)], compared: u32, season: usize) -> Option<Found> {
    let near = |a: f64, b: f64| (a - b).abs() <= AGREE_SECS;
    let weight = |g: &[(f64, f64)]| g.len() as f64 * median(g.iter().map(|c| c.1 - c.0).collect());
    let min = if season == 2 { 1 } else { 2 };
    let mut group: Vec<(f64, f64)> = Vec::new();
    for c in cands {
        let g: Vec<(f64, f64)> = cands.iter().copied().filter(|o| near(o.0, c.0)).collect();
        if g.len() >= min && (group.is_empty() || weight(&g) > weight(&group)) {
            group = g;
        }
    }
    if group.is_empty() {
        return None;
    }
    let support = group.len().min(2);
    let mut end_at: Option<f64> = None;
    for c in &group {
        let ends: Vec<f64> = group.iter().filter(|o| near(o.1, c.1)).map(|o| o.1).collect();
        if ends.len() >= support {
            let e = median(ends);
            if end_at.map_or(true, |x| e > x) {
                end_at = Some(e);
            }
        }
    }
    let end = end_at?;
    Some(Found { start: median(group.iter().map(|c| c.0).collect()), end, agreeing: group.len() as u32, compared })
}

// ---------------------------------------------------------------------------
// Fingerprint cache: <local app data>/fingerprints/<file fingerprint>.<region>.fp

fn cache_path<R: Runtime>(app: &AppHandle<R>, fingerprint: &str, region: &str) -> Result<PathBuf, String> {
    Ok(crate::artwork::data_dir(app, "fingerprints")?.join(format!("{fingerprint}.{region}.fp")))
}

fn write_cache(file: &Path, start: f64, length: f64, fp: &[u32]) -> Result<(), String> {
    let mut out = Vec::with_capacity(24 + fp.len() * 4);
    out.extend_from_slice(CACHE_MAGIC);
    out.extend_from_slice(&start.to_le_bytes());
    out.extend_from_slice(&length.to_le_bytes());
    out.extend_from_slice(&(fp.len() as u32).to_le_bytes());
    for x in fp {
        out.extend_from_slice(&x.to_le_bytes());
    }
    let tmp = file.with_extension("part");
    std::fs::File::create(&tmp)
        .and_then(|mut f| f.write_all(&out))
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file).map_err(|e| e.to_string())
}

/// (start, length, items) of a cached fingerprint.
fn read_cache(file: &Path) -> Option<(f64, f64, Vec<u32>)> {
    let bytes = std::fs::read(file).ok()?;
    if bytes.len() < 24 || &bytes[..4] != CACHE_MAGIC {
        return None;
    }
    let start = f64::from_le_bytes(bytes[4..12].try_into().ok()?);
    let length = f64::from_le_bytes(bytes[12..20].try_into().ok()?);
    let n = u32::from_le_bytes(bytes[20..24].try_into().ok()?) as usize;
    if bytes.len() != 24 + n * 4 {
        return None;
    }
    let fp = bytes[24..].chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
    Some((start, length, fp))
}

fn check_region(region: &str) -> Result<Limits, String> {
    match region {
        "intro" => Ok(INTRO),
        "credits" => Ok(CREDITS),
        _ => Err("Bad region".into()),
    }
}

// ---------------------------------------------------------------------------
// Commands

#[derive(Serialize)]
pub struct FpMeta {
    items: usize,
    cached: bool,
    /// Time spent decoding and fingerprinting (0 when cached).
    ms: u64,
}

/// Fingerprint `length` seconds from `start` of one file's audio, or reuse the
/// cached fingerprint made with the same bounds. With `cached_only`, never
/// read the file: an episode analysed before is only used for comparison if
/// its fingerprint is still cached (fails with "NOT_CACHED" otherwise).
#[tauri::command]
pub async fn segment_fingerprint<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    fingerprint: String,
    region: String,
    start: f64,
    length: f64,
    cached_only: Option<bool>,
) -> Result<FpMeta, String> {
    crate::artwork::check_fingerprint(&fingerprint)?;
    check_region(&region)?;
    if !(start >= 0.0) || !(length > 0.0) {
        return Err("Bad region bounds".into());
    }
    let file = cache_path(&app, &fingerprint, &region)?;
    if let Some((s0, l0, fp)) = read_cache(&file) {
        if (s0 - start).abs() < 0.05 && (l0 - length).abs() < 0.05 {
            return Ok(FpMeta { items: fp.len(), cached: true, ms: 0 });
        }
    }
    if cached_only.unwrap_or(false) {
        return Err("NOT_CACHED".into());
    }
    let src = PathBuf::from(&path);
    if !src.exists() {
        // The caller skips the season without recording a failure (drive unplugged, folder moved).
        return Err(format!("MISSING: {path}"));
    }
    let t0 = Instant::now();
    let fp = tauri::async_runtime::spawn_blocking(move || decode_and_fingerprint(&src, start, length))
        .await
        .map_err(|e| e.to_string())??;
    write_cache(&file, start, length, &fp)?;
    Ok(FpMeta { items: fp.len(), cached: false, ms: t0.elapsed().as_millis() as u64 })
}

/// Compare the cached fingerprints of one season's episodes (in episode order)
/// and return, for each, the shared segment in seconds from the region start.
#[tauri::command]
pub async fn segment_match<R: Runtime>(
    app: AppHandle<R>,
    region: String,
    fingerprints: Vec<String>,
) -> Result<Vec<Option<Found>>, String> {
    let lim = check_region(&region)?;
    let mut fps = Vec::with_capacity(fingerprints.len());
    for f in &fingerprints {
        crate::artwork::check_fingerprint(f)?;
        fps.push(read_cache(&cache_path(&app, f, &region)?).map(|c| c.2));
    }
    tauri::async_runtime::spawn_blocking(move || find_segments(&fps, lim))
        .await
        .map_err(|e| e.to_string())
}

/// Delete cached fingerprints of files no longer in the library. Returns how many went.
#[tauri::command]
pub async fn segment_cache_prune<R: Runtime>(app: AppHandle<R>, keep: Vec<String>) -> Result<usize, String> {
    let dir = crate::artwork::data_dir(&app, "fingerprints")?;
    let keep: HashSet<String> = keep.into_iter().collect();
    let mut removed = 0;
    for e in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let owner = name.split('.').next().unwrap_or("");
        if !keep.contains(owner) && std::fs::remove_file(e.path()).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// After the theme music, a title sequence often runs on for a few seconds that
/// fingerprints can't match (a "Created by" card over different audio). It
/// ends with a fade: black picture over a moment of silence. Looks for that
/// in `length` seconds from `start` and returns where the picture comes back.
#[tauri::command]
pub async fn segment_intro_tail(path: String, start: f64, length: f64) -> Result<Option<f64>, String> {
    if !(start >= 0.0) || !(length > 0.0) || length > 30.0 {
        return Err("Bad window".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        if !Path::new(&path).exists() {
            return Err(format!("MISSING: {path}"));
        }
        let mut cmd = crate::tools::command("ffmpeg");
        cmd.args(["-hide_banner", "-nostats", "-v", "info", "-nostdin", "-ss", &format!("{start:.3}"), "-t", &format!("{length:.3}"), "-i"])
            .arg(&path)
            .args([
                "-map", "0:v:0", "-map", "0:a:0",
                "-vf", "blackdetect=d=0.05:pix_th=0.12",
                "-af", "silencedetect=noise=-38dB:d=0.15",
                "-f", "null", "-",
            ]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000 | 0x0000_4000);
        }
        let out = cmd.output().map_err(|e| format!("ffmpeg not runnable ({e})"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or("ffmpeg failed").to_string());
        }
        Ok(fade_end(&String::from_utf8_lossy(&out.stderr), length).map(|t| start + t))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// From ffmpeg's blackdetect and silencedetect log (times relative to the
/// window start): the end of the first black stretch that overlaps a silence.
pub fn fade_end(log: &str, window: f64) -> Option<f64> {
    let num = |s: &str| s.trim().split(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-')).next()?.parse::<f64>().ok();
    let mut black = Vec::new();
    let mut silences = Vec::new();
    let mut open: Option<f64> = None;
    for line in log.lines() {
        if let (Some(a), Some(b)) = (line.find("black_start:"), line.find("black_end:")) {
            if let (Some(s), Some(e)) = (num(&line[a + 12..]), num(&line[b + 10..])) {
                black.push((s, e));
            }
        } else if let Some(a) = line.find("silence_start:") {
            open = num(&line[a + 14..]);
        } else if let Some(a) = line.find("silence_end:") {
            if let Some(e) = num(&line[a + 12..]) {
                // A silence that began before the window has no start line.
                silences.push((open.take().unwrap_or(0.0), e));
            }
        }
    }
    if let Some(s) = open {
        silences.push((s, window)); // still silent when the window ended
    }
    const SLACK: f64 = 0.3;
    black
        .into_iter()
        .find(|&(bs, be)| silences.iter().any(|&(ss, se)| ss <= be + SLACK && se >= bs - SLACK))
        .map(|(_, be)| be)
}

#[derive(Serialize)]
pub struct ChapterOut {
    title: Option<String>,
    start: f64,
    end: f64,
}

/// A file's chapters, read with ffprobe.
#[tauri::command]
pub async fn media_chapters(path: String) -> Result<Vec<ChapterOut>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !Path::new(&path).exists() {
            return Err(format!("MISSING: {path}"));
        }
        let mut cmd = crate::tools::command("ffprobe");
        cmd.args(["-v", "error", "-print_format", "json", "-show_chapters"]).arg(&path);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        let out = cmd.output().map_err(|e| format!("ffprobe not runnable ({e})"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        let json: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
        let num = |v: &serde_json::Value, k: &str| v.get(k).and_then(|x| x.as_str()).and_then(|x| x.parse::<f64>().ok());
        Ok(json
            .get("chapters")
            .and_then(|c| c.as_array())
            .into_iter()
            .flatten()
            .filter_map(|c| {
                Some(ChapterOut {
                    title: c.get("tags").and_then(|t| t.get("title")).and_then(|x| x.as_str()).map(String::from),
                    start: num(c, "start_time")?,
                    end: num(c, "end_time")?,
                })
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    const SR: f64 = SAMPLE_RATE as f64;

    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            // xorshift64*
            self.0 ^= self.0 >> 12;
            self.0 ^= self.0 << 25;
            self.0 ^= self.0 >> 27;
            self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
        }
        fn unit(&mut self) -> f64 {
            (self.next() >> 11) as f64 / (1u64 << 53) as f64
        }
    }

    /// Stand-in for music: three-note chords changing every 0.2–0.6 s. The same
    /// seed always gives the same samples; different seeds are unrelated.
    fn music(seed: u64, secs: f64) -> Vec<i16> {
        let mut r = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
        let n = (secs * SR) as usize;
        let mut out = Vec::with_capacity(n);
        while out.len() < n {
            let dur = ((0.2 + 0.4 * r.unit()) * SR) as usize;
            let notes: Vec<f64> = (0..3).map(|_| 440.0 * 2f64.powf(((r.next() % 36) as f64 - 21.0) / 12.0)).collect();
            for k in 0..dur {
                let t = k as f64 / SR;
                let env = ((k.min(dur - k)) as f64 / 200.0).min(1.0);
                let v: f64 = notes.iter().map(|f| (2.0 * PI * f * t).sin()).sum::<f64>() / 3.0;
                out.push((v * env * 9000.0) as i16);
            }
        }
        out.truncate(n);
        out
    }

    fn fp_of(samples: &[i16]) -> Vec<u32> {
        let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        fingerprint_pcm(&bytes[..]).unwrap().0
    }

    /// An "episode" region: its own audio, then the theme, then more of its own.
    fn episode(seed: u64, pre: f64, theme: &[i16], post: f64) -> Vec<u32> {
        fp_of(&[music(seed, pre), theme.to_vec(), music(seed + 1000, post)].concat())
    }

    #[test]
    fn pcm_reader_handles_odd_reads() {
        // A reader that returns 3 bytes at a time splits samples across reads.
        struct Drip<'a>(&'a [u8]);
        impl Read for Drip<'_> {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                let n = self.0.len().min(3).min(buf.len());
                buf[..n].copy_from_slice(&self.0[..n]);
                self.0 = &self.0[n..];
                Ok(n)
            }
        }
        let s = music(7, 20.0);
        let bytes: Vec<u8> = s.iter().flat_map(|x| x.to_le_bytes()).collect();
        let (whole, secs) = fingerprint_pcm(&bytes[..]).unwrap();
        let (dripped, _) = fingerprint_pcm(Drip(&bytes)).unwrap();
        assert!((secs - 20.0).abs() < 0.01);
        assert_eq!(whole, dripped);
    }

    #[test]
    fn finds_a_shared_theme_at_different_offsets() {
        let theme = music(42, 40.0);
        let pres = [12.3, 47.81, 95.06, 3.5];
        let fps: Vec<Option<Vec<u32>>> =
            pres.iter().enumerate().map(|(i, &p)| Some(episode(100 + i as u64, p, &theme, 160.0 - p))).collect();
        let found = find_segments(&fps, INTRO);
        for (i, f) in found.iter().enumerate() {
            let f = f.unwrap_or_else(|| panic!("episode {i}: no intro found"));
            eprintln!("episode {i}: start {:+.2} s, end {:+.2} s", f.start - pres[i], f.end - (pres[i] + 40.0));
            assert!((f.start - pres[i]).abs() <= 0.75, "episode {i} start {} vs {}", f.start, pres[i]);
            assert!((f.end - (pres[i] + 40.0)).abs() <= 0.75, "episode {i} end {} vs {}", f.end, pres[i] + 40.0);
            assert_eq!(f.agreeing, 3);
        }
    }

    #[test]
    fn theme_switch_mid_season_matches_far_episodes() {
        // Episode 0 has theme A, like episodes 4 and 5; its nearest neighbours 1–3 have theme B.
        let a = music(50, 40.0);
        let b = music(51, 40.0);
        let pres = [30.0, 12.0, 50.0, 20.0, 70.0, 5.0];
        let fps: Vec<Option<Vec<u32>>> = pres
            .iter()
            .enumerate()
            .map(|(i, &p)| Some(episode(900 + i as u64, p, if [0, 4, 5].contains(&i) { &a } else { &b }, 140.0 - p)))
            .collect();
        let found = find_segments(&fps, INTRO);
        let f0 = found[0].expect("episode 0 matched through episodes 4 and 5");
        assert!((f0.start - 30.0).abs() < 0.75 && (f0.end - 70.0).abs() < 0.75, "{f0:?}");
        assert_eq!(f0.agreeing, 2);
        assert!(found.iter().all(|f| f.is_some()));
    }

    #[test]
    fn a_longer_cut_shared_by_others_keeps_its_length() {
        // Every episode has the first 30 s of the theme; episodes 1, 3 and 5 have the 45 s cut.
        let long = music(60, 45.0);
        let short: Vec<i16> = long[..(30.0 * SR) as usize].to_vec();
        let pres = [10.0, 25.0, 40.0, 15.0, 33.0, 8.0];
        let fps: Vec<Option<Vec<u32>>> = pres
            .iter()
            .enumerate()
            .map(|(i, &p)| Some(episode(950 + i as u64, p, if i % 2 == 1 { &long } else { &short }, 140.0 - p)))
            .collect();
        let found = find_segments(&fps, INTRO);
        for (i, f) in found.iter().enumerate() {
            let f = f.unwrap();
            let want = pres[i] + if i % 2 == 1 { 45.0 } else { 30.0 };
            assert!((f.end - want).abs() < 0.75, "episode {i}: end {} want {want}", f.end);
        }
    }

    #[test]
    fn nothing_found_in_unrelated_audio() {
        let fps: Vec<Option<Vec<u32>>> = (0..3).map(|i| Some(fp_of(&music(500 + i, 120.0)))).collect();
        assert!(find_segments(&fps, INTRO).iter().all(|f| f.is_none()));
    }

    #[test]
    fn a_short_shared_sting_is_not_an_intro() {
        let sting = music(9, 10.0);
        let fps: Vec<Option<Vec<u32>>> =
            [5.0, 30.0, 61.0].iter().enumerate().map(|(i, &p)| Some(episode(600 + i as u64, p, &sting, 100.0 - p))).collect();
        assert!(find_segments(&fps, INTRO).iter().all(|f| f.is_none()));
    }

    #[test]
    fn the_same_file_twice_is_not_an_intro() {
        let x = fp_of(&music(77, 90.0));
        let found = find_segments(&[Some(x.clone()), Some(x)], INTRO);
        assert_eq!(found, vec![None, None]);
    }

    #[test]
    fn two_episode_season_needs_only_one_match() {
        let theme = music(43, 30.0);
        let fps = vec![Some(episode(700, 20.0, &theme, 60.0)), Some(episode(701, 50.0, &theme, 30.0)), None];
        let found = find_segments(&fps, INTRO);
        assert!(found[0].is_some() && found[1].is_some());
        assert!(found[2].is_none());
    }

    #[test]
    fn theme_longer_than_the_limit_is_rejected() {
        let theme = music(44, 40.0);
        let short = Limits { min_len: 15.0, max_len: 30.0 };
        let fps: Vec<Option<Vec<u32>>> =
            [10.0, 25.0, 40.0].iter().enumerate().map(|(i, &p)| Some(episode(800 + i as u64, p, &theme, 90.0 - p))).collect();
        assert!(find_segments(&fps, short).iter().all(|f| f.is_none()));
    }

    /// Measurement harness for real files, not run by default:
    ///   OFFPLAYER_SEG_LIST=<file with "path<TAB>duration" lines, one season in order>
    ///   cargo test --release --lib real_season -- --ignored --nocapture
    /// Needs ffmpeg on PATH. Prints each episode's intro and credits and the time taken.
    #[test]
    #[ignore]
    fn real_season() {
        let list = std::fs::read_to_string(std::env::var("OFFPLAYER_SEG_LIST").expect("OFFPLAYER_SEG_LIST")).unwrap();
        let eps: Vec<(String, f64)> = list
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| {
                let (p, d) = l.split_once('\t').unwrap();
                (p.to_string(), d.trim().parse().unwrap())
            })
            .collect();
        for (region, lim) in [("intro", INTRO), ("credits", CREDITS)] {
            let mut fps = Vec::new();
            let mut offsets = Vec::new();
            for (p, d) in &eps {
                let (start, len) = if region == "intro" { (0.0, d.min(600.0).min(0.3 * d)) } else {
                    let len = 300f64.min(0.2 * d);
                    (d - len, len)
                };
                let t0 = Instant::now();
                let fp = decode_and_fingerprint(Path::new(p), start, len);
                eprintln!("{region} fingerprint {:>6} ms  {}", t0.elapsed().as_millis(), p.rsplit(['\\', '/']).next().unwrap());
                fps.push(fp.ok());
                offsets.push(start);
            }
            let profile: Option<usize> = std::env::var("OFFPLAYER_SEG_PROFILE").ok().and_then(|v| v.parse().ok());
            // OFFPLAYER_SEG_EP=<index>: that episode's match against every other one.
            if let Some(i) = std::env::var("OFFPLAYER_SEG_EP").ok().and_then(|v| v.parse::<usize>().ok()) {
                for j in 0..fps.len() {
                    if let (true, Some(a), Some(b)) = (i != j, &fps[i], &fps[j]) {
                        let s = item_secs();
                        match compare(a, b) {
                            Some(r) => println!(
                                "VS\t{region}\t{i}-{j}\t{:.1}-{:.1}\t(other {:.1})\tlen {:.1}\tscore {:.1}",
                                offsets[i] + r.a as f64 * s + ITEM_DELAY, offsets[i] + (r.a + r.len) as f64 * s + ITEM_DELAY,
                                offsets[j] + r.b as f64 * s + ITEM_DELAY, r.len as f64 * s, r.score
                            ),
                            None => println!("VS\t{region}\t{i}-{j}\tnone"),
                        }
                    }
                }
            }
            for i in 0..fps.len().saturating_sub(1) {
                if let (Some(a), Some(b)) = (&fps[i], &fps[i + 1]) {
                    if let Some(r) = compare(a, b) {
                        let s = item_secs();
                        if profile == Some(i) && region == "intro" {
                            // Mean differing bits per second, from 10 s before the run to 20 s after it.
                            let from = r.a.saturating_sub((10.0 / s) as usize).max(r.a.saturating_sub(r.b));
                            let to = (r.a + r.len + (20.0 / s) as usize).min(a.len()).min(b.len() + r.a - r.b);
                            let mut line = String::new();
                            let per = (1.0 / s).round() as usize;
                            for k in (from..to).step_by(per) {
                                let n = per.min(to - k);
                                let e: u32 = (0..n).map(|d| (a[k + d] ^ b[k + d + r.b - r.a]).count_ones()).sum();
                                line.push_str(&format!("{:.0}:{:.1} ", k as f64 * s + ITEM_DELAY, e as f64 / n as f64));
                            }
                            println!("PROFILE {i}-{} {line}", i + 1);
                        }
                        println!(
                            "PAIR\t{region}\t{i}-{}\t{:.1}\t{:.1}\tlen {:.1} s\tscore {:.1}",
                            i + 1, offsets[i] + r.a as f64 * s + ITEM_DELAY, offsets[i + 1] + r.b as f64 * s + ITEM_DELAY,
                            r.len as f64 * s, r.score
                        );
                    }
                }
            }
            let t0 = Instant::now();
            let found = find_segments(&fps, lim);
            eprintln!("{region} match {} ms", t0.elapsed().as_millis());
            for (i, f) in found.iter().enumerate() {
                match f {
                    Some(f) => println!(
                        "RESULT\t{region}\t{}\t{:.2}\t{:.2}\t{}/{}",
                        i, offsets[i] + f.start, offsets[i] + f.end, f.agreeing, f.compared
                    ),
                    None => println!("RESULT\t{region}\t{i}\t-\t-\t-"),
                }
            }
        }
    }

    #[test]
    fn fade_end_needs_black_over_silence() {
        // Friends S10E4 after the music (window from 98.3 s): a fade at +6.5 s.
        let log = "[blackdetect @ 0] black_start:6.5 black_end:7.85 black_duration:1.35\n\
                   [silencedetect @ 1] silence_start: 7.03\n\
                   [silencedetect @ 1] silence_end: 7.74 | silence_duration: 0.71\n";
        assert_eq!(fade_end(log, 9.0), Some(7.85));
        // Black with no silence (a dark shot) and silence with no black (a pause): nothing.
        let dark = "[blackdetect @ 0] black_start:2 black_end:3.1 black_duration:1.1\n\
                    [silencedetect @ 1] silence_start: 5\n[silencedetect @ 1] silence_end: 5.5 | silence_duration: 0.5\n";
        assert_eq!(fade_end(dark, 9.0), None);
        // Silence already running when the window opened, black right away.
        let early = "[blackdetect @ 0] black_start:0 black_end:2 black_duration:2\n\
                     [silencedetect @ 1] silence_end: 1.87 | silence_duration: 1.9\n";
        assert_eq!(fade_end(early, 9.0), Some(2.0));
        // Silence still going at the end of the window.
        let late = "[blackdetect @ 0] black_start:8.2 black_end:9 black_duration:0.8\n[silencedetect @ 1] silence_start: 8.5\n";
        assert_eq!(fade_end(late, 9.0), Some(9.0));
    }

    #[test]
    fn cache_round_trip() {
        let dir = std::env::temp_dir().join(format!("offplayer-fp-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("abc.intro.fp");
        write_cache(&f, 1.5, 600.0, &[1, 2, 0xFFFF_FFFF]).unwrap();
        assert_eq!(read_cache(&f), Some((1.5, 600.0, vec![1, 2, 0xFFFF_FFFF])));
        std::fs::write(&f, b"OPF1short").unwrap();
        assert_eq!(read_cache(&f), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
