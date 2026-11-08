//! Ship's Log backend: stores journal entries as JSON in the app's data folder
//! and exposes a few commands the interface calls.

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};

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
}

struct Store {
    path: PathBuf,
    entries: Mutex<Vec<Entry>>,
}

impl Store {
    fn load(path: PathBuf) -> Self {
        let entries = fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        Store {
            path,
            entries: Mutex::new(entries),
        }
    }

    /// Writes to a temporary file first, then swaps it in, so a crash mid-write
    /// never leaves a half-written journal.
    fn persist(&self, entries: &[Entry]) -> Result<(), String> {
        let text = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, text).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &self.path).map_err(|e| e.to_string())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            app.manage(Store::load(dir.join("entries.json")));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_entries,
            save_entry,
            delete_entry,
            search_entries
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ship's Log");
}
