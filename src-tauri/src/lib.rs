//! Almacenamiento local de UniCore.
//!
//! Todo vive en `Documentos\UniCore`:
//! - `unicore.db`: base SQLite con los registros (carreras, materias, tareas, apuntes, etc.).
//! - `archivos\`: fotos y PDFs como archivos comunes, nombrados `<id>.<extensión>`.
//!
//! La interfaz trabaja sobre IndexedDB y espeja cada cambio acá; al abrir la app se
//! restaura desde esta carpeta, que es la copia que manda.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde_json::Value;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{Manager, State};
use tauri_plugin_opener::OpenerExt;

struct Store {
    conn: Mutex<Connection>,
    root: PathBuf,
}

impl Store {
    fn files_dir(&self) -> PathBuf {
        self.root.join("archivos")
    }
}

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn data_root() -> PathBuf {
    let base = dirs::document_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("UniCore")
}

fn open_store() -> Result<Store, String> {
    let root = data_root();
    fs::create_dir_all(root.join("archivos")).map_err(err)?;
    let conn = Connection::open(root.join("unicore.db")).map_err(err)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS records (
           tbl  TEXT NOT NULL,
           id   TEXT NOT NULL,
           data TEXT NOT NULL,
           updated_at TEXT NOT NULL DEFAULT (datetime('now')),
           PRIMARY KEY (tbl, id)
         );",
    )
    .map_err(err)?;
    Ok(Store { conn: Mutex::new(conn), root })
}

// Sólo letras, números, guion y guion bajo: evita salir de la carpeta con "../".
fn safe(s: &str) -> CmdResult<&str> {
    if !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        Ok(s)
    } else {
        Err(format!("Identificador inválido: {s}"))
    }
}

#[tauri::command]
fn data_dir(store: State<Store>) -> String {
    store.root.to_string_lossy().into_owned()
}

/// Devuelve todos los registros agrupados por tabla.
#[tauri::command]
fn db_dump(store: State<Store>) -> CmdResult<HashMap<String, Vec<Value>>> {
    let conn = store.conn.lock().map_err(err)?;
    let mut stmt = conn.prepare("SELECT tbl, data FROM records").map_err(err)?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?;
    let mut out: HashMap<String, Vec<Value>> = HashMap::new();
    for row in rows {
        let (tbl, data) = row.map_err(err)?;
        if let Ok(v) = serde_json::from_str(&data) {
            out.entry(tbl).or_default().push(v);
        }
    }
    Ok(out)
}

#[tauri::command]
fn db_put(store: State<Store>, table: String, id: String, data: Value) -> CmdResult<()> {
    let conn = store.conn.lock().map_err(err)?;
    conn.execute(
        "INSERT INTO records (tbl, id, data, updated_at) VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT(tbl, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
        params![table, id, data.to_string()],
    )
    .map_err(err)?;
    Ok(())
}

/// Carga masiva (primera migración desde el navegador).
#[tauri::command]
fn db_put_many(store: State<Store>, table: String, records: Vec<Value>) -> CmdResult<()> {
    let mut conn = store.conn.lock().map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    for rec in records {
        if let Some(id) = rec.get("id").and_then(|v| v.as_str()) {
            tx.execute(
                "INSERT OR REPLACE INTO records (tbl, id, data, updated_at) VALUES (?1, ?2, ?3, datetime('now'))",
                params![table, id, rec.to_string()],
            )
            .map_err(err)?;
        }
    }
    tx.commit().map_err(err)
}

#[tauri::command]
fn db_delete(store: State<Store>, table: String, id: String) -> CmdResult<()> {
    let conn = store.conn.lock().map_err(err)?;
    conn.execute("DELETE FROM records WHERE tbl = ?1 AND id = ?2", params![table, id])
        .map_err(err)?;
    Ok(())
}

/// Guarda los bytes de una foto o PDF. Cabeceras: x-file (nombre en disco, `<id>.<ext>`).
#[tauri::command]
fn file_write(store: State<Store>, request: Request<'_>) -> CmdResult<()> {
    let name = request
        .headers()
        .get("x-file")
        .and_then(|h| h.to_str().ok())
        .ok_or("Falta el nombre del archivo")?
        .to_string();
    let (stem, ext) = name.split_once('.').unwrap_or((name.as_str(), "bin"));
    let path = store.files_dir().join(format!("{}.{}", safe(stem)?, safe(ext)?));
    match request.body() {
        InvokeBody::Raw(bytes) => fs::write(path, bytes).map_err(err),
        InvokeBody::Json(_) => Err("Se esperaban bytes".into()),
    }
}

#[tauri::command]
fn file_read(store: State<Store>, file: String) -> CmdResult<Response> {
    let (stem, ext) = file.split_once('.').unwrap_or((file.as_str(), "bin"));
    let path = store.files_dir().join(format!("{}.{}", safe(stem)?, safe(ext)?));
    fs::read(path).map(Response::new).map_err(err)
}

#[tauri::command]
fn file_delete(store: State<Store>, file: String) -> CmdResult<()> {
    let (stem, ext) = file.split_once('.').unwrap_or((file.as_str(), "bin"));
    let path = store.files_dir().join(format!("{}.{}", safe(stem)?, safe(ext)?));
    if path.exists() {
        fs::remove_file(path).map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
fn open_data_folder(app: tauri::AppHandle, store: State<Store>) -> CmdResult<()> {
    app.opener()
        .open_path(store.root.to_string_lossy(), None::<&str>)
        .map_err(err)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let store = open_store()?;
            app.manage(store);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            data_dir,
            db_dump,
            db_put,
            db_put_many,
            db_delete,
            file_write,
            file_read,
            file_delete,
            open_data_folder
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar UniCore");
}
