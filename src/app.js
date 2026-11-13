// Ship's Log — interface logic.
// Runs inside Tauri (data saved by the Rust backend) or in a plain browser
// (data saved in localStorage) so you can preview it without building.

// Each skin: key, name, a one-line description, and three colors for its preview.
// The matching colors and shapes live in skins.css and styles.css.
const SKINS = [
  ["console", "Console", "Starship control panel: gold, orange and lavender blocks", ["#000000", "#f7b538", "#a99ae6"]],
  ["classic", "Classic", "1960s bridge: square panels, grid lines and colored lights", ["#0a0a0b", "#e8483a", "#f2c230"]],
  ["vector", "Vector", "Film-era readouts: thin amber and green line drawings", ["#050403", "#ffb000", "#7dd3a8"]],
  ["pioneer", "Pioneer", "Early starship: boxy steel panels and push buttons", ["#0d1218", "#6fb7e8", "#e8a04a"]],
  ["flare", "Flare", "Frosted glass lit with fluorescent cyan, green and pink", ["#0b2152", "#19e6ff", "#ff5ad1"]],
  ["daylight", "Daylight", "Bright bridge: white and blue with a light streak", ["#eaf2fb", "#0a63cc", "#0b5c7a"]],
  ["glass", "Glass", "Tinted glass tiles on a warm dark backdrop, with a tile home screen", ["#2a0f08", "#4fa3b8", "#bfeff0"]],
  ["grid", "Grid", "Neon grid worlds: Sunset, Room, Rings or Light-line", ["#0a0420", "#19e6ff", "#ff4fd8"]],
  ["command", "Command", "Steel-blue glass panels, fine readouts and message-style log lists", ["#0d2236", "#8fd8ff", "#e9f6ff"]],
  ["holo", "Holo", "Modern projection: glowing cyan outlines", ["#04121c", "#2fd3e8", "#7fe7c4"]],
  ["archive", "Archive", "Library computer: navy with gold, steel blue and silver", ["#050d21", "#e8c46a", "#7fb0ff"]],
];

// Each label has a plain name and a ship name; Settings chooses which is shown.
const LOG_TYPES = [
  ["personal", "Personal", "Personal Log"],
  ["engineering", "Engineering", "Engineering"],
  ["medical", "Medical", "Sick Bay"],
  ["science", "Science", "Science Station"],
  ["away", "Away mission", "Away Mission"],
];

// key, plain name, color, ship name, short ship name (for narrow buttons)
const CONDITIONS = [
  ["calm", "Calm", "var(--accent2)", "Condition Green", "Green"],
  ["caution", "Caution", "var(--caution)", "Yellow Alert", "Yellow alert"],
  ["critical", "Critical", "var(--critical)", "Red Alert", "Red alert"],
];

/**
 * Picks the ship name or the plain one, by the "Ship terms" setting.
 * Ship names are remembered with their plain meaning, so hovering over one
 * on a computer shows what it does (see addPlainTips).
 */
const PLAIN_FOR = new Map();
const T = (plain, ship) => {
  if (!state.prefs.shipTerms) return plain;
  if (plain !== ship) PLAIN_FOR.set(ship, plain);
  return ship;
};

const typePlain = (k) => (LOG_TYPES.find(([key]) => key === k) || [k, k])[1];
const typeLabel = (k) => {
  const t = LOG_TYPES.find(([key]) => key === k);
  return t ? (state.prefs.shipTerms ? t[2] : t[1]) : k;
};

/** Gives every ship name on screen a hover tip with its plain meaning. */
function addPlainTips() {
  if (!state.prefs.shipTerms) return;
  const walker = document.createTreeWalker(document.querySelector(".app"), NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const plain = PLAIN_FOR.get(n.nodeValue.trim());
    const el = n.parentElement;
    // Log-type tags carry their own tips: "Engineering" is both a log type and a screen.
    if (!plain || !el || el.closest(".pill, .pills, .nav")) continue;
    (el.closest("button, label") || el).title = plain;
  }
}
const typeColor = (k) =>
  k === "personal" ? "var(--accent)" : k === "away" ? "var(--muted)" : "var(--accent2)";
const condition = (k) => {
  const c = CONDITIONS.find(([key]) => key === k) || CONDITIONS[0];
  return [c[0], T(c[1], c[3]), c[2]];
};
/** Text for the condition tag: "Condition: Calm", or "Yellow Alert" in ship terms. */
const conditionTag = (k) => {
  const c = CONDITIONS.find(([key]) => key === k) || CONDITIONS[0];
  return T("Condition: " + c[1], c[3]);
};

// ---------- Storage ----------

const tauri = window.__TAURI__ && window.__TAURI__.core;
// In a browser (no Tauri), web.js provides storage and backups.
const web = tauri ? null : window.ShipsLogWeb;

function matches(e, q, logType) {
  if (logType && logType !== "all" && e.logType !== logType) return false;
  if (!q) return true;
  q = q.toLowerCase();
  return (
    e.title.toLowerCase().includes(q) ||
    (!e.locked && e.body.toLowerCase().includes(q)) ||
    (e.place || "").toLowerCase().includes(q) ||
    (e.crew || []).some((c) => c.toLowerCase().includes(q))
  );
}

const newestFirst = (list) => [...list].sort((a, b) => b.created.localeCompare(a.created));

const memoryAudio = new Map();
const memoryMedia = new Map();
const memoryUrls = new Map();

const api = tauri
  ? {
      list: () => tauri.invoke("list_entries"),
      save: (entry) => tauri.invoke("save_entry", { entry }),
      remove: (id) => tauri.invoke("delete_entry", { id }),
      search: (query, logType) => tauri.invoke("search_entries", { query, logType }),
      // Audio goes to Rust as raw bytes, with the file name in a header.
      async saveAudio(file, blob) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return tauri.invoke("save_audio", bytes, { headers: { "x-file-name": file } });
      },
      async loadAudio(rec) {
        const buf = await tauri.invoke("load_audio", { file: rec.file });
        return new Blob([buf], { type: rec.mime });
      },
      deleteAudio: (file) => tauri.invoke("delete_audio", { file }),

      // Photos and video go to Rust in 8 MB pieces, so long videos never sit in memory whole.
      async saveMedia(file, blob, onProgress) {
        const size = 8 * 1024 * 1024;
        for (let offset = 0; offset < blob.size || offset === 0; offset += size) {
          const piece = new Uint8Array(await blob.slice(offset, offset + size).arrayBuffer());
          await tauri.invoke("save_media_chunk", piece, { headers: { "x-file-name": file, "x-offset": String(offset) } });
          if (onProgress) onProgress(Math.min(1, (offset + size) / Math.max(blob.size, 1)));
          if (!blob.size) break;
        }
        return file;
      },
      deleteMedia: (file) => tauri.invoke("delete_media", { file }),
      convertVideo: (file) => tauri.invoke("convert_video", { file }),
      async mediaDir() { return tauri.invoke("media_dir"); },
      saveSettings: (settings) => tauri.invoke("save_settings", { settings }),
      backupStatus: () => tauri.invoke("backup_status"),
      dataLocation: () => tauri.invoke("data_location"),
      makePortable: () => tauri.invoke("make_portable"),
      moveData: (toDocuments) => tauri.invoke("move_data", { toDocuments }),
      restartApp: () => tauri.invoke("restart_app"),
      showDataFolder: () => tauri.invoke("show_data_folder"),
      backupNow: () => tauri.invoke("backup_now"),
      restoreBackup: () => tauri.invoke("restore_backup"),
      setAutoBackup: (off, everyDays) => tauri.invoke("set_auto_backup", { off, everyDays }),
      mediaUrl(file) {
        const dir = state.mediaDir;
        const sep = dir.includes("\\") ? "\\" : "/";
        return tauri.convertFileSrc(dir + sep + file);
      },
    }
  : {
      // Web browser (and iPhone home-screen app): everything lives in the browser's
      // own database, through web.js. Recordings, photos and video are also kept in
      // the maps above while the page is open, so playback stays instant.
      async mediaDir() {
        // First thing called at start-up: pull the saved files into memory.
        await loadBrowserFiles();
        return "";
      },
      async saveMedia(file, blob, onProgress) {
        await web.putBlob("media", file, blob);
        memoryMedia.set(file, blob);
        if (onProgress) onProgress(1);
        return file;
      },
      async deleteMedia(file) {
        await web.deleteBlob("media", file);
        memoryMedia.delete(file);
        forgetUrl(file);
      },
      async convertVideo() { return null; },
      async saveSettings(s) { try { localStorage.setItem("shipslog.settings", s); } catch {} },
      async dataLocation() {
        return { path: web.isInstalled() ? "this phone (inside the Ship's Log app)" : "this browser's storage on this device", portable: false, portable_folder: "Ships Log Data", app_folder: null };
      },
      async makePortable() { throw "Portable mode works in the installed Mac, Windows or Linux app."; },
      async moveData() { throw "Moving the log works in the installed Mac, Windows or Linux app."; },
      async restartApp() { location.reload(); },
      async showDataFolder() {},
      async backupStatus() {
        const last = Number(localStorage.getItem("shipslog.lastBackup") || 0);
        return { lastBackup: last || null, autoFolder: null, autoEveryDays: 7 };
      },
      async backupNow() {
        const result = await web.makeBackup(localStorage.getItem("shipslog.settings") || "{}");
        const stamp = new Date().toISOString().slice(0, 10);
        const how = await web.deliver(result.blob, `ShipsLog-${stamp}.zip`);
        if (how === "cancelled") return null;
        localStorage.setItem("shipslog.lastBackup", String(Math.floor(Date.now() / 1000)));
        return { path: how === "shared" ? "where you chose in the share sheet" : "your Downloads folder", bytes: result.bytes, entries: result.entries, files: result.files };
      },
      async restoreBackup() {
        const file = await web.pickFile(".zip,application/zip");
        if (!file) return null;
        const settings = await web.restoreBackup(file);
        await loadBrowserFiles(true);
        return settings;
      },
      async setAutoBackup() { return this.backupStatus(); },
      mediaUrl(file) {
        if (!memoryUrls.has(file) && memoryMedia.has(file)) memoryUrls.set(file, URL.createObjectURL(memoryMedia.get(file)));
        return memoryUrls.get(file) || "";
      },
      async saveAudio(file, blob) {
        await web.putBlob("audio", file, blob);
        memoryAudio.set(file, blob);
        return file;
      },
      async loadAudio(rec) {
        let blob = memoryAudio.get(rec.file) || (await web.getBlob("audio", rec.file));
        if (!blob) throw new Error("This recording is missing from the browser's storage.");
        if (rec.mime && blob.type !== rec.mime) blob = new Blob([blob], { type: rec.mime });
        return blob;
      },
      async deleteAudio(file) {
        await web.deleteBlob("audio", file);
        memoryAudio.delete(file);
      },
      async list() { return newestFirst(await web.listEntries()); },
      async save(entry) {
        if (!entry.id) entry.id = "log-" + Date.now();
        await web.saveEntry(entry);
        return entry;
      },
      async remove(id) { await web.deleteEntry(id); },
      async search(query, logType) {
        return newestFirst((await web.listEntries()).filter((e) => matches(e, query.trim(), logType)));
      },
    };

/** Browser only: loads saved recordings, photos and video into memory (again, after a restore). */
async function loadBrowserFiles(reset) {
  if (!web) return;
  if (reset) {
    memoryUrls.forEach((url) => URL.revokeObjectURL(url));
    memoryUrls.clear();
    memoryAudio.clear();
    memoryMedia.clear();
  }
  for (const [file, blob] of await web.allBlobs("audio")) memoryAudio.set(file, blob);
  for (const [file, blob] of await web.allBlobs("media")) memoryMedia.set(file, blob);
}

function forgetUrl(file) {
  const url = memoryUrls.get(file);
  if (url) URL.revokeObjectURL(url);
  memoryUrls.delete(file);
}

// ---------- Helpers ----------

/** Stardate-style number: (year − 1946) × 1000 + how far through the year we are × 1000. */
function stardate(d = new Date()) {
  const y = d.getFullYear();
  const start = new Date(y, 0, 1);
  const end = new Date(y + 1, 0, 1);
  return Math.round(((y - 1946) * 1000 + ((d - start) / (end - start)) * 1000) * 10) / 10;
}

const formatDate = (d) =>
  d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

const sd1 = (n) => Number(n).toFixed(1);
const showStardate = () => state.prefs.dateStyle !== "calendar";
const showCalendar = () => state.prefs.dateStyle !== "stardate" && !state.prefs.storyMode;

/** The stardate "now": today's, or in story mode where the story has got to (the latest stardate written). */
function currentStardate() {
  if (state.prefs.storyMode && state.entries.length) return Math.max(...state.entries.map((e) => e.stardate));
  return stardate(new Date());
}

/** Stardate for a new entry: today's, or in story mode a step on from the latest one. */
function nextStardate() {
  if (state.prefs.storyMode && state.entries.length) return Math.round((currentStardate() + 0.1) * 10) / 10;
  return stardate(new Date());
}

/** "Log date 80863.4 · Thu, Nov 12, 2026", following the Dates setting. */
function dateLine(sd, date) {
  const parts = [];
  if (showStardate()) parts.push(`${T("Log date", "Stardate")} ${sd1(sd)}`);
  if (showCalendar() && date) parts.push(formatDate(date));
  return parts.join(" · ");
}

/** An entry's date as a short label for lists: its stardate, or its calendar date. */
const entryDate = (e) => showStardate() ? sd1(e.stardate) : new Date(e.created).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Logs in the order the Dates setting asks for: newest written first, or by stardate in story mode. */
function inOrder(list) {
  return state.prefs.storyMode ? [...list].sort((a, b) => b.stardate - a.stardate || b.created.localeCompare(a.created)) : list;
}

/** Tiny element builder: h("div", {class: "x", onclick: fn}, "text", child, [more]) */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const svg = (paths) => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = paths; // static, trusted markup only
  return s;
};
const ICON = {
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 11v2"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 8"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  speaker: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17.5h.01"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  save: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" r="1"/>',
};

const clock = (secs) => {
  const s = Math.max(0, Math.round(secs || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Splits text so every match of q is wrapped in <mark>. */
function highlight(text, q) {
  if (!q) return [text];
  const out = [];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  let i = 0;
  for (;;) {
    const j = lower.indexOf(needle, i);
    if (j < 0) { out.push(text.slice(i)); break; }
    out.push(text.slice(i, j), h("mark", {}, text.slice(j, j + needle.length)));
    i = j + needle.length;
  }
  return out;
}

const snippet = (e) => {
  if (e.locked) return "Locked entry";
  const b = e.body.replace(/\s+/g, " ").trim();
  const recs = e.recordings || [];
  if (!b && recs.length) {
    const total = recs.reduce((t, r) => t + (r.seconds || 0), 0);
    return `Audio log · ${clock(total)}`;
  }
  const media = e.media || [];
  if (!b && media.length) {
    const photos = media.filter((m) => m.kind === "photo").length;
    const videos = media.length - photos;
    return [photos && `${photos} ${photos === 1 ? "photo" : "photos"}`, videos && `${videos} ${videos === 1 ? "video" : "videos"}`]
      .filter(Boolean).join(" · ");
  }
  return b.length > 140 ? b.slice(0, 140) + "…" : b;
};

// ---------- State ----------

const state = {
  screen: "cover",
  ship: { captain: "", ship: "", registry: "" },
  editingShip: false,
  skin: "console",
  entries: [],
  draft: null,
  pad: { title: "", body: "" }, // the log pad on computer home screens
  deleteArmed: false,
  query: "",
  queryType: "all",
  place: null,
  mediaDir: "",
  textColor: "", // "" follows the skin
  // Display options, set in Settings.
  prefs: {
    accent: "",        // "" follows the skin
    alertMode: "subtle", // "off" | "subtle" | "full": how much a log's Condition recolors the app
    readout: true,     // activity readout on the Logs screen
    glyphs: true,      // line graphics on log cards
    iconsOnly: false,  // icons in place of words on buttons
    glassClear: false, // Glass skin: clear tiles with no tint
    gridBackdrop: "sunset", // Grid skin: "sunset" | "room" | "rings" | "lightline"
    shipTerms: true,   // ship names (Bridge, Engineering…) in place of plain labels
    voiceCommands: true, // "Make it so", "Belay that"… while dictating
    dateStyle: "both", // "both", "stardate" (stardates only) or "calendar" (calendar dates only)
    storyMode: false,
    voiceName: "",     // system voice for Read aloud; "" = system default
    voiceStyle: "standard", // standard, captain, computer, narrator or custom
    voiceRate: 1,      // custom style speed
    voicePitch: 1,     // custom style pitch
    readIntro: true,   // start with "Captain's log, stardate …"
    allVoices: false,  // list every voice, not just natural ones in your language
    textSize: 1,       // 0.9 small … 1.5 largest; scales all text
    dictationMode: "app", // "app": the app listens; "keyboard": use the phone's keyboard microphone  // stardates are set by the writer, for telling a story; logs listed in stardate order
    layout: null,      // computer home screen panels (Glass, Flare, Daylight, Grid); null = default
  },
  arranging: false,    // arrange mode on the computer home screen
};

try {
  const saved = localStorage.getItem("shipslog.skin");
  if (SKINS.some(([k]) => k === saved)) state.skin = saved;
  state.textColor = localStorage.getItem("shipslog.textColor") || "";
  Object.assign(state.prefs, JSON.parse(localStorage.getItem("shipslog.prefs") || "{}"));
  Object.assign(state.ship, JSON.parse(localStorage.getItem("shipslog.ship") || "{}"));
} catch {}

const screenEl = document.getElementById("screen");
const appEl = document.querySelector(".app");

function go(screen) {
  if (screen !== "logs") state.arranging = false;
  if (screen !== state.screen) stopSpeaking();
  state.screen = screen;
  render();
  screenEl.scrollTop = 0;
}

async function refresh() {
  state.entries = inOrder(await api.list());
}

/** Picks dark or white text for a background color, whichever reads better. */
function readableOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.3 ? "#0a0f18" : "#ffffff";
}

/** Applies the display options: condition colors, accent color, icons-only. */
function applyLook() {
  const root = document.documentElement;
  const p = state.prefs;
  root.style.setProperty("--ts", String(p.textSize || 1));
  const alert = (state.entries[0] && state.entries[0].condition) || "calm";
  root.dataset.alert = alert;
  root.dataset.alertMode = p.alertMode;
  if (p.iconsOnly) root.dataset.icons = "on"; else delete root.dataset.icons;
  if (p.glassClear && state.skin === "glass") root.dataset.clear = "on"; else delete root.dataset.clear;
  if (state.skin === "grid") root.dataset.variant = p.gridBackdrop || "sunset"; else delete root.dataset.variant;
  // A full Caution or Critical recolor takes over from the chosen accent color.
  const alertWins = p.alertMode === "full" && alert !== "calm";
  if (/^#[0-9a-f]{6}$/i.test(p.accent) && !alertWins) {
    root.style.setProperty("--accent", p.accent);
    root.style.setProperty("--on-accent", readableOn(p.accent));
  } else {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--on-accent");
  }
}

function setPref(key, value) {
  state.prefs[key] = value;
  if (key === "storyMode") state.entries = value ? inOrder(state.entries) : [...state.entries].sort((a, b) => b.created.localeCompare(a.created));
  try { localStorage.setItem("shipslog.prefs", JSON.stringify(state.prefs)); } catch {}
  persistSettings();
  render();
}

function render() {
  document.documentElement.dataset.skin = state.skin;
  applyLook();
  if (state.textColor) document.documentElement.style.setProperty("--entry-text", state.textColor);
  else document.documentElement.style.removeProperty("--entry-text");
  appEl.classList.toggle("composing", state.screen === "compose");
  appEl.classList.toggle("cover", state.screen === "cover");
  document.getElementById("bar-label").textContent =
    state.screen === "cover" ? "Personal records" : state.ship.ship || "Ship's Log";
  // The top-left Home button returns to the cover. It rests on the cover itself,
  // and while writing an entry (use the back arrow there, so nothing is lost by accident).
  const ship = state.prefs.shipTerms;
  const navNames = { logs: ship ? "Bridge" : "Logs", search: ship ? "Science" : "Search", crew: "Crew", map: ship ? "Navigation" : "Map" };
  document.querySelectorAll(".nav [data-go]").forEach((b) => {
    b.querySelector("span").textContent = navNames[b.dataset.go];
    b.title = { logs: "Logs", search: "Search", crew: "Crew", map: "Map" }[b.dataset.go];
  });
  const home = document.getElementById("home-btn");
  home.disabled = state.screen === "cover" || state.screen === "compose";
  home.setAttribute("aria-label", home.disabled ? (state.ship.ship || "Ship's Log") : "Home");
  /** Shrinks the cover title until the whole line fits inside the screen. */
function fitCoverTitle() {
  const el = document.querySelector(".cover-title");
  if (!el) return;
  el.style.fontSize = "";
  const room = el.parentElement.clientWidth - 16;
  const width = el.getBoundingClientRect().width;
  if (width > room && width > 0) {
    const size = parseFloat(getComputedStyle(el).fontSize);
    el.style.fontSize = Math.max(18, Math.floor(size * room / width)) + "px";
  }
}
window.addEventListener("resize", fitCoverTitle);
["gesturestart", "gesturechange"].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitCoverTitle);
if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", fitCoverTitle);

document.querySelectorAll(".nav [data-go]").forEach((b) => {
    const here = state.screen === "read" ? (["search", "crew", "map"].includes(state.readBack) ? state.readBack : "logs") : state.screen;
    if (b.dataset.go === here) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  const view = { cover: CoverScreen, logs: LogsScreen, compose: ComposeScreen, read: ReadScreen, help: HelpScreen, search: SearchScreen, crew: CrewScreen, map: MapScreen, settings: SettingsScreen, gallery: GalleryScreen, onthisday: OnThisDayScreen }[state.screen];
  screenEl.dataset.screen = state.screen;
  screenEl.replaceChildren(...[view()].flat(Infinity).filter(Boolean));
  fitCoverTitle();
  addPlainTips();
}

document.querySelectorAll(".nav [data-go]").forEach((b) =>
  b.addEventListener("click", () => go(b.dataset.go))
);
document.getElementById("home-btn").addEventListener("click", () => {
  backupUi.restoreArmed = false;
  state.editingShip = false;
  go("cover");
});

// ---------- Shared pieces ----------

function setSkin(k) {
  state.skin = k;
  try { localStorage.setItem("shipslog.skin", k); } catch {}
  persistSettings();
  render();
}

/** The list of skins on the Settings screen. */
const GRID_BACKDROPS = [
  ["sunset", "Sunset", "A striped sun behind wireframe mountains"],
  ["room", "Room", "A black grid room, floor and ceiling"],
  ["rings", "Rings", "Turning rings over a teal floor"],
  ["lightline", "Light-line", "Glowing circuit lines on black, with orange"],
];

/** Shown under the skin list while Grid is in use. */
function GridBackdropPicker() {
  const current = state.prefs.gridBackdrop || "sunset";
  const about = (GRID_BACKDROPS.find(([k]) => k === current) || GRID_BACKDROPS[0])[2];
  return h("div", { class: "stack" },
    h("span", { class: "label", id: "backdrop-label" }, "Grid backdrop"),
    h("div", { class: "pills", role: "group", "aria-labelledby": "backdrop-label" },
      GRID_BACKDROPS.map(([k, name]) =>
        h("button", { type: "button", "aria-pressed": String(current === k), onclick: () => setPref("gridBackdrop", k) }, name)
      )
    ),
    h("span", { class: "small" }, about)
  );
}

function SkinPicker() {
  return h("div", { class: "skin-list", role: "group", "aria-label": "Skin" },
    SKINS.map(([k, name, about, colors]) =>
      h("button", { type: "button", class: "skin-option", "aria-pressed": String(state.skin === k), onclick: () => setSkin(k) },
        h("span", { class: "skin-preview", "aria-hidden": "true", style: { background: colors[0] } },
          h("span", { style: { background: colors[1] } }),
          h("span", { style: { background: colors[2] } })
        ),
        h("span", { class: "stack", style: { gap: "2px", flex: "1", "min-width": "0" } },
          h("span", { class: "h3" }, name),
          h("span", { class: "small" }, about)
        ),
        state.skin === k ? h("span", { class: "pill" }, "In use") : null
      )
    )
  );
}

function EntryCard(e, q) {
  const glyph = state.prefs.glyphs && !(e.media || []).length;
  return h("button", { type: "button", class: "card" + (glyph ? " has-glyph" : ""), onclick: () => openEntry(e) },
    h("div", { class: "row" },
      h("span", { class: "pill", title: typePlain(e.logType), style: { "--c": typeColor(e.logType) } }, typeLabel(e.logType)),
      h("span", { class: "small row", style: { gap: "6px", "justify-content": "flex-end" } },
        e.locked ? svg(ICON.lock) : null,
        (e.recordings || []).length
          ? h("span", { class: "row", style: { gap: "2px" }, "aria-label": `${e.recordings.length} recordings` }, svg(ICON.mic), e.recordings.length)
          : null,
        entryDate(e))
    ),
    h("h3", { class: "h3" }, highlight(e.title || "Untitled", q)),
    h("p", {}, highlight(snippet(e), q)),
    (e.media || []).length ? ThumbStrip(e.media) : null,
    glyph ? TypeGlyph(e.logType) : null
  );
}

function svgEl(viewBox, cls, inner, label) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", viewBox);
  s.setAttribute("class", cls);
  if (label) { s.setAttribute("role", "img"); s.setAttribute("aria-label", label); }
  else s.setAttribute("aria-hidden", "true");
  s.innerHTML = inner; // built from numbers only
  return s;
}

/** A small line drawing for each log type, shown in the corner of its card. */
function TypeGlyph(type) {
  const g = {
    away: '<path d="M4 34 C22 34 26 10 46 10 S70 26 92 16"/><circle cx="46" cy="10" r="3" class="f"/><circle cx="92" cy="16" r="3" class="b"/><path d="M20 40v4M46 40v4M72 40v4"/>',
    engineering: '<path d="M30 40 A22 22 0 1 1 66 40"/><path d="M36 36 A14 14 0 1 1 60 36" class="b"/><path d="M48 22L60 12"/><circle cx="48" cy="22" r="3" class="f"/>',
    science: '<path d="M10 40 A38 38 0 0 1 86 40"/><path d="M24 40 A24 24 0 0 1 72 40" class="b"/><path d="M38 40 A10 10 0 0 1 58 40"/><path d="M48 40L74 14"/><circle cx="70" cy="18" r="3" class="f"/>',
    medical: '<path d="M4 26H28L34 12L42 40L50 6L58 30L64 26H92"/>',
    personal: '<ellipse cx="48" cy="24" rx="40" ry="12" transform="rotate(-14 48 24)"/><circle cx="48" cy="24" r="8" class="b"/><circle cx="84" cy="14" r="3" class="f"/>',
  }[type];
  return g ? svgEl("0 0 96 48", "type-glyph", g) : null;
}

/** Counts logs and words for each of the last seven days, oldest first. */
function weekActivity() {
  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push({ date: d, logs: 0, words: 0 });
  }
  for (const e of state.entries) {
    const d = new Date(e.created);
    d.setHours(0, 0, 0, 0);
    const slot = days.find((x) => x.date.getTime() === d.getTime());
    if (!slot) continue;
    slot.logs += 1;
    slot.words += (e.body.trim().match(/\S+/g) || []).length;
  }
  return days;
}

/**
 * The activity readout on the Logs screen, drawn from the last seven days:
 * ring = share of days with a log, line = words written each day,
 * bars = logs made each day (today on the right).
 */
function ReadoutStrip() {
  const days = weekActivity();
  const logs = days.reduce((t, d) => t + d.logs, 0);
  const words = days.reduce((t, d) => t + d.words, 0);
  const active = days.filter((d) => d.logs).length;
  const maxLogs = Math.max(1, ...days.map((d) => d.logs));
  const maxWords = Math.max(1, ...days.map((d) => d.words));

  const cols = Array.from({ length: 17 }, (_, i) => `M${10 + i * 20} 4V60`).join("");
  const R = 24, around = 2 * Math.PI * R;
  const pts = days.map((d, i) => [70 + i * 30, 50 - (d.words / maxWords) * 36]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y.toFixed(1)}`).join("");
  const ticks = pts.map(([x]) => `<path d="M${x} 54v5"/>`).join("");
  const dots = pts.map(([x, y], i) => days[i].logs ? `<circle cx="${x}" cy="${y.toFixed(1)}" r="${i === 6 ? 4 : 2.5}" class="${i === 6 ? "ro-dot2" : "ro-dot"}"/>` : "").join("");
  const bars = days.map((d, i) => {
    const hgt = d.logs ? 6 + (d.logs / maxLogs) * 34 : 2;
    return `<rect x="${272 + i * 10}" y="${(56 - hgt).toFixed(1)}" width="6" height="${hgt.toFixed(1)}" rx="1"${d.logs ? "" : ' class="empty"'}/>`;
  }).join("");

  const summary = `${logs} ${logs === 1 ? "log" : "logs"} · ${active} of 7 days · ${words} ${words === 1 ? "word" : "words"}`;
  if (state.skin === "classic") {
    // Round scope: the week's words as a trace. Lights: one per day. Blocks: logs that day.
    const sp = days.map((d, i) => [16 + i * 11, 62 - (d.words / maxWords) * 30]);
    const trace = sp.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y.toFixed(1)}`).join("");
    const lit = ["#e8483a", "#f2c230", "#6fb2f0", "#58c070"];
    const names = ["S", "M", "T", "W", "T", "F", "S"];
    const lights = days.map((d, i) => {
      const x = 112 + i * 33;
      const blocks = Array.from({ length: Math.min(d.logs, 4) }, (_, k) => `<rect x="${x}" y="${70 - k * 8}" width="24" height="5" rx="1" fill="${lit[i % 4]}"/>`).join("");
      return `<rect x="${x}" y="10" width="24" height="24" rx="3" class="${d.logs ? "cl-on" : "cl-off"}" ${d.logs ? `fill="${lit[i % 4]}" style="color:${lit[i % 4]}"` : ""}/>
              <text x="${x + 12}" y="48" text-anchor="middle" class="cl-day">${names[d.date.getDay()]}</text>${blocks}`;
    }).join("");
    return h("div", { class: "readout-wrap" },
      svgEl("0 0 350 96", "readout scope",
        `<defs><clipPath id="scope-clip"><circle cx="48" cy="48" r="38"/></clipPath></defs>
         <circle cx="48" cy="48" r="44" class="cl-bezel"/><circle cx="48" cy="48" r="38" class="cl-screen"/>
         <g clip-path="url(#scope-clip)"><path class="cl-grid" d="M10 48H86M48 10V86M10 29H86M10 67H86M29 10V86M67 10V86"/>
         <path class="cl-trace" d="${trace}"/><path class="cl-scan" d="M10 30H86M10 34H86M10 38H86M10 42H86M10 46H86M10 50H86M10 54H86M10 58H86M10 62H86M10 66H86"/></g>
         <path class="cl-glare" d="M22 30 A32 32 0 0 1 44 16"/>${lights}
         <path class="cl-rule" d="M108 78H346"/>`,
        "Last 7 days: " + summary.replace(/ · /g, ", ")),
      h("div", { class: "small readout-caption" }, T("Last 7 days: ", "Ship's status, 7 days: ") + summary)
    );
  }
  return h("div", { class: "readout-wrap" },
    svgEl("0 0 350 64", "readout",
      `<g class="ro-grid"><path d="M0 16H350M0 32H350M0 48H350"/><path d="${cols}"/></g>
       <g transform="translate(34 32)">
         <circle r="${R}" class="ro-track"/>
         <circle r="${R}" class="ro-progress" stroke-dasharray="${((active / 7) * around).toFixed(1)} ${around.toFixed(1)}" transform="rotate(-90)"/>
         <circle r="15" class="ro-ring"/>
         <text class="ro-num" y="5" text-anchor="middle">${active}</text>
       </g>
       <path class="ro-path" d="${line}"/>
       <g class="ro-ticks">${ticks}</g>${dots}
       <g class="ro-bars">${bars}</g>`,
      "Last 7 days: " + summary.replace(/ · /g, ", ")),
    h("div", { class: "small readout-caption" }, T("Last 7 days: ", "Ship's status, 7 days: ") + summary)
  );
}

/** Up to four small previews on a log card. */
function ThumbStrip(media) {
  const shown = media.slice(0, 4);
  const extra = media.length - shown.length;
  return h("div", { class: "thumb-strip", "aria-label": `${media.length} photos and videos` },
    shown.map((m, i) =>
      h("span", { class: "mini" },
        m.thumb ? h("img", { src: api.mediaUrl(m.thumb), alt: "" }) : svg(m.kind === "video" ? ICON.video : ICON.photo),
        m.kind === "video" ? h("span", { class: "mini-play" }, svg(ICON.play)) : null,
        extra > 0 && i === shown.length - 1 ? h("span", { class: "mini-more" }, "+" + extra) : null
      )
    )
  );
}

// ---------- Screens ----------

/** The app's badge (src/logo.png): replace that file to change it. */
function Emblem() {
  return h("span", { class: "emblem-wrap" }, h("img", { src: "logo.png", class: "emblem", alt: "Ship's Log emblem" }));
}

function CoverScreen() {
  const ship = state.ship;
  const parts = [ship.captain && "Capt. " + ship.captain, ship.ship, ship.registry].filter(Boolean);
  const line = parts.length
    ? parts.flatMap((p, i) => (i ? [" • ", h("span", {}, p)] : [h("span", {}, p)]))
    : null;

  if (state.editingShip) {
    const draft = { ...ship };
    const field = (key, label, placeholder) =>
      h("div", { class: "stack" },
        h("label", { class: "label", for: "ship-" + key }, label),
        h("input", { id: "ship-" + key, class: "field", type: "text", placeholder, value: draft[key], oninput: (ev) => { draft[key] = ev.target.value; } })
      );
    return h("div", { class: "cover-screen" },
      h("h1", { class: "title" }, "Ship's details"),
      h("div", { class: "cover-form" },
        field("captain", "Your name", "Your name"),
        field("ship", "Ship name", "Name your ship"),
        field("registry", "Registry", "e.g. NX-2026"),
      ),
      h("button", {
        type: "button", class: "primary",
        onclick: () => {
          state.ship = { captain: draft.captain.trim(), ship: draft.ship.trim(), registry: draft.registry.trim() };
          try { localStorage.setItem("shipslog.ship", JSON.stringify(state.ship)); } catch {}
          persistSettings();
          state.editingShip = false;
          render();
        },
      }, T("Save details", "Make it so")),
      h("button", { type: "button", class: "small-btn", onclick: () => { state.editingShip = false; render(); } }, T("Cancel", "Belay that"))
    );
  }

  return h("div", { class: "cover-screen" },
    Emblem(),
    h("h1", { class: "cover-title" }, "Captain's Log"),
    h("div", { class: "cover-sub" }, "Authorized access only"),
    line
      ? h("div", { class: "cover-line" }, line)
      : h("div", { class: "muted" }, "Add your name and ship below."),
    h("button", { type: "button", class: "primary", style: { "max-width": "320px" }, onclick: () => go("logs") }, "Open log"),
    h("div", { class: "row", style: { "justify-content": "center", "flex-wrap": "wrap" } },
      h("button", { type: "button", class: "small-btn", onclick: () => { state.editingShip = true; render(); } }, line ? "Edit details" : "Add details"),
      h("button", { type: "button", class: "small-btn", onclick: () => go("settings") }, svg(ICON.gear), "Settings")
    )
  );
}

/** Logs from today's month and day in earlier years, newest first. */
function logsOnThisDate() {
  const now = new Date();
  return state.entries.filter((e) => {
    const d = new Date(e.created);
    return d.getMonth() === now.getMonth() && d.getDate() === now.getDate() && d.getFullYear() < now.getFullYear();
  });
}

function SubHeader(title) {
  return h("header", { class: "row", style: { "justify-content": "flex-start", gap: "6px" } },
    h("button", { type: "button", class: "small-btn icon-btn", "aria-label": "Back", onclick: () => go("logs") }, svg(ICON.back)),
    h("h1", { class: "title" }, title)
  );
}

function OnThisDayScreen() {
  const now = new Date();
  const logs = logsOnThisDate();
  const today = now.toLocaleDateString(undefined, { month: "long", day: "numeric" });
  const groups = new Map();
  for (const e of logs) {
    const years = now.getFullYear() - new Date(e.created).getFullYear();
    if (!groups.has(years)) groups.set(years, []);
    groups.get(years).push(e);
  }
  return [
    SubHeader("On this date"),
    h("div", { class: "muted" }, `Logs written on ${today} in past years`),
    logs.length
      ? [...groups].map(([years, list]) => [
          h("h2", { class: "h2" }, years === 1 ? "1 year ago" : `${years} years ago`),
          h("div", { class: "list" }, list.map((e) => EntryCard(e))),
        ])
      : h("div", { class: "empty" }, `No logs from ${today} in past years yet. What you write today will show up here next year.`),
  ];
}

/** Every photo and video from every log, newest first. */
function GalleryScreen() {
  const items = [];
  for (const e of state.entries) for (const m of e.media || []) items.push({ m, e });
  return [
    SubHeader(T("Photos & video", "Viewscreen")),
    h("div", { class: "muted" }, items.length ? `${items.length} from all your logs` : "Photos and videos from all your logs"),
    items.length
      ? h("div", { class: "media-grid" }, items.map(({ m, e }) =>
          h("button", {
            type: "button", class: "tile", title: e.title || "Untitled",
            "aria-label": `${m.kind === "video" ? "Video" : "Photo"} from ${e.title || "an untitled log"}`,
            onclick: () => openViewer(null, m),
          },
            m.thumb ? h("img", { src: api.mediaUrl(m.thumb), alt: "" }) : h("span", { class: "tile-icon" }, svg(m.kind === "video" ? ICON.video : ICON.photo)),
            m.kind === "video" ? h("span", { class: "tile-badge" }, svg(ICON.play), clock(m.seconds)) : null
          )))
      : h("div", { class: "empty" }, "Nothing here yet. Add a photo or video when you write an entry."),
  ];
}

/** The Glass skin's home: a widget, a grid of icon tiles, and the latest logs. */
/** Computer home screens: a writing field right on the home screen. */
function LogPad(extra = "") {
  const p = state.pad;
  const now = new Date();
  const carry = (opts) => openCompose(null, { ...opts, title: p.title, body: p.body });
  async function savePad() {
    if (!p.title.trim() && !p.body.trim()) { document.getElementById("pad-body").focus(); return; }
    const t = new Date();
    await api.save({ id: "", created: t.toISOString(), stardate: nextStardate(), logType: "personal", condition: "calm",
      title: p.title.trim(), body: p.body, crew: [], place: "", locked: false, recordings: [], media: [] });
    state.pad = { title: "", body: "" };
    await refresh();
    render();
  }
  const btn = (icon, label, plain, fn, cls = "") =>
    h("button", { type: "button", class: "pad-btn " + cls, title: plain, onclick: fn }, svg(icon), h("span", {}, label));
  return h("section", { class: "pad " + extra },
    h("div", { class: "pad-head" },
      h("span", { class: "pad-label" }, T("New entry", "Captain's log")),
      h("span", { class: "pad-date" }, dateLine(nextStardate(), now))),
    h("input", { class: "pad-title", placeholder: "Title (optional)", value: p.title, "aria-label": "Title", oninput: (e) => { p.title = e.target.value; } }),
    h("textarea", { id: "pad-body", class: "pad-body", placeholder: "Begin your log entry…", value: p.body, "aria-label": "Log entry", style: { color: state.textColor || null },
      oninput: (e) => { p.body = e.target.value; },
      onkeydown: (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); savePad(); } } }),
    h("div", { class: "pad-actions" },
      btn(ICON.mic, "Dictate", "Dictate into this entry", () => carry({ dictate: true }), "go"),
      btn(ICON.wave, "Record", "Add an audio recording", () => carry({ record: true })),
      btn(ICON.photo, "More", "Log type, condition, crew, place, photos and video", () => carry({})),
      h("span", { class: "pad-space" }),
      btn(ICON.save, T("Save", "Make it so"), "Save this entry (Ctrl or ⌘ + Enter)", savePad, "save"))
  );
}

function TileHome() {
  const latest = state.entries[0];
  const now = new Date();
  const cond = latest ? latest.condition : "calm";
  const past = logsOnThisDate().length;
  const tile = (icon, label, plain, fn, badge) =>
    h("button", { type: "button", class: "app-tile", title: plain, onclick: fn },
      h("span", { class: "app-icon" }, svg(icon), badge ? h("span", { class: "app-badge" }, badge) : null),
      h("span", { class: "app-name" }, label));
  const widget = () => h("section", { class: "widget" },
      h("div", { class: "row" },
        h("div", { class: "stack", style: { gap: "0" } },
          h("h1", { class: "widget-title" }, T("Ship's Log", "Bridge")),
          h("span", { class: "widget-big", title: showCalendar() ? formatDate(now) : null }, showStardate() ? sd1(currentStardate()) : now.toLocaleDateString(undefined, { month: "short", day: "numeric" }))),
        h("span", { class: "chip", title: conditionTag(cond), style: { "--c": condition(cond)[2] } }, conditionTag(cond))
      ),
      state.prefs.readout ? ReadoutStrip() : h("div", { class: "muted" }, showCalendar() ? formatDate(now) : "")
    );
  const tiles = () => h("div", { class: "app-grid" },
      tile(ICON.mic, "Dictate", "Dictate a log", () => openCompose(null, { dictate: true })),
      tile(ICON.wave, "Record", "Record audio", () => openCompose(null, { record: true })),
      tile(ICON.pen, "Write", "Write an entry", () => openCompose(null)),
      tile(ICON.search, T("Search", "Science"), "Search", () => go("search")),
      tile(ICON.photo, T("Photos", "Viewscreen"), "Photos and video", () => go("gallery")),
      tile(ICON.clock, "On this date", "Logs from this date in past years", () => go("onthisday"), past || null),
      tile(ICON.save, T("Backup", "Transporter"), "Backup and restore", () => go("settings")),
      tile(ICON.gear, T("Settings", "Engineering"), "Settings", () => go("settings"))
    );
  const recent = () => [
    h("div", { class: "row" },
      h("h2", { class: "h2" }, "Recent logs"),
      h("span", { class: "muted" }, `${state.entries.length} on file`)
    ),
    state.entries.length
      ? h("div", { class: "list" }, state.entries.map((e) => EntryCard(e)))
      : h("div", { class: "empty" }, "No logs on file yet. Tap Dictate or Write to make your first entry."),
  ];
  if (WIDE.matches) return PanelHome({ status: widget, logs: recent, pad: () => LogPad(state.skin === "glass" ? "glass-pad" : ""), buttons: tiles });
  return [widget(), BackupReminder(), tiles(), recent()];
}

// ---------- Movable panels (computer home screen for Glass, Flare, Daylight and Grid) ----------

const PANEL_SKINS = ["glass", "flare", "daylight", "grid"];
const SLOTS = ["top", "left", "middle", "right"];
const PANEL_IDS = ["status", "logs", "pad", "buttons"];
const DEFAULT_LAYOUT = { top: ["status"], left: ["logs"], middle: ["pad"], right: ["buttons"], hidden: [] };
const panelName = (id) => ({ status: T("Status", "Ship's status"), logs: "Recent logs", pad: T("New entry", "Captain's log"), buttons: "Buttons" })[id];

/** The saved layout, repaired so every panel appears exactly once. */
function getLayout() {
  const saved = state.prefs.layout || DEFAULT_LAYOUT;
  const out = { top: [], left: [], middle: [], right: [], hidden: [] };
  const seen = new Set();
  for (const k of [...SLOTS, "hidden"]) for (const id of saved[k] || []) {
    if (PANEL_IDS.includes(id) && !seen.has(id)) { out[k].push(id); seen.add(id); }
  }
  for (const id of PANEL_IDS) if (!seen.has(id)) out[Object.keys(DEFAULT_LAYOUT).find((k) => DEFAULT_LAYOUT[k].includes(id))].push(id);
  return out;
}

function movePanel(id, to, before) {
  const L = getLayout();
  for (const k of Object.keys(L)) L[k] = L[k].filter((x) => x !== id);
  const list = L[to];
  const i = before ? list.indexOf(before) : -1;
  if (i >= 0) list.splice(i, 0, id); else list.push(id);
  setPref("layout", L);
}

function PanelHome(build) {
  const L = getLayout();
  const on = state.arranging;
  const arrows = [["top", "↑", "Move to the top"], ["left", "←", "Move to the left"], ["middle", "●", "Move to the middle"], ["right", "→", "Move to the right"]];
  const panel = (id, slot) => h("div", { class: "ph-panel", "data-panel": id },
    on ? h("div", { class: "ph-tab" },
      h("span", { class: "ph-grip", title: "Drag to move", onpointerdown: (ev) => startPanelDrag(ev, id) }, "⠿ ", panelName(id)),
      arrows.filter(([k]) => k !== slot).map(([k, sym, tip]) => h("button", { type: "button", class: "ph-arrow", title: tip, "aria-label": `${tip}: ${panelName(id)}`, onclick: () => movePanel(id, k) }, sym)),
      h("button", { type: "button", class: "ph-arrow", title: "Hide this panel", "aria-label": `Hide ${panelName(id)}`, onclick: () => movePanel(id, "hidden") }, "✕")) : null,
    build[id]());
  const slot = (name) => {
    const ids = L[name];
    if (!ids.length && !on) return null;
    const onlyButtons = ids.length === 1 && ids[0] === "buttons";
    return h("div", { class: `ph-slot ph-${name}${onlyButtons ? " narrow" : ""}`, "data-slot": name },
      ids.map((id) => panel(id, name)),
      on && !ids.length ? h("div", { class: "ph-drop" }, "Drop a panel here") : null);
  };
  const middleEmpty = !L.middle.length && !on;
  return h("div", { class: "ph" + (on ? " arranging" : "") + (middleEmpty ? " no-middle" : "") },
    on ? h("div", { class: "ph-bar" },
      h("span", { class: "ph-bar-title" }, "Arrange the home screen: drag a panel by its name, or use the arrows."),
      L.hidden.map((id) => h("button", { type: "button", class: "small-btn", title: "Show this panel again", onclick: () => movePanel(id, "middle") }, svg(ICON.plus), panelName(id))),
      h("span", { class: "ph-space" }),
      h("button", { type: "button", class: "small-btn", onclick: () => setPref("layout", null) }, "Reset layout"),
      h("button", { type: "button", class: "small-btn filled", title: "Done", onclick: () => { state.arranging = false; render(); } }, T("Done", "Engage")))
      : h("button", { type: "button", class: "small-btn icon-btn ph-open", title: "Arrange the home screen", "aria-label": "Arrange the home screen", onclick: () => { state.arranging = true; render(); } }, svg(ICON.grid)),
    BackupReminder(),
    slot("top"),
    h("div", { class: "ph-row" }, slot("left"), slot("middle"), slot("right")));
}

/** Drags a panel with the mouse or a finger; it lands in the slot (and before the panel) under the pointer. */
function startPanelDrag(ev, id) {
  ev.preventDefault();
  const ghost = h("div", { class: "ph-ghost" }, "⠿ " + panelName(id));
  document.body.append(ghost);
  let target = null;
  const place = (x, y) => {
    ghost.style.left = x + 12 + "px"; ghost.style.top = y + 12 + "px";
    document.querySelectorAll(".ph-slot.over").forEach((el) => el.classList.remove("over"));
    const under = document.elementFromPoint(x, y);
    const slotEl = under && under.closest(".ph-slot");
    const before = under && under.closest(".ph-panel");
    target = slotEl ? [slotEl.dataset.slot, before && before.dataset.panel !== id ? before.dataset.panel : null] : null;
    if (slotEl) slotEl.classList.add("over");
  };
  place(ev.clientX, ev.clientY);
  const move = (e) => place(e.clientX, e.clientY);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    ghost.remove();
    if (target) movePanel(id, target[0], target[1]);
    else render();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/** "//TODAY 8:15 PM", "//YESTERDAY 9:02 AM" or "//NOV 07 6:40 PM". */
function stamp(iso) {
  const d = new Date(iso), now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).toUpperCase();
  const when = diff === 0 ? "TODAY" : diff === 1 ? "YESTERDAY" : d.toLocaleDateString(undefined, { month: "short", day: "2-digit" }).toUpperCase();
  return `//${when} ${time}`;
}

function RowCard(e) {
  const [, , color] = condition(e.condition);
  return h("button", { type: "button", class: "msg-row", onclick: () => openEntry(e) },
    h("span", { class: "msg-arrow", "aria-hidden": "true" }, "\u25B6"),
    h("span", { class: "msg-type" }, typeLabel(e.logType).toUpperCase()),
    h("span", { class: "msg-when" }, showCalendar() ? stamp(e.created) : `SD ${sd1(e.stardate)}`),
    h("span", { class: "msg-flag", style: { background: color }, title: condition(e.condition)[1] }),
    h("span", { class: "msg-title" }, e.title || "Untitled")
  );
}

function CommandHome() {
  const now = new Date();
  const days = weekActivity();
  const logs = days.reduce((t, d) => t + d.logs, 0);
  const words = days.reduce((t, d) => t + d.words, 0);
  const active = days.filter((d) => d.logs).length;
  const maxW = Math.max(1, ...days.map((d) => d.words));
  const ship = state.ship;
  const latest = state.entries[0];
  const stat = (label, value, sub) => h("div", { class: "cmd-stat" },
    h("span", { class: "cmd-stat-label" }, label), h("span", { class: "cmd-stat-num" }, value), h("span", { class: "cmd-stat-sub" }, sub));
  const bars = days.map((d) => h("span", { class: "cmd-bar" + (d.logs ? "" : " off"), style: { height: (8 + (d.words / maxW) * 72) + "px" } }));
  return [
    h("section", { class: "cmd-panel cmd-head" },
      h("div", { class: "stack", style: { gap: "2px", "min-width": "0" } },
        h("span", { class: "cmd-fine" }, `PERSONAL RECORDS // ${(ship.registry || "NX-0000").toUpperCase()}`),
        h("span", { class: "cmd-fine" }, dateLine(currentStardate(), now).toUpperCase()),
        h("span", { class: "cmd-name" }, (ship.captain ? "CAPT. " + ship.captain : "CAPTAIN").toUpperCase()),
        h("span", { class: "cmd-fine" }, `${(ship.ship || "SHIP").toUpperCase()} // ${conditionTag(latest ? latest.condition : "calm").toUpperCase()}`)
      ),
      h("div", { class: "cmd-stats" }, stat("LOGS", logs, "7 DAYS"), stat("DAYS", `${active}/7`, "ACTIVE"), stat("WORDS", words, "7 DAYS"))
    ),
    BackupReminder(),
    h("div", { class: "row" },
      h("h1", { class: "cmd-title" }, T("Ship's Log", "Captain's Log")),
      h("button", { type: "button", class: "small-btn icon-btn", "aria-label": "Settings and backup", title: "Settings", onclick: () => go("settings") }, svg(ICON.gear))
    ),
    h("div", { class: "cmd-sub" },
      h("span", {}, `LOG FILE (${state.entries.length} ENTRIES / ${logs} THIS WEEK)`),
      h("span", { class: "cmd-segs", "aria-hidden": "true" }, days.map((d) => h("span", { class: d.logs ? "on" : "" })))
    ),
    h("div", { class: "cmd-actions" },
      h("button", { type: "button", class: "cmd-btn primary-cmd", title: "Dictate a log", onclick: () => openCompose(null, { dictate: true }) }, svg(ICON.mic), h("span", {}, "DICTATE")),
      h("button", { type: "button", class: "cmd-btn", title: "Record audio", onclick: () => openCompose(null, { record: true }) }, svg(ICON.wave), h("span", {}, "RECORD")),
      h("button", { type: "button", class: "cmd-btn", title: "Write an entry", onclick: () => openCompose(null) }, svg(ICON.pen), h("span", {}, "WRITE"))
    ),
    state.entries.length
      ? h("section", { class: "cmd-panel cmd-list" }, state.entries.map(RowCard))
      : h("div", { class: "empty" }, "No logs on file yet. Tap Dictate or Write to make your first entry."),
    state.prefs.readout ? h("section", { class: "cmd-panel cmd-chart" },
      h("div", { class: "row" }, h("span", { class: "cmd-fine" }, "ACTIVITY // WORDS PER DAY"), h("span", { class: "cmd-fine" }, "7 DAYS")),
      h("div", { class: "cmd-bars" }, bars),
      h("div", { class: "cmd-dots", "aria-hidden": "true" }, Array.from({ length: 22 }, (_, i) => h("span", { class: i < 3 ? "big" : i % 5 === 0 ? "lit" : "" })))
    ) : null,
  ];
}

// ---------- Wide screens (computers) ----------
const WIDE = window.matchMedia("(min-width: 960px)");
WIDE.addEventListener("change", () => render());

/** Counts logs and words for each of the last n days, oldest first. */
function dayActivity(n) {
  const days = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) { const d = new Date(today); d.setDate(today.getDate() - i); days.push({ date: d, logs: 0, words: 0 }); }
  for (const e of state.entries) {
    const d = new Date(e.created); d.setHours(0, 0, 0, 0);
    const slot = days.find((x) => x.date.getTime() === d.getTime());
    if (slot) { slot.logs += 1; slot.words += (e.body.trim().match(/\S+/g) || []).length; }
  }
  return days;
}
const wordCount = (e) => (e.body.trim().match(/\S+/g) || []).length;
const pad = (n) => String(n).padStart(2, "0");

/** "-02:14:07" since the newest log, or "-3D 02:14" after a day. */
function sinceText(iso) {
  if (!iso) return "--:--:--";
  let s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const d = Math.floor(s / 86400); s %= 86400;
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return d ? `-${d}D ${pad(hh)}:${pad(mm)}` : `-${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}
setInterval(() => { const el = document.getElementById("since-last"); if (el && state.entries[0]) el.textContent = sinceText(state.entries[0].created); }, 1000);

/** Radar of the last 30 days: each log is a dot (closer = newer), the newest five get callout labels. */
function LogScan(list) {
  const cx = 210, cy = 205, R = 180, now = Date.now();
  const typeIdx = (t) => Math.max(0, LOG_TYPES.findIndex(([k]) => k === t));
  const recent = list.filter((e) => now - new Date(e.created) < 30 * 86400000);
  const place = (e, i) => {
    const age = (now - new Date(e.created)) / 86400000;
    const r = 26 + (age / 30) * (R - 30);
    let hsh = 0; for (const ch of e.id) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
    const a = ((typeIdx(e.logType) * 72 + (hsh % 50) - 25) - 90) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const rings = [36, 72, 108, 144, 180].map((r) => `<circle cx="${cx}" cy="${cy}" r="${r}" class="sc-ring"/>`).join("");
  const ticks = Array.from({ length: 72 }, (_, i) => { const a = i * 5 * Math.PI / 180, r1 = R + 4, r2 = R + (i % 6 ? 9 : 16);
    return `<path d="M${(cx + r1 * Math.cos(a)).toFixed(1)} ${(cy + r1 * Math.sin(a)).toFixed(1)}L${(cx + r2 * Math.cos(a)).toFixed(1)} ${(cy + r2 * Math.sin(a)).toFixed(1)}"/>`; }).join("");
  const sectors = LOG_TYPES.map(([k], i) => { const a = (i * 72 - 90) * Math.PI / 180, x = cx + (R + 28) * Math.cos(a), y = cy + (R + 28) * Math.sin(a) + 4;
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" class="sc-sector">${typeLabel(k).split(" ")[0].toUpperCase()}</text>`; }).join("");
  const dots = recent.map((e, i) => { const [x, y] = place(e, i);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i === 0 ? 5 : 3.5}" class="sc-dot ${e.condition}"/>${i === 0 ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" class="sc-target"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="21" class="sc-target2"/>` : ""}`; }).join("");
  const esc = (t) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const calls = recent.slice(0, 5).map((e, i) => { const [x, y] = place(e, i), ly = 54 + i * 38, lx = 450;
    return `<path d="M${x.toFixed(1)} ${y.toFixed(1)}L${lx - 26} ${ly}H${lx - 6}" class="sc-call"/><rect x="${lx}" y="${ly - 13}" width="176" height="24" rx="12" class="sc-chip"/>
      <text x="${lx + 12}" y="${ly + 4}" class="sc-label">${esc((e.title || "Untitled").slice(0, 22))}</text>`; }).join("");
  return svgEl("0 0 640 420", "scan",
    `<g class="sc-grid">${Array.from({ length: 17 }, (_, i) => `<path d="M${i * 40} 0V420"/>`).join("")}${Array.from({ length: 11 }, (_, i) => `<path d="M0 ${i * 40}H640"/>`).join("")}</g>
     ${rings}<g class="sc-ticks">${ticks}</g>
     <path d="M${cx - R - 20} ${cy}H${cx + R + 20}M${cx} ${cy - R - 20}V${cy + R + 20}" class="sc-cross"/>
     <g class="sc-sweep"><path d="M${cx} ${cy}L${cx} ${cy - R}A${R} ${R} 0 0 1 ${(cx + R * Math.sin(Math.PI / 5)).toFixed(1)} ${(cy - R * Math.cos(Math.PI / 5)).toFixed(1)}Z"/></g>
     ${sectors}${calls}${dots}<circle cx="${cx}" cy="${cy}" r="4" class="sc-center"/>`,
    `Scan of the last 30 days: ${recent.length} logs`);
}

/** Small donut per log type: its share of all logs. */
function TypeGauges() {
  const total = Math.max(1, state.entries.length);
  return h("div", { class: "gauges" }, LOG_TYPES.map(([k]) => {
    const n = state.entries.filter((e) => e.logType === k).length, pct = Math.round((n / total) * 100), C = 2 * Math.PI * 15;
    return h("div", { class: "gauge", title: `${typePlain(k)}: ${n}` },
      svgEl("0 0 40 40", "gauge-ring", `<circle cx="20" cy="20" r="15" class="g-track"/><circle cx="20" cy="20" r="15" class="g-fill" stroke-dasharray="${(pct / 100 * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 20 20)"/><text x="20" y="24" text-anchor="middle" class="g-num">${n}</text>`),
      h("span", { class: "gauge-label" }, typeLabel(k).split(" ")[0]));
  }));
}

function CommandConsole() {
  const now = new Date();
  const ship = state.ship;
  const latest = state.entries[0];
  const filter = state.cmdFilter || "all";
  const list = state.entries.filter((e) => filter === "all" || e.logType === filter);
  const week = dayActivity(7), month = dayActivity(28);
  const wk = { logs: week.reduce((t, d) => t + d.logs, 0), words: week.reduce((t, d) => t + d.words, 0), days: week.filter((d) => d.logs).length };
  const allWords = state.entries.reduce((t, e) => t + wordCount(e), 0);
  const overdue = latest && Date.now() - new Date(latest.created) > 3 * 86400000;
  const maxW = Math.max(1, ...month.map((d) => d.words));
  const big = (label, value, sub) => h("div", { class: "cc-big" }, h("span", { class: "cc-big-label" }, label), h("span", { class: "cc-big-num" }, value), sub ? h("span", { class: "cmd-fine" }, sub) : null);
  const tabs = [["all", "ALL"], ...LOG_TYPES.map(([k]) => [k, typeLabel(k).split(" ")[0].toUpperCase()])];
  return h("div", { class: "console" },
    h("section", { class: "cc-head" },
      h("div", { class: "cc-tab left" }, h("span", { class: "cmd-fine" }, `SYS ${(ship.registry || "NX-0000").toUpperCase()}`), h("span", { class: "cc-tab-num" }, showStardate() ? sd1(currentStardate()) : now.toLocaleDateString(undefined, { month: "short", day: "numeric" }))),
      h("div", { class: "cc-title-block" },
        h("span", { class: "cmd-fine" }, `PERSONAL RECORDS // ${(ship.ship || "SHIP").toUpperCase()} // ${(ship.captain ? "CAPT. " + ship.captain : "CAPTAIN").toUpperCase()}`),
        h("h1", { class: "cmd-title" }, T("Ship's Log", "Captain's Log"))),
      h("div", { class: "cc-chs", role: "group", "aria-label": "Filter by type" }, tabs.map(([k, name], i) =>
        h("button", { type: "button", class: "cc-ch", "aria-pressed": String(filter === k), onclick: () => { state.cmdFilter = k; render(); } }, h("span", { class: "cc-ch-n" }, "CH " + pad(i + 1)), name))),
      h("button", { type: "button", class: "small-btn icon-btn", "aria-label": "Settings", title: "Settings", onclick: () => go("settings") }, svg(ICON.gear)),
      h("div", { class: "cc-tab right" }, h("span", { class: "cmd-fine" }, "LOG FILE"), h("span", { class: "cc-tab-num" }, String(state.entries.length).padStart(4, "0")))
    ),
    h("aside", { class: "cc-left" },
      h("section", { class: "cmd-panel cc-alert" + (overdue ? " red" : "") },
        h("span", { class: "cc-alert-head" }, overdue ? "LOG OVERDUE :" : "LAST ENTRY :"),
        h("span", { id: "since-last", class: "cc-alert-num" }, sinceText(latest && latest.created)),
        h("span", { class: "cmd-fine" }, latest ? (latest.title || "Untitled").toUpperCase() : "NO LOGS ON FILE")),
      h("section", { class: "cmd-panel" },
        h("span", { class: "cmd-fine" }, T("LAST 7 DAYS", "SHIP'S STATUS // 7 DAYS")),
        h("div", { class: "cc-bigs" }, big("LOGS", wk.logs), big("DAYS", `${wk.days}/7`), big("WORDS", wk.words))),
      h("section", { class: "cmd-panel" }, h("span", { class: "cmd-fine" }, "LOG TYPES // ALL TIME"), TypeGauges()),
      h("div", { class: "cc-actions" },
        h("button", { type: "button", class: "cmd-btn primary-cmd", title: "Dictate a log", onclick: () => openCompose(null, { dictate: true }) }, svg(ICON.mic), h("span", {}, "DICTATE")),
        h("button", { type: "button", class: "cmd-btn", title: "Record audio", onclick: () => openCompose(null, { record: true }) }, svg(ICON.wave), h("span", {}, "RECORD")),
        h("button", { type: "button", class: "cmd-btn", title: "Write an entry", onclick: () => openCompose(null) }, svg(ICON.pen), h("span", {}, "WRITE")))
    ),
    h("div", { class: "cc-center" }, LogPad("cmd-panel cmd-pad"), h("section", { class: "cmd-panel cc-scanbox" },
      h("div", { class: "row" }, h("span", { class: "cmd-fine" }, "SCANNING LOG FILE // LAST 30 DAYS"), h("span", { class: "cmd-fine" }, `${list.length} RECORDS`)),
      LogScan(list),
      h("div", { class: "cc-scan-foot" },
        latest ? h("div", { class: "cc-scan-text" },
          h("span", { class: "cc-scan-h" }, "LATEST ENTRY :"),
          h("span", {}, `TITLE: ${(latest.title || "Untitled").toUpperCase()}`),
          h("span", {}, `TYPE: ${typeLabel(latest.logType).toUpperCase()}`),
          h("span", {}, `STATUS: ${conditionTag(latest.condition).toUpperCase()}`),
          h("span", {}, `PLACE: ${(latest.place || "UNKNOWN").toUpperCase()}`)) : h("span"),
        big("WORDS ON FILE", allWords.toLocaleString(), `${state.entries.length} ENTRIES`))
    )),
    h("aside", { class: "cmd-panel cc-right" },
      h("div", { class: "row" }, h("span", { class: "cmd-fine" }, `LOG FILE (${list.length} ENTRIES / ${wk.logs} THIS WEEK)`)),
      list.length ? h("div", { class: "cmd-list cc-list" }, list.map(RowCard)) : h("div", { class: "empty" }, "No logs here yet.")),
    state.prefs.readout ? h("section", { class: "cmd-panel cc-foot" },
      h("div", { class: "row" }, h("span", { class: "cmd-fine" }, "ACTIVITY // WORDS PER DAY // 28 DAYS"), h("span", { class: "cmd-fine" }, `${month.filter((d) => d.logs).length} ACTIVE DAYS`)),
      h("div", { class: "cc-bars" }, month.map((d) => h("span", { class: "cmd-bar" + (d.logs ? "" : " off"), title: `${d.date.toLocaleDateString()}: ${d.words} words`, style: { height: (6 + (d.words / maxW) * 64) + "px" } }))),
      h("div", { class: "cmd-dots" }, month.map((d, i) => h("span", { class: i === month.length - 1 ? "big" : d.logs ? "lit" : "" })))) : null
  );
}

/** Console skin on a computer: elbow-framed panel with number blocks and a striped log bar. */
function ConsoleWide() {
  const now = new Date();
  const month = dayActivity(28);
  const typeColor2 = { personal: "var(--accent)", engineering: "var(--orange)", medical: "var(--accent2)", science: "#9fb6ff", away: "#e9b9ff" };
  const counts = LOG_TYPES.map(([k]) => [k, state.entries.filter((e) => e.logType === k).length]);
  const num = (n, w = 4) => String(n).padStart(w, "0");
  const words = state.entries.reduce((t, e) => t + wordCount(e), 0);
  const stripes = [];
  for (const d of month) {
    const day = state.entries.filter((e) => { const x = new Date(e.created); x.setHours(0, 0, 0, 0); return x.getTime() === d.date.getTime(); });
    if (!day.length) stripes.push(h("span", { class: "lw-stripe gap" }));
    for (const e of day) stripes.push(h("span", { class: "lw-stripe", title: e.title, style: { background: typeColor2[e.logType] || "var(--accent)", flex: String(1 + Math.min(4, wordCount(e) / 40)) } }));
  }
  return h("div", { class: "lw" },
    h("div", { class: "lw-top" },
      h("div", { class: "lw-elbow top" }),
      h("div", { class: "lw-topbar" },
        h("span", { class: "lw-blk a" }, num(state.entries.length)), h("span", { class: "lw-blk b" }, num(words, 5)), h("span", { class: "lw-fill" }),
        h("h1", { class: "lw-title" }, T("Ship's Log", "Bridge")), h("span", { class: "lw-cap" }))
    ),
    h("div", { class: "lw-body" },
      h("div", { class: "lw-rail" },
        counts.map(([k, n]) => h("button", { type: "button", class: "lw-seg", style: { background: typeColor2[k] }, onclick: () => { state.query = ""; state.queryType = k; go("search"); } },
          h("span", {}, typeLabel(k)), h("b", {}, num(n, 3)))),
        h("span", { class: "lw-seg tall" })
      ),
      h("section", { class: "lw-file" },
        LogPad("lw-pad"),
        h("div", { class: "lw-file-head" }, h("span", {}, "FILE = " + T("SHIP'S LOG", "CAPTAIN'S LOG")), h("span", {}, "ENTRY BY " + (state.ship.captain ? state.ship.captain : "CAPTAIN").toUpperCase())),
        state.entries.length ? state.entries.map((e) => h("button", { type: "button", class: "lw-row", onclick: () => openEntry(e) },
          h("span", { class: "lw-dot", style: { background: condition(e.condition)[2] } }),
          h("span", { class: "lw-n" }, entryDate(e)),
          h("span", { class: "lw-n" }, num(wordCount(e), 4)),
          h("span", { class: "lw-type", style: { color: typeColor2[e.logType] } }, typeLabel(e.logType)),
          h("span", { class: "lw-t" }, e.title || "Untitled"))) : h("div", { class: "empty" }, "No logs on file yet.")
      ),
      h("section", { class: "lw-side" },
        h("span", { class: "lw-label" }, T("Log date", "Stardate")),
        h("span", { class: "lw-date" }, showStardate() ? sd1(currentStardate()) : now.toLocaleDateString(undefined, { month: "short", day: "numeric" })),
        showCalendar() ? h("span", { class: "lw-label small" }, formatDate(now)) : null,
        state.prefs.readout ? h("div", { class: "lw-bar", title: "Last 28 days" }, stripes) : null,
        state.prefs.readout ? h("div", { class: "row lw-under" }, h("span", {}, "28 DAYS"), h("span", {}, `${month.filter((d) => d.logs).length} ACTIVE`)) : null,
        h("div", { class: "lw-btns" },
          h("button", { type: "button", class: "lw-btn go", title: "Dictate a log", onclick: () => openCompose(null, { dictate: true }) }, h("span", {}, "Dictate")),
          h("button", { type: "button", class: "lw-btn", title: "Record audio", onclick: () => openCompose(null, { record: true }) }, h("span", {}, "Record")),
          h("button", { type: "button", class: "lw-btn alt", title: "Write an entry", onclick: () => openCompose(null) }, h("span", {}, "Write")),
          h("button", { type: "button", class: "lw-btn dim", title: "Settings", onclick: () => go("settings") }, h("span", {}, T("Settings", "Engineering"))))
      )
    ),
    h("div", { class: "lw-bottom" },
      h("div", { class: "lw-elbow bottom" }),
      h("div", { class: "lw-topbar" }, h("span", { class: "lw-blk c" }, conditionTag((state.entries[0] || {}).condition || "calm")), h("span", { class: "lw-fill" }), h("span", { class: "lw-blk a" }, (state.ship.registry || "NX-0000").toUpperCase()), h("span", { class: "lw-cap" })))
  );
}

function LogsScreen() {
  if (state.skin === "glass" || (WIDE.matches && PANEL_SKINS.includes(state.skin))) return TileHome();
  if (state.skin === "console" && WIDE.matches) return ConsoleWide();
  if (state.skin === "command") return WIDE.matches ? CommandConsole() : CommandHome();
  const latest = state.entries[0];
  const [, , condColor] = condition(latest ? latest.condition : "calm");
  const now = new Date();
  return [
    h("header", { class: "stack" },
      h("div", { class: "row" },
        h("h1", { class: "title" }, T("Ship's Log", "Bridge")),
        h("button", { type: "button", class: "small-btn icon-btn", "aria-label": "Settings and backup", onclick: () => go("settings") }, svg(ICON.gear))
      ),
      h("div", { class: "row" },
        h("div", { class: "muted" }, dateLine(currentStardate(), now)),
        h("span", { class: "chip", title: conditionTag(latest ? latest.condition : "calm"), style: { "--c": condColor } }, conditionTag(latest ? latest.condition : "calm"))
      )
    ),
    state.prefs.readout ? ReadoutStrip() : null,
    BackupReminder(),
    h("button", { type: "button", class: "primary", title: "Dictate a log", onclick: () => openCompose(null, { dictate: true }) },
      svg(ICON.mic), "Dictate a log"),
    h("div", { class: "row", style: { "justify-content": "center" } },
      h("button", { type: "button", class: "small-btn", title: "Record audio", onclick: () => openCompose(null, { record: true }) },
        svg(ICON.wave), "Record audio"),
      h("button", { type: "button", class: "small-btn", title: "Write an entry", onclick: () => openCompose(null) },
        svg(ICON.pen), "Write")
    ),
    h("div", { class: "row" },
      h("h2", { class: "h2" }, "Recent logs"),
      h("span", { class: "muted" }, `${state.entries.length} on file`)
    ),
    state.entries.length
      ? h("div", { class: "list" }, state.entries.map((e) => EntryCard(e)))
      : h("div", { class: "empty" }, "No logs on file yet. Tap Dictate a log, or Write, to make your first entry."),
  ];
}

// ---------- Settings and backup ----------

const isPhone = () => {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod|Android/i.test(ua) || (/Mac/i.test(ua) && navigator.maxTouchPoints > 1);
};
const canAutoBackup = () => !!tauri && !isPhone();

const backupUi = { status: null, message: "", error: "", busy: "", restoreArmed: false };

function persistSettings() {
  api.saveSettings(JSON.stringify({ skin: state.skin, ship: state.ship, textColor: state.textColor, prefs: state.prefs })).catch(() => {});
}

function applySettings(json) {
  let s = {};
  try { s = JSON.parse(json || "{}"); } catch {}
  if (SKINS.some(([k]) => k === s.skin)) state.skin = s.skin;
  if (s.ship) state.ship = { captain: "", ship: "", registry: "", ...s.ship };
  if (typeof s.textColor === "string") state.textColor = s.textColor;
  if (s.prefs && typeof s.prefs === "object") Object.assign(state.prefs, s.prefs);
  try {
    localStorage.setItem("shipslog.skin", state.skin);
    localStorage.setItem("shipslog.ship", JSON.stringify(state.ship));
    localStorage.setItem("shipslog.textColor", state.textColor);
    localStorage.setItem("shipslog.prefs", JSON.stringify(state.prefs));
  } catch {}
  persistSettings();
}

async function loadBackupStatus() {
  try { backupUi.status = await api.backupStatus(); } catch { backupUi.status = null; }
  try { backupUi.location = await api.dataLocation(); } catch { backupUi.location = null; }
}

async function doMakePortable() {
  if (!backupUi.portableArmed) { backupUi.portableArmed = true; render(); return; }
  backupUi.portableArmed = false;
  backupUi.error = ""; backupUi.message = "";
  try {
    const dest = await api.makePortable();
    backupUi.message = `Your log was copied to ${dest}. Restart Ship's Log to start using it there. Keep the folder next to the app when you move them (for example to a USB drive).`;
    backupUi.needsRestart = true;
  } catch (e) { backupUi.error = String(e); }
  render();
}

async function doMoveData(toDocuments) {
  const key = toDocuments ? "docs" : "standard";
  if (backupUi.moveArmed !== key) { backupUi.moveArmed = key; render(); return; }
  backupUi.moveArmed = "";
  backupUi.error = ""; backupUi.message = "";
  try {
    const dest = await api.moveData(toDocuments);
    backupUi.message = `Your log was copied to ${dest}. Restart Ship's Log to start using it there. The old copy stays where it was, with a MOVED.txt note, until you delete it.`;
    backupUi.needsRestart = true;
  } catch (e) { backupUi.error = String(e); }
  render();
}

const fileManagerName = () => /Mac/i.test(navigator.userAgent) ? "Finder" : /Windows/i.test(navigator.userAgent) ? "File Explorer" : "the file manager";

/** Where the log lives, with Show in Finder, Move to Documents and the portable option on computers. */
function LocationCard() {
  const loc = backupUi.location;
  if (!loc) return null;
  const computer = canAutoBackup();
  return h("section", { class: "card settings-card" },
    h("h2", { class: "h2" }, T("Where your log is kept", "Ship's computer core")),
    h("p", {}, loc.portable ? "Portable: everything is kept in the folder beside the app."
      : loc.in_documents ? "Everything (logs, recordings, photos, video and settings) is kept in your Documents folder:"
      : "Everything (logs, recordings, photos, video and settings) is kept in the app's standard data folder:"),
    h("div", { class: "small path" }, loc.path),
    computer ? h("button", { type: "button", class: "small-btn", onclick: () => api.showDataFolder().catch((e) => { backupUi.error = String(e); render(); }) },
      svg(ICON.folder), `Show in ${fileManagerName()}`) : null,
    backupUi.needsRestart ? h("button", { type: "button", class: "primary", onclick: () => api.restartApp() }, T("Restart now", "Engage")) : null,
    computer && !loc.portable && !backupUi.needsRestart
      ? (loc.in_documents
          ? [
              h("p", { class: "small" }, "Move it back to the app's standard data folder, which is hidden so it can't be moved or deleted by accident."),
              h("button", { type: "button", class: "small-btn" + (backupUi.moveArmed === "standard" ? " danger" : ""), onclick: () => doMoveData(false) },
                backupUi.moveArmed === "standard" ? "Tap again to move it back" : "Move back to the standard folder"),
            ]
          : [
              h("p", { class: "small" }, `Or keep it in your Documents folder (${loc.documents_path}), where you can see it. If Documents is synced (iCloud Drive, OneDrive), the log is synced too; don't use the app on two computers with the same synced log at once.`),
              h("button", { type: "button", class: "small-btn" + (backupUi.moveArmed === "docs" ? " danger" : ""), onclick: () => doMoveData(true) },
                backupUi.moveArmed === "docs" ? "Tap again to move it to Documents" : "Move to Documents"),
            ])
      : null,
    computer && !loc.portable && !backupUi.needsRestart
      ? [
          h("p", { class: "small" }, `To make the app portable, for example to run it from a USB drive, it keeps its log in a folder named “${loc.portable_folder}” right next to the app. This copies your log there.`,
            loc.app_folder ? ` The app is in ${loc.app_folder}.` : ""),
          h("button", { type: "button", class: "small-btn" + (backupUi.portableArmed ? " danger" : ""), onclick: doMakePortable },
            svg(ICON.folder), backupUi.portableArmed ? "Tap again to copy the log beside the app" : T("Make portable", "Engage portable mode")),
        ]
      : null);
}

const daysSince = (secs) => Math.floor((Date.now() / 1000 - secs) / 86400);
function lastBackupText(status) {
  if (!status || !status.lastBackup) return "No backup yet";
  const days = daysSince(status.lastBackup);
  const when = new Date(status.lastBackup * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const ago = days <= 0 ? "today" : days === 1 ? "yesterday" : days < 14 ? `${days} days ago` : days < 60 ? `${Math.round(days / 7)} weeks ago` : `${Math.round(days / 30)} months ago`;
  return `Last backup ${ago} (${when})`;
}

async function doBackup() {
  backupUi.busy = "Backing up…"; backupUi.message = ""; backupUi.error = "";
  render();
  try {
    const info = await api.backupNow();
    if (info) {
      backupUi.message = `Backup saved: ${info.entries} ${info.entries === 1 ? "log" : "logs"} and ${info.files} ${info.files === 1 ? "file" : "files"}, ${megabytes(info.bytes)}.` +
        (isPhone() && tauri ? " Find it in the Files app under Ship's Log › Backups." : ` Saved to ${info.path}.`);
    }
  } catch (err) {
    backupUi.error = "Backup didn't finish: " + (err.message || err);
  }
  backupUi.busy = "";
  await loadBackupStatus();
  render();
}

async function doRestore() {
  if (!backupUi.restoreArmed) { backupUi.restoreArmed = true; render(); return; }
  backupUi.restoreArmed = false;
  backupUi.busy = "Restoring…"; backupUi.message = ""; backupUi.error = "";
  render();
  try {
    const settings = await api.restoreBackup();
    if (settings != null) {
      applySettings(settings);
      await refresh();
      backupUi.message = `Restored ${state.entries.length} ${state.entries.length === 1 ? "log" : "logs"}.` +
        (tauri ? " Your previous log was kept in the app's before-restore folder." : "");
    }
  } catch (err) {
    backupUi.error = "Restore didn't finish: " + (err.message || err) + " Your log hasn't been changed.";
  }
  backupUi.busy = "";
  render();
}

async function setAuto(off, every) {
  backupUi.error = "";
  try { backupUi.status = await api.setAutoBackup(off, every); }
  catch (err) { backupUi.error = String(err.message || err); }
  render();
}

const ACCENT_COLORS = [
  ["", "Skin default"],
  ["#f7b538", "Gold"],
  ["#ff8a3d", "Orange"],
  ["#ff6b6b", "Red"],
  ["#ff5ad1", "Pink"],
  ["#a99ae6", "Lavender"],
  ["#5aa2ff", "Blue"],
  ["#19e6ff", "Cyan"],
  ["#8dff6a", "Green"],
];

function Toggle(label, about, key) {
  const on = !!state.prefs[key];
  return h("button", { type: "button", class: "toggle", role: "switch", "aria-checked": String(on), onclick: () => setPref(key, !on) },
    h("span", { class: "stack", style: { gap: "2px", flex: "1", "min-width": "0" } },
      h("span", { class: "h3" }, label),
      h("span", { class: "small" }, about)
    ),
    h("span", { class: "switch", "aria-hidden": "true" })
  );
}

function DisplayOptions() {
  const p = state.prefs;
  const custom = p.accent && !ACCENT_COLORS.some(([c]) => c === p.accent);
  return h("section", { class: "card settings-card" },
    h("h2", { class: "h2" }, T("Display options", "Main Helm")),

    h("div", { class: "stack" },
      h("span", { class: "label", id: "tsize-label" }, "Text size"),
      h("div", { class: "segment wrap text-sizes", role: "group", "aria-labelledby": "tsize-label" },
        [[0.9, "Small"], [1, "Normal"], [1.15, "Large"], [1.3, "Larger"], [1.5, "Largest"]].map(([v, name]) =>
          h("button", { type: "button", "aria-pressed": String((p.textSize || 1) === v), style: { "font-size": `calc(${Math.round(13 * v)}px)` },
            onclick: () => { setPref("textSize", v); requestAnimationFrame(fitCoverTitle); } }, name))),
      h("span", { class: "small" }, "Makes all the writing in the app bigger or smaller.")
    ),
    isTouchDevice() ? h("div", { class: "stack" },
      h("span", { class: "label", id: "dmode-label" }, "Dictation"),
      h("div", { class: "segment", role: "group", "aria-labelledby": "dmode-label" },
        [["app", "App listens"], ["keyboard", "Keyboard microphone"]].map(([k, name]) =>
          h("button", { type: "button", "aria-pressed": String((p.dictationMode || "app") === k), onclick: () => setPref("dictationMode", k) }, name))),
      h("span", { class: "small" }, (p.dictationMode === "keyboard")
        ? "Dictate opens the keyboard; tap its microphone. Usually the most accurate on a phone. Spoken commands (make it so…) don't work this way."
        : "The app listens and understands spoken commands. If it misses words, try Keyboard microphone.")
    ) : null,

    h("div", { class: "stack" },
      h("span", { class: "label", id: "accent-label" }, "Accent color"),
      h("div", { class: "swatches", role: "group", "aria-labelledby": "accent-label" },
        ACCENT_COLORS.map(([c, name]) =>
          h("button", {
            type: "button", class: "swatch" + (c ? "" : " default"), title: name, "aria-label": name,
            "aria-pressed": String(p.accent === c), style: c ? { "--swatch": c } : null,
            onclick: () => setPref("accent", c),
          }, c ? null : h("span", { "aria-hidden": "true" }, "A"))
        ),
        h("label", { class: "swatch custom" + (custom ? " selected" : ""), title: "Choose any color", style: custom ? { "--swatch": p.accent } : null },
          h("span", { class: "sr-only" }, "Choose any color"),
          svg(ICON.palette),
          h("input", { type: "color", class: "sr-only", value: p.accent || "#f7b538", onchange: (ev) => setPref("accent", ev.target.value) })
        )
      ),
      h("span", { class: "small" }, "Changes buttons, titles and highlights in every skin. “A” uses the skin's own color.")
    ),

    h("div", { class: "stack" },
      h("span", { class: "label", id: "alert-label" }, T("Condition colors", "Alert colors")),
      h("div", { class: "segment", role: "group", "aria-labelledby": "alert-label" },
        [["off", "Off"], ["subtle", "Subtle"], ["full", "Full"]].map(([k, name]) =>
          h("button", { type: "button", "aria-pressed": String(p.alertMode === k), onclick: () => setPref("alertMode", k) }, name)
        )
      ),
      h("span", { class: "small" }, {
        off: "The app looks the same whatever your latest log's condition is.",
        subtle: `When your latest log is ${condition("caution")[1]} or ${condition("critical")[1]}, the top bar changes color.`,
        full: `When your latest log is ${condition("caution")[1]} or ${condition("critical")[1]}, the whole app turns yellow or red.`,
      }[p.alertMode])
    ),

    h("div", { class: "stack" },
      h("span", { class: "label", id: "dates-label" }, T("Dates", "Stardates")),
      h("div", { class: "segment", role: "group", "aria-labelledby": "dates-label" },
        [["both", "Both"], ["stardate", "Stardate"], ["calendar", "Calendar"]].map(([k, name]) =>
          h("button", { type: "button", "aria-pressed": String(p.dateStyle === k), onclick: () => setPref("dateStyle", k) }, name)
        )
      ),
      h("span", { class: "small" }, {
        both: "Logs show a stardate and the calendar date.",
        stardate: "Logs show only stardates; calendar dates are hidden.",
        calendar: "Logs show only calendar dates, no stardates.",
      }[p.dateStyle] || "")
    ),
    Toggle("Story mode", "For telling a story: you set each entry's stardate on the entry screen, logs are listed in stardate order, and a new entry carries on from where your story left off. Calendar dates are hidden.", "storyMode"),

    state.skin === "glass" ? Toggle("Clear glass", "Glass skin: see-through tiles with no tint", "glassClear") : null,
    Toggle("Ship terms", "Names like Bridge, Engineering and Sick Bay, and buttons like Make it so and Energize. Turn off for plain labels.", "shipTerms"),
    Toggle("Spoken commands", "While dictating, say “make it so”, “engage” or “punch it” at the end to save, “belay that” to take back the last words, or “stand down” to stop listening.", "voiceCommands"),
    WIDE.matches && PANEL_SKINS.includes(state.skin)
      ? h("button", { type: "button", class: "small-btn", onclick: () => { state.arranging = true; go("logs"); } }, svg(ICON.grid), "Arrange the home screen")
      : null,
    Toggle(T("Activity readout", "Ship's Status"), T("A graph of your last 7 days on the Logs screen", "A graph of your last 7 days on the Bridge"), "readout"),
    Toggle("Card graphics", "A small line drawing on each log for its type", "glyphs"),
    Toggle("Icons instead of words", "Buttons and tags show icons and colors only", "iconsOnly")
  );
}

/** A gentle note on the Logs screen when a backup is overdue. */
function BackupReminder() {
  const s = backupUi.status;
  if (!s || !state.entries.length) return null;
  const overdue = !s.lastBackup || daysSince(s.lastBackup) >= 14;
  if (!overdue || s.autoFolder) return null;
  return h("div", { class: "notice row", style: { "justify-content": "space-between" } },
    h("span", {}, s.lastBackup ? lastBackupText(s) + "." : "Your log hasn't been backed up yet."),
    h("button", { type: "button", class: "small-btn", onclick: () => go("settings") }, T("Back up", "Beam out"))
  );
}

function SettingsScreen() {
  const s = backupUi.status || { lastBackup: null, autoFolder: null, autoEveryDays: 7 };
  const busy = !!backupUi.busy;
  return [
    h("header", { class: "row", style: { "justify-content": "flex-start", gap: "6px" } },
      h("button", { type: "button", class: "small-btn icon-btn", "aria-label": "Back to logs", onclick: () => { backupUi.restoreArmed = false; go("logs"); } }, svg(ICON.back)),
      h("h1", { class: "title" }, T("Settings", "Engineering")),
      h("span", { style: { flex: "1" } }),
      h("button", { type: "button", class: "small-btn", title: "Guide: how everything works (F1)", onclick: () => openHelp() }, svg(ICON.help), T("Guide", "Ship's manual"))
    ),

    h("section", { class: "card settings-card" },
      h("h2", { class: "h2" }, T("Appearance", "Holo Deck")),
      h("p", {}, "Choose how the app looks. Your logs stay the same in every skin."),
      SkinPicker(),
      state.skin === "grid" ? GridBackdropPicker() : null
    ),

    DisplayOptions(),

    VoiceSettings(),

    h("section", { class: "card settings-card" },
      h("h2", { class: "h2" }, T("Backup", "Transporter Room")),
      h("p", {}, "A backup is one file with all your logs, recordings, photos, videos and settings. Keep it somewhere safe, like iCloud Drive, Dropbox or a USB drive."),
      h("div", { class: "small", style: { color: s.lastBackup ? "var(--accent2)" : "var(--caution)" } }, lastBackupText(s)),
      h("button", { type: "button", class: "primary", disabled: busy, onclick: doBackup }, svg(ICON.save), backupUi.busy === "Backing up…" ? "Backing up…" : T("Back up now", "Energize")),
      backupUi.message ? h("div", { class: "notice" }, backupUi.message) : null,
      backupUi.error ? h("div", { class: "notice", style: { "border-color": "var(--critical)", color: "var(--critical)" } }, backupUi.error) : null
    ),

    h("section", { class: "card settings-card" },
      h("h2", { class: "h2" }, T("Restore", "Transporter Room: beam in")),
      h("p", {}, "Bring back a log from a backup file, on this device or a new one. This replaces the log that's here now; the current one is kept in a separate folder just in case."),
      h("button", { type: "button", class: "small-btn" + (backupUi.restoreArmed ? " danger" : ""), disabled: busy, onclick: doRestore },
        svg(ICON.restore), backupUi.busy === "Restoring…" ? "Restoring…" : backupUi.restoreArmed ? "Tap again to choose a backup" : T("Restore from a backup", "Beam in a backup"))
    ),

    canAutoBackup()
      ? h("section", { class: "card settings-card" },
          h("h2", { class: "h2" }, "Automatic backup"),
          h("p", {}, s.autoFolder
            ? `Backups are saved to ${s.autoFolder}. The 10 newest are kept.`
            : "Save a backup to a folder you choose, on a schedule. Pick a folder that's synced (iCloud Drive, Dropbox, OneDrive) or on another drive."),
          h("div", { class: "segment", role: "group", "aria-label": "How often" },
            [[1, "Daily"], [7, "Weekly"], [30, "Monthly"]].map(([days, label]) =>
              h("button", { type: "button", "aria-pressed": String(s.autoEveryDays === days), onclick: () => setAuto(!s.autoFolder, days) }, label)
            )
          ),
          h("div", { class: "row", style: { "justify-content": "flex-start" } },
            s.autoFolder
              ? [
                  h("button", { type: "button", class: "small-btn", onclick: async () => { await setAuto(true, s.autoEveryDays); setAuto(false, s.autoEveryDays); } }, "Change folder"),
                  h("button", { type: "button", class: "small-btn danger", onclick: () => setAuto(true, s.autoEveryDays) }, "Turn off"),
                ]
              : h("button", { type: "button", class: "small-btn filled", onclick: () => setAuto(false, s.autoEveryDays) }, svg(ICON.folder), "Choose folder and turn on")
          )
        )
      : null,

    LocationCard(),

    h("section", { class: "card settings-card" },
      h("h2", { class: "h2" }, "Ship's details"),
      h("p", {}, [state.ship.captain && "Capt. " + state.ship.captain, state.ship.ship, state.ship.registry].filter(Boolean).join(" • ") || "Not set yet."),
      h("button", { type: "button", class: "small-btn", onclick: () => { state.editingShip = true; go("cover"); } }, "Edit details")
    ),
  ];
}

// ---------- Audio recording ----------

const recorder = {
  active: null,   // { media, stream, chunks, started, done }
  playing: null,  // { file, audio, url }
  error: "",
};

function pickMime() {
  if (!window.MediaRecorder) return "";
  const options = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return options.find((m) => MediaRecorder.isTypeSupported(m)) || "";
}
const extFor = (mime) => (mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm");

async function startRecording() {
  if (recorder.active) return;
  if (dictation.active) stopDictation(); // one thing listens to the microphone at a time
  recorder.error = "";
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    recorder.error = "Audio recording isn't available on this device yet.";
    render();
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    recorder.error = "Microphone access was turned down. You can allow it in the device's settings.";
    render();
    return;
  }
  const mime = pickMime();
  const media = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  const chunks = [];
  let finish;
  const done = new Promise((resolve) => (finish = resolve));
  media.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
  media.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    const seconds = (Date.now() - recorder.active.started) / 1000;
    const type = (media.mimeType || mime || "audio/webm").split(";")[0];
    recorder.active = null;
    const d = state.draft;
    if (chunks.length && d && !finish.discard) {
      const file = `rec-${Date.now()}.${extFor(type)}`;
      try {
        await api.saveAudio(file, new Blob(chunks, { type }));
        d.recordings.push({ file, mime: type, seconds });
        d.newFiles.push(file);
      } catch (err) {
        recorder.error = "Couldn't save the recording: " + err;
      }
    }
    if (state.screen === "compose") render();
    finish();
  };
  recorder.active = { media, stream, started: Date.now(), done, finish };
  media.start(1000);
  render();
}

/** Stops the current recording; resolves once it has been saved (or discarded). */
async function stopRecording(discard = false) {
  const a = recorder.active;
  if (!a) return;
  a.finish.discard = discard;
  a.media.stop();
  await a.done;
}

function stopPlayback() {
  const p = recorder.playing;
  if (!p) return;
  p.audio.pause();
  URL.revokeObjectURL(p.url);
  recorder.playing = null;
}

async function togglePlay(rec) {
  const same = recorder.playing && recorder.playing.file === rec.file;
  stopPlayback();
  if (same) { render(); return; }
  try {
    const url = URL.createObjectURL(await api.loadAudio(rec));
    const audio = new Audio(url);
    recorder.playing = { file: rec.file, audio, url };
    audio.onended = () => { stopPlayback(); render(); };
    await audio.play();
  } catch (err) {
    stopPlayback();
    recorder.error = "Couldn't play that recording: " + (err.message || err);
  }
  render();
}

// Keeps the recording timer ticking without redrawing the screen.
setInterval(() => {
  const el = document.getElementById("rec-timer");
  if (el && recorder.active) el.textContent = clock((Date.now() - recorder.active.started) / 1000);
}, 250);

function RecordingsSection(d) {
  const a = recorder.active;
  return h("div", { class: "stack" },
    h("div", { class: "row" },
      h("span", { class: "label" }, T("Recordings", "Communications")),
      a
        ? h("button", { type: "button", class: "small-btn danger", onclick: () => stopRecording() },
            h("span", { class: "rec-dot", "aria-hidden": "true" }),
            h("span", { id: "rec-timer" }, clock((Date.now() - a.started) / 1000)),
            svg(ICON.stop), "Stop")
        : h("button", { type: "button", class: "small-btn filled", onclick: startRecording }, svg(ICON.mic), "Record")
    ),
    recorder.error ? h("div", { class: "notice", style: { "border-color": "var(--critical)", color: "var(--critical)" } }, recorder.error) : null,
    d.recordings.length
      ? h("div", { class: "list" }, d.recordings.map((rec, i) => {
          const isPlaying = recorder.playing && recorder.playing.file === rec.file;
          return h("div", { class: "recording" },
            h("button", {
              type: "button", class: "small-btn", "aria-label": isPlaying ? "Pause" : "Play",
              style: isPlaying ? { color: "var(--accent)", "border-color": "var(--accent)" } : null,
              onclick: () => togglePlay(rec),
            }, svg(isPlaying ? ICON.pause : ICON.play)),
            h("span", { class: "stack", style: { flex: "1", gap: "2px" } },
              h("span", { class: "h3", style: { "font-size": "15px" } }, `Recording ${i + 1}`),
              h("span", { class: "small" }, clock(rec.seconds))
            ),
            h("button", {
              type: "button", class: "small-btn", "aria-label": `Delete recording ${i + 1}`,
              onclick: () => removeRecording(d, rec),
            }, svg(ICON.trash))
          );
        }))
      : a ? null : h("div", { class: "small" }, "No recordings on this entry.")
  );
}

async function removeRecording(d, rec) {
  if (recorder.playing && recorder.playing.file === rec.file) stopPlayback();
  d.recordings = d.recordings.filter((r) => r.file !== rec.file);
  if (d.newFiles.includes(rec.file)) {
    // Never saved with the entry, so it can go right away.
    d.newFiles = d.newFiles.filter((f) => f !== rec.file);
    await api.deleteAudio(rec.file).catch(() => {});
  } else {
    // Already part of the saved entry: delete the file only once the entry is saved.
    d.removedFiles.push(rec.file);
  }
  render();
}

// ---------- Dictation (speech to text) ----------
// Uses the system's speech recognition when the app's web view offers it
// (Apple devices, and Chrome-based views where available). Elsewhere it points
// to the system's own dictation, which types into any text box.

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const dictation = { rec: null, active: false, interim: "", hint: "" };

function isTouchDevice() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod|Android/i.test(ua) || (/Mac/i.test(ua) && navigator.maxTouchPoints > 1);
}

function platformDictationHint() {
  const ua = navigator.userAgent;
  const touchMac = /Mac/i.test(ua) && navigator.maxTouchPoints > 1; // iPad reports itself as a Mac
  if (/iPhone|iPad|iPod|Android/i.test(ua) || touchMac) return "Tap the microphone on your keyboard to dictate into the entry.";
  if (/Mac/i.test(ua)) return "Press the Fn (Globe) key twice to dictate with macOS, and again to stop.";
  if (/Windows/i.test(ua)) return "Press Windows + H to dictate with Windows voice typing.";
  return "Dictation isn't available on this system yet. You can record audio instead.";
}

// Spoken punctuation, for systems that don't add it themselves.
const SPOKEN = [
  [/\s*\bnew paragraph\b\s*/gi, "\n\n"],
  [/\s*\bnew line\b\s*/gi, "\n"],
  [/\s*\b(period|full stop)\b/gi, "."],
  [/\s*\bcomma\b/gi, ","],
  [/\s*\bquestion mark\b/gi, "?"],
  [/\s*\bexclamation (point|mark)\b/gi, "!"],
  [/\s*\bcolon\b/gi, ":"],
];

/*
  Spoken commands, in ship phrases, said at the end of what you dictate:
  save ("make it so", "engage", "punch it", "computer, save"),
  take back the last words ("belay that", "scratch that"),
  stop listening ("stand down", "end transmission").
*/
const VOICE_COMMANDS = [
  ["save", /(?:^|[\s,.!?])(?:make it so|engage|punch it|(?:computer,?\s*)?(?:save|commit) (?:the |this )?(?:log|entry)|computer,? save)[\s.!?]*$/i],
  ["undo", /(?:^|[\s,.!?])(?:belay that(?: order)?|scratch that)[\s.!?]*$/i],
  ["stop", /(?:^|[\s,.!?])(?:stand down|end transmission|computer,? stop)[\s.!?]*$/i],
];
const voiceAction = { save: null }; // set by the entry screen
let lastDictated = "";

/** A command at the end of a spoken phrase: its kind, and any words said before it. */
function voiceCommand(transcript) {
  for (const [kind, re] of VOICE_COMMANDS) {
    const m = transcript.match(re);
    if (m) return { kind, text: transcript.slice(0, m.index).trim() };
  }
  return null;
}

function runVoiceCommand(kind) {
  const d = state.draft;
  if (kind === "undo" && d) {
    if (lastDictated && d.body.endsWith(lastDictated)) d.body = d.body.slice(0, -lastDictated.length).replace(/[ \t]+$/, "");
    lastDictated = "";
    const ta = document.getElementById("entry-body");
    if (ta) ta.value = d.body;
    return;
  }
  if (kind === "stop") { stopDictation(); return; }
  if (kind === "save" && voiceAction.save && state.screen === "compose") voiceAction.save();
}

function appendDictated(d, chunk) {
  for (const [re, sub] of SPOKEN) chunk = chunk.replace(re, sub);
  chunk = chunk.replace(/^[ \t]+|[ \t]+$/g, "");
  if (!chunk) return;
  chunk = chunk.replace(/([.!?]\s+|\n\s*)([a-z])/g, (m, p, c) => p + c.toUpperCase());
  const body = d.body;
  if (!body.trim() || /[.!?\n]\s*$/.test(body)) chunk = chunk[0].toUpperCase() + chunk.slice(1);
  const sep = !body || /\s$/.test(body) || /^[.,!?:\n]/.test(chunk) ? "" : " ";
  d.body = body + sep + chunk;
  lastDictated = sep + chunk;
  const ta = document.getElementById("entry-body");
  if (ta) { ta.value = d.body; ta.scrollTop = ta.scrollHeight; }
}

function showInterim() {
  const el = document.getElementById("dictation-live");
  if (el) { el.textContent = dictation.interim; el.hidden = !dictation.interim; }
}

const focusBody = () => { const ta = document.getElementById("entry-body"); if (ta) ta.focus(); };

function startDictation() {
  if (dictation.active) return;
  if (recorder.active) stopRecording();
  dictation.hint = "";
  if (state.prefs.dictationMode === "keyboard" && isTouchDevice()) {
    dictation.hint = "Tap the microphone on the keyboard and speak. Tap it again (or the keyboard key) to stop.";
    render();
    focusBody();
    return;
  }
  if (!SpeechRec) {
    dictation.hint = platformDictationHint();
    render();
    focusBody();
    return;
  }
  const rec = new SpeechRec();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = navigator.language || "en-US";
  rec.onresult = (ev) => {
    dictation.heard = Date.now();
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) {
        const cmd = state.prefs.voiceCommands ? voiceCommand(r[0].transcript) : null;
        if (cmd) {
          if (cmd.text) appendDictated(state.draft, cmd.text);
          dictation.interim = ""; showInterim();
          runVoiceCommand(cmd.kind);
          return;
        }
        appendDictated(state.draft, r[0].transcript);
      }
      else interim += r[0].transcript;
    }
    dictation.interim = interim;
    showInterim();
  };
  rec.onerror = (ev) => {
    if (ev.error === "no-speech" || ev.error === "aborted") return;
    dictation.active = false;
    dictation.hint = (ev.error === "not-allowed" || ev.error === "service-not-allowed")
      ? "Speech access was turned down. You can allow it in the device's settings. " + platformDictationHint()
      : platformDictationHint();
    if (state.screen === "compose") { render(); focusBody(); }
  };
  rec.onend = () => {
    // Words still being recognized when listening ends would be lost (iPhone often ends
    // without marking them final), so keep them.
    if (dictation.interim && state.draft && dictation.rec === rec) {
      appendDictated(state.draft, dictation.interim);
      dictation.interim = "";
      showInterim();
      const ta = document.getElementById("entry-body");
      if (ta) ta.value = state.draft.body;
    }
    // Some systems stop listening after a pause; carry on until Stop is tapped.
    // A short wait first: starting again at once fails on iPhone.
    if (dictation.active && dictation.rec === rec) {
      setTimeout(() => {
        if (!dictation.active || dictation.rec !== rec) return;
        try { rec.start(); } catch { dictation.active = false; dictation.rec = null; startDictation(); }
      }, 250);
      return;
    }
    if (dictation.rec === rec) dictation.rec = null;
    dictation.active = false;
    dictation.interim = "";
    if (state.screen === "compose") render();
  };
  dictation.rec = rec;
  dictation.active = true;
  dictation.interim = "";
  try {
    rec.start();
  } catch {
    dictation.active = false;
    dictation.rec = null;
    dictation.hint = platformDictationHint();
  }
  render();
}

/** Stops listening; anything still being recognized is finished and added. */
function stopDictation() {
  dictation.active = false;
  if (dictation.rec) { try { dictation.rec.stop(); } catch {} }
  render();
}

/** Stops at once, keeping the words heard so far (used when saving or leaving). */
function finishDictationNow(keep) {
  if (keep && dictation.interim && state.draft) appendDictated(state.draft, dictation.interim);
  dictation.active = false;
  dictation.interim = "";
  if (dictation.rec) { try { dictation.rec.abort(); } catch {} }
  dictation.rec = null;
}

function DictationSection(d) {
  const set = (ev) => { d.body = ev.target.value; };
  return h("div", { class: "stack" },
    h("div", { class: "row" },
      h("label", { class: "label", for: "entry-body" }, "Entry"),
      dictation.active
        ? h("button", { type: "button", class: "small-btn danger", onclick: stopDictation },
            h("span", { class: "rec-dot", "aria-hidden": "true" }), "Listening", svg(ICON.stop), T("Stop", "Stand down"))
        : h("button", { type: "button", class: "small-btn filled", onclick: startDictation }, svg(ICON.mic), "Dictate")
    ),
    dictation.hint ? h("div", { class: "notice" }, dictation.hint) : null,
    h("textarea", { id: "entry-body", class: "field", placeholder: "Personal log, supplemental…", value: d.body, oninput: set,
      onkeydown: (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); voiceAction.save && voiceAction.save(); } } }),
    h("div", { id: "dictation-live", class: "small live", hidden: !dictation.interim }, dictation.interim),
    dictation.active
      ? h("div", { class: "small" }, "Say “new paragraph”, “period” or “comma” for punctuation.",
          state.prefs.voiceCommands ? " Say “make it so”, “engage” or “punch it” to save, “belay that” to take back the last words, “stand down” to stop listening." : "")
      : null
  );
}

// ---------- Journal text color ----------

const TEXT_COLORS = [
  ["", "Skin default"],
  ["#f7b538", "Gold"],
  ["#ee8a3b", "Orange"],
  ["#b9acd9", "Lavender"],
  ["#9cc4ff", "Sky blue"],
  ["#7fe7c4", "Mint"],
  ["#ffffff", "White"],
  ["#c9d3e6", "Silver"],
  ["#2f5d62", "Teal"],
];

function setTextColor(c) {
  state.textColor = c;
  try { localStorage.setItem("shipslog.textColor", c); } catch {}
  persistSettings();
  render();
}

function TextColorPicker() {
  const current = state.textColor;
  const custom = current && !TEXT_COLORS.some(([c]) => c === current);
  return h("div", { class: "stack" },
    h("span", { class: "label", id: "color-label" }, "Text color"),
    h("div", { class: "swatches", role: "group", "aria-labelledby": "color-label" },
      TEXT_COLORS.map(([c, name]) =>
        h("button", {
          type: "button", class: "swatch" + (c ? "" : " default"), title: name, "aria-label": name,
          "aria-pressed": String(current === c),
          style: c ? { "--swatch": c } : null,
          onclick: () => setTextColor(c),
        }, c ? null : h("span", { "aria-hidden": "true" }, "A"))
      ),
      h("label", { class: "swatch custom" + (custom ? " selected" : ""), title: "Choose any color", style: custom ? { "--swatch": current } : null },
        h("span", { class: "sr-only" }, "Choose any color"),
        svg(ICON.palette),
        h("input", { type: "color", class: "sr-only", value: current || "#f7b538", oninput: (ev) => setTextColor(ev.target.value) })
      )
    )
  );
}

// ---------- Photos and video ----------

const MAX_PHOTO = 2048;   // longest side of the display copy
const THUMB = 480;        // longest side of previews
const LONG_VIDEO = 5 * 60; // seconds; longer clips get a size note

const extOf = (file, fallback) => {
  const m = /\.([a-z0-9]{1,5})$/i.exec(file.name || "");
  return (m ? m[1] : fallback).toLowerCase();
};
const newBase = () => `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const megabytes = (bytes) => `${Math.max(1, Math.round(bytes / 1048576))} MB`;

/** Draws an image or video frame scaled to fit `max`, as a JPEG blob. */
function toJpeg(source, w, h, max, quality) {
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("couldn't make image"))), "image/jpeg", quality)
  );
}

async function decodeImage(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch {}
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function processPhoto(d, item, file) {
  const base = newBase();
  const original = `${base}.${extOf(file, "jpg")}`;
  let image = null;
  try { image = await decodeImage(file); } catch {}
  const w = image ? image.width || image.naturalWidth : 0;
  const hgt = image ? image.height || image.naturalHeight : 0;

  await api.saveMedia(original, file, (p) => { item.progress = p; updateTile(item); });
  d.newMediaFiles.push(original);
  Object.assign(item, { file: original, mime: file.type || "image/" + extOf(file, "jpg"), bytes: file.size, width: w, height: hgt });

  if (image) {
    // A JPEG copy for showing: every system can display it, and it's smaller.
    const needsCopy = file.type !== "image/jpeg" || Math.max(w, hgt) > MAX_PHOTO;
    if (needsCopy) {
      const view = `${base}-view.jpg`;
      await api.saveMedia(view, await toJpeg(image, w, hgt, MAX_PHOTO, 0.86));
      d.newMediaFiles.push(view);
      Object.assign(item, { file: view, original, mime: "image/jpeg" });
    }
    const thumb = `${base}-thumb.jpg`;
    await api.saveMedia(thumb, await toJpeg(image, w, hgt, THUMB, 0.8));
    d.newMediaFiles.push(thumb);
    item.thumb = thumb;
  }
}

/** Reads a video's size, length and a preview frame, using the file itself. */
function inspectVideo(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    const done = (info) => { URL.revokeObjectURL(url); resolve(info); };
    const timer = setTimeout(() => done({}), 8000);
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(1, (v.duration || 0) / 2);
    };
    v.onseeked = async () => {
      clearTimeout(timer);
      const info = { width: v.videoWidth, height: v.videoHeight, seconds: v.duration || 0 };
      try { info.thumb = await toJpeg(v, v.videoWidth, v.videoHeight, THUMB, 0.8); } catch {}
      done(info);
    };
    v.onerror = () => { clearTimeout(timer); done({}); };
    v.src = url;
  });
}

async function processVideo(d, item, file) {
  const base = newBase();
  const original = `${base}.${extOf(file, "mp4")}`;
  const info = await inspectVideo(file);
  Object.assign(item, {
    width: info.width || 0, height: info.height || 0, seconds: info.seconds || 0,
    bytes: file.size, mime: file.type || "video/mp4",
  });
  updateTile(item);

  await api.saveMedia(original, file, (p) => { item.progress = p; updateTile(item); });
  d.newMediaFiles.push(original);
  item.file = original;

  if (info.thumb) {
    const thumb = `${base}-thumb.jpg`;
    await api.saveMedia(thumb, info.thumb);
    d.newMediaFiles.push(thumb);
    item.thumb = thumb;
  }

  // On computers with FFmpeg, make an H.264 1080p copy if this isn't one already.
  item.stage = "Preparing";
  updateTile(item);
  try {
    const copy = await api.convertVideo(original);
    if (copy) {
      d.newMediaFiles.push(copy);
      Object.assign(item, { file: copy, original, mime: "video/mp4" });
    }
  } catch (err) {
    console.warn("Video kept as is:", err);
  }
}

const mediaState = { error: "", viewing: null };

function addMediaFiles(d, files) {
  mediaState.error = "";
  for (const file of files) {
    const isVideo = (file.type || "").startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name);
    const item = { kind: isVideo ? "video" : "photo", file: "", pending: true, progress: 0, key: newBase() };
    d.media.push(item);
    const job = (isVideo ? processVideo : processPhoto)(d, item, file)
      .then(() => { delete item.pending; delete item.progress; delete item.stage; })
      .catch((err) => {
        d.media = d.media.filter((m) => m !== item);
        mediaState.error = `Couldn't add ${file.name || "that file"}: ${err.message || err}`;
      })
      .finally(() => { if (state.screen === "compose" && state.draft === d) render(); });
    d.pending.push(job);
  }
  render();
}

/** Updates one tile's progress label without redrawing the screen. */
function updateTile(item) {
  const el = document.querySelector(`[data-key="${item.key}"] .tile-status`);
  if (el) el.textContent = tileStatus(item);
}
const tileStatus = (m) =>
  m.stage ? m.stage + "…" : m.progress != null ? `Saving ${Math.round(m.progress * 100)}%` : "";

async function removeMedia(d, item) {
  d.media = d.media.filter((m) => m !== item);
  const files = [item.file, item.original, item.thumb].filter(Boolean);
  for (const f of files) {
    if (d.newMediaFiles.includes(f)) {
      d.newMediaFiles = d.newMediaFiles.filter((x) => x !== f);
      await api.deleteMedia(f).catch(() => {});
    } else {
      d.removedMediaFiles.push(f); // deleted once the entry is saved
    }
  }
  render();
}

function MediaSection(d) {
  const long = d.media.find((m) => m.kind === "video" && m.seconds > LONG_VIDEO);
  return h("div", { class: "stack" },
    h("div", { class: "row" },
      h("span", { class: "label" }, T("Photos & video", "Viewscreen")),
      h("label", { class: "small-btn filled" },
        svg(ICON.plus), "Add",
        h("input", {
          type: "file", class: "sr-only", accept: "image/*,video/*", multiple: true,
          onchange: (ev) => { addMediaFiles(d, [...ev.target.files]); ev.target.value = ""; },
        })
      )
    ),
    mediaState.error ? h("div", { class: "notice", style: { "border-color": "var(--critical)", color: "var(--critical)" } }, mediaState.error) : null,
    long ? h("div", { class: "notice" }, `That video is ${clock(long.seconds)} long and uses ${megabytes(long.bytes)} of space.`) : null,
    d.media.length
      ? h("div", { class: "media-grid" }, d.media.map((m) =>
          h("button", {
            type: "button", class: "tile", "data-key": m.key || m.file,
            "aria-label": m.pending ? "Saving" : m.kind === "video" ? `Video, ${clock(m.seconds)}` : "Photo",
            disabled: !!m.pending,
            onclick: () => openViewer(d, m),
          },
            m.thumb ? h("img", { src: api.mediaUrl(m.thumb), alt: "" }) : h("span", { class: "tile-icon" }, svg(m.kind === "video" ? ICON.video : ICON.photo)),
            m.kind === "video" && !m.pending ? h("span", { class: "tile-badge" }, svg(ICON.play), clock(m.seconds)) : null,
            m.pending ? h("span", { class: "tile-status" }, tileStatus(m)) : null
          )
        ))
      : h("div", { class: "small" }, "Take a photo or video, or choose from your library.")
  );
}

function openViewer(d, item) {
  closeViewer();
  const url = api.mediaUrl(item.file);
  const media = item.kind === "video"
    ? h("video", { src: url, controls: true, autoplay: true, playsinline: true })
    : h("img", { src: url, alt: "" });
  const overlay = h("div", { class: "viewer", role: "dialog", "aria-modal": "true", "aria-label": item.kind === "video" ? "Video" : "Photo" },
    h("div", { class: "viewer-bar" },
      h("button", { type: "button", class: "small-btn", "aria-label": "Close", onclick: closeViewer }, svg(ICON.close)),
      h("span", { class: "small" }, [item.width && item.height ? `${item.width}×${item.height}` : "", item.bytes ? megabytes(item.bytes) : ""].filter(Boolean).join(" · ")),
      d ? h("button", { type: "button", class: "small-btn danger", "aria-label": "Delete", onclick: () => { closeViewer(); removeMedia(d, item); } }, svg(ICON.trash)) : h("span")
    ),
    h("div", { class: "viewer-body" }, media)
  );
  mediaState.viewing = overlay;
  document.body.append(overlay);
  overlay.querySelector("button").focus();
}

function closeViewer() {
  const v = mediaState.viewing;
  if (!v) return;
  const video = v.querySelector("video");
  if (video) video.pause();
  v.remove();
  mediaState.viewing = null;
}

document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeViewer(); });

// ---------- Reading an entry ----------

/** Opens a log to read. Editing is a separate button on the reading screen. */
function openEntry(e) {
  if (state.screen !== "read") state.readBack = state.screen === "compose" ? "logs" : state.screen;
  state.readingId = e.id;
  stopPlayback();
  stopSpeaking();
  go("read");
  document.getElementById("screen").scrollTop = 0;
}

function editEntry(e) {
  stopPlayback();
  stopSpeaking();
  openCompose(e, { returnTo: "read" });
}

function ReadScreen() {
  const list = state.entries;
  const i = list.findIndex((x) => x.id === state.readingId);
  if (i < 0) { setTimeout(() => go("logs")); return []; }
  const e = list[i];
  const newer = list[i - 1], older = list[i + 1];
  const back = () => { stopPlayback(); go(state.readBack || "logs"); };
  const recs = e.recordings || [], media = e.media || [];
  const facts = [
    (e.crew || []).length ? ["Crew", e.crew.join(", ")] : null,
    e.place ? [T("Place", "Location"), e.place] : null,
  ].filter(Boolean);
  const step = (x, label, plain) => h("button", { type: "button", class: "small-btn", disabled: !x, title: plain, onclick: () => x && openEntry(x) }, label);
  return [
    h("header", { class: "row read-head" },
      h("button", { type: "button", class: "small-btn icon-btn", "aria-label": "Back", title: "Back", onclick: back }, svg(ICON.back)),
      h("span", { class: "h2 read-kicker" }, T("Log entry", "Captain's log")),
      h("span", { class: "row", style: { gap: "8px" } },
        ReadAloudButton(e),
        h("button", { type: "button", class: "small-btn filled", title: "Edit this entry (E)", onclick: () => editEntry(e) }, svg(ICON.pen), T("Edit", "Amend log")))
    ),
    h("article", { class: "reader" },
      h("div", { class: "row read-tags" },
        h("span", { class: "pill", title: typePlain(e.logType), style: { "--c": typeColor(e.logType) } }, typeLabel(e.logType)),
        h("span", { class: "chip", title: conditionTag(e.condition), style: { "--c": condition(e.condition)[2] } }, conditionTag(e.condition))
      ),
      h("h1", { class: "read-title" }, e.title || "Untitled"),
      h("div", { class: "small read-date" }, dateLine(e.stardate, new Date(e.created))),
      e.body ? h("div", { class: "read-body" }, e.body) : h("div", { class: "small" }, "No written entry."),
      media.length
        ? h("section", { class: "stack" },
            h("span", { class: "label" }, T("Photos & video", "Viewscreen")),
            h("div", { class: "media-grid" }, media.map((m) =>
              h("button", { type: "button", class: "tile", "aria-label": m.kind === "video" ? `Video, ${clock(m.seconds)}` : "Photo", onclick: () => openViewer(null, m) },
                m.thumb ? h("img", { src: api.mediaUrl(m.thumb), alt: "" }) : h("span", { class: "tile-icon" }, svg(m.kind === "video" ? ICON.video : ICON.photo)),
                m.kind === "video" ? h("span", { class: "tile-badge" }, svg(ICON.play), clock(m.seconds)) : null))))
        : null,
      recs.length
        ? h("section", { class: "stack" },
            h("span", { class: "label" }, T("Recordings", "Communications")),
            h("div", { class: "list" }, recs.map((rec, n) => {
              const playing = recorder.playing && recorder.playing.file === rec.file;
              return h("div", { class: "recording" },
                h("button", { type: "button", class: "small-btn", "aria-label": playing ? "Pause" : "Play",
                  style: playing ? { color: "var(--accent)", "border-color": "var(--accent)" } : null, onclick: () => togglePlay(rec) },
                  svg(playing ? ICON.pause : ICON.play)),
                h("span", { class: "stack", style: { flex: "1", gap: "2px" } },
                  h("span", { class: "h3", style: { "font-size": "15px" } }, `Recording ${n + 1}`),
                  h("span", { class: "small" }, clock(rec.seconds))));
            })))
        : null,
      facts.length ? h("dl", { class: "read-facts" }, facts.map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])) : null
    ),
    h("div", { class: "row read-nav" },
      step(newer, "‹ Newer", "The log above this one in the list (←)"),
      h("span", { class: "small" }, `${i + 1} of ${list.length}`),
      step(older, "Older ›", "The log below this one in the list (→)"))
  ];
}

// On a computer: ← and → step through logs, E edits.
document.addEventListener("keydown", (ev) => {
  if (state.screen !== "read" || mediaState.viewing || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  const list = state.entries, i = list.findIndex((x) => x.id === state.readingId);
  if (ev.key === "ArrowLeft" && list[i - 1]) openEntry(list[i - 1]);
  else if (ev.key === "ArrowRight" && list[i + 1]) openEntry(list[i + 1]);
  else if ((ev.key === "e" || ev.key === "E") && list[i]) editEntry(list[i]);
});

// ---------- Entry screen ----------

function openCompose(entry, opts = {}) {
  const now = new Date();
  state.draft = entry
    ? { ...entry, crewText: (entry.crew || []).join(", "), recordings: [...(entry.recordings || [])], media: (entry.media || []).map((m) => ({ ...m })) }
    : {
        id: "", created: now.toISOString(), stardate: nextStardate(),
        logType: "personal", condition: "calm", title: "", body: "",
        crewText: "", place: "", locked: false, recordings: [], media: [],
      };
  state.draft.returnTo = opts.returnTo || "logs";
  if (opts.title) state.draft.title = opts.title;
  if (opts.body) state.draft.body = opts.body;
  Object.assign(state.draft, { newFiles: [], removedFiles: [], newMediaFiles: [], removedMediaFiles: [], pending: [] });
  state.deleteArmed = false;
  recorder.error = "";
  mediaState.error = "";
  dictation.hint = "";
  go("compose");
  if (opts.record) startRecording();
  if (opts.dictate) startDictation();
}

/** Leaves the entry screen without saving: drops any recordings made since it opened. */
async function closeCompose() {
  const d = state.draft;
  finishDictationNow(false);
  await stopRecording(true);
  stopPlayback();
  closeViewer();
  go(d.returnTo || "logs");
  // Tidy up anything added since the entry was opened, once uploads settle.
  await Promise.allSettled(d.pending);
  for (const f of d.newFiles) await api.deleteAudio(f).catch(() => {});
  for (const f of d.newMediaFiles) await api.deleteMedia(f).catch(() => {});
}

function ComposeScreen() {
  const d = state.draft;
  const isNew = !d.id;
  const set = (k) => (ev) => { d[k] = ev.target.value; };

  async function save(ev) {
    finishDictationNow(true);
    await stopRecording();
    stopPlayback();
    closeViewer();
    if (d.media.some((m) => m.pending)) {
      const btn = ev && ev.currentTarget;
      if (btn) { btn.textContent = "Saving…"; btn.disabled = true; }
      await Promise.allSettled(d.pending);
    }
    if (!d.title.trim() && !d.body.trim() && !d.recordings.length && !d.media.length) {
      render();
      document.getElementById("entry-body").focus();
      return;
    }
    const entry = {
      id: d.id, created: d.created, stardate: d.stardate,
      logType: d.logType, condition: d.condition,
      title: d.title.trim(), body: d.body,
      crew: d.crewText.split(",").map((s) => s.trim()).filter(Boolean),
      place: d.place.trim(), locked: d.locked,
      recordings: d.recordings,
      media: d.media.filter((m) => m.file && !m.pending).map(({ kind, file, original, thumb, mime, width, height, seconds, bytes }) =>
        ({ kind, file, original, thumb, mime, width: width || 0, height: height || 0, seconds: seconds || 0, bytes: bytes || 0 })),
    };
    await api.save(entry);
    if (isNew) state.pad = { title: "", body: "" };
    for (const f of d.removedFiles) await api.deleteAudio(f).catch(() => {});
    for (const f of d.removedMediaFiles) await api.deleteMedia(f).catch(() => {});
    await refresh();
    if (d.returnTo === "read") state.readingId = d.id;
    go(d.returnTo || "logs");
  }

  voiceAction.save = () => save();

  async function remove() {
    if (!state.deleteArmed) { state.deleteArmed = true; render(); return; }
    finishDictationNow(false);
    await stopRecording(true);
    stopPlayback();
    await Promise.allSettled(d.pending);
    for (const f of d.newFiles) await api.deleteAudio(f).catch(() => {});
    for (const f of d.newMediaFiles) await api.deleteMedia(f).catch(() => {});
    await api.remove(d.id);
    await refresh();
    go("logs");
  }

  return [
    h("header", { class: "row" },
      h("button", { type: "button", class: "small-btn icon-btn", "aria-label": "Back to logs", onclick: closeCompose }, svg(ICON.back)),
      h("div", { class: "stack", style: { "align-items": "center", gap: "2px" } },
        h("span", { class: "h2", style: { color: "var(--accent)" } }, T(isNew ? "New entry" : "Edit entry", "Ready Room")),
        state.prefs.storyMode
          ? h("label", { class: "small sd-edit", title: "This entry's stardate in your story" }, T("Log date", "Stardate"), " ",
              h("input", { type: "number", step: "0.1", class: "sd-input", value: sd1(d.stardate), "aria-label": "Stardate",
                oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) d.stardate = Math.round(v * 10) / 10; } }))
          : h("span", { class: "small" }, dateLine(d.stardate, new Date(d.created)))
      ),
      h("button", { type: "button", class: "small-btn filled", title: "Save (Ctrl or ⌘ + Enter)", onclick: save }, T("Save", "Make it so"))
    ),

    h("div", { class: "stack" },
      h("span", { class: "label", id: "type-label" }, "Log type"),
      h("div", { class: "pills", role: "group", "aria-labelledby": "type-label" },
        LOG_TYPES.map(([k]) => [k, typeLabel(k)]).map(([k, label]) =>
          h("button", { type: "button", title: typePlain(k), "aria-pressed": String(d.logType === k), onclick: () => { d.logType = k; render(); } }, label)
        )
      )
    ),

    h("div", { class: "stack" },
      h("span", { class: "label", id: "cond-label" }, T("Condition", "Alert status")),
      h("div", { class: "segment", role: "group", "aria-labelledby": "cond-label" },
        CONDITIONS.map(([k, plain, color, , short]) => [k, T(plain, short), color]).map(([k, label, color]) =>
          h("button", { type: "button", style: { "--c": color }, "aria-pressed": String(d.condition === k), onclick: () => { d.condition = k; render(); } }, label)
        )
      )
    ),

    h("div", { class: "stack" },
      h("label", { class: "label", for: "entry-title" }, "Title"),
      h("input", { id: "entry-title", class: "field title-field", type: "text", placeholder: "What happened today?", value: d.title, oninput: set("title") })
    ),

    DictationSection(d),

    TextColorPicker(),

    MediaSection(d),

    RecordingsSection(d),

    h("div", { class: "stack" },
      h("label", { class: "label", for: "entry-crew" }, "Crew"),
      h("input", { id: "entry-crew", class: "field", type: "text", placeholder: "Names, separated by commas", value: d.crewText, oninput: set("crewText") })
    ),

    h("div", { class: "stack" },
      h("label", { class: "label", for: "entry-place" }, "Place"),
      h("input", { id: "entry-place", class: "field", type: "text", placeholder: "Where were you?", value: d.place, oninput: set("place") })
    ),

    h("div", { class: "row" },
      h("button", {
        type: "button", class: "small-btn", "aria-pressed": String(d.locked),
        style: d.locked ? { color: "var(--accent)", "border-color": "var(--accent)" } : null,
        onclick: () => { d.locked = !d.locked; render(); },
      }, svg(ICON.lock), d.locked ? T("Hidden from search", "Security clearance on") : T("Hide from search", "Set security clearance")),
      isNew ? null : h("button", { type: "button", class: "small-btn danger", onclick: remove },
        state.deleteArmed ? T("Tap again to delete", "Confirm: jettison") : T("Delete", "Jettison"))
    ),
  ];
}

function SearchScreen() {
  const results = h("div", { class: "list" });
  const countEl = h("span", { class: "muted" });
  let timer;

  async function run() {
    const q = state.query.trim();
    const hits = inOrder(await api.search(q, state.queryType));
    countEl.textContent = `${hits.length} ${hits.length === 1 ? "log matches" : "logs match"}`;
    results.replaceChildren(
      ...(hits.length ? hits.map((e) => EntryCard(e, q)) : [h("div", { class: "empty" }, "No logs match.")])
    );
  }

  const now = new Date();
  const onThisDay = state.entries.filter((e) => {
    const d = new Date(e.created);
    return d.getMonth() === now.getMonth() && d.getDate() === now.getDate() && d.getFullYear() < now.getFullYear();
  });

  const input = h("input", {
    id: "q", class: "field", type: "search", placeholder: "Search logs…", value: state.query,
    style: { border: "none", background: "transparent", padding: "0", "min-height": "48px" },
    oninput: (ev) => { state.query = ev.target.value; clearTimeout(timer); timer = setTimeout(run, 150); },
  });

  queueMicrotask(run);

  return [
    h("header", { class: "stack" },
      h("h1", { class: "title" }, T("Search logs", "Science Station")),
      h("div", { class: "muted" }, "Titles, entries, crew and places")
    ),
    h("div", {
      class: "row",
      style: { padding: "0 14px", "border-radius": "var(--radius)", border: "1px solid var(--accent)", background: "var(--panel)", color: "var(--muted)", "justify-content": "flex-start" },
    }, svg(ICON.search), h("label", { for: "q", class: "sr-only" }, "Search logs"), input),
    h("div", { class: "pills scroll", role: "group", "aria-label": "Filter by type" },
      [["all", "All"], ...LOG_TYPES.map(([k]) => [k, typeLabel(k)])].map(([k, label]) =>
        h("button", { type: "button", title: k === "all" ? "All" : typePlain(k), "aria-pressed": String(state.queryType === k), onclick: () => { state.queryType = k; render(); } }, label)
      )
    ),
    h("div", { class: "row", style: { "justify-content": "flex-start", "flex-wrap": "wrap" } },
      h("button", { type: "button", class: "small-btn", onclick: () => go("onthisday") }, svg(ICON.clock),
        onThisDay.length ? `On this date (${onThisDay.length})` : "On this date"),
      h("button", { type: "button", class: "small-btn", onclick: () => go("gallery") }, svg(ICON.photo), T("Photos & video", "Viewscreen"))
    ),
    h("div", { class: "row" }, h("h2", { class: "h2" }, "Results"), countEl),
    results,
  ];
}

function searchFor(text) {
  state.query = text;
  state.queryType = "all";
  go("search");
}

function CrewScreen() {
  const counts = new Map();
  for (const e of state.entries) for (const name of e.crew || []) counts.set(name, (counts.get(name) || 0) + 1);
  const crew = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const colors = ["var(--accent)", "var(--accent2)", "var(--muted)"];
  const initials = (n) => n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return [
    h("header", { class: "stack" },
      h("h1", { class: "title" }, T("Crew", "Crew Manifest")),
      h("div", { class: "muted" }, "People who appear in your logs")
    ),
    crew.length
      ? h("div", { class: "list" }, crew.map(([name, n], i) =>
          h("button", { type: "button", class: "person", onclick: () => searchFor(name) },
            h("span", { class: "avatar", "aria-hidden": "true", style: { "--c": colors[i % 3] } }, initials(name)),
            h("span", { class: "stack", style: { flex: "1", "min-width": "0", gap: "2px" } },
              h("span", { class: "h3" }, name),
              h("span", { class: "small" }, "Tap to see their logs")
            ),
            h("span", { class: "stack", style: { "align-items": "flex-end", gap: "2px" } },
              h("span", { class: "count" }, n), h("span", { class: "small" }, n === 1 ? "log" : "logs"))
          )))
      : h("div", { class: "empty" }, "No crew yet. Add names in the Crew field when you write an entry."),
  ];
}

function MapScreen() {
  const places = new Map();
  for (const e of state.entries) {
    if (!e.place) continue;
    const p = places.get(e.place) || { name: e.place, count: 0, latest: e };
    p.count += 1;
    if (e.created > p.latest.created) p.latest = e;
    places.set(e.place, p);
  }
  const list = [...places.values()].sort((a, b) => b.count - a.count);

  // Places have no real coordinates yet, so each gets a stable spot from its name.
  const spot = (name) => {
    let x = 0;
    for (const ch of name) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
    return { left: 12 + (x % 76), top: 15 + ((x >>> 8) % 70) };
  };

  if (!state.place || !places.has(state.place)) state.place = list[0] ? list[0].name : null;
  const sel = state.place ? places.get(state.place) : null;

  const chart = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  chart.setAttribute("viewBox", "0 0 350 340");
  chart.setAttribute("preserveAspectRatio", "xMidYMid slice");
  chart.setAttribute("aria-hidden", "true");
  chart.innerHTML =
    '<g class="grid"><path d="M0 50H350M0 100H350M0 150H350M0 200H350M0 250H350M0 300H350"/>' +
    '<path d="M50 0V340M100 0V340M150 0V340M200 0V340M250 0V340M300 0V340"/></g>' +
    '<path class="land" d="M-10 110 C40 80 80 130 120 100 S200 50 240 90 S300 150 360 120 L360 350 L-10 350 Z"/>';

  return [
    h("header", { class: "stack" },
      h("h1", { class: "title" }, T("Map", "Navigation")),
      h("div", { class: "muted" }, "Where your logs were written")
    ),
    list.length
      ? [
          h("div", { class: "map" }, chart,
            list.map((p) => {
              const { left, top } = spot(p.name);
              return h("button", {
                type: "button", class: "marker", "aria-label": `${p.name}, ${p.count} logs`,
                "aria-pressed": String(p.name === state.place),
                style: { left: left + "%", top: top + "%" },
                onclick: () => { state.place = p.name; render(); },
              }, p.count);
            })
          ),
          h("div", { class: "card" },
            h("div", { class: "row" },
              h("h2", { class: "h2", style: { color: "var(--accent)" } }, sel.name),
              h("span", { class: "small" }, `${sel.count} ${sel.count === 1 ? "log" : "logs"}`)
            ),
            h("span", { class: "small" }, `Most recent · ${sel.latest.stardate.toFixed(1)}`),
            h("p", { style: { color: "var(--text)" } }, sel.latest.title || snippet(sel.latest)),
            h("button", { type: "button", class: "small-btn", style: { "align-self": "flex-start" }, onclick: () => searchFor(sel.name) }, "See all logs here")
          ),
        ]
      : h("div", { class: "empty" }, "No places yet. Add a Place when you write an entry and it shows up here."),
  ];
}

// ---------- Start ----------

(async () => {
  render();
  try {
    state.mediaDir = await api.mediaDir();
    persistSettings();
    await refresh();
    await loadBackupStatus();
  } catch (err) { console.error(err); }
  render();
})();
