// Ship's Log in a web browser (including an iPhone home-screen install).
//
// The installed app keeps its journal in files on disk through Rust. In a
// browser there is no Rust side, so this file does that job with the
// browser's own database (IndexedDB): entries, recordings, photos and video
// all survive reloads, and backups are the same .zip files the installed app
// makes, so a backup moves freely between the browser, the Mac and the phone.
//
// Loaded before app.js; app.js uses window.ShipsLogWeb when Tauri is absent.

window.ShipsLogWeb = (() => {
  const DB_NAME = "shipslog";
  const DB_VERSION = 1;
  const STORES = ["entries", "audio", "media"];

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("entries")) db.createObjectStore("entries", { keyPath: "id" });
        if (!db.objectStoreNames.contains("audio")) db.createObjectStore("audio");
        if (!db.objectStoreNames.contains("media")) db.createObjectStore("media");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("The browser's storage couldn't be opened."));
      req.onblocked = () => reject(new Error("Close other Ship's Log tabs and try again."));
    }).then(async (db) => {
      await migrateFromLocalStorage(db);
      // Ask the browser not to throw this data away when space gets tight.
      try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}
      return db;
    });
    return dbPromise;
  }

  // Earlier browser previews kept entries in localStorage. Carry them over once.
  async function migrateFromLocalStorage(db) {
    let old;
    try { old = JSON.parse(localStorage.getItem("shipslog.entries") || "null"); } catch { old = null; }
    if (!Array.isArray(old) || !old.length) return;
    const existing = await run(db, "entries", "readonly", (s) => s.count());
    if (existing === 0) {
      await run(db, "entries", "readwrite", (s) => { old.forEach((e) => { if (e && e.id) s.put(e); }); });
    }
    try { localStorage.removeItem("shipslog.entries"); } catch {}
  }

  // One transaction on one store. `work` gets the store and may return a request
  // whose result is resolved; otherwise resolves when the transaction completes.
  function run(db, store, mode, work) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const s = tx.objectStore(store);
      let req;
      try { req = work(s); } catch (err) { reject(err); return; }
      let result;
      if (req && typeof req === "object" && "onsuccess" in req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("The browser's storage refused the change."));
      tx.onabort = () => reject(tx.error || new Error("The change to the browser's storage was cancelled."));
    });
  }

  const withDb = (fn) => open().then(fn);

  // ----- Entries -----

  const listEntries = () => withDb((db) => run(db, "entries", "readonly", (s) => s.getAll()));
  const saveEntry = (entry) => withDb((db) => run(db, "entries", "readwrite", (s) => s.put(entry)));
  const deleteEntry = (id) => withDb((db) => run(db, "entries", "readwrite", (s) => s.delete(id)));

  // ----- Recordings, photos and video (store = "audio" | "media") -----

  const putBlob = (store, file, blob) => withDb((db) => run(db, store, "readwrite", (s) => s.put(blob, file)));
  const getBlob = (store, file) => withDb((db) => run(db, store, "readonly", (s) => s.get(file)));
  const deleteBlob = (store, file) => withDb((db) => run(db, store, "readwrite", (s) => s.delete(file)));

  /** Every file in a store, as a Map of name → Blob. */
  async function allBlobs(store) {
    const db = await open();
    const keys = await run(db, store, "readonly", (s) => s.getAllKeys());
    const values = await run(db, store, "readonly", (s) => s.getAll());
    const map = new Map();
    keys.forEach((k, i) => map.set(k, values[i]));
    return map;
  }

  // ----- Backups: the same .zip layout as the installed app -----
  //   backup.json, settings.json, entries.json, audio/<file>, media/<file>

  const FORMAT = 1;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function zipAsync(files) {
    return new Promise((resolve, reject) => fflate.zip(files, (err, out) => (err ? reject(err) : resolve(out))));
  }
  function unzipAsync(bytes) {
    return new Promise((resolve, reject) => fflate.unzip(bytes, (err, out) => (err ? reject(err) : resolve(out))));
  }

  /** Builds a backup. `settingsText` is the settings JSON the app keeps. */
  async function makeBackup(settingsText) {
    const entries = await listEntries();
    const audio = await allBlobs("audio");
    const media = await allBlobs("media");

    const files = {};
    let count = 0;
    const addBlobs = async (folder, map) => {
      for (const [name, blob] of map) {
        if (!(blob instanceof Blob)) continue;
        files[`${folder}/${name}`] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
        count++;
      }
    };
    await addBlobs("audio", audio);
    await addBlobs("media", media);

    const manifest = { format: FORMAT, app: "Ship's Log", created: new Date().toISOString(), entries: entries.length, files: count };
    files["backup.json"] = [enc.encode(JSON.stringify(manifest, null, 2)), { level: 6 }];
    files["settings.json"] = [enc.encode(settingsText || "{}"), { level: 6 }];
    files["entries.json"] = [enc.encode(JSON.stringify(entries, null, 2)), { level: 6 }];

    const bytes = await zipAsync(files);
    return { blob: new Blob([bytes], { type: "application/zip" }), bytes: bytes.length, entries: entries.length, files: count };
  }

  /**
   * Replaces the journal with the contents of a backup file.
   * Returns the settings JSON text from the backup (or "{}").
   */
  async function restoreBackup(file) {
    let unzipped;
    try { unzipped = await unzipAsync(new Uint8Array(await file.arrayBuffer())); }
    catch { throw new Error("That file isn't a Ship's Log backup."); }
    if (!unzipped["entries.json"]) throw new Error("That file isn't a Ship's Log backup.");

    let entries;
    try { entries = JSON.parse(dec.decode(unzipped["entries.json"])); } catch { entries = null; }
    if (!Array.isArray(entries)) throw new Error("The backup's journal couldn't be read.");
    const settings = unzipped["settings.json"] ? dec.decode(unzipped["settings.json"]) : "{}";

    // Media types come from the entries, so playback knows what each file is.
    const mimes = new Map();
    for (const e of entries) {
      (e.recordings || []).forEach((r) => r && r.file && mimes.set(r.file, r.mime || "audio/mp4"));
      (e.media || []).forEach((m) => {
        if (!m) return;
        if (m.file) mimes.set(m.file, m.mime || "");
        if (m.original && !mimes.has(m.original)) mimes.set(m.original, "");
      });
    }

    const db = await open();
    for (const store of STORES) await run(db, store, "readwrite", (s) => s.clear());
    await run(db, "entries", "readwrite", (s) => { entries.forEach((e) => { if (e && e.id) s.put(e); }); });
    for (const [path, bytes] of Object.entries(unzipped)) {
      const slash = path.indexOf("/");
      if (slash < 0) continue;
      const folder = path.slice(0, slash);
      const name = path.slice(slash + 1);
      if (!name || !(folder === "audio" || folder === "media")) continue;
      await run(db, folder, "readwrite", (s) => s.put(new Blob([bytes], { type: mimes.get(name) || "" }), name));
    }
    return settings;
  }

  /** Hands a file to the user: the share sheet where there is one (phones), otherwise a download. */
  async function deliver(blob, name) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      try { await navigator.share({ files: [file], title: name }); return "shared"; }
      catch (err) { if (err && err.name === "AbortError") return "cancelled"; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 60000);
    return "downloaded";
  }

  /** Lets the user pick a file. Resolves with the File or null. */
  function pickFile(accept) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = accept;
      input.style.display = "none";
      input.onchange = () => { resolve(input.files[0] || null); input.remove(); };
      document.body.appendChild(input);
      input.click();
    });
  }

  /** True when running as a home-screen app rather than in a browser tab. */
  const isInstalled = () =>
    window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

  return { open, listEntries, saveEntry, deleteEntry, putBlob, getBlob, deleteBlob, allBlobs, makeBackup, restoreBackup, deliver, pickFile, isInstalled };
})();
