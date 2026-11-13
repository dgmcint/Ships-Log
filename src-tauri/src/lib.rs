//! Ship's Log backend: stores journal entries as JSON, plus audio recordings,
//! photos and videos as files in the app's data folder, and exposes the
//! commands the interface calls.

mod backup;

use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Write},
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Manager, State,
};
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    /// File name inside the app's `audio` folder, e.g. "rec-1762581234000.m4a".
    pub file: String,
    /// Audio format, e.g. "audio/mp4" or "audio/webm".
    pub mime: String,
    #[serde(default)]
    pub seconds: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    /// "photo" or "video".
    pub kind: String,
    /// The file shown or played, inside the app's `media` folder.
    pub file: String,
    /// The untouched original, when `file` is a converted copy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original: Option<String>,
    /// A small preview image.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumb: Option<String>,
    #[serde(default)]
    pub mime: String,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    /// Length of a video, in seconds.
    #[serde(default)]
    pub seconds: f64,
    #[serde(default)]
    pub bytes: u64,
}

impl Media {
    fn files(&self) -> impl Iterator<Item = &String> {
        std::iter::once(&self.file)
            .chain(self.original.iter())
            .chain(self.thumb.iter())
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    #[serde(default)]
    pub id: String,
    /// ISO 8601 timestamp from the device, e.g. "2026-11-07T22:31:00.000Z".
    pub created: String,
    pub stardate: f64,
    pub log_type: String,
    pub condition: String,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub crew: Vec<String>,
    #[serde(default)]
    pub place: String,
    #[serde(default)]
    pub locked: bool,
    #[serde(default)]
    pub recordings: Vec<Recording>,
    #[serde(default)]
    pub media: Vec<Media>,
}

struct Store {
    root: PathBuf,
    path: PathBuf,
    audio_dir: PathBuf,
    media_dir: PathBuf,
    entries: Mutex<Vec<Entry>>,
    /// Held while a backup or restore runs, so they never overlap.
    busy: Mutex<()>,
}

/// Accepts only plain file names, so nothing can point outside its folder.
pub(crate) fn checked_name(file: &str) -> Result<&str, String> {
    let ok = !file.is_empty()
        && file.len() <= 120
        && !file.starts_with('.')
        && file
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if ok {
        Ok(file)
    } else {
        Err(format!("invalid file name: {file}"))
    }
}

fn remove_if_present(path: PathBuf) -> Result<(), String> {
    match fs::remove_file(path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

impl Store {
    fn load(dir: PathBuf) -> io::Result<Self> {
        let path = dir.join("entries.json");
        let audio_dir = dir.join("audio");
        let media_dir = dir.join("media");
        fs::create_dir_all(&audio_dir)?;
        fs::create_dir_all(&media_dir)?;
        let entries = fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        Ok(Store {
            root: dir,
            path,
            audio_dir,
            media_dir,
            entries: Mutex::new(entries),
            busy: Mutex::new(()),
        })
    }

    /// Writes to a temporary file first, then swaps it in, so a crash mid-write
    /// never leaves a half-written journal.
    fn persist(&self, entries: &[Entry]) -> Result<(), String> {
        let text = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, text).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &self.path).map_err(|e| e.to_string())
    }

    fn audio_path(&self, file: &str) -> Result<PathBuf, String> {
        Ok(self.audio_dir.join(checked_name(file)?))
    }

    fn media_path(&self, file: &str) -> Result<PathBuf, String> {
        Ok(self.media_dir.join(checked_name(file)?))
    }
}

fn newest_first(mut list: Vec<Entry>) -> Vec<Entry> {
    list.sort_by(|a, b| b.created.cmp(&a.created));
    list
}

fn header<'a>(request: &'a Request<'_>, name: &str) -> Result<&'a str, String> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| format!("missing {name} header"))
}

// ---------- Entries ----------

#[tauri::command]
fn list_entries(store: State<Store>) -> Vec<Entry> {
    newest_first(store.entries.lock().unwrap().clone())
}

#[tauri::command]
fn save_entry(store: State<Store>, mut entry: Entry) -> Result<Entry, String> {
    let mut entries = store.entries.lock().unwrap();
    if entry.id.is_empty() {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis();
        entry.id = format!("log-{millis}");
    }
    entry.crew = entry
        .crew
        .iter()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect();
    entry.place = entry.place.trim().to_string();

    match entries.iter_mut().find(|e| e.id == entry.id) {
        Some(existing) => *existing = entry.clone(),
        None => entries.push(entry.clone()),
    }
    store.persist(&entries)?;
    Ok(entry)
}

#[tauri::command]
fn delete_entry(store: State<Store>, id: String) -> Result<(), String> {
    let mut entries = store.entries.lock().unwrap();
    if let Some(entry) = entries.iter().find(|e| e.id == id) {
        for rec in &entry.recordings {
            remove_if_present(store.audio_path(&rec.file)?)?;
        }
        for item in &entry.media {
            for file in item.files() {
                remove_if_present(store.media_path(file)?)?;
            }
        }
    }
    entries.retain(|e| e.id != id);
    store.persist(&entries)
}

#[tauri::command]
fn search_entries(store: State<Store>, query: String, log_type: Option<String>) -> Vec<Entry> {
    let q = query.trim().to_lowercase();
    let entries = store.entries.lock().unwrap();
    let hits = entries
        .iter()
        .filter(|e| match &log_type {
            Some(t) if !t.is_empty() && t != "all" => &e.log_type == t,
            _ => true,
        })
        .filter(|e| {
            q.is_empty()
                || e.title.to_lowercase().contains(&q)
                || (!e.locked && e.body.to_lowercase().contains(&q))
                || e.place.to_lowercase().contains(&q)
                || e.crew.iter().any(|c| c.to_lowercase().contains(&q))
        })
        .cloned()
        .collect();
    newest_first(hits)
}

// ---------- Audio ----------

/// Saves raw audio bytes sent from the interface. The file name comes in the
/// `x-file-name` header so the audio itself can travel as binary, not JSON.
#[tauri::command]
fn save_audio(store: State<Store>, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw audio bytes".into());
    };
    let name = header(&request, "x-file-name")?;
    fs::write(store.audio_path(name)?, bytes).map_err(|e| e.to_string())?;
    Ok(name.to_string())
}

/// Returns a recording's bytes; the interface receives them as an ArrayBuffer.
#[tauri::command]
fn load_audio(store: State<Store>, file: String) -> Result<Response, String> {
    let bytes = fs::read(store.audio_path(&file)?).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

#[tauri::command]
fn delete_audio(store: State<Store>, file: String) -> Result<(), String> {
    remove_if_present(store.audio_path(&file)?)
}

// ---------- Photos and video ----------

/// The folder photos and videos live in. The interface turns it into URLs it
/// can show and stream (Tauri's asset protocol), so large videos are never
/// loaded into memory all at once.
#[tauri::command]
fn media_dir(store: State<Store>) -> String {
    store.media_dir.to_string_lossy().into_owned()
}

/// Receives a photo or video in pieces: `x-offset: 0` starts the file, later
/// pieces are added to the end. Keeps memory low for long videos.
#[tauri::command]
fn save_media_chunk(store: State<Store>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw file bytes".into());
    };
    let path = store.media_path(header(&request, "x-file-name")?)?;
    let offset: u64 = header(&request, "x-offset")?
        .parse()
        .map_err(|_| "bad x-offset header")?;
    let mut file = if offset == 0 {
        fs::File::create(&path)
    } else {
        fs::OpenOptions::new().append(true).open(&path)
    }
    .map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() != offset {
        return Err("file pieces arrived out of order".into());
    }
    file.write_all(bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_media(store: State<Store>, file: String) -> Result<(), String> {
    remove_if_present(store.media_path(&file)?)
}

/// On computers with FFmpeg installed, makes an H.264/AAC MP4 copy (at most
/// 1080p) of a video that isn't one already, so it plays on every system.
/// Returns the copy's file name, or nothing when no copy was needed or
/// possible. Phones skip this: their cameras already record H.264 MP4.
#[tauri::command]
async fn convert_video(store: State<'_, Store>, file: String) -> Result<Option<String>, String> {
    let input = store.media_path(&file)?;
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("bad file name")?
        .to_string();
    let output = store.media_path(&format!("{stem}-play.mp4"))?;
    tauri::async_runtime::spawn_blocking(move || video::convert(&input, &output))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(desktop)]
mod video {
    use std::{
        path::{Path, PathBuf},
        process::Command,
    };

    /// Apps opened from the Finder don't see Homebrew's folders on their PATH,
    /// so the usual install places are checked directly.
    fn find(tool: &str) -> Option<PathBuf> {
        let exe = if cfg!(windows) { format!("{tool}.exe") } else { tool.to_string() };
        let mut places: Vec<PathBuf> = std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default();
        places.extend(
            ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "C:\\ffmpeg\\bin"]
                .iter()
                .map(PathBuf::from),
        );
        places.into_iter().map(|d| d.join(&exe)).find(|p| p.is_file())
    }

    /// True when the video is already H.264 in an MP4 at 1080p or smaller.
    fn already_fine(ffprobe: &Path, input: &Path) -> bool {
        let is_mp4 = input
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("mp4"));
        let Ok(out) = Command::new(ffprobe)
            .args(["-v", "error", "-select_streams", "v:0"])
            .args(["-show_entries", "stream=codec_name,width,height", "-of", "csv=p=0"])
            .arg(input)
            .output()
        else {
            return false;
        };
        let text = String::from_utf8_lossy(&out.stdout);
        let parts: Vec<&str> = text.trim().split(',').collect();
        match parts.as_slice() {
            [codec, w, h] => {
                let short_side = w.parse::<u32>().unwrap_or(u32::MAX).min(h.parse().unwrap_or(u32::MAX));
                is_mp4 && *codec == "h264" && short_side <= 1080
            }
            _ => false,
        }
    }

    pub fn convert(input: &Path, output: &Path) -> Result<Option<String>, String> {
        let Some(ffmpeg) = find("ffmpeg") else {
            return Ok(None);
        };
        if let Some(ffprobe) = find("ffprobe") {
            if already_fine(&ffprobe, input) {
                return Ok(None);
            }
        }
        let status = Command::new(ffmpeg)
            .args(["-y", "-v", "error", "-i"])
            .arg(input)
            // Shrink so the shorter side is at most 1080, keeping the shape.
            .args(["-vf", "scale='if(gt(iw,ih),-2,min(1080,iw))':'if(gt(iw,ih),min(1080,ih),-2)'"])
            .args(["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"])
            .args(["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"])
            .arg(output)
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            Ok(output.file_name().and_then(|n| n.to_str()).map(String::from))
        } else {
            let _ = std::fs::remove_file(output);
            Err("FFmpeg couldn't convert this video".into())
        }
    }
}

#[cfg(mobile)]
mod video {
    use std::path::Path;
    pub fn convert(_input: &Path, _output: &Path) -> Result<Option<String>, String> {
        Ok(None)
    }
}

// ---------- Settings and backups ----------

/// The interface keeps its settings (skin, ship details, text color) here too,
/// so backups include them.
#[tauri::command]
fn save_settings(store: State<Store>, settings: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&settings).map_err(|e| e.to_string())?;
    fs::write(store.root.join("settings.json"), settings).map_err(|e| e.to_string())
}

#[tauri::command]
fn backup_status(store: State<Store>) -> backup::BackupState {
    backup::read_state(&store.root)
}

fn backup_name() -> String {
    format!("ShipsLog-backup-{}.zip", backup::date_stamp(backup::now_secs()))
}

/// Asks where to save (on phones: the app's Documents folder, which shows in
/// the Files app) and writes the backup there. Returns nothing if cancelled.
#[tauri::command]
async fn backup_now(app: AppHandle) -> Result<Option<backup::BackupInfo>, String> {
    #[cfg(desktop)]
    let dest = {
        let start = app.path().document_dir().ok();
        let mut dialog = app
            .dialog()
            .file()
            .set_title("Save a backup of your log")
            .set_file_name(backup_name())
            .add_filter("Ship's Log backup", &["zip"]);
        if let Some(dir) = start {
            dialog = dialog.set_directory(dir);
        }
        match tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
            .await
            .map_err(|e| e.to_string())?
        {
            Some(p) => p.into_path().map_err(|e| e.to_string())?,
            None => return Ok(None),
        }
    };
    #[cfg(mobile)]
    let dest = {
        let dir = app.path().document_dir().map_err(|e| e.to_string())?.join("Backups");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        dir.join(backup_name())
    };

    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let store = handle.state::<Store>();
        let _busy = store.busy.lock().unwrap();
        let info = backup::write_backup(&store.root, &dest)?;
        let mut state = backup::read_state(&store.root);
        state.last_backup = Some(backup::now_secs());
        backup::write_state(&store.root, &state)?;
        Ok(Some(info))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Asks for a backup file and replaces the journal with it. The journal it
/// replaces is kept in a `before-restore` folder. Returns the backup's
/// settings, or nothing if cancelled.
#[tauri::command]
async fn restore_backup(app: AppHandle) -> Result<Option<String>, String> {
    let dialog = app
        .dialog()
        .file()
        .set_title("Choose a Ship's Log backup")
        .add_filter("Ship's Log backup", &["zip"]);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else { return Ok(None) };
    let zip_path = picked
        .into_path()
        .map_err(|_| "That file can't be opened from here. Copy it to the device first.".to_string())?;

    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let store = handle.state::<Store>();
        let _busy = store.busy.lock().unwrap();
        let mut entries = store.entries.lock().unwrap();
        let (restored, settings) = backup::restore_backup(&store.root, &zip_path)?;
        *entries = restored;
        Ok(Some(settings))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Computers only: pick the folder for automatic backups (or turn them off
/// with `off`), and how often they run.
#[tauri::command]
async fn set_auto_backup(app: AppHandle, off: bool, every_days: u32) -> Result<backup::BackupState, String> {
    let root = app.state::<Store>().root.clone();
    let mut state = backup::read_state(&root);
    state.auto_every_days = every_days.clamp(1, 90);
    if off {
        state.auto_folder = None;
    } else if state.auto_folder.is_none() {
        #[cfg(desktop)]
        {
            let dialog = app.dialog().file().set_title("Choose a folder for automatic backups");
            let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder())
                .await
                .map_err(|e| e.to_string())?;
            match picked {
                Some(p) => state.auto_folder = Some(p.into_path().map_err(|e| e.to_string())?.to_string_lossy().into_owned()),
                None => return Ok(backup::read_state(&root)),
            }
        }
    }
    backup::write_state(&root, &state)?;
    run_auto_backup(app);
    Ok(state)
}

/// Makes an automatic backup in the background if one is due.
fn run_auto_backup(app: AppHandle) {
    #[cfg(desktop)]
    std::thread::spawn(move || {
        let store = app.state::<Store>();
        let Ok(_busy) = store.busy.try_lock() else { return };
        if let Err(e) = backup::auto_backup_if_due(&store.root) {
            eprintln!("automatic backup: {e}");
        }
    });
    #[cfg(mobile)]
    let _ = app;
}

/// Name of the folder that switches the app to portable mode when it sits beside the app.
const PORTABLE_FOLDER: &str = "Ships Log Data";

/// The folder the app itself sits in: beside the .exe (Windows), the .AppImage (Linux)
/// or the .app (Mac). None on phones.
fn app_home() -> Option<PathBuf> {
    #[cfg(desktop)]
    {
        if let Some(img) = std::env::var_os("APPIMAGE") {
            return PathBuf::from(img).parent().map(|p| p.to_path_buf());
        }
        let exe = std::env::current_exe().ok()?;
        let dir = exe.parent()?.to_path_buf();
        #[cfg(target_os = "macos")]
        {
            // Ship's Log.app/Contents/MacOS/ship-s-log → the folder holding Ship's Log.app
            if dir.ends_with("Contents/MacOS") {
                return dir.parent()?.parent()?.parent().map(|p| p.to_path_buf());
            }
        }
        Some(dir)
    }
    #[cfg(mobile)]
    {
        None
    }
}

/// Name of the data folder in Documents, when the person chooses to keep the log there.
const DOCUMENTS_FOLDER: &str = "Ships Log";
/// Small file in the standard app-data folder that points to a chosen data folder.
const LOCATION_FILE: &str = "location.json";

/// The standard app-data folder, or the folder chosen in Settings (Documents/Ships Log).
fn default_data_dir(app: &tauri::App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let standard = app.path().app_data_dir()?;
    if let Some(chosen) = chosen_dir(&standard) {
        return Ok(chosen);
    }
    Ok(standard)
}

fn chosen_dir(standard: &std::path::Path) -> Option<PathBuf> {
    let text = fs::read_to_string(standard.join(LOCATION_FILE)).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let dir = PathBuf::from(v.get("dir")?.as_str()?);
    // If the chosen folder has gone missing (a drive unplugged, a folder renamed), make it again
    // rather than quietly using another folder: the log may come back when the folder does.
    Some(dir)
}

fn portable_dir() -> Option<PathBuf> {
    let d = app_home()?.join(PORTABLE_FOLDER);
    d.is_dir().then_some(d)
}

#[derive(Serialize)]
struct DataLocation {
    path: String,
    portable: bool,
    portable_folder: String,
    app_folder: Option<String>,
    in_documents: bool,
    documents_path: Option<String>,
    standard_path: Option<String>,
}

fn documents_target(app: &AppHandle) -> Option<PathBuf> {
    let docs = app.path().document_dir().or_else(|_| app.path().home_dir()).ok()?;
    Some(docs.join(DOCUMENTS_FOLDER))
}

/// Where the log is kept, for the Settings screen.
#[tauri::command]
fn data_location(app: AppHandle, store: State<Store>) -> DataLocation {
    let portable = portable_dir().map_or(false, |d| d == store.root);
    let standard = app.path().app_data_dir().ok();
    DataLocation {
        path: store.root.display().to_string(),
        portable,
        portable_folder: PORTABLE_FOLDER.into(),
        app_folder: app_home().map(|p| p.display().to_string()),
        in_documents: !portable && standard.as_ref().map_or(false, |s| *s != store.root),
        documents_path: documents_target(&app).map(|p| p.display().to_string()),
        standard_path: standard.map(|p| p.display().to_string()),
    }
}

/// Moves the log between the standard app-data folder and Documents/Ships Log.
/// The log is copied (the old copy is left, with a note), and the app then restarts to use it.
#[tauri::command]
fn move_data(app: AppHandle, store: State<Store>, to_documents: bool) -> Result<String, String> {
    let standard = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let target = if to_documents {
        documents_target(&app).ok_or("Couldn't find the Documents folder.")?
    } else {
        standard.clone()
    };
    if target == store.root {
        return Ok(target.display().to_string());
    }
    if to_documents && target.join("entries.json").exists() {
        return Err(format!("{} already has a log in it. Move or rename that folder first.", target.display()));
    }
    {
        let _guard = store.busy.lock().map_err(|e| e.to_string())?;
        copy_dir(&store.root, &target).map_err(|e| format!("Couldn't copy the log to {}: {e}", target.display()))?;
        let _ = fs::remove_file(target.join("MOVED.txt"));
        if to_documents {
            let _ = fs::remove_file(target.join(LOCATION_FILE));
            fs::write(standard.join(LOCATION_FILE), serde_json::json!({ "dir": target }).to_string()).map_err(|e| e.to_string())?;
        } else {
            fs::remove_file(standard.join(LOCATION_FILE)).map_err(|e| e.to_string())?;
        }
        let _ = fs::write(
            store.root.join("MOVED.txt"),
            format!("Ship's Log now keeps its log in {}.\nThis folder is an older copy and can be deleted.\n", target.display()),
        );
    }
    Ok(target.display().to_string())
}

#[tauri::command]
fn restart_app(app: AppHandle) {
    app.restart();
}

/// Opens the data folder in Finder, File Explorer or the Linux file manager.
#[tauri::command]
fn show_data_folder(store: State<Store>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(target_os = "windows")]
    let cmd = "explorer";
    #[cfg(all(desktop, not(any(target_os = "macos", target_os = "windows"))))]
    let cmd = "xdg-open";
    #[cfg(desktop)]
    {
        std::process::Command::new(cmd).arg(&store.root).spawn().map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(mobile)]
    {
        let _ = store;
        Err("Not available on phones.".into())
    }
}

/// Makes the "Ships Log Data" folder beside the app and copies the current log into it.
/// The app uses it from the next start.
#[tauri::command]
fn make_portable(store: State<Store>) -> Result<String, String> {
    let home = app_home().ok_or("Portable mode is for computers.")?;
    let dest = home.join(PORTABLE_FOLDER);
    if dest == store.root {
        return Ok(dest.display().to_string());
    }
    if dest.exists() && fs::read_dir(&dest).map_err(|e| e.to_string())?.next().is_some() {
        return Err(format!("{} already has files in it.", dest.display()));
    }
    let _guard = store.busy.lock().map_err(|e| e.to_string())?;
    copy_dir(&store.root, &dest).map_err(|e| format!("Couldn't copy the log to {}: {e}", dest.display()))?;
    Ok(dest.display().to_string())
}

fn copy_dir(from: &std::path::Path, to: &std::path::Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for item in fs::read_dir(from)? {
        let item = item?;
        let target = to.join(item.file_name());
        if item.file_type()?.is_dir() {
            if item.file_name() == "before-restore" {
                continue;
            }
            copy_dir(&item.path(), &target)?;
        } else {
            fs::copy(item.path(), target)?;
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Portable: a "Ships Log Data" folder beside the app keeps the log there instead.
            let dir = match portable_dir() {
                Some(d) => d,
                None => default_data_dir(app)?,
            };
            fs::create_dir_all(&dir)?;
            // Photos and video are shown straight from disk, so the viewer must be allowed to read them there.
            let _ = app.asset_protocol_scope().allow_directory(dir.join("media"), true);
            app.manage(Store::load(dir)?);
            // Check for a due automatic backup now and every hour.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                run_auto_backup(handle.clone());
                std::thread::sleep(std::time::Duration::from_secs(3600));
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_entries,
            save_entry,
            delete_entry,
            search_entries,
            save_audio,
            load_audio,
            delete_audio,
            media_dir,
            save_media_chunk,
            delete_media,
            convert_video,
            save_settings,
            backup_status,
            backup_now,
            restore_backup,
            set_auto_backup,
            data_location,
            make_portable,
            move_data,
            restart_app,
            show_data_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ship's Log");
}

#[cfg(all(test, desktop))]
mod tests {
    use super::video;
    use std::process::Command;

    fn make(path: &std::path::Path, size: &str, codec: &[&str]) {
        let ok = Command::new("ffmpeg")
            .args(["-y", "-v", "error", "-f", "lavfi", "-i"])
            .arg(format!("testsrc=duration=2:size={size}:rate=30"))
            .args(["-f", "lavfi", "-i", "sine=duration=2"])
            .args(codec)
            .arg(path)
            .status()
            .unwrap()
            .success();
        assert!(ok);
    }

    fn short_side(path: &std::path::Path) -> (String, u32) {
        let out = Command::new("ffprobe")
            .args(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height", "-of", "csv=p=0"])
            .arg(path)
            .output()
            .unwrap();
        let t = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let p: Vec<&str> = t.split(',').collect();
        (p[0].to_string(), p[1].parse::<u32>().unwrap().min(p[2].parse().unwrap()))
    }

    #[test]
    fn converts_only_when_needed() {
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            return; // FFmpeg not installed here
        }
        let dir = std::env::temp_dir().join("shipslog-video-test");
        std::fs::create_dir_all(&dir).unwrap();

        // A large WebM (like Windows/Android in-app recordings) gets a 1080p H.264 copy.
        let webm = dir.join("big.webm");
        make(&webm, "2560x1440", &["-c:v", "libvpx-vp9", "-b:v", "1M", "-c:a", "libopus"]);
        let out = dir.join("big-play.mp4");
        assert_eq!(video::convert(&webm, &out).unwrap().as_deref(), Some("big-play.mp4"));
        assert_eq!(short_side(&out), ("h264".to_string(), 1080));

        // A portrait phone video keeps its shape.
        let tall = dir.join("tall.webm");
        make(&tall, "1440x2560", &["-c:v", "libvpx-vp9", "-b:v", "1M", "-c:a", "libopus"]);
        let out2 = dir.join("tall-play.mp4");
        video::convert(&tall, &out2).unwrap();
        assert_eq!(short_side(&out2), ("h264".to_string(), 1080));

        // An H.264 MP4 at 720p is left alone.
        let fine = dir.join("fine.mp4");
        make(&fine, "1280x720", &["-c:v", "libx264", "-c:a", "aac"]);
        assert_eq!(video::convert(&fine, &dir.join("fine-play.mp4")).unwrap(), None);
    }
}

#[cfg(test)]
mod location_tests {
    use super::*;

    #[test]
    fn chosen_folder_and_copy() {
        let base = std::env::temp_dir().join(format!("shipslog-loc-{}", std::process::id()));
        let standard = base.join("standard");
        let docs = base.join("Documents").join(DOCUMENTS_FOLDER);
        fs::create_dir_all(standard.join("media")).unwrap();
        fs::write(standard.join("entries.json"), "[]").unwrap();
        fs::write(standard.join("media").join("a.jpg"), "x").unwrap();
        fs::create_dir_all(standard.join("before-restore")).unwrap();
        assert!(chosen_dir(&standard).is_none());

        copy_dir(&standard, &docs).unwrap();
        assert!(docs.join("entries.json").exists());
        assert!(docs.join("media").join("a.jpg").exists());
        assert!(!docs.join("before-restore").exists());

        fs::write(standard.join(LOCATION_FILE), serde_json::json!({ "dir": docs }).to_string()).unwrap();
        assert_eq!(chosen_dir(&standard), Some(docs.clone()));
        fs::remove_dir_all(&base).unwrap();
    }
}
