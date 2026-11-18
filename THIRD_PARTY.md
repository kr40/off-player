# Third-party software

The Off Player installer includes these programs and libraries, unmodified. Their source code is available from the links below. Rust crates and npm packages compiled into the app are listed with their licences in Settings → About (generated at build time by `scripts/gen-licenses.mjs`).

| Component | Version | Licence | Binary from | Source code |
|---|---|---|---|---|
| mpv (`libmpv-2.dll`) | v0.42.0-94-g543a8c2c5 | GPL-2.0-or-later (this build includes GPL-only parts, so it is distributed under the GPL) | [zhongfly/mpv-winbuild](https://github.com/zhongfly/mpv-winbuild/releases), via `npx tauri-plugin-libmpv-api setup-lib` | [mpv-player/mpv](https://github.com/mpv-player/mpv) at commit `543a8c2c5`; the build recipe and the versions of the libraries linked into it are in [zhongfly/mpv-winbuild](https://github.com/zhongfly/mpv-winbuild) |
| libmpv-wrapper (`libmpv-wrapper.dll`) | latest at build time | see its repository | [nini22P/libmpv-wrapper](https://github.com/nini22P/libmpv-wrapper/releases) | [nini22P/libmpv-wrapper](https://github.com/nini22P/libmpv-wrapper) |
| FFmpeg (`ffmpeg.exe`, `ffprobe.exe`, DLLs) | 9.0, LGPL shared build | LGPL-2.1-or-later | [FFmpeg-Builds](https://github.com/FFmpeg-Builds/FFmpeg-Builds) release `latest`, `ffmpeg-n9.0-latest-win64-lgpl-shared-9.0.zip`, SHA-256 `da743e1a461aa35ee3f49cf3ae9d325a1e7c59fc3d70e35a2df0243a39248040` | [ffmpeg.org](https://ffmpeg.org/download.html); build scripts in [FFmpeg-Builds](https://github.com/FFmpeg-Builds/FFmpeg-Builds) |
| tauri-plugin-libmpv | 0.3.2 | MPL-2.0 | crates.io / npm | [nini22P/tauri-plugin-libmpv](https://github.com/nini22P/tauri-plugin-libmpv) |
| rusty-chromaprint (audio fingerprints for Skip intro) | 0.3.0 | MIT | crates.io | [darksv/rusty-chromaprint](https://github.com/darksv/rusty-chromaprint) |

FFmpeg's licence text is installed next to it (`lib/ffmpeg/LICENSE.txt`).

## Data

- **TMDB**: titles, artwork, cast, ratings and availability (availability by JustWatch). This product uses the TMDB API but is not endorsed or certified by TMDB. Each user supplies their own free API key.
- **IMDb** (optional): ratings from IMDb's public data files, downloaded on the user's PC only when they turn the feature on, never bundled. Information courtesy of IMDb (https://www.imdb.com). Used with permission.

Both services allow personal, non-commercial use only.
