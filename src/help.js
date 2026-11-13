/*
  Ship's Log guide: the Help screen inside the app.
  Each section is a title and a list of blocks: a string is a paragraph,
  an array is a bulleted list, and {keys: [...]} is a two-column table.
  MANUAL.md in the project is made from this same text (npm run manual).
*/

const HELP = [
  {
    id: "start", title: "Getting started",
    body: [
      "Ship's Log is a personal journal styled like a starship's log. Everything you write stays on your device unless you back it up somewhere yourself.",
      "There are three ways to start a log:",
      [
        "Dictate: speak your entry and the words appear as you talk.",
        "Record: keep your voice as an audio recording on the entry.",
        "Write: type the entry.",
      ],
      "You can mix all three in one entry: dictate a few lines, type a correction, add a recording and a photo.",
      "On a computer, the home screen also has a writing box, so you can start typing straight away. Make it so (Save) saves it as a Personal log; More opens the full entry screen with what you've typed so you can set the log type, alert status, crew, place, photos and video. Ctrl + Enter (⌘ + Enter on a Mac) also saves.",
    ],
  },
  {
    id: "entry", title: "The entry screen (Ready Room)",
    body: [
      "This is where you write or change a log.",
      [
        "Log type: Personal, Engineering, Medical (Sick Bay), Science (Science Station) or Away mission. It sets the tag and color on the log.",
        "Alert status: Calm (Condition Green), Caution (Yellow Alert) or Critical (Red Alert). Use it for how the day went.",
        "Title and Entry: the entry box grows as you write. Choose the text color under Text color; \"A\" follows the skin.",
        "Photos & video (Viewscreen), Recordings (Communications), Crew and Place are further down.",
        "Hide from search keeps the entry's text out of search results. It is not encryption.",
      ],
      "Save with Make it so at the top right, or Ctrl/⌘ + Enter. The back arrow leaves without saving new changes. Delete (Jettison) is at the bottom; tap it twice to confirm.",
    ],
  },
  {
    id: "read", title: "Reading and editing logs",
    body: [
      "Tap any log to open it for reading. Nothing can be changed by accident on the reading screen.",
      [
        "Edit (Amend log) at the top right opens the entry screen. When you save or go back, you return to the log you were reading.",
        "‹ Newer and Older › step through your logs without going back to the list.",
        "Tap a photo or video to see it full screen; press play on a recording to listen.",
        "On a computer: ← and → step through logs, E opens Edit.",
      ],
    ],
  },
  {
    id: "voice", title: "Reading logs aloud",
    body: [
      "On the reading screen, Read aloud (Computer, read) speaks the log with one of the voices built into your device. Press it again, or Stop, to stop. On a computer, R does the same.",
      "Settings > Read aloud (Computer voice) chooses how it sounds:",
      [
        "Voice: any voice your system has. On a Mac, iPhone and Windows you can download more natural \"enhanced\" or \"premium\" voices in the system's speech settings.",
        "Style: Standard, Captain (deeper and measured), Ship's computer (crisp and quick), Narrator (unhurried), or Custom with your own speed and pitch.",
        "Announce the log: starts with \"Captain's log, stardate …\". Stardates are read digit by digit.",
        "Hear a sample plays a short test.",
      ],
      "Voices come from your device, so they differ between Mac, iPhone, Windows and Android. Some Linux systems have none; the button doesn't appear there.",
    ],
  },
  {
    id: "dictate", title: "Dictation and spoken commands",
    body: [
      "Dictate a log opens a new entry and starts listening. Your words appear in the entry as you speak, and you can type at the same time. Tap Stop (Stand down) to finish.",
      "Say these for punctuation: \"period\", \"comma\", \"question mark\", \"new line\", \"new paragraph\".",
      "Spoken commands work at the end of what you say:",
      { keys: [
        ["\"Make it so\", \"Engage\", \"Punch it\"", "Save the entry"],
        ["\"Belay that\", \"Scratch that\"", "Take back the last words"],
        ["\"Stand down\", \"End transmission\"", "Stop listening"],
      ] },
      "If you'd say one of these phrases at the end of a real sentence, turn off Spoken commands in Settings > Display options.",
      "Where the app can listen itself: Mac, iPhone and iPad (the app asks once for microphone and speech access). On Windows, Android and Linux, the Dictate button shows how to use the system's own dictation instead: Windows + H on Windows, the microphone on the keyboard on phones. It types straight into the entry.",
    ],
  },
  {
    id: "record", title: "Audio recordings",
    body: [
      "Record audio starts a recording right away. On the entry screen, Record adds more recordings; each one can be played back or deleted.",
      "Recordings are kept as sound files beside your log (.m4a on Apple devices, .webm elsewhere). Turning recordings into text is not available yet; use Dictate for that.",
    ],
  },
  {
    id: "media", title: "Photos and video (Viewscreen)",
    body: [
      "On the entry screen, Add takes a photo or video with the camera (on phones) or picks from your library or files. Tap one to view it full screen or delete it.",
      [
        "Photos keep their original file; a JPEG copy is made for display when needed, so iPhone photos show everywhere.",
        "Videos keep their original file. On a computer with FFmpeg installed, other video formats also get an MP4 copy at up to 1080p for playback.",
        "Videos longer than 5 minutes show how much space they use.",
      ],
      "The Viewscreen shows every photo and video from all your logs in one grid. Open it from Search, or from its tile in the Glass skin.",
    ],
  },
  {
    id: "find", title: "Search, On this date, Crew and Map",
    body: [
      [
        "Search (Science Station) looks through titles, entries, crew and places. The type buttons narrow it to one log type.",
        "On this date shows logs written on today's date in past years. Open it from Search, or from its tile in Glass.",
        "Crew (Crew Manifest) lists everyone named in your entries and how many logs each appears in.",
        "Map (Navigation) shows the places from your entries as markers on a chart.",
      ],
    ],
  },
  {
    id: "skins", title: "Skins and display options",
    body: [
      "Settings > Appearance (Holo Deck) changes the look. Your logs are the same in every skin.",
      { keys: [
        ["Console", "Gold, orange and lavender blocks with rounded frames"],
        ["Classic", "1960s bridge: square panels, grid lines, colored lights"],
        ["Vector", "Film-era amber and green line readouts"],
        ["Pioneer", "Boxy steel panels with push buttons"],
        ["Flare", "Frosted glass lit with fluorescent colors"],
        ["Daylight", "The one light skin: white and blue glass"],
        ["Glass", "Tinted glass tiles, like a phone home screen"],
        ["Grid", "Neon grid worlds: Sunset, Room, Rings or Light-line backdrops"],
        ["Command", "Steel-blue panels with stats, a 30-day scan and a message-style list"],
        ["Holo", "Glowing cyan outlines"],
        ["Archive", "Navy, gold and silver library computer"],
      ] },
      "Display options (Main Helm) work in every skin:",
      [
        "Accent color: recolors buttons, titles and highlights.",
        "Condition colors: Off, Subtle (the top bar changes color when your latest log is Caution or Critical) or Full (the whole app turns yellow or red).",
        "Activity readout (Ship's Status): your last 7 days. The ring shows how many days have a log, the line shows words written each day, the bars show logs per day.",
        "Card graphics: a small line drawing on each log for its type.",
        "Icons instead of words: buttons and tags show icons only.",
        "Ship terms: ship names for screens and buttons. Turn it off for plain labels everywhere. On a computer, hover over a ship name to see its plain meaning.",
      ],
    ],
  },
  {
    id: "computer", title: "On a computer: layout and Arrange mode",
    body: [
      "When the window is wide (about 960 pixels or more), the app uses the whole window: the menu runs down the side (Glass keeps a dock at the bottom), lists and Settings spread into columns, and Console and Command get their own panel layouts. Make the window narrow and you get the phone layout.",
      "In Glass, Flare, Daylight and Grid you can arrange the home screen:",
      [
        "Press the four-squares button at the top right of the home screen, or Settings > Arrange the home screen.",
        "Drag a panel by its name (Status, Recent logs, the writing box, Buttons) to the top, left, middle or right, or use its arrows.",
        "✕ hides a panel; it appears in the bar at the top so you can bring it back.",
        "Reset layout puts everything back. Press Done (Engage) when finished.",
      ],
      "Each computer remembers its own layout.",
    ],
  },
  {
    id: "dates", title: "Stardates, dates and Story mode",
    body: [
      "Every log has a stardate, a number made from the date: (year − 1946) × 1000, plus how far through the year it is × 1000. So the start of 2026 is 80000.0 and mid-year is about 80500.0.",
      "Settings > Display options > Dates chooses what you see: Both (stardate and calendar date), Stardate only, or Calendar only.",
      "Story mode is for using the app to tell a story:",
      [
        "On the entry screen the stardate becomes a box you can type into.",
        "Logs are listed in stardate order instead of the order you wrote them.",
        "A new entry carries on 0.1 after your latest stardate.",
        "Calendar dates are hidden. The real time each log was written is still kept, for backups and the activity graphs.",
      ],
    ],
  },
  {
    id: "backup", title: "Backup and restore (Transporter Room)",
    body: [
      [
        "Back up now (Energize) saves one .zip file with every log, recording, photo, video and your settings. On a computer you choose where it goes; on a phone it is saved to Files > Ship's Log > Backups.",
        "Automatic backup (computers): choose a folder and Daily, Weekly or Monthly. The 10 newest automatic backups are kept. A synced folder (iCloud Drive, Dropbox, OneDrive) or another drive is best.",
        "Restore from a backup (Beam in a backup) replaces the log on this device with the one in a backup file. The log it replaces is kept in a before-restore folder, just in case.",
      ],
      "The home screen reminds you when your last backup is more than two weeks old. To move your log to a new device, back up on the old one and restore on the new one.",
    ],
  },
  {
    id: "where", title: "Where your log is kept",
    body: [
      "Settings > Where your log is kept (Ship's computer core) shows the folder. Everything is in one folder: entries.json, an audio folder and a media folder.",
      { keys: [
        ["Mac", "~/Library/Application Support/com.dgmcint.shipslog"],
        ["Windows", "C:\\Users\\<you>\\AppData\\Roaming\\com.dgmcint.shipslog"],
        ["Linux", "~/.local/share/com.dgmcint.shipslog"],
        ["iPhone, iPad, Android", "Inside the app"],
      ] },
      "These are hidden on purpose, so the log can't be moved or deleted by accident. On a computer:",
      [
        "Show in Finder (File Explorer on Windows) opens the folder.",
        "Move to Documents copies the log to Documents/Ships Log and uses it from then on (press Restart now). Move back to the standard folder reverses it. The old copy is left with a MOVED.txt note and can be deleted afterward.",
        "If Documents is synced (iCloud Drive, OneDrive), the log is synced too. Don't use the app on two computers with the same synced log at the same time.",
      ],
    ],
  },
  {
    id: "portable", title: "Portable mode (USB drive)",
    body: [
      "If a folder named \"Ships Log Data\" sits right next to the app, the app keeps everything in that folder instead, so the app and its log can travel together.",
      [
        "Windows: download the portable .zip from the release, unzip it anywhere (a USB drive works) and run Ships Log.exe.",
        "Mac or Linux: put the app (or the .AppImage) in a folder, then use Settings > Make portable, which copies your log into Ships Log Data beside it and restarts.",
        "On a Mac, move the app out of the downloaded disk image first, or macOS may run it from a hidden temporary place where it can't see the folder.",
      ],
    ],
  },
  {
    id: "keys", title: "Keyboard shortcuts (computers)",
    body: [
      { keys: [
        ["Ctrl/⌘ + Enter", "Save the entry (entry screen or the home writing box)"],
        ["← / →", "Newer / older log while reading"],
        ["E", "Edit the log you're reading"],
        ["R", "Read the log aloud, or stop"],
        ["Esc", "Close a photo or video"],
        ["F1 or ?", "Open this guide"],
      ] },
    ],
  },
  {
    id: "terms", title: "Ship terms and what they mean",
    body: [
      { keys: [
        ["Bridge", "Home screen (your logs)"],
        ["Ready Room", "The entry screen"],
        ["Captain's log", "A log entry, or the writing box"],
        ["Science / Science Station", "Search"],
        ["Crew Manifest", "Crew"],
        ["Navigation", "Map"],
        ["Engineering", "Settings"],
        ["Holo Deck", "Appearance (skins)"],
        ["Main Helm", "Display options"],
        ["Ship's Status", "Activity readout"],
        ["Transporter Room", "Backup and restore"],
        ["Energize / Beam out", "Back up"],
        ["Beam in a backup", "Restore"],
        ["Ship's computer core", "Where your log is kept"],
        ["Viewscreen", "Photos and video"],
        ["Communications", "Recordings"],
        ["Stardate", "Log date"],
        ["Condition Green / Yellow Alert / Red Alert", "Calm / Caution / Critical"],
        ["Sick Bay", "Medical log"],
        ["Security clearance", "Hidden from search"],
        ["Make it so", "Save"],
        ["Engage", "Done, or Restart now"],
        ["Belay that", "Cancel"],
        ["Stand down", "Stop listening"],
        ["Jettison", "Delete"],
        ["Amend log", "Edit"],
        ["Computer, read / Computer voice", "Read aloud"],
      ] },
    ],
  },
  {
    id: "trouble", title: "Troubleshooting",
    body: [
      [
        "Dictation or recording doesn't start: check the app is allowed to use the microphone (Mac: System Settings > Privacy & Security > Microphone and Speech Recognition; Windows: Settings > Privacy > Microphone).",
        "\"Can't be opened\" or \"Windows protected your PC\" the first time: the app isn't signed yet. On a Mac, right-click the app and choose Open. On Windows, choose More info, then Run anyway.",
        "A video won't play on a computer: install FFmpeg (Mac: brew install ffmpeg; Windows: winget install ffmpeg) and add the video again.",
        "Your logs seem to be missing after moving folders: check Settings > Where your log is kept. If you used Move to Documents, the folder in Documents must keep its name (Ships Log).",
        "Something went wrong after a restore: the log that was replaced is in the before-restore folder inside the data folder.",
      ],
    ],
  },
];

// ---------- The Help screen ----------

const helpUi = { query: "", open: new Set(["start"]) };

function openHelp(section) {
  if (state.screen !== "help") state.helpBack = state.screen === "help" ? "logs" : state.screen;
  if (section) helpUi.open.add(section);
  go("help");
}

/** Plain text of a section, for searching. */
function helpText(sec) {
  const parts = [sec.title];
  for (const b of sec.body) {
    if (typeof b === "string") parts.push(b);
    else if (Array.isArray(b)) parts.push(...b);
    else if (b.keys) for (const [k, v] of b.keys) parts.push(k, v);
  }
  return parts.join(" ").toLowerCase();
}

function helpBlock(b) {
  if (typeof b === "string") return h("p", {}, b);
  if (Array.isArray(b)) return h("ul", {}, b.map((li) => h("li", {}, li)));
  if (b.keys) return h("dl", { class: "help-keys" }, b.keys.map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
  return null;
}

function HelpScreen() {
  const q = helpUi.query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const shown = HELP.filter((sec) => !words.length || words.every((w) => helpText(sec).includes(w)));
  const back = () => go(state.helpBack && state.helpBack !== "help" ? state.helpBack : "logs");
  return [
    h("header", { class: "row", style: { "justify-content": "flex-start", gap: "6px" } },
      h("button", { type: "button", class: "small-btn icon-btn", "aria-label": "Back", title: "Back", onclick: back }, svg(ICON.back)),
      h("h1", { class: "title" }, T("Guide", "Ship's manual"))
    ),
    h("input", {
      type: "search", class: "field help-search", placeholder: "Search the guide", value: helpUi.query, "aria-label": "Search the guide",
      oninput: (e) => { helpUi.query = e.target.value; render(); const el = document.querySelector(".help-search"); el.focus(); el.setSelectionRange(el.value.length, el.value.length); },
    }),
    words.length ? null : h("nav", { class: "help-toc", "aria-label": "Guide contents" },
      HELP.map((sec) => h("button", { type: "button", class: "chip", onclick: () => {
        helpUi.open.add(sec.id); render();
        const el = document.getElementById("help-" + sec.id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      } }, sec.title))),
    shown.length
      ? shown.map((sec) => {
          const open = words.length > 0 || helpUi.open.has(sec.id);
          return h("section", { class: "card help-sec" + (open ? " open" : ""), id: "help-" + sec.id },
            h("button", { type: "button", class: "help-head", "aria-expanded": String(open), onclick: () => {
              if (helpUi.open.has(sec.id)) helpUi.open.delete(sec.id); else helpUi.open.add(sec.id);
              render();
            } }, h("span", { class: "h2" }, sec.title), h("span", { class: "help-caret", "aria-hidden": "true" }, open ? "−" : "+")),
            open ? h("div", { class: "help-body" }, sec.body.map(helpBlock)) : null);
        })
      : h("div", { class: "empty" }, "Nothing in the guide matches that."),
    h("p", { class: "small help-foot" }, "Ship's Log · the full guide is also in MANUAL.md on GitHub."),
  ];
}

// F1, or ? on a computer, opens the guide from anywhere.
document.addEventListener("keydown", (ev) => {
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (ev.key === "F1" || (ev.key === "?" && !ev.metaKey && !ev.ctrlKey)) { ev.preventDefault(); openHelp(); }
});

if (typeof module !== "undefined") module.exports = { HELP };
