# Installing Off Player

Off Player is a free, open-source Windows app (GPL-3.0) for watching the shows and movies on your PC, and for finding what to watch next. Download the installer from https://github.com/kr40/off-player/releases/latest.

## 1. Run the installer

Double-click `Off-Player_1.0.0_x64-setup.exe`. It installs for your Windows account only, so it doesn't need administrator rights.

**"Windows protected your PC".** The installer isn't signed with a paid certificate, so Windows SmartScreen shows a blue warning the first time. Click **More info**, then **Run anyway**.

If your PC doesn't have Microsoft Edge WebView2 (almost every Windows 10 and 11 PC does), the installer downloads it for you.

## 2. First launch

A short set-up walks you through:

1. **Your library.** Pick a folder of shows or movies. Off Player reads seasons and episodes from the file names. You can skip this and add folders later.
2. **A free TMDB key.** Posters, episode names, Discover, Top Lists and Collections come from TMDB, a free film and TV database.
   1. Create an account at <https://www.themoviedb.org/signup>.
   2. Go to **Settings → API** (<https://www.themoviedb.org/settings/api>) and ask for a developer key for personal use.
   3. Copy the **API Key** or the **API Read Access Token** and paste it into Off Player.

   Without a key your library still plays; it just has no artwork, and Discover stays empty.
3. **IMDb ratings (optional).** Off Player can download IMDb's public rating files, about 240 MB once and then weekly, to show IMDb ratings and rank Top Lists by them.
4. **What have you watched?** Pick a few titles you've seen to get suggestions straight away.

You can run set-up again any time from **Settings → General**.

## What's included

Playback (mpv) and thumbnails (FFmpeg) are built in. You don't need to install anything else.

**Skip intro.** After you add a folder, Off Player works through your TV shows in the background ("Finding intros" in the top bar), comparing the theme music across each season's episodes. It reads one file at a time and pauses while you watch. A **Skip intro** button then appears during the title sequence (or press **S**). Shows without a recurring title sequence get no button. Turn on automatic skipping, or turn the whole feature off, in **Settings → Playback**; fix a wrong marker from the gear menu in the player.

## Your data and privacy

- No account is needed, and nothing about what you own or watch leaves your PC. Intros are found on your PC; nothing is uploaded.
- Off Player only contacts `api.themoviedb.org` and `image.tmdb.org`, plus `datasets.imdbws.com` if you turn on IMDb ratings.
- Your watch history, lists and settings are stored in `%APPDATA%\com.offplayer.app`. A copy is saved automatically before every update, in its `backups` folder.
- **Settings → Data & privacy** can export everything to one file and import it again, for example on a new PC.

## Terms

Off Player uses the TMDB API but is not endorsed or certified by TMDB. IMDb information is used with permission, courtesy of IMDb (<https://www.imdb.com>). Both allow personal, non-commercial use only, so Off Player is free and must stay free.
