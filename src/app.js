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
    }
  : {
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
};

try {
  const saved = localStorage.getItem("shipslog.skin");
  if (SKINS.some(([k]) => k === saved)) state.skin = saved;
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
  appEl.classList.toggle("composing", state.screen === "compose");
  appEl.classList.toggle("cover", state.screen === "cover");
  document.getElementById("bar-label").textContent =
    state.screen === "cover" ? "Personal records" : state.ship.ship || "Ship's Log";
  document.querySelectorAll(".nav [data-go]").forEach((b) => {
    if (b.dataset.go === state.screen) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  const view = { cover: CoverScreen, logs: LogsScreen, compose: ComposeScreen, search: SearchScreen, crew: CrewScreen, map: MapScreen }[state.screen];
  screenEl.replaceChildren(...[view()].flat(Infinity).filter(Boolean));
}

document.querySelectorAll(".nav [data-go]").forEach((b) =>
  b.addEventListener("click", () => go(b.dataset.go))
);

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
    h("p", {}, highlight(snippet(e), q))
  );
}

// ---------- Screens ----------

/** Original emblem: a planet inside a hexagonal frame, circled by an orbit. */
function Emblem() {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 220 220");
  s.setAttribute("class", "emblem");
  s.setAttribute("role", "img");
  s.setAttribute("aria-label", "Ship's Log emblem");
  s.innerHTML =
    '<polygon points="110,12 195,61 195,159 110,208 25,159 25,61" fill="none" stroke="var(--accent)" stroke-width="10" stroke-linejoin="round"/>' +
    '<polygon points="110,34 176,72 176,148 110,186 44,148 44,72" fill="var(--panel)" stroke="var(--accent2)" stroke-width="3"/>' +
    '<circle cx="110" cy="110" r="34" fill="var(--accent2)"/>' +
    '<ellipse cx="110" cy="110" rx="78" ry="26" transform="rotate(-24 110 110)" fill="none" stroke="var(--orange)" stroke-width="6"/>' +
    '<path d="M86 100 a34 34 0 0 1 48 -14" fill="none" stroke="var(--bg)" stroke-width="4" stroke-linecap="round" opacity=".35"/>' +
    '<circle cx="176" cy="84" r="8" fill="var(--accent)"/>';
  return s;
}

function CoverScreen() {
  const ship = state.ship;
  const line = [ship.captain && "Capt. " + ship.captain, ship.ship, ship.registry].filter(Boolean).join("  •  ");

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
        h("span", { class: "chip", style: { "--c": condColor } }, "Condition: " + condLabel)
      ),
      h("div", { class: "muted" }, `Log date ${stardate(now).toFixed(1)} · ${formatDate(now)}`)
    ),
    SkinSwitcher(),
    h("button", { type: "button", class: "primary", onclick: () => openCompose(null, { record: true }) },
      svg(ICON.mic), "Begin recording"),
    h("button", { type: "button", class: "small-btn", style: { "align-self": "center" }, onclick: () => openCompose(null) },
      svg(ICON.pen), "Write an entry"),
    h("div", { class: "row" },
      h("h2", { class: "h2" }, "Recent logs"),
      h("span", { class: "muted" }, `${state.entries.length} on file`)
    ),
    state.entries.length
      ? h("div", { class: "list" }, state.entries.map((e) => EntryCard(e)))
      : h("div", { class: "empty" }, "No logs on file yet. Tap Begin recording to write your first entry."),
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

// ---------- Entry screen ----------

function openCompose(entry, opts = {}) {
  const now = new Date();
  state.draft = entry
    ? { ...entry, crewText: (entry.crew || []).join(", "), recordings: [...(entry.recordings || [])] }
    : {
        id: "", created: now.toISOString(), stardate: stardate(now),
        logType: "personal", condition: "calm", title: "", body: "",
        crewText: "", place: "", locked: false, recordings: [],
      };
  state.draft.newFiles = [];
  state.draft.removedFiles = [];
  state.deleteArmed = false;
  recorder.error = "";
  go("compose");
  if (opts.record) startRecording();
}

/** Leaves the entry screen without saving: drops any recordings made since it opened. */
async function closeCompose() {
  const d = state.draft;
  await stopRecording(true);
  stopPlayback();
  for (const f of d.newFiles) await api.deleteAudio(f).catch(() => {});
  go("logs");
}

function ComposeScreen() {
  const d = state.draft;
  const isNew = !d.id;
  const set = (k) => (ev) => { d[k] = ev.target.value; };

  async function save() {
    await stopRecording();
    stopPlayback();
    if (!d.title.trim() && !d.body.trim() && !d.recordings.length) {
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
    };
    await api.save(entry);
    for (const f of d.removedFiles) await api.deleteAudio(f).catch(() => {});
    await refresh();
    go("logs");
  }

  async function remove() {
    if (!state.deleteArmed) { state.deleteArmed = true; render(); return; }
    await stopRecording(true);
    stopPlayback();
    for (const f of d.newFiles) await api.deleteAudio(f).catch(() => {});
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

    RecordingsSection(d),

    h("div", { class: "stack" },
      h("label", { class: "label", for: "entry-title" }, "Title"),
      h("input", { id: "entry-title", class: "field title-field", type: "text", placeholder: "What happened today?", value: d.title, oninput: set("title") })
    ),

    h("div", { class: "stack" },
      h("div", { class: "row" },
        h("label", { class: "label", for: "entry-body" }, "Entry"),
        h("button", {
          type: "button", class: "small-btn",
          onclick: () => {
            document.getElementById("entry-body").focus();
            document.getElementById("dictate-tip").hidden = false;
          },
        }, svg(ICON.mic), "Dictate")
      ),
      h("div", { id: "dictate-tip", class: "notice", hidden: true }, "Tap the microphone on your keyboard to dictate."),
      h("textarea", { id: "entry-body", class: "field", placeholder: "Personal log, supplemental…", value: d.body, oninput: set("body") })
    ),

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
  try { await refresh(); } catch (err) { console.error(err); }
  render();
})();
