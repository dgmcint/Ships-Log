/*
  Reading logs aloud with the voices built into the system (Mac, iPhone, iPad,
  Windows and Android have them; some Linux systems don't).
  Voice styles are made from the chosen voice by changing its speed and pitch.
*/

const VOICE_STYLES = [
  // key, name, description, speed, pitch
  ["standard", "Standard", "The voice as it comes", 1, 1],
  ["captain", "Captain", "Deeper and measured", 0.9, 0.78],
  ["computer", "Ship's computer", "Crisp, even and a little quick", 1.08, 1.12],
  ["narrator", "Narrator", "Unhurried storytelling", 0.92, 0.95],
  ["custom", "Custom", "Set your own speed and pitch", null, null],
];

const tts = { speaking: false, voices: [] };
const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

function loadVoices() {
  if (!canSpeak()) return;
  const all = speechSynthesis.getVoices();
  const lang = (navigator.language || "en").slice(0, 2).toLowerCase();
  // The person's own language first, then the rest; each group by name.
  tts.voices = [...all].sort((a, b) =>
    (b.lang.toLowerCase().startsWith(lang) - a.lang.toLowerCase().startsWith(lang)) || a.name.localeCompare(b.name));
}
if (canSpeak()) {
  loadVoices();
  speechSynthesis.addEventListener("voiceschanged", () => { loadVoices(); try { if (state.screen === "settings") render(); } catch {} });
}

function voiceSettings() {
  const p = state.prefs;
  const style = VOICE_STYLES.find(([k]) => k === p.voiceStyle) || VOICE_STYLES[0];
  return {
    voice: tts.voices.find((v) => v.name === p.voiceName) || null,
    rate: style[0] === "custom" ? p.voiceRate : style[3],
    pitch: style[0] === "custom" ? p.voicePitch : style[4],
  };
}

/** Stardates are read digit by digit, the way a ship's log reads them: "eight zero eight six zero point four". */
function spokenStardate(n) {
  return Number(n).toFixed(1).split("").map((c) => (c === "." ? "point" : c)).join(" ");
}

function spokenIntro(e) {
  const parts = [];
  if (showStardate()) parts.push(`${T("Log entry", "Captain's log")}, ${T("log date", "stardate")} ${spokenStardate(e.stardate)}.`);
  else parts.push(`${T("Log entry", "Captain's log")}.`);
  if (showCalendar()) parts.push(new Date(e.created).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) + ".");
  return parts.join(" ");
}

function speak(text) {
  if (!canSpeak()) return;
  stopSpeaking();
  const { voice, rate, pitch } = voiceSettings();
  // Long entries are spoken a paragraph at a time; some systems stop partway through very long text.
  const chunks = text.split(/\n\s*\n|(?<=[.!?])\s+(?=\S)/).map((c) => c.trim()).filter(Boolean);
  const merged = [];
  for (const c of chunks) {
    if (merged.length && (merged[merged.length - 1].length + c.length) < 220) merged[merged.length - 1] += " " + c;
    else merged.push(c);
  }
  tts.speaking = true;
  merged.forEach((chunk, i) => {
    const u = new SpeechSynthesisUtterance(chunk);
    if (voice) { u.voice = voice; u.lang = voice.lang; }
    u.rate = rate; u.pitch = pitch;
    if (i === merged.length - 1) u.onend = u.onerror = () => { tts.speaking = false; if (state.screen === "read" || state.screen === "settings") render(); };
    speechSynthesis.speak(u);
  });
  render();
}

function stopSpeaking() {
  if (!canSpeak()) return;
  if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
  if (tts.speaking) { tts.speaking = false; }
}

function readAloud(e) {
  if (tts.speaking) { stopSpeaking(); render(); return; }
  const intro = state.prefs.readIntro ? spokenIntro(e) + "\n\n" : "";
  speak(intro + (e.title ? e.title + ".\n\n" : "") + (e.body || ""));
}

/** The Read aloud / Stop button on the reading screen. */
function ReadAloudButton(e) {
  if (!canSpeak()) return null;
  return h("button", { type: "button", class: "small-btn" + (tts.speaking ? " filled" : ""), title: tts.speaking ? "Stop reading aloud (R)" : "Read this log aloud (R)", onclick: () => readAloud(e) },
    svg(tts.speaking ? ICON.stop : ICON.speaker), tts.speaking ? T("Stop", "Stand down") : T("Read aloud", "Computer, read"));
}

/** Settings card: voice, style, speed and pitch. */
function VoiceSettings() {
  const p = state.prefs;
  if (!canSpeak()) {
    return h("section", { class: "card settings-card" },
      h("h2", { class: "h2" }, T("Read aloud", "Computer voice")),
      h("p", {}, "This system doesn't offer voices to the app, so logs can't be read aloud here."));
  }
  const custom = p.voiceStyle === "custom";
  const slider = (label, key, min, max) => h("label", { class: "stack voice-slider" },
    h("span", { class: "row" }, h("span", { class: "label" }, label), h("span", { class: "small" }, Number(p[key]).toFixed(2) + "×")),
    h("input", { type: "range", min, max, step: "0.02", value: p[key], oninput: (ev) => { state.prefs[key] = parseFloat(ev.target.value); ev.target.previousSibling.lastChild.textContent = Number(ev.target.value).toFixed(2) + "×"; },
      onchange: (ev) => setPref(key, parseFloat(ev.target.value)) }));
  const sample = `${T("Log entry", "Captain's log")}, ${T("log date", "stardate")} ${spokenStardate(currentStardate())}. All systems are running normally, and the crew is in good spirits.`;
  return h("section", { class: "card settings-card" },
    h("h2", { class: "h2" }, T("Read aloud", "Computer voice")),
    h("p", {}, "The reading screen has a Read aloud button. Choose the voice it uses."),
    h("label", { class: "stack" },
      h("span", { class: "label" }, "Voice"),
      h("select", { class: "field", onchange: (ev) => setPref("voiceName", ev.target.value) },
        h("option", { value: "", selected: !p.voiceName }, "System default"),
        tts.voices.map((v) => h("option", { value: v.name, selected: v.name === p.voiceName }, `${v.name} (${v.lang})`)))),
    h("div", { class: "stack" },
      h("span", { class: "label", id: "vstyle-label" }, "Style"),
      h("div", { class: "segment wrap", role: "group", "aria-labelledby": "vstyle-label" },
        VOICE_STYLES.map(([k, name]) => h("button", { type: "button", "aria-pressed": String(p.voiceStyle === k), onclick: () => setPref("voiceStyle", k) }, name))),
      h("span", { class: "small" }, (VOICE_STYLES.find(([k]) => k === p.voiceStyle) || VOICE_STYLES[0])[2] + ".")),
    custom ? slider("Speed", "voiceRate", "0.5", "1.6") : null,
    custom ? slider("Pitch", "voicePitch", "0.4", "1.6") : null,
    Toggle("Announce the log", "Start with “Captain's log, stardate …” before reading.", "readIntro"),
    h("button", { type: "button", class: "small-btn", onclick: () => { if (tts.speaking) { stopSpeaking(); render(); } else speak(sample); } },
      svg(tts.speaking ? ICON.stop : ICON.speaker), tts.speaking ? "Stop" : "Hear a sample"),
    h("p", { class: "small" }, "More voices: on a Mac, System Settings > Accessibility > Spoken Content > System voice > Manage Voices; on iPhone, Settings > Accessibility > Spoken Content > Voices; on Windows, Settings > Time & language > Speech. The enhanced and premium voices sound the most natural."));
}

// R reads the open log aloud (or stops) on a computer.
document.addEventListener("keydown", (ev) => {
  if (state.screen !== "read" || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (ev.key === "r" || ev.key === "R") {
    const e = state.entries.find((x) => x.id === state.readingId);
    if (e) readAloud(e);
  }
});
