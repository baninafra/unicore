//! Búsqueda en apuntes y bibliografía con el índice de texto completo de SQLite (FTS5).
//!
//! Los textos se parten en fragmentos de ~800 caracteres (como hacía la interfaz) y se
//! guardan en `chunks`. El índice se pone al día solo antes de cada búsqueda: compara
//! `updated_at` y el largo de cada registro con lo que se indexó la última vez, así
//! también entra lo que escribe el MCP.

use std::collections::HashMap;

use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::{err, Store};

const CHUNK_SIZE: usize = 800;
const CHUNK_OVERLAP: usize = 120;

// Palabras vacías en español, ya normalizadas (sin acentos ni mayúsculas).
const STOPWORDS: &str = "a al de del la las el los lo le les un una unos unas y o u e que qu como cual cuales cuando donde \
    por para con sin sobre entre en es son ser sea fue hay haber tiene tienen puede pueden hacer hace \
    se su sus mi mis tu tus me te nos si no ya pero mas muy este esta esto estos estas ese esa eso \
    quien quienes porque aunque tambien solo cada todo toda todos todas otro otra otros otras \
    ademas hola gracias favor dame decime explicame explica explicar ejemplo armame arma tomame \
    cuadro comparativo";

pub(crate) fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
           label, text, tbl UNINDEXED, rid UNINDEXED, subject UNINDEXED,
           tokenize = 'unicode61 remove_diacritics 2'
         );
         CREATE TABLE IF NOT EXISTS chunk_src (tbl TEXT NOT NULL, id TEXT NOT NULL, stamp TEXT NOT NULL, PRIMARY KEY (tbl, id));",
    )
}

// Qué texto aporta cada tipo de registro: (etiqueta, cuerpo).
fn source(tbl: &str, data: &Value) -> (String, String) {
    let s = |k: &str| data.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    match tbl {
        "notes" => (s("title"), s("plainTextCache")),
        _ => (s("fileName"), s("extractedText")),
    }
}

/// Parte el texto en trozos de ~CHUNK_SIZE cortando en espacios, con solapamiento.
fn split_text(raw: &str) -> Vec<String> {
    let mut text = String::with_capacity(raw.len());
    let mut newlines = 0;
    let mut space = false;
    for c in raw.chars() {
        match c {
            '\r' => {}
            '\n' => {
                newlines += 1;
                space = false;
                if newlines <= 2 {
                    text.push('\n');
                }
            }
            ' ' | '\t' => {
                if !space {
                    text.push(' ');
                }
                space = true;
            }
            _ => {
                newlines = 0;
                space = false;
                text.push(c);
            }
        }
    }
    let chars: Vec<char> = text.trim().chars().collect();
    let mut pieces = Vec::new();
    let mut start = 0;
    while start < chars.len() {
        let mut end = (start + CHUNK_SIZE).min(chars.len());
        if end < chars.len() {
            if let Some(cut) = (start..end).rev().find(|&i| chars[i] == ' ' || chars[i] == '\n') {
                if cut > start + CHUNK_SIZE / 2 {
                    end = cut;
                }
            }
        }
        let piece: String = chars[start..end].iter().collect();
        let piece = piece.trim();
        if !piece.is_empty() {
            pieces.push(piece.to_string());
        }
        if end >= chars.len() {
            break;
        }
        start = end.saturating_sub(CHUNK_OVERLAP).max(start + 1);
    }
    pieces
}

/// Pone el índice al día con la tabla `records`.
pub(crate) fn sync(conn: &Connection) -> rusqlite::Result<()> {
    let mut current: HashMap<(String, String), String> = HashMap::new();
    {
        let mut st = conn.prepare(
            "SELECT tbl, id, updated_at || ':' || length(data) FROM records WHERE tbl IN ('notes', 'documents')",
        )?;
        for row in st.query_map([], |r| Ok(((r.get(0)?, r.get(1)?), r.get(2)?)))? {
            let (k, v) = row?;
            current.insert(k, v);
        }
    }
    let mut indexed: HashMap<(String, String), String> = HashMap::new();
    {
        let mut st = conn.prepare("SELECT tbl, id, stamp FROM chunk_src")?;
        for row in st.query_map([], |r| Ok(((r.get(0)?, r.get(1)?), r.get(2)?)))? {
            let (k, v) = row?;
            indexed.insert(k, v);
        }
    }

    let stale: Vec<&(String, String)> = indexed
        .iter()
        .filter(|(k, stamp)| current.get(*k) != Some(*stamp))
        .map(|(k, _)| k)
        .collect();
    let fresh: Vec<&(String, String)> = current
        .iter()
        .filter(|(k, stamp)| indexed.get(*k) != Some(*stamp))
        .map(|(k, _)| k)
        .collect();
    if stale.is_empty() && fresh.is_empty() {
        return Ok(());
    }

    // Una transacción por tanda corta, para no frenar a la app mientras escribe.
    for batch in stale.chunks(200) {
        let tx = conn.unchecked_transaction()?;
        for (tbl, id) in batch {
            tx.execute("DELETE FROM chunks WHERE tbl = ?1 AND rid = ?2", params![tbl, id])?;
            tx.execute("DELETE FROM chunk_src WHERE tbl = ?1 AND id = ?2", params![tbl, id])?;
        }
        tx.commit()?;
    }
    for batch in fresh.chunks(50) {
        let tx = conn.unchecked_transaction()?;
        for key in batch {
            let (tbl, id) = key;
            let data: Option<String> = tx
                .query_row("SELECT data FROM records WHERE tbl = ?1 AND id = ?2", params![tbl, id], |r| r.get(0))
                .ok();
            let Some(data) = data.and_then(|d| serde_json::from_str::<Value>(&d).ok()) else { continue };
            let (label, body) = source(tbl, &data);
            let subject = data.get("subjectId").and_then(|v| v.as_str()).unwrap_or("");
            if !body.trim().is_empty() {
                for piece in split_text(&body) {
                    tx.execute(
                        "INSERT INTO chunks (label, text, tbl, rid, subject) VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![label, piece, tbl, id, subject],
                    )?;
                }
            }
            tx.execute(
                "INSERT OR REPLACE INTO chunk_src (tbl, id, stamp) VALUES (?1, ?2, ?3)",
                params![tbl, id, current[*key]],
            )?;
        }
        tx.commit()?;
    }
    Ok(())
}

fn normalize(text: &str) -> String {
    text.chars()
        .flat_map(|c| c.to_lowercase())
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            'ç' => 'c',
            c => c,
        })
        .collect()
}

fn terms(question: &str) -> Vec<String> {
    let stop: Vec<&str> = STOPWORDS.split_whitespace().collect();
    let mut out: Vec<String> = Vec::new();
    for t in normalize(question).split(|c: char| !c.is_ascii_alphanumeric()) {
        if t.len() > 1 && !stop.contains(&t) && !out.iter().any(|o| o == t) {
            out.push(t.to_string());
        }
    }
    out
}

#[derive(Serialize)]
pub struct Hit {
    label: String,
    text: String,
}

/// Los fragmentos de una materia que más coinciden con la pregunta (ranking BM25).
#[tauri::command]
pub async fn search_chunks(
    store: State<'_, Store>,
    subject_id: String,
    question: String,
    max_chunks: u32,
    exclude_note_id: Option<String>,
) -> Result<Vec<Hit>, String> {
    let words = terms(&question);
    if words.is_empty() {
        return Ok(vec![]);
    }
    let query = words.iter().map(|w| format!("\"{w}\"")).collect::<Vec<_>>().join(" OR ");
    let conn = store.conn.lock().map_err(err)?;
    sync(&conn).map_err(err)?;
    let mut st = conn
        .prepare(
            "SELECT label, text FROM chunks
             WHERE chunks MATCH ?1 AND subject = ?2 AND NOT (tbl = 'notes' AND rid = ?3)
             ORDER BY bm25(chunks, 2.0, 1.0) LIMIT ?4",
        )
        .map_err(err)?;
    let rows = st
        .query_map(params![query, subject_id, exclude_note_id.unwrap_or_default(), max_chunks], |r| {
            Ok(Hit { label: r.get(0)?, text: r.get(1)? })
        })
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indexa_y_busca() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE records (tbl TEXT, id TEXT, data TEXT, updated_at TEXT, source TEXT, PRIMARY KEY (tbl, id));",
        )
        .unwrap();
        init(&conn).unwrap();
        let put = |tbl: &str, id: &str, data: Value| {
            conn.execute(
                "INSERT OR REPLACE INTO records VALUES (?1, ?2, ?3, datetime('now'), 'app')",
                params![tbl, id, data.to_string()],
            )
            .unwrap();
        };
        put("notes", "n1", serde_json::json!({"title": "Fotosíntesis", "subjectId": "bio", "plainTextCache": "La clorofila absorbe luz."}));
        put("documents", "d1", serde_json::json!({"fileName": "Libro.pdf", "subjectId": "bio", "extractedText": "La mitocondria produce energía. ".repeat(80)}));
        put("notes", "n2", serde_json::json!({"title": "Otra", "subjectId": "mate", "plainTextCache": "clorofila"}));
        sync(&conn).unwrap();

        let find = |q: &str| -> Vec<String> {
            let query = terms(q).iter().map(|w| format!("\"{w}\"")).collect::<Vec<_>>().join(" OR ");
            let mut st = conn
                .prepare("SELECT label FROM chunks WHERE chunks MATCH ?1 AND subject = 'bio' ORDER BY bm25(chunks, 2.0, 1.0)")
                .unwrap();
            st.query_map(params![query], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
        };
        // Sin acentos también encuentra, y sólo dentro de la materia.
        assert_eq!(find("¿qué hace la CLOROFILA?"), vec!["Fotosíntesis"]);
        assert!(find("energia").iter().all(|l| l == "Libro.pdf"));
        assert!(find("energia").len() > 1, "el texto largo se parte en varios fragmentos");

        // Al cambiar una nota se reindexa; al borrarla desaparece.
        conn.execute("UPDATE records SET data = ?1, updated_at = datetime('now', '+1 second') WHERE id = 'n1'",
            params![serde_json::json!({"title": "Fotosíntesis", "subjectId": "bio", "plainTextCache": "Estomas."}).to_string()]).unwrap();
        sync(&conn).unwrap();
        assert!(find("clorofila").is_empty());
        conn.execute("DELETE FROM records WHERE id = 'd1'", []).unwrap();
        sync(&conn).unwrap();
        assert!(find("energia").is_empty());
    }
}
