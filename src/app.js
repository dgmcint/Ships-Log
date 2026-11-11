// Ship's Log — interface logic.
// Runs inside Tauri (data saved by the Rust backend) or in a plain browser
// (data saved in localStorage) so you can preview it without building.

const SKINS = [
  ["console", "Console"],
  ["holo", "Holo"],
  ["archive", "Archive"],
];

const LOG_TYPES = [
  ["personal", "Personal"],
  ["engineering", "Engineering"],
  ["medical", "Medical"],
  ["science", "Science"],
  ["away", "Away mission"],
];

const CONDITIONS = [
  ["calm", "Calm", "var(--accent2)"],
  ["caution", "Caution", "var(--caution)"],
  ["critical", "Critical", "var(--critical)"],
];

const typeLabel = (k) => (LOG_TYPES.find(([key]) => key === k) || [k, k])[1];
const typeColor = (k) =>
  k === "personal" ? "var(--accent)" : k === "away" ? "var(--muted)" : "var(--accent2)";
const condition = (k) => CONDITIONS.find(([key]) => key === k) || CONDITIONS[0];

// ---------- Storage ----------

const tauri = window.__TAURI__ && window.__TAURI__.core;

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

const browserStore = {
  read() {
    try { return JSON.parse(localStorage.getItem("shipslog.entries") || "[]"); }
    catch { return []; }
  },
  write(list) {
    try { localStorage.setItem("shipslog.entries", JSON.stringify(list)); } catch {}
  },
};

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
      // Browser preview only: photos and video live in memory until the page reloads.
      async saveMedia(file, blob, onProgress) { memoryMedia.set(file, blob); if (onProgress) onProgress(1); return file; },
      async deleteMedia(file) { memoryMedia.delete(file); },
      async convertVideo() { return null; },
      async mediaDir() { return ""; },
      // Browser preview: backups are a download of the journal text (no media).
      async saveSettings(s) { try { localStorage.setItem("shipslog.settings", s); } catch {} },
      async backupStatus() {
        const last = Number(localStorage.getItem("shipslog.lastBackup") || 0);
        return { lastBackup: last || null, autoFolder: null, autoEveryDays: 7 };
      },
      async backupNow() {
        const data = JSON.stringify({ entries: browserStore.read(), settings: JSON.parse(localStorage.getItem("shipslog.settings") || "{}") }, null, 2);
        const a = h("a", { href: URL.createObjectURL(new Blob([data], { type: "application/json" })), download: "ShipsLog-preview-backup.json" });
        a.click();
        localStorage.setItem("shipslog.lastBackup", String(Math.floor(Date.now() / 1000)));
        return { path: "your Downloads folder", bytes: data.length, entries: browserStore.read().length, files: 0 };
      },
      async restoreBackup() {
        const file = await new Promise((resolve) => {
          const input = h("input", { type: "file", accept: ".json", onchange: () => resolve(input.files[0] || null) });
          input.click();
        });
        if (!file) return null;
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data.entries)) throw new Error("That file isn't a Ship's Log preview backup.");
        browserStore.write(data.entries);
        return JSON.stringify(data.settings || {});
      },
      async setAutoBackup() { return this.backupStatus(); },
      mediaUrl(file) {
        if (!memoryUrls.has(file) && memoryMedia.has(file)) memoryUrls.set(file, URL.createObjectURL(memoryMedia.get(file)));
        return memoryUrls.get(file) || "";
      },
      // Browser preview only: recordings live in memory until the page reloads.
      async saveAudio(file, blob) { memoryAudio.set(file, blob); return file; },
      async loadAudio(rec) {
        const blob = memoryAudio.get(rec.file);
        if (!blob) throw new Error("This recording was made in an earlier browser session.");
        return blob;
      },
      async deleteAudio(file) { memoryAudio.delete(file); },
      async list() { return newestFirst(browserStore.read()); },
      async save(entry) {
        const list = browserStore.read();
        if (!entry.id) entry.id = "log-" + Date.now();
        const i = list.findIndex((e) => e.id === entry.id);
        if (i >= 0) list[i] = entry; else list.push(entry);
        browserStore.write(list);
        return entry;
      },
      async remove(id) { browserStore.write(browserStore.read().filter((e) => e.id !== id)); },
      async search(query, logType) {
        return newestFirst(browserStore.read().filter((e) => matches(e, query.trim(), logType)));
      },
    };

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
  deleteArmed: false,
  query: "",
  queryType: "all",
  place: null,
  mediaDir: "",
  textColor: "", // "" follows the skin
};

try {
  const saved = localStorage.getItem("shipslog.skin");
  if (SKINS.some(([k]) => k === saved)) state.skin = saved;
  state.textColor = localStorage.getItem("shipslog.textColor") || "";
  Object.assign(state.ship, JSON.parse(localStorage.getItem("shipslog.ship") || "{}"));
} catch {}

const screenEl = document.getElementById("screen");
const appEl = document.querySelector(".app");

function go(screen) {
  state.screen = screen;
  render();
  screenEl.scrollTop = 0;
}

async function refresh() {
  state.entries = await api.list();
}

function render() {
  document.documentElement.dataset.skin = state.skin;
  if (state.textColor) document.documentElement.style.setProperty("--entry-text", state.textColor);
  else document.documentElement.style.removeProperty("--entry-text");
  appEl.classList.toggle("composing", state.screen === "compose");
  appEl.classList.toggle("cover", state.screen === "cover");
  document.getElementById("bar-label").textContent =
    state.screen === "cover" ? "Personal records" : state.ship.ship || "Ship's Log";
  // The top-left Home button returns to the cover. It rests on the cover itself,
  // and while writing an entry (use the back arrow there, so nothing is lost by accident).
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
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitCoverTitle);
if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", fitCoverTitle);

document.querySelectorAll(".nav [data-go]").forEach((b) => {
    if (b.dataset.go === state.screen) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  const view = { cover: CoverScreen, logs: LogsScreen, compose: ComposeScreen, search: SearchScreen, crew: CrewScreen, map: MapScreen, settings: SettingsScreen }[state.screen];
  screenEl.replaceChildren(...[view()].flat(Infinity).filter(Boolean));
  fitCoverTitle();
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

function SkinSwitcher() {
  return h("div", { class: "switcher", role: "group", "aria-label": "Skin" },
    SKINS.map(([k, label]) =>
      h("button", {
        type: "button",
        "aria-pressed": String(state.skin === k),
        onclick: () => {
          state.skin = k;
          try { localStorage.setItem("shipslog.skin", k); } catch {}
          persistSettings();
          render();
        },
      }, label)
    )
  );
}

function EntryCard(e, q) {
  return h("button", { type: "button", class: "card", onclick: () => openCompose(e) },
    h("div", { class: "row" },
      h("span", { class: "pill", style: { "--c": typeColor(e.logType) } }, typeLabel(e.logType)),
      h("span", { class: "small row", style: { gap: "6px", "justify-content": "flex-end" } },
        e.locked ? svg(ICON.lock) : null,
        (e.recordings || []).length
          ? h("span", { class: "row", style: { gap: "2px" }, "aria-label": `${e.recordings.length} recordings` }, svg(ICON.mic), e.recordings.length)
          : null,
        e.stardate.toFixed(1))
    ),
    h("h3", { class: "h3" }, highlight(e.title || "Untitled", q)),
    h("p", {}, highlight(snippet(e), q)),
    (e.media || []).length ? ThumbStrip(e.media) : null
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
  return h("img", { src: "logo.png", class: "emblem", alt: "Ship's Log emblem" });
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
      }, "Save details"),
      h("button", { type: "button", class: "small-btn", onclick: () => { state.editingShip = false; render(); } }, "Cancel")
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
    h("button", { type: "button", class: "small-btn", onclick: () => { state.editingShip = true; render(); } }, line ? "Edit details" : "Add details"),
    SkinSwitcher()
  );
}

function LogsScreen() {
  const latest = state.entries[0];
  const [, condLabel, condColor] = condition(latest ? latest.condition : "calm");
  const now = new Date();
  return [
    h("header", { class: "stack" },
      h("div", { class: "row" },
        h("h1", { class: "title" }, "Ship's Log"),
        h("button", { type: "button", class: "small-btn icon-btn", "aria-label": "Settings and backup", onclick: () => go("settings") }, svg(ICON.gear))
      ),
      h("div", { class: "row" },
        h("div", { class: "muted" }, `Log date ${stardate(now).toFixed(1)} · ${formatDate(now)}`),
        h("span", { class: "chip", style: { "--c": condColor } }, "Condition: " + condLabel)
      )
    ),
    SkinSwitcher(),
    BackupReminder(),
    h("button", { type: "button", class: "primary", onclick: () => openCompose(null, { dictate: true }) },
      svg(ICON.mic), "Dictate a log"),
    h("div", { class: "row", style: { "justify-content": "center" } },
      h("button", { type: "button", class: "small-btn", onclick: () => openCompose(null, { record: true }) },
        svg(ICON.wave), "Record audio"),
      h("button", { type: "button", class: "small-btn", onclick: () => openCompose(null) },
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
  api.saveSettings(JSON.stringify({ skin: state.skin, ship: state.ship, textColor: state.textColor })).catch(() => {});
}

function applySettings(json) {
  let s = {};
  try { s = JSON.parse(json || "{}"); } catch {}
  if (SKINS.some(([k]) => k === s.skin)) state.skin = s.skin;
  if (s.ship) state.ship = { captain: "", ship: "", registry: "", ...s.ship };
  if (typeof s.textColor === "string") state.textColor = s.textColor;
  try {
    localStorage.setItem("shipslog.skin", state.skin);
    localStorage.setItem("shipslog.ship", JSON.stringify(state.ship));
    localStorage.setItem("shipslog.textColor", state.textColor);
  } catch {}
  persistSettings();
}

async function loadBackupStatus() {
  try { backupUi.status = await api.backupStatus(); } catch { backupUi.status = null; }
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

/** A gentle note on the Logs screen when a backup is overdue. */
function BackupReminder() {
  const s = backupUi.status;
  if (!s || !state.entries.length) return null;
  const overdue = !s.lastBackup || daysSince(s.lastBackup) >= 14;
  if (!overdue || s.autoFolder) return null;
  return h("div", { class: "notice row", style: { "justify-content": "space-between" } },
    h("span", {}, s.lastBackup ? lastBackupText(s) + "." : "Your log hasn't been backed up yet."),
    h("button", { type: "button", class: "small-btn", onclick: () => go("settings") }, "Back up")
  );
}

function SettingsScreen() {
  const s = backupUi.status || { lastBackup: null, autoFolder: null, autoEveryDays: 7 };
  const busy = !!backupUi.busy;
  return [
    h("header", { class: "row", style: { "justify-content": "flex-start", gap: "6px" } },
      h("button", { type: "button", class: "small-btn icon-btn", "aria-label": "Back to logs", onclick: () => { backupUi.restoreArmed = false; go("logs"); } }, svg(ICON.back)),
      h("h1", { class: "title" }, "Settings")
    ),

    h("section", { class: "card settings-card" },
      h("h2", { class: "h2" }, "Backup"),
      h("p", {}, "A backup is one file with all your logs, recordings, photos, videos and settings. Keep it somewhere safe, like iCloud Drive, Dropbox or a USB drive."),
      h("div", { class: "small", style: { color: s.lastBackup ? "var(--accent2)" : "var(--caution)" } }, lastBackupText(s)),
      h("button", { type: "button", class: "primary", disabled: busy, onclick: doBackup }, svg(ICON.save), backupUi.busy === "Backing up…" ? "Backing up…" : "Back up now"),
      backupUi.message ? h("div", { class: "notice" }, backupUi.message) : null,
      backupUi.error ? h("div", { class: "notice", style: { "border-color": "var(--critical)", color: "var(--critical)" } }, backupUi.error) : null
    ),

    h("section", { class: "card settings-card" },
      h("h2", { class: "h2" }, "Restore"),
      h("p", {}, "Bring back a log from a backup file, on this device or a new one. This replaces the log that's here now; the current one is kept in a separate folder just in case."),
      h("button", { type: "button", class: "small-btn" + (backupUi.restoreArmed ? " danger" : ""), disabled: busy, onclick: doRestore },
        svg(ICON.restore), backupUi.busy === "Restoring…" ? "Restoring…" : backupUi.restoreArmed ? "Tap again to choose a backup" : "Restore from a backup")
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
      h("span", { class: "label" }, "Recordings"),
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

function appendDictated(d, chunk) {
  for (const [re, sub] of SPOKEN) chunk = chunk.replace(re, sub);
  chunk = chunk.replace(/^[ \t]+|[ \t]+$/g, "");
  if (!chunk) return;
  chunk = chunk.replace(/([.!?]\s+|\n\s*)([a-z])/g, (m, p, c) => p + c.toUpperCase());
  const body = d.body;
  if (!body.trim() || /[.!?\n]\s*$/.test(body)) chunk = chunk[0].toUpperCase() + chunk.slice(1);
  const sep = !body || /\s$/.test(body) || /^[.,!?:\n]/.test(chunk) ? "" : " ";
  d.body = body + sep + chunk;
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
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) appendDictated(state.draft, r[0].transcript);
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
    // Some systems stop listening after a pause; carry on until Stop is tapped.
    if (dictation.active && dictation.rec === rec) {
      try { rec.start(); return; } catch {}
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
            h("span", { class: "rec-dot", "aria-hidden": "true" }), "Listening", svg(ICON.stop), "Stop")
        : h("button", { type: "button", class: "small-btn filled", onclick: startDictation }, svg(ICON.mic), "Dictate")
    ),
    dictation.hint ? h("div", { class: "notice" }, dictation.hint) : null,
    h("textarea", { id: "entry-body", class: "field", placeholder: "Personal log, supplemental…", value: d.body, oninput: set }),
    h("div", { id: "dictation-live", class: "small live", hidden: !dictation.interim }, dictation.interim),
    dictation.active
      ? h("div", { class: "small" }, "Say “new paragraph”, “period” or “comma” for punctuation.")
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
      h("span", { class: "label" }, "Photos & video"),
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

// ---------- Entry screen ----------

function openCompose(entry, opts = {}) {
  const now = new Date();
  state.draft = entry
    ? { ...entry, crewText: (entry.crew || []).join(", "), recordings: [...(entry.recordings || [])], media: (entry.media || []).map((m) => ({ ...m })) }
    : {
        id: "", created: now.toISOString(), stardate: stardate(now),
        logType: "personal", condition: "calm", title: "", body: "",
        crewText: "", place: "", locked: false, recordings: [], media: [],
      };
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
  go("logs");
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
    for (const f of d.removedFiles) await api.deleteAudio(f).catch(() => {});
    for (const f of d.removedMediaFiles) await api.deleteMedia(f).catch(() => {});
    await refresh();
    go("logs");
  }

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
        h("span", { class: "h2", style: { color: "var(--accent)" } }, isNew ? "New entry" : "Edit entry"),
        h("span", { class: "small" }, `Log date ${d.stardate.toFixed(1)} · ${formatDate(new Date(d.created))}`)
      ),
      h("button", { type: "button", class: "small-btn filled", onclick: save }, "Save")
    ),

    h("div", { class: "stack" },
      h("span", { class: "label", id: "type-label" }, "Log type"),
      h("div", { class: "pills", role: "group", "aria-labelledby": "type-label" },
        LOG_TYPES.map(([k, label]) =>
          h("button", { type: "button", "aria-pressed": String(d.logType === k), onclick: () => { d.logType = k; render(); } }, label)
        )
      )
    ),

    h("div", { class: "stack" },
      h("span", { class: "label", id: "cond-label" }, "Condition"),
      h("div", { class: "segment", role: "group", "aria-labelledby": "cond-label" },
        CONDITIONS.map(([k, label, color]) =>
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
      }, svg(ICON.lock), d.locked ? "Hidden from search" : "Hide from search"),
      isNew ? null : h("button", { type: "button", class: "small-btn danger", onclick: remove },
        state.deleteArmed ? "Tap again to delete" : "Delete")
    ),
  ];
}

function SearchScreen() {
  const results = h("div", { class: "list" });
  const countEl = h("span", { class: "muted" });
  let timer;

  async function run() {
    const q = state.query.trim();
    const hits = await api.search(q, state.queryType);
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
      h("h1", { class: "title" }, "Search logs"),
      h("div", { class: "muted" }, "Titles, entries, crew and places")
    ),
    SkinSwitcher(),
    h("div", {
      class: "row",
      style: { padding: "0 14px", "border-radius": "var(--radius)", border: "1px solid var(--accent)", background: "var(--panel)", color: "var(--muted)", "justify-content": "flex-start" },
    }, svg(ICON.search), h("label", { for: "q", class: "sr-only" }, "Search logs"), input),
    h("div", { class: "pills scroll", role: "group", "aria-label": "Filter by type" },
      [["all", "All"], ...LOG_TYPES].map(([k, label]) =>
        h("button", { type: "button", "aria-pressed": String(state.queryType === k), onclick: () => { state.queryType = k; render(); } }, label)
      )
    ),
    onThisDay.length
      ? h("div", { class: "notice row", style: { "justify-content": "flex-start" } }, svg(ICON.clock),
          `On this date: ${onThisDay.length} ${onThisDay.length === 1 ? "log" : "logs"} from past years`)
      : null,
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
      h("h1", { class: "title" }, "Crew"),
      h("div", { class: "muted" }, "People who appear in your logs")
    ),
    SkinSwitcher(),
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
      h("h1", { class: "title" }, "Map"),
      h("div", { class: "muted" }, "Where your logs were written")
    ),
    SkinSwitcher(),
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
