//! Backups: the whole journal (entries, audio, photos, video and settings) in
//! one .zip file, and restoring from one.
//!
//! Layout of a backup:
//!   backup.json      what's inside and when it was made
//!   settings.json    skin, ship details, text color
//!   entries.json     the journal
//!   audio/<file>     recordings
//!   media/<file>     photos and videos

use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, BufWriter, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

use crate::{checked_name, Entry};

pub const FORMAT: u32 = 1;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct BackupState {
    /// When the last backup was made, in seconds since 1970.
    #[serde(default)]
    pub last_backup: Option<u64>,
    /// Computers only: a folder that gets a backup automatically.
    #[serde(default)]
    pub auto_folder: Option<String>,
    /// How often the automatic backup runs, in days.
    #[serde(default = "default_every")]
    pub auto_every_days: u32,
}

fn default_every() -> u32 {
    7
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub path: String,
    pub bytes: u64,
    pub entries: usize,
    pub files: usize,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format: u32,
    app: String,
    created: String,
    entries: usize,
    files: usize,
}

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Year, month, day (UTC) for a number of seconds since 1970.
fn ymd(secs: u64) -> (i64, u32, u32) {
    // Howard Hinnant's days-to-civil algorithm.
    let z = (secs / 86_400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

pub fn date_stamp(secs: u64) -> String {
    let (y, m, d) = ymd(secs);
    format!("{y:04}-{m:02}-{d:02}")
}

fn iso(secs: u64) -> String {
    let (y, m, d) = ymd(secs);
    let t = secs % 86_400;
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", t / 3600, t / 60 % 60, t % 60)
}

pub fn read_state(root: &Path) -> BackupState {
    fs::read_to_string(root.join("backup-state.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(BackupState {
            auto_every_days: default_every(),
            ..Default::default()
        })
}

pub fn write_state(root: &Path, state: &BackupState) -> Result<(), String> {
    let text = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(root.join("backup-state.json"), text).map_err(|e| e.to_string())
}

fn files_in(dir: &Path) -> Vec<(String, PathBuf)> {
    let mut list: Vec<(String, PathBuf)> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| {
            let name = e.file_name().to_str()?.to_string();
            checked_name(&name).ok()?;
            Some((name, e.path()))
        })
        .collect();
    list.sort();
    list
}

/// Writes a backup of everything in `root` to `dest`.
pub fn write_backup(root: &Path, dest: &Path) -> Result<BackupInfo, String> {
    let entries_text = fs::read_to_string(root.join("entries.json")).unwrap_or_else(|_| "[]".into());
    let entries: Vec<Entry> = serde_json::from_str(&entries_text).map_err(|e| e.to_string())?;
    let settings = fs::read_to_string(root.join("settings.json")).unwrap_or_else(|_| "{}".into());
    let audio = files_in(&root.join("audio"));
    let media = files_in(&root.join("media"));

    let part = dest.with_extension("zip.part");
    let out = fs::File::create(&part).map_err(|e| format!("couldn't create the backup file: {e}"))?;
    let mut zip = ZipWriter::new(BufWriter::new(out));
    let packed = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .large_file(false);
    // Photos, video and audio are already compressed; storing them is faster.
    let stored = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .large_file(true);

    let manifest = Manifest {
        format: FORMAT,
        app: "Ship's Log".into(),
        created: iso(now_secs()),
        entries: entries.len(),
        files: audio.len() + media.len(),
    };
    let write_text = |zip: &mut ZipWriter<_>, name: &str, text: &str| -> Result<(), String> {
        zip.start_file(name, packed).map_err(|e| e.to_string())?;
        zip.write_all(text.as_bytes()).map_err(|e| e.to_string())
    };
    write_text(&mut zip, "backup.json", &serde_json::to_string_pretty(&manifest).unwrap())?;
    write_text(&mut zip, "settings.json", &settings)?;
    write_text(&mut zip, "entries.json", &entries_text)?;
    for (folder, list) in [("audio", &audio), ("media", &media)] {
        for (name, path) in list {
            zip.start_file(format!("{folder}/{name}"), stored)
                .map_err(|e| e.to_string())?;
            let mut f = fs::File::open(path).map_err(|e| e.to_string())?;
            io::copy(&mut f, &mut zip).map_err(|e| e.to_string())?;
        }
    }
    let mut buf = zip.finish().map_err(|e| e.to_string())?;
    buf.flush().map_err(|e| e.to_string())?;
    drop(buf);
    fs::rename(&part, dest).map_err(|e| e.to_string())?;

    Ok(BackupInfo {
        path: dest.to_string_lossy().into_owned(),
        bytes: fs::metadata(dest).map(|m| m.len()).unwrap_or(0),
        entries: entries.len(),
        files: audio.len() + media.len(),
    })
}

/// Restores a backup into `root`. Everything is unpacked and checked first;
/// only then is the current journal moved to `before-restore/` (kept until the
/// next restore) and the backup put in its place. Returns the restored entries
/// and the backup's settings.
pub fn restore_backup(root: &Path, zip_path: &Path) -> Result<(Vec<Entry>, String), String> {
    let file = fs::File::open(zip_path).map_err(|e| format!("couldn't open the backup: {e}"))?;
    let mut zip = ZipArchive::new(file).map_err(|_| "That file isn't a Ship's Log backup.".to_string())?;

    let staging = root.join("restore-staging");
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(staging.join("audio")).map_err(|e| e.to_string())?;
    fs::create_dir_all(staging.join("media")).map_err(|e| e.to_string())?;

    let result = (|| {
        for i in 0..zip.len() {
            let mut item = zip.by_index(i).map_err(|e| e.to_string())?;
            if item.is_dir() {
                continue;
            }
            // Only known names are unpacked; anything else (including paths
            // that try to climb out of the folder) is ignored.
            let target = match item.name().split_once('/') {
                None if matches!(item.name(), "entries.json" | "settings.json" | "backup.json") => {
                    staging.join(item.name())
                }
                Some((folder @ ("audio" | "media"), name)) if checked_name(name).is_ok() => {
                    staging.join(folder).join(name)
                }
                _ => continue,
            };
            let mut out = fs::File::create(&target).map_err(|e| e.to_string())?;
            io::copy(&mut item, &mut out).map_err(|e| e.to_string())?;
        }

        let text = fs::read_to_string(staging.join("entries.json"))
            .map_err(|_| "That file isn't a Ship's Log backup (no journal inside).".to_string())?;
        let entries: Vec<Entry> =
            serde_json::from_str(&text).map_err(|_| "The journal inside that backup is damaged.".to_string())?;
        if let Ok(m) = fs::read_to_string(staging.join("backup.json")) {
            if let Ok(m) = serde_json::from_str::<Manifest>(&m) {
                if m.format > FORMAT {
                    return Err("That backup was made by a newer version of Ship's Log. Please update first.".into());
                }
            }
        }
        let settings = fs::read_to_string(staging.join("settings.json")).unwrap_or_else(|_| "{}".into());

        // Swap: current data aside, backup in.
        let previous = root.join("before-restore");
        let _ = fs::remove_dir_all(&previous);
        fs::create_dir_all(&previous).map_err(|e| e.to_string())?;
        for name in ["entries.json", "settings.json", "audio", "media"] {
            let from = root.join(name);
            if from.exists() {
                fs::rename(&from, previous.join(name)).map_err(|e| e.to_string())?;
            }
        }
        for name in ["entries.json", "settings.json", "audio", "media"] {
            let from = staging.join(name);
            if from.exists() {
                fs::rename(&from, root.join(name)).map_err(|e| e.to_string())?;
            }
        }
        Ok((entries, settings))
    })();

    let _ = fs::remove_dir_all(&staging);
    result
}

/// Computers only: if an automatic backup folder is set and the last backup is
/// old enough, make a new one there and keep the 10 most recent.
pub fn auto_backup_if_due(root: &Path) -> Result<Option<BackupInfo>, String> {
    let mut state = read_state(root);
    let Some(folder) = state.auto_folder.clone() else {
        return Ok(None);
    };
    let every = u64::from(state.auto_every_days.max(1)) * 86_400;
    let now = now_secs();
    if state.last_backup.is_some_and(|last| now.saturating_sub(last) < every) {
        return Ok(None);
    }
    let folder = PathBuf::from(folder);
    if !folder.is_dir() {
        return Err("The automatic backup folder can't be found.".into());
    }
    let dest = folder.join(format!("ShipsLog-auto-{}.zip", date_stamp(now)));
    let info = write_backup(root, &dest)?;
    state.last_backup = Some(now);
    write_state(root, &state)?;

    let mut old: Vec<PathBuf> = fs::read_dir(&folder)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("ShipsLog-auto-") && n.ends_with(".zip"))
        })
        .collect();
    old.sort();
    if old.len() > 10 {
        for p in &old[..old.len() - 10] {
            let _ = fs::remove_file(p);
        }
    }
    Ok(Some(info))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("shipslog-backup-{name}-{}", now_secs()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("audio")).unwrap();
        fs::create_dir_all(d.join("media")).unwrap();
        d
    }

    const ONE_ENTRY: &str = r#"[{"id":"log-1","created":"2026-11-08T08:00:00Z","stardate":80852.2,
        "logType":"personal","condition":"calm","title":"Harbor","body":"Fog lifting.",
        "media":[{"kind":"photo","file":"p.jpg"}],"recordings":[{"file":"r.m4a","mime":"audio/mp4"}]}]"#;

    #[test]
    fn dates() {
        assert_eq!(date_stamp(0), "1970-01-01");
        assert_eq!(date_stamp(1_794_096_000), "2026-11-08");
        assert_eq!(iso(951_782_400), "2000-02-29T00:00:00Z");
    }

    #[test]
    fn round_trip_keeps_everything_and_the_previous_journal() {
        let a = temp("a");
        fs::write(a.join("entries.json"), ONE_ENTRY).unwrap();
        fs::write(a.join("settings.json"), r#"{"skin":"holo"}"#).unwrap();
        fs::write(a.join("media/p.jpg"), vec![7u8; 300_000]).unwrap();
        fs::write(a.join("audio/r.m4a"), b"sound").unwrap();
        let zip = a.join("backup.zip");
        let info = write_backup(&a, &zip).unwrap();
        assert_eq!((info.entries, info.files), (1, 2));

        // Restore into a different journal; the old one is kept aside.
        let b = temp("b");
        fs::write(b.join("entries.json"), "[]").unwrap();
        fs::write(b.join("media/old.jpg"), b"old").unwrap();
        let (entries, settings) = restore_backup(&b, &zip).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].title, "Harbor");
        assert_eq!(settings, r#"{"skin":"holo"}"#);
        assert_eq!(fs::read(b.join("media/p.jpg")).unwrap().len(), 300_000);
        assert_eq!(fs::read(b.join("audio/r.m4a")).unwrap(), b"sound");
        assert!(!b.join("media/old.jpg").exists());
        assert!(b.join("before-restore/media/old.jpg").exists());
        assert!(!b.join("restore-staging").exists());
    }

    #[test]
    fn refuses_files_that_are_not_backups_and_leaves_journal_alone() {
        let d = temp("bad");
        fs::write(d.join("entries.json"), ONE_ENTRY).unwrap();
        let junk = d.join("junk.zip");
        fs::write(&junk, b"not a zip").unwrap();
        assert!(restore_backup(&d, &junk).is_err());

        // A zip with no journal inside.
        let empty = d.join("empty.zip");
        let mut z = ZipWriter::new(fs::File::create(&empty).unwrap());
        z.start_file("hello.txt", SimpleFileOptions::default()).unwrap();
        z.write_all(b"hi").unwrap();
        z.finish().unwrap();
        assert!(restore_backup(&d, &empty).is_err());
        assert_eq!(fs::read_to_string(d.join("entries.json")).unwrap(), ONE_ENTRY);
    }

    #[test]
    fn ignores_paths_that_try_to_escape() {
        let d = temp("escape");
        let evil = d.join("evil.zip");
        let mut z = ZipWriter::new(fs::File::create(&evil).unwrap());
        let o = SimpleFileOptions::default();
        z.start_file("entries.json", o).unwrap();
        z.write_all(b"[]").unwrap();
        z.start_file("media/../../escaped.txt", o).unwrap();
        z.write_all(b"x").unwrap();
        z.start_file("../escaped2.txt", o).unwrap();
        z.write_all(b"x").unwrap();
        z.finish().unwrap();
        restore_backup(&d, &evil).unwrap();
        assert!(!d.parent().unwrap().join("escaped.txt").exists());
        assert!(!d.parent().unwrap().join("escaped2.txt").exists());
    }

    #[test]
    fn automatic_backup_runs_when_due_and_keeps_ten() {
        let d = temp("auto");
        let folder = temp("auto-folder");
        fs::write(d.join("entries.json"), ONE_ENTRY).unwrap();
        for day in 1..=12 {
            fs::write(folder.join(format!("ShipsLog-auto-2026-01-{day:02}.zip")), b"old").unwrap();
        }
        write_state(&d, &BackupState { last_backup: None, auto_folder: Some(folder.to_string_lossy().into()), auto_every_days: 7 }).unwrap();
        assert!(auto_backup_if_due(&d).unwrap().is_some());
        assert!(auto_backup_if_due(&d).unwrap().is_none()); // not due again yet
        let count = fs::read_dir(&folder).unwrap().flatten().filter(|e| e.path().extension().is_some_and(|x| x == "zip")).count();
        assert_eq!(count, 10);
    }
}
