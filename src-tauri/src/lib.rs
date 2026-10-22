//! Almacenamiento local de UniCore.
//!
//! Todo vive en `Documentos\UniCore`:
//! - `unicore.db`: base SQLite con los registros (carreras, materias, tareas, apuntes, etc.).
//! - `archivos\`: fotos y PDFs como archivos comunes, nombrados `<id>.<extensión>`.
//!
//! Sin WAL: todo queda en un solo archivo, así OneDrive o un pendrive copian la base completa.
//!
//! La interfaz trabaja sobre IndexedDB y espeja cada cambio acá; al abrir la app se
//! restaura desde esta carpeta, que es la copia que manda.
//!
//! Con `unicore.exe --mcp` el mismo ejecutable funciona como servidor MCP (ver mcp.rs)
//! para que otras IAs lean y escriban en esta base. Lo que escribe el MCP se marca con
//! `source = 'mcp'` y la app lo trae con `db_changes_since`.

mod frame;
mod ia;
mod mcp;
mod ocr;
mod search;

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde_json::Value;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{Manager, State};
use tauri_plugin_opener::OpenerExt;

pub(crate) struct Store {
    pub(crate) conn: Mutex<Connection>,
    pub(crate) root: PathBuf,
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
    // Para pruebas: UNICORE_DATA_DIR apunta a otra carpeta y no toca los datos reales.
    if let Some(dir) = std::env::var_os("UNICORE_DATA_DIR") {
        return PathBuf::from(dir);
    }
    let base = dirs::document_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("UniCore")
}

pub(crate) fn open_store() -> Result<Store, String> {
    let root = data_root();
    fs::create_dir_all(root.join("archivos")).map_err(err)?;
    let conn = Connection::open(root.join("unicore.db")).map_err(err)?;
    conn.execute_batch(
        "PRAGMA journal_mode = DELETE;
         CREATE TABLE IF NOT EXISTS records (
           tbl  TEXT NOT NULL,
           id   TEXT NOT NULL,
           data TEXT NOT NULL,
           updated_at TEXT NOT NULL DEFAULT (datetime('now')),
           PRIMARY KEY (tbl, id)
         );",
    )
    .map_err(err)?;
    // v2: de dónde vino el último cambio (app o mcp). Dos procesos pueden usar la base a la vez.
    let has_source: bool = conn
        .prepare("SELECT 1 FROM pragma_table_info('records') WHERE name = 'source'")
        .and_then(|mut st| st.exists([]))
        .map_err(err)?;
    if !has_source {
        conn.execute_batch("ALTER TABLE records ADD COLUMN source TEXT NOT NULL DEFAULT 'app';").map_err(err)?;
    }
    // v3: número de revisión que sube con cada cambio (venga de la app o del MCP).
    // Si al abrir coincide con el que recuerda la interfaz, no hace falta recargar todo.
    // Arranca en la cantidad de registros (una base con datos nunca está en 0) y `uid`
    // distingue esta base de otra carpeta de datos.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
         INSERT OR IGNORE INTO meta (k, v) VALUES ('rev', (SELECT count(*) FROM records));
         INSERT OR IGNORE INTO meta (k, v) VALUES ('uid', lower(hex(randomblob(8))));
         CREATE TRIGGER IF NOT EXISTS rev_ins AFTER INSERT ON records BEGIN UPDATE meta SET v = v + 1 WHERE k = 'rev'; END;
         CREATE TRIGGER IF NOT EXISTS rev_upd AFTER UPDATE ON records BEGIN UPDATE meta SET v = v + 1 WHERE k = 'rev'; END;
         CREATE TRIGGER IF NOT EXISTS rev_del AFTER DELETE ON records BEGIN UPDATE meta SET v = v + 1 WHERE k = 'rev'; END;",
    )
    .map_err(err)?;
    search::init(&conn).map_err(err)?;
    conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(err)?;
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

fn rev(conn: &Connection) -> CmdResult<i64> {
    conn.query_row("SELECT v FROM meta WHERE k = 'rev'", [], |r| r.get(0)).map_err(err)
}

/// Identificador de esta base y su revisión actual.
#[tauri::command]
async fn db_rev(store: State<'_, Store>) -> CmdResult<(String, i64)> {
    let conn = store.conn.lock().map_err(err)?;
    let uid: String = conn.query_row("SELECT v FROM meta WHERE k = 'uid'", [], |r| r.get(0)).map_err(err)?;
    Ok((uid, rev(&conn)?))
}

/// Devuelve todos los registros agrupados por tabla.
#[tauri::command]
async fn db_dump(store: State<'_, Store>) -> CmdResult<HashMap<String, Vec<Value>>> {
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
fn db_put(store: State<Store>, table: String, id: String, data: Value) -> CmdResult<i64> {
    let conn = store.conn.lock().map_err(err)?;
    conn.execute(
        "INSERT INTO records (tbl, id, data, updated_at, source) VALUES (?1, ?2, ?3, datetime('now'), 'app')
         ON CONFLICT(tbl, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, source = 'app'",
        params![table, id, data.to_string()],
    )
    .map_err(err)?;
    rev(&conn)
}

/// Carga masiva (primera migración desde el navegador).
#[tauri::command]
async fn db_put_many(store: State<'_, Store>, table: String, records: Vec<Value>) -> CmdResult<()> {
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

/// Registros que escribió el MCP desde `since` (formato "YYYY-MM-DD HH:MM:SS"). Devuelve también la hora actual de la base.
#[tauri::command]
fn db_changes_since(store: State<Store>, since: String) -> CmdResult<(String, HashMap<String, Vec<Value>>)> {
    let conn = store.conn.lock().map_err(err)?;
    let now: String = conn.query_row("SELECT datetime('now')", [], |r| r.get(0)).map_err(err)?;
    let mut stmt = conn
        .prepare("SELECT tbl, data FROM records WHERE source = 'mcp' AND updated_at >= ?1")
        .map_err(err)?;
    let rows = stmt
        .query_map(params![since], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?;
    let mut out: HashMap<String, Vec<Value>> = HashMap::new();
    for row in rows {
        let (tbl, data) = row.map_err(err)?;
        if let Ok(v) = serde_json::from_str(&data) {
            out.entry(tbl).or_default().push(v);
        }
    }
    Ok((now, out))
}

#[tauri::command]
fn db_delete(store: State<Store>, table: String, id: String) -> CmdResult<i64> {
    let conn = store.conn.lock().map_err(err)?;
    conn.execute("DELETE FROM records WHERE tbl = ?1 AND id = ?2", params![table, id])
        .map_err(err)?;
    rev(&conn)
}

/// Guarda los bytes de una foto o PDF. Cabeceras: x-file (nombre en disco, `<id>.<ext>`).
#[tauri::command]
async fn file_write(store: State<'_, Store>, request: Request<'_>) -> CmdResult<()> {
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
async fn file_read(store: State<'_, Store>, file: String) -> CmdResult<Response> {
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

/// Vuelve a pintar el borde de la ventana después de mostrarla (ver frame.rs).
#[tauri::command]
fn refresh_frame(window: tauri::WebviewWindow) {
    frame::repaint(&window);
}

/// Modo servidor MCP por stdio (`unicore.exe --mcp`).
pub fn run_mcp() {
    mcp::serve();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Recuerda si la ventana quedó maximizada, su tamaño y posición al cerrar.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // La visibilidad no: la ventana se muestra cuando la interfaz está lista.
                .with_state_flags(tauri_plugin_window_state::StateFlags::all() & !tauri_plugin_window_state::StateFlags::VISIBLE)
                .build(),
        )
        // Actualizaciones con un clic: busca la versión nueva en GitHub y la instala (firmada).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let store = open_store()?;
            // El índice de búsqueda se arma de fondo, con su propia conexión, para no frenar el arranque.
            let db_path = store.root.join("unicore.db");
            std::thread::spawn(move || {
                if let Ok(conn) = Connection::open(db_path) {
                    let _ = conn.busy_timeout(std::time::Duration::from_secs(5));
                    let _ = search::sync(&conn);
                }
            });
            app.manage(store);
            if let Some(w) = app.get_webview_window("main") {
                frame::install(&w);
            }
            // Por si la interfaz no llega a mostrar la ventana (un error al cargar), se muestra igual.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(5));
                if let Some(w) = handle.get_webview_window("main") {
                    if !w.is_visible().unwrap_or(true) {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
            });
            app.manage(ia::Ia::default());
            app.manage(ia::Downloads::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            data_dir,
            db_rev,
            db_dump,
            db_put,
            db_put_many,
            db_changes_since,
            db_delete,
            file_write,
            file_read,
            file_delete,
            open_data_folder,
            refresh_frame,
            search::search_chunks,
            ocr::ocr_image,
            ocr::ocr_words,
            ia::ia_info,
            ia::ia_start,
            ia::ia_stop,
            ia::ia_log,
            ia::web_get,
            ia::ia_download,
            ia::ia_download_status,
            ia::ia_remove,
            ia::ia_free_space,
            ia::ia_catalog,
            ia::save_export
        ])
        .build(tauri::generate_context!())
        .expect("no se pudo iniciar UniCore")
        .run(|app, event| {
            // Al cerrar la app se apaga también el servidor de IA.
            if let tauri::RunEvent::Exit = event {
                ia::ia_stop(app.state::<ia::Ia>());
            }
        });
}
