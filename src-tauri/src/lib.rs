//! Ship's Log backend: stores journal entries as JSON and audio recordings as
//! files in the app's data folder, and exposes commands the interface calls.

use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    Manager, State,
};

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
}

struct Store {
    path: PathBuf,
    audio_dir: PathBuf,
    entries: Mutex<Vec<Entry>>,
}

impl Store {
    fn load(dir: PathBuf) -> io::Result<Self> {
        let path = dir.join("entries.json");
        let audio_dir = dir.join("audio");
        fs::create_dir_all(&audio_dir)?;
        let entries = fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        Ok(Store {
            path,
            audio_dir,
            entries: Mutex::new(entries),
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

    /// Resolves a recording's file name to its path, refusing anything that
    /// could point outside the audio folder.
    fn audio_path(&self, file: &str) -> Result<PathBuf, String> {
        let ok = !file.is_empty()
            && file.len() <= 100
            && !file.starts_with('.')
            && file
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
        if ok {
            Ok(self.audio_dir.join(file))
        } else {
            Err(format!("invalid recording name: {file}"))
        }
    }

    fn remove_audio(&self, file: &str) -> Result<(), String> {
        match fs::remove_file(self.audio_path(file)?) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        }
    }
}

fn newest_first(mut list: Vec<Entry>) -> Vec<Entry> {
    list.sort_by(|a, b| b.created.cmp(&a.created));
    list
}

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
            store.remove_audio(&rec.file)?;
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

/// Saves raw audio bytes sent from the interface. The file name comes in the
/// `x-file-name` header so the audio itself can travel as binary, not JSON.
#[tauri::command]
fn save_audio(store: State<Store>, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw audio bytes".into());
    };
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing x-file-name header")?;
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
    store.remove_audio(&file)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            app.manage(Store::load(dir)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_entries,
            save_entry,
            delete_entry,
            search_entries,
            save_audio,
            load_audio,
            delete_audio
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ship's Log");
}
