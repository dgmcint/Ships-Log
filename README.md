# Ship's Log

A starship-style personal journal built with [Tauri 2](https://tauri.app): a Rust backend with an HTML/CSS interface. One codebase runs on **macOS, Windows, Linux, iOS and Android**.

## What's in it

- **Logs**: recent entries, a "Begin recording" button and a log date (a stardate-style number).
- **Audio logs**: "Begin recording" starts recording right away; the entry screen can record more, play back and delete recordings. Audio is saved as files next to your journal.
- **Entry screen**: log type (Personal, Engineering, Medical, Science, Away mission), condition (Calm / Caution / Critical), title, entry, crew, place, and an option to hide an entry's text from search.
- **Search**: searches titles, entries, crew and places, with type filters and an "On this date" notice for past years.
- **Crew**: everyone named in your entries, with how many logs each appears in.
- **Map**: places from your entries as markers on a stylized chart.
- **Skins**: Console, Holo and Archive. The choice is remembered.

Entries are saved by the Rust backend to `entries.json` in the app's data folder, with recordings in an `audio` folder beside it (on a Mac: `~/Library/Application Support/com.dgmcint.shipslog/`).

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
2. In `src/app.js`, add `["yourname", "Your Name"]` to `SKINS`.

## Notes

- Fonts load from Google Fonts. Offline, the app falls back to system fonts. To work fully offline, download the fonts into `src/fonts/` and reference them from `styles.css`.
- Dictation (speech to text) uses the microphone on the phone's keyboard. Audio recordings are kept as sound; turning them into text would be a later addition.
- In the browser preview, recordings only last until the page is reloaded.
- "Hide from search" keeps an entry's text out of search results. It is not encryption yet.
