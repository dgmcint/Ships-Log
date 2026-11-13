# Ship's Log

A starship-style personal journal built with [Tauri 2](https://tauri.app): a Rust backend with an HTML/CSS interface. One codebase runs on **macOS, Windows, Linux, iOS and Android**.

## What's in it

- **Guide**: Settings > Guide (Ship's manual), or F1 on a computer, opens a searchable guide to every feature. The same text is in [MANUAL.md](MANUAL.md); after changing `src/help.js`, run `npm run manual` to update it.
- **Read aloud**: the reading screen's Read aloud (Computer, read) button, or R on a computer, speaks the log with the device's built-in voices. Settings > Read aloud chooses the voice and a style (Standard, Captain, Ship's computer, Narrator or Custom speed and pitch), and whether it starts with "Captain's log, stardate …".
- **Reading logs**: tap a log to read it. Edit (Amend log) is a separate button; ‹ Newer and Older › (or ← and → on a computer) step through logs.

- **Logs**: recent entries, a "Begin recording" button and a log date (a stardate-style number).
- **Dictation**: "Dictate a log" opens a new entry and starts listening; your words appear in the entry as you speak. Say "period", "comma", "question mark", "new line" or "new paragraph" for punctuation. You can type in the entry at any time, during dictation too.
- **Audio logs**: "Record audio" starts a sound recording right away; the entry screen can record more, play back and delete recordings. Audio is saved as files next to your journal.
- **Write**: opens a blank entry to type.
- **Photos & video**: "Add" on the entry screen takes a photo or video with the camera (on phones) or picks from your library or files. Tap one to view or play it full screen, or delete it.
- **Display options** (Settings): work in every skin.
  - *Text size*: Small, Normal, Large, Larger or Largest, for all the writing in the app.
  - *Dictation* (phones and tablets): App listens, or Keyboard microphone (the phone's own dictation, usually more accurate; spoken commands don't work that way).
  - *Accent color*: recolors buttons, titles and highlights.
  - *Condition colors*: Off, Subtle (the top bar changes color when your latest log is Caution or Critical) or Full (the whole app turns yellow or red).
  - *Activity readout*: a graph of your last 7 days on the Logs screen. The ring shows how many of the 7 days have a log, the line shows words written each day, and the bars show logs made each day, with today on the right.
  - *Card graphics*: a small line drawing on each log for its type.
  - *Icons instead of words*: buttons and tags show icons and colors only.
- **Ship terms** (Settings): screens and sections use ship names (Bridge, Ready Room, Science Station, Navigation, Engineering, Holo Deck, Transporter Room, Sick Bay, Yellow Alert and so on). On a computer, hovering over a ship name shows its plain meaning. Turn the setting off for plain labels everywhere.
- **Text color**: choose the color of your journal text on the entry screen, from preset colors or any color you like. "A" follows the skin.
- **Entry screen**: log type (Personal, Engineering, Medical, Science, Away mission), condition (Calm / Caution / Critical), title, entry, crew, place, and an option to hide an entry's text from search.
- **Search**: searches titles, entries, crew and places, with type filters and an "On this date" notice for past years.
- **Viewscreen**: every photo and video from all your logs in one grid. Open it from Search, or from its tile in the Glass skin.
- **On this date**: logs written on today's date in past years. Open it from Search, or from its tile in the Glass skin.
- **Crew**: everyone named in your entries, with how many logs each appears in.
- **Map**: places from your entries as markers on a stylized chart.
- **Computer layout**: on a computer (a window about 960 pixels wide or more) the app uses the whole window instead of a phone-shaped column. Menus run down the side (Glass keeps a dock at the bottom), lists and Settings spread into columns, and the home screen has a large writing field so you can start a log straight away (Ctrl or ⌘ + Enter saves it). Console has a framed panel layout with a large stardate and a striped 28-day bar; Command has a scan of the last 30 days, a time-since-last-entry box that turns red after 3 days, and dials for each log type. The window opens at 1280 × 860. Phones keep their layout.
- **Arrange mode** (Glass, Flare, Daylight, Grid on a computer): press the four-squares button at the top right of the home screen, or Settings > Arrange the home screen. Drag a panel (Status, Recent logs, the writing field, Buttons) by its name to the top, left, middle or right, or use its arrows; ✕ hides a panel. Buttons line up vertically at the sides and in a row across the top. "Reset layout" puts everything back. Each computer remembers its own layout.
- **Ship phrases**: with Ship terms on, buttons say *Make it so* (save), *Energize* (back up), *Engage* (done), *Belay that* (cancel), *Jettison* (delete) and so on; hover for the plain meaning.
- **Spoken commands** (Settings, on by default): while dictating, finish with "make it so", "engage" or "punch it" to save the entry, "belay that" or "scratch that" to take back the last words, or "stand down" / "end transmission" to stop listening. Turn it off if those phrases come up in your writing.
- **Dates** (Settings): show a stardate and the calendar date (Both), stardates only, or calendar dates only.
- **Story mode** (Settings): for using the app to tell a story. Each entry's stardate is yours to set on the entry screen, logs are listed in stardate order, a new entry carries on 0.1 after the latest stardate, and calendar dates are hidden. The real date and time each entry was written is still kept behind the scenes (for backups and the activity graphs).
- **Skins**: eleven looks, chosen in Settings under Appearance: Console, Classic, Vector, Pioneer, Flare, Daylight, Glass, Grid, Command, Holo and Archive. Grid has four backdrops to choose from: Sunset, Room, Rings and Light-line. Glass and Command have their own home screens (Glass: a grid of icon tiles; Command: a stats header and message-style log list). Glass's tint follows the Accent color setting (or turn on Clear glass for no tint). The choice is remembered.

## Where everything is saved

Entries are saved to `entries.json` in the app's data folder, with recordings in an `audio` folder and photos and video in a `media` folder beside it. Settings > "Where your log is kept" shows the exact folder.

| System | Data folder |
|---|---|
| Mac | `~/Library/Application Support/com.dgmcint.shipslog/` |
| Windows | `%APPDATA%\com.dgmcint.shipslog\` (C:\Users\<you>\AppData\Roaming\com.dgmcint.shipslog) |
| Linux | `~/.local/share/com.dgmcint.shipslog/` |
| iPhone, iPad | inside the app (backups appear in Files > Ship's Log > Backups) |
| Android | inside the app |

These are each system's standard, hidden places for app data, so the log can't be moved or deleted by accident. In Settings > "Where your log is kept":

- **Show in Finder** (File Explorer on Windows) opens the folder.
- **Move to Documents** copies the log to `Documents/Ships Log`, where it's easy to see, and the app uses it from then on (it restarts to switch). **Move back to the standard folder** reverses it. The old copy is left in place with a `MOVED.txt` note and can be deleted. If Documents is synced (iCloud Drive, OneDrive), the log is synced too; don't use the app on two computers with the same synced log at once. On a Mac, macOS may ask once whether Ship's Log can use Documents; choose Allow.

### Portable mode

If a folder named **`Ships Log Data`** sits right next to the app (next to `Ships Log.exe` on Windows, the `.AppImage` on Linux, or `Ship's Log.app` on a Mac), the app keeps everything in that folder instead, so the app and its log can travel together on a USB drive. Settings > Make portable copies your current log into that folder; the app then restarts to use it. The GitHub release includes a ready-made portable Windows zip. On a Mac, macOS may run an app from a download or disk image in a hidden temporary location; move it into its folder (or onto the drive) first so it finds `Ships Log Data`.

## Browser version

The same app also runs in a web browser, with nothing to install: https://dgmcint.github.io/Ships-Log/ (published from `src/` by `.github/workflows/pages.yml` on every push to main; turn it on once in the repository's Settings > Pages > Source: GitHub Actions).

- Logs, recordings, photos and video are kept in the browser's own storage (`src/web.js`), so they survive reloads. Backups are the same `.zip` files the installed app makes, so a backup moves freely between the browser, the Mac and the phone.
- On an iPhone, open the address in Safari, tap Share, then Add to Home Screen. It then opens full screen like an app and works offline (`src/sw.js`, `src/manifest.webmanifest`).
- Browser storage belongs to that one browser on that one device; clearing the browser's website data erases it. Back up regularly.
- `src/vendor/fflate.js` (MIT) makes and opens the backup zips.

## Microphone permission

Each system has to be told the app uses the microphone. Most of this is already in place:

- **macOS**: `src-tauri/Info.plist` (the message shown when asking) and `src-tauri/Entitlements.plist` are included.
- **iOS**: `src-tauri/Info.ios.plist` is included. If the app doesn't ask for the microphone, open `src-tauri/gen/apple/` in Xcode after `ios init` and add *Privacy – Microphone Usage Description* to the iOS target's Info.
- **Android**: after `npm run tauri android init`, open `src-tauri/gen/android/app/src/main/AndroidManifest.xml` and add these two lines just above `<application`:
  ```xml
  <uses-permission android:name="android.permission.RECORD_AUDIO" />
  <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
  ```
- **Windows**: nothing to add; Windows asks the first time.
- **Linux**: recording depends on the system's WebKitGTK build and may not be available on every distribution.

Recordings are saved in the format each system's web view produces: `.m4a` on Apple devices, `.webm` on Windows, Android and Linux.

## Project layout

```
src/                  the interface (no build step)
  index.html
  skins.css           one block of variables per skin
  styles.css          layout and components; reads the skin variables
  app.js              screens and logic
  help.js             the in-app guide (also used to make MANUAL.md)
  voice.js            reading logs aloud
src-tauri/
  src/lib.rs          Rust: load/save/search/delete entries
  src/main.rs         desktop entry point
  tauri.conf.json     app name, window size, bundle settings
  icons/              app icons (regenerate with: npx tauri icon app-icon.png)
```

## Quick preview (no build)

Open `src/index.html` in a browser. It works the same, but saves to the browser instead of to a file.

## Set up once

1. Install Rust: https://rustup.rs
2. Install Node.js (LTS): https://nodejs.org
3. In this folder run: `npm install`

Then add what your platform needs.

| Building for | You need |
|---|---|
| macOS | Xcode Command Line Tools: `xcode-select --install` |
| iOS | A Mac with full Xcode, then `rustup target add aarch64-apple-ios aarch64-apple-ios-sim` |
| Android | Android Studio with the SDK and NDK, `JAVA_HOME`, `ANDROID_HOME`, `NDK_HOME` set, then `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android` |
| Windows | Microsoft C++ Build Tools and WebView2 (already on Windows 10/11) |
| Linux | `sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev librsvg2-dev` (Debian/Ubuntu) |

Tauri's own guide has full details: https://v2.tauri.app/start/prerequisites/

## Run and build

```bash
npm run dev            # run on this computer, with live reload
npm run build          # make an installer for this computer

npm run tauri ios init       # once, creates the Xcode project
npm run ios                  # run in the iOS Simulator or on a plugged-in iPhone

npm run tauri android init   # once, creates the Android project
npm run android              # run in the emulator or on a plugged-in phone
```

Each desktop installer has to be built on its own system (Mac on a Mac, Windows on Windows, Linux on Linux). GitHub Actions can build all three for you; see https://v2.tauri.app/distribute/pipelines/github/

Putting the app on a real iPhone needs a free Apple ID signed into Xcode; the App Store needs a paid Apple Developer account.

## Adding a skin

1. In `src/skins.css`, copy one `:root[data-skin="..."]` block, rename it and change the values.
2. In `src/app.js`, add a line to `SKINS`: the name, a one-line description, and three preview colors.
3. For shapes that differ from the default (bars, cards, buttons), add rules for `:root[data-skin="yourname"]` in `src/styles.css`.

## Notes

- On Windows the app is named "Ships Log", without the apostrophe (`src-tauri/tauri.windows.conf.json`). The Windows installer builder fails on an apostrophe in the app name. The window title still reads "Ship's Log".

- Fonts load from Google Fonts. Offline, the app falls back to system fonts. To work fully offline, download the fonts into `src/fonts/` and reference them from `styles.css`.
- Dictation uses the system's speech recognition inside the app on Mac, iPhone and iPad (the app asks once for speech and microphone access). Where the app's web view has none (Android, Windows, Linux), the Dictate button explains the system's own dictation instead: the keyboard microphone on phones, Windows + H on Windows. Both type straight into the entry.
- Audio recordings are kept as sound; turning them into text would be a later addition.

## Backup and restore

Open Settings with the gear button on the Logs screen.

- **Back up now** (*Energize*) saves one `.zip` with every log, recording, photo, video and your settings. On a computer you choose where it goes; on a phone it is saved to the app's Documents folder (Files app > Ship's Log > Backups).
- **Restore from a backup** replaces the log on this device with the one in a backup file. The log it replaces is kept in a `before-restore` folder inside the app's data folder.
- **Automatic backup** (computers): choose a folder and Daily, Weekly or Monthly. The 10 newest automatic backups are kept.
- The Logs screen shows a reminder when the last backup is more than two weeks old.

## Install files (Mac, Windows, Linux)

Each system gets one file:

| System | File | How it's used |
|---|---|---|
| Mac | `Ship's Log_<version>_universal.dmg` | Open, drag to Applications. Works on Apple Silicon and Intel. |
| Windows | `Ships Log_<version>_x64-setup.exe` | Run it. No administrator rights needed. |
| Linux | `Ship's Log_<version>_amd64.AppImage` | `chmod +x` and run. Nothing to install. |
| Windows, portable | `Ships-Log-<version>-windows-portable.zip` | Unzip anywhere (a USB drive works) and run `Ships Log.exe`. The log stays in the `Ships Log Data` folder beside it. |

**Built by GitHub:** `.github/workflows/release.yml` builds all three. Push a version tag and GitHub attaches the files to a draft release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

**Built on your own computer:** `npm run build` makes the file for the system you're on, in `src-tauri/target/release/bundle/`. For the universal Mac file: `rustup target add aarch64-apple-darwin x86_64-apple-darwin`, then `npm run tauri build -- --target universal-apple-darwin`. On Linux the AppImage build also needs `patchelf`.

### What must be in the GitHub repository

```
.github/workflows/release.yml   (hidden folder: starts with a dot)
.gitignore
package.json
package-lock.json
README.md
app-icon.png
src/                index.html, app.js, styles.css, skins.css, logo.png, fonts/
src-tauri/
  Cargo.toml
  Cargo.lock
  build.rs
  tauri.conf.json
  Info.plist
  Info.ios.plist
  Entitlements.plist
  capabilities/default.json
  icons/            all of it
  src/              main.rs, lib.rs, backup.rs
```

Leave out `node_modules/` and `src-tauri/target/`; they are rebuilt each time.

## Photos and video

- Photos keep their original file. When the original isn't a JPEG, or is larger than 2048 pixels on its longest side, a JPEG copy is made for display, so iPhone HEIC photos still show on Windows, Android and Linux. Every photo and video also gets a small preview image.
- Videos keep their original file. Phones already record H.264 MP4, which plays everywhere.
- **On a computer with FFmpeg installed**, any other video (for example WebM, HEVC, or anything larger than 1080p) also gets an H.264 MP4 copy at up to 1080p for playback. Install FFmpeg with `brew install ffmpeg` (Mac), `winget install ffmpeg` (Windows) or your package manager (Linux). Without FFmpeg, videos are kept and played as they are.
- Videos longer than 5 minutes show how much space they use.
- Files are saved in pieces, so long videos don't need to fit in memory all at once.
- Photos and videos are stored in a `media` folder beside `entries.json`.
- In the browser preview, recordings only last until the page is reloaded.
- "Hide from search" keeps an entry's text out of search results. It is not encryption yet.
