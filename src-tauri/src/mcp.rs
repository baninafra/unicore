//! Servidor MCP (Model Context Protocol) de UniCore por stdio.
//!
//! Se inicia con `unicore.exe --mcp`. Habla JSON-RPC 2.0, un mensaje por línea.
//! Lee y escribe la misma base que la app (`Documentos\UniCore\unicore.db`); lo que escribe
//! queda marcado con `source = 'mcp'` y la app abierta lo incorpora en pocos segundos.

use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasher, Hasher};
use std::io::{self, BufRead, Write};
use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};

use crate::{open_store, Store};

const PROTOCOL_VERSION: &str = "2025-06-18";
const DAILY: &str = "__diario";
const LOOSE: &str = "__notas";
const TEMPLATES: &str = "__plantillas";

pub fn serve() {
    let store = match open_store() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("UniCore MCP: no se pudo abrir la base: {e}");
            return;
        }
    };
    let stdin = io::stdin();
    let mut out = io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let msg: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                send(&mut out, json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"JSON inválido"}}));
                continue;
            }
        };
        if let Some(reply) = handle(&store, &msg) {
            send(&mut out, reply);
        }
    }
}

fn send(out: &mut impl Write, v: Value) {
    let _ = writeln!(out, "{v}");
    let _ = out.flush();
}

fn handle(store: &Store, msg: &Value) -> Option<Value> {
    let id = msg.get("id").cloned();
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    // Las notificaciones no llevan id y no se responden.
    let id = id?;
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": params.get("protocolVersion").and_then(Value::as_str).unwrap_or(PROTOCOL_VERSION),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "unicore", "title": "UniCore", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "UniCore es la app de facultad del usuario: carreras, materias (con correlativas), notas tipo Obsidian, tareas/parciales, flashcards y bibliografía en PDF ya pasada a texto. Empezá con `resumen`. Las notas se escriben en Markdown; [[Título]] enlaza a otra nota y #etiqueta etiqueta. Respondé en español rioplatense."
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools() })),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            let conn = match store.conn.lock() {
                Ok(c) => c,
                Err(_) => return Some(error(id, -32603, "Base ocupada")),
            };
            Ok(match call_tool(&conn, name, &args) {
                Ok(text) => json!({ "content": [{ "type": "text", "text": text }] }),
                Err(e) => json!({ "content": [{ "type": "text", "text": e }], "isError": true }),
            })
        }
        _ => Err((-32601, format!("Método no soportado: {method}"))),
    };
    Some(match result {
        Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
        Err((code, m)) => error(id, code, &m),
    })
}

fn error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

// ---------------------------------------------------------------- herramientas

fn tools() -> Value {
    let s = |props: Value, required: &[&str]| json!({ "type": "object", "properties": props, "required": required });
    json!([
        { "name": "resumen", "description": "Panorama actual: carreras, materias que cursa, próximos parciales y entregas (14 días), flashcards para hoy y cantidad de notas.", "inputSchema": s(json!({}), &[]) },
        { "name": "listar_materias", "description": "Materias del plan de estudios con año, cuatrimestre, estado (PENDIENTE, CURSANDO, REGULAR, APROBADA), nota y correlativas.", "inputSchema": s(json!({
            "carrera": { "type": "string", "description": "Id, nombre o sigla de la carrera (opcional)" },
            "estado": { "type": "string", "enum": ["PENDIENTE", "CURSANDO", "REGULAR", "APROBADA"] }
        }), &[]) },
        { "name": "buscar_notas", "description": "Busca texto en títulos, alias y contenido de las notas. Devuelve id, título, materia y un fragmento.", "inputSchema": s(json!({
            "consulta": { "type": "string" },
            "materia": { "type": "string", "description": "Id o nombre de materia para filtrar (opcional)" },
            "etiqueta": { "type": "string", "description": "Filtrar por etiqueta, sin # (opcional)" },
            "limite": { "type": "integer", "default": 10 }
        }), &["consulta"]) },
        { "name": "listar_notas", "description": "Lista las notas de una materia o carpeta (diario, notas, plantillas), ordenadas por unidad.", "inputSchema": s(json!({
            "materia": { "type": "string", "description": "Id o nombre de materia" },
            "carpeta": { "type": "string", "enum": ["diario", "notas", "plantillas"] }
        }), &[]) },
        { "name": "leer_nota", "description": "Devuelve una nota completa en Markdown, con sus propiedades, etiquetas y enlaces.", "inputSchema": s(json!({
            "id": { "type": "string" },
            "titulo": { "type": "string", "description": "Alternativa al id" }
        }), &[]) },
        { "name": "crear_nota", "description": "Crea una nota a partir de Markdown (títulos #, listas, - [ ] tareas, > citas, ``` código, [[enlaces]] y #etiquetas). Si no se indica materia ni carpeta va a 'Notas'.", "inputSchema": s(json!({
            "titulo": { "type": "string" },
            "contenido": { "type": "string", "description": "Markdown" },
            "materia": { "type": "string", "description": "Id o nombre de materia (opcional)" },
            "carpeta": { "type": "string", "enum": ["diario", "notas", "plantillas"] },
            "unidad": { "type": "integer", "default": 1 },
            "propiedades": { "type": "object", "description": "Propiedades tipo frontmatter (opcional)" }
        }), &["titulo", "contenido"]) },
        { "name": "agregar_a_nota", "description": "Agrega Markdown al final de una nota existente.", "inputSchema": s(json!({
            "id": { "type": "string" },
            "contenido": { "type": "string" }
        }), &["id", "contenido"]) },
        { "name": "listar_tareas", "description": "Tareas, parciales, finales, TPs, foros y lecturas. Por defecto, las no terminadas de los próximos 30 días y las vencidas.", "inputSchema": s(json!({
            "dias": { "type": "integer", "default": 30 },
            "estado": { "type": "string", "enum": ["INBOX_EMAIL", "TODO", "IN_PROGRESS", "DONE"] },
            "materia": { "type": "string" },
            "incluir_sin_fecha": { "type": "boolean", "default": true }
        }), &[]) },
        { "name": "crear_tarea", "description": "Crea una tarea, parcial, final, TP, foro o lectura.", "inputSchema": s(json!({
            "titulo": { "type": "string" },
            "tipo": { "type": "string", "enum": ["PARCIAL", "FINAL", "TP", "FORO", "LECTURA", "TAREA"], "default": "TAREA" },
            "fecha": { "type": "string", "description": "YYYY-MM-DD o YYYY-MM-DDTHH:MM (hora local). Sin hora vence 23:59." },
            "materia": { "type": "string" },
            "descripcion": { "type": "string" },
            "prioridad": { "type": "string", "enum": ["LOW", "MEDIUM", "HIGH"], "default": "MEDIUM" }
        }), &["titulo"]) },
        { "name": "actualizar_tarea", "description": "Cambia estado, fecha, título o descripción de una tarea.", "inputSchema": s(json!({
            "id": { "type": "string" },
            "estado": { "type": "string", "enum": ["TODO", "IN_PROGRESS", "DONE"] },
            "fecha": { "type": "string" },
            "titulo": { "type": "string" },
            "descripcion": { "type": "string" }
        }), &["id"]) },
        { "name": "listar_flashcards", "description": "Flashcards de repaso (frente y dorso) con su próxima fecha.", "inputSchema": s(json!({
            "materia": { "type": "string" },
            "solo_para_hoy": { "type": "boolean", "default": false }
        }), &[]) },
        { "name": "crear_flashcards", "description": "Agrega flashcards a una materia; entran al repaso espaciado de hoy.", "inputSchema": s(json!({
            "materia": { "type": "string" },
            "tarjetas": { "type": "array", "items": { "type": "object", "properties": { "frente": { "type": "string" }, "dorso": { "type": "string" } }, "required": ["frente", "dorso"] } }
        }), &["materia", "tarjetas"]) },
        { "name": "listar_bibliografia", "description": "PDFs cargados en una materia (ya pasados a texto), con páginas y resaltados.", "inputSchema": s(json!({
            "materia": { "type": "string" }
        }), &["materia"]) },
        { "name": "leer_documento", "description": "Lee el texto extraído de un PDF de la bibliografía, por partes.", "inputSchema": s(json!({
            "id": { "type": "string" },
            "desde": { "type": "integer", "default": 0, "description": "Carácter inicial" },
            "largo": { "type": "integer", "default": 12000 }
        }), &["id"]) }
    ])
}

fn call_tool(conn: &Connection, name: &str, a: &Value) -> Result<String, String> {
    let db = Db { conn };
    match name {
        "resumen" => resumen(&db),
        "listar_materias" => listar_materias(&db, a),
        "buscar_notas" => buscar_notas(&db, a),
        "listar_notas" => listar_notas(&db, a),
        "leer_nota" => leer_nota(&db, a),
        "crear_nota" => crear_nota(&db, a),
        "agregar_a_nota" => agregar_a_nota(&db, a),
        "listar_tareas" => listar_tareas(&db, a),
        "crear_tarea" => crear_tarea(&db, a),
        "actualizar_tarea" => actualizar_tarea(&db, a),
        "listar_flashcards" => listar_flashcards(&db, a),
        "crear_flashcards" => crear_flashcards(&db, a),
        "listar_bibliografia" => listar_bibliografia(&db, a),
        "leer_documento" => leer_documento(&db, a),
        _ => Err(format!("Herramienta desconocida: {name}")),
    }
}

// ---------------------------------------------------------------- acceso a datos

struct Db<'a> {
    conn: &'a Connection,
}

impl Db<'_> {
    fn all(&self, tbl: &str) -> Vec<Value> {
        let Ok(mut st) = self.conn.prepare("SELECT data FROM records WHERE tbl = ?1") else { return vec![] };
        let rows = st.query_map(params![tbl], |r| r.get::<_, String>(0));
        match rows {
            Ok(rows) => rows.filter_map(|r| r.ok()).filter_map(|s| serde_json::from_str(&s).ok()).collect(),
            Err(_) => vec![],
        }
    }
    fn get(&self, tbl: &str, id: &str) -> Option<Value> {
        self.conn
            .query_row("SELECT data FROM records WHERE tbl = ?1 AND id = ?2", params![tbl, id], |r| r.get::<_, String>(0))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
    }
    fn put(&self, tbl: &str, v: &Value) -> Result<(), String> {
        let id = v.get("id").and_then(Value::as_str).ok_or("Registro sin id")?;
        self.conn
            .execute(
                "INSERT INTO records (tbl, id, data, updated_at, source) VALUES (?1, ?2, ?3, datetime('now'), 'mcp')
                 ON CONFLICT(tbl, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, source = 'mcp'",
                params![tbl, id, v.to_string()],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    fn now_iso(&self) -> String {
        self.conn
            .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |r| r.get(0))
            .unwrap_or_default()
    }
    // Fecha local de hoy "YYYY-MM-DD"
    fn today(&self) -> String {
        self.conn.query_row("SELECT date('now', 'localtime')", [], |r| r.get(0)).unwrap_or_default()
    }
    // "YYYY-MM-DD[THH:MM]" local → ISO UTC
    fn local_to_iso(&self, s: &str) -> Option<String> {
        let s = s.trim();
        let (date, time) = match s.split_once(['T', ' ']) {
            Some((d, t)) => (d, if t.len() >= 5 { &t[..5] } else { "23:59" }),
            None => (s, "23:59"),
        };
        if date.len() != 10 {
            return None;
        }
        self.conn
            .query_row(
                "SELECT strftime('%Y-%m-%dT%H:%M:%fZ', ?1 || ' ' || ?2, 'utc')",
                params![date, time],
                |r| r.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten()
    }
    fn days_from_now(&self, iso: &str) -> Option<f64> {
        self.conn
            .query_row("SELECT julianday(?1) - julianday('now')", params![iso], |r| r.get::<_, Option<f64>>(0))
            .ok()
            .flatten()
    }
    fn local_date(&self, iso: &str) -> String {
        self.conn
            .query_row("SELECT strftime('%d/%m %H:%M', ?1, 'localtime')", params![iso], |r| r.get::<_, Option<String>>(0))
            .ok()
            .flatten()
            .unwrap_or_else(|| iso.to_string())
    }
}

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn new_id() -> String {
    const ALPHA: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u64(COUNTER.fetch_add(1, Ordering::Relaxed));
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    let mut x = h.finish();
    let mut h2 = std::collections::hash_map::RandomState::new().build_hasher();
    h2.write_u64(x);
    let mut y = h2.finish();
    (0..12)
        .map(|i| {
            let src = if i < 6 { &mut x } else { &mut y };
            let c = ALPHA[(*src % 62) as usize] as char;
            *src /= 62;
            c
        })
        .collect()
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or("")
}

fn norm(t: &str) -> String {
    t.to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' => 'a',
            'é' | 'è' | 'ë' => 'e',
            'í' | 'ì' | 'ï' => 'i',
            'ó' | 'ò' | 'ö' => 'o',
            'ú' | 'ù' | 'ü' => 'u',
            other => other,
        })
        .collect()
}

fn find_degree(db: &Db, q: &str) -> Option<Value> {
    let nq = norm(q);
    db.all("degrees").into_iter().find(|d| {
        s(d, "id") == q || norm(s(d, "name")) == nq || norm(s(d, "shortName")) == nq || norm(s(d, "name")).contains(&nq)
    })
}

fn find_subject(db: &Db, q: &str) -> Result<Value, String> {
    if let Some(v) = db.get("subjects", q) {
        return Ok(v);
    }
    let nq = norm(q);
    let subjects = db.all("subjects");
    if let Some(v) = subjects.iter().find(|x| norm(s(x, "name")) == nq) {
        return Ok(v.clone());
    }
    let matches: Vec<&Value> = subjects.iter().filter(|x| norm(s(x, "name")).contains(&nq)).collect();
    match matches.len() {
        1 => Ok(matches[0].clone()),
        0 => Err(format!("No hay ninguna materia que coincida con «{q}». Usá listar_materias.")),
        _ => Err(format!(
            "«{q}» coincide con varias materias: {}. Indicá cuál.",
            matches.iter().map(|m| s(m, "name")).collect::<Vec<_>>().join(", ")
        )),
    }
}

fn folder_of(name: &str) -> Option<&'static str> {
    match norm(name).as_str() {
        "diario" => Some(DAILY),
        "notas" => Some(LOOSE),
        "plantillas" => Some(TEMPLATES),
        _ => None,
    }
}

fn subject_label(db: &Db, subject_id: &str) -> String {
    match subject_id {
        DAILY => "Diario".into(),
        LOOSE => "Notas".into(),
        TEMPLATES => "Plantillas".into(),
        id => db.get("subjects", id).map(|v| s(&v, "name").to_string()).unwrap_or_else(|| "Sin materia".into()),
    }
}

// ---------------------------------------------------------------- Markdown ↔ bloques

fn text_node(t: &str, styles: Value) -> Value {
    json!({ "type": "text", "text": t, "styles": styles })
}

// Texto inline: **negrita**, *cursiva*, `código` y [[enlaces|alias]].
fn inline(text: &str, titles: &HashMap<String, String>, links: &mut Vec<String>) -> Vec<Value> {
    let mut out = Vec::new();
    let mut buf = String::new();
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    let flush = |buf: &mut String, out: &mut Vec<Value>| {
        if !buf.is_empty() {
            out.push(text_node(buf, json!({})));
            buf.clear();
        }
    };
    while i < chars.len() {
        let rest: String = chars[i..].iter().collect();
        if rest.starts_with("[[") {
            if let Some(end) = rest.find("]]") {
                flush(&mut buf, &mut out);
                let inner = &rest[2..end];
                let (target, alias) = inner.split_once('|').unwrap_or((inner, ""));
                let note_id = titles.get(&norm(target.trim())).cloned().unwrap_or_default();
                if !note_id.is_empty() {
                    links.push(note_id.clone());
                }
                out.push(json!({ "type": "wikilink", "props": { "noteId": note_id, "title": target.trim(), "alias": alias.trim() } }));
                i += rest[..end + 2].chars().count();
                continue;
            }
        }
        for (mark, style) in [("**", "bold"), ("`", "code"), ("*", "italic")] {
            if rest.starts_with(mark) {
                if let Some(end) = rest[mark.len()..].find(mark) {
                    if end > 0 {
                        flush(&mut buf, &mut out);
                        let inner = &rest[mark.len()..mark.len() + end];
                        out.push(text_node(inner, json!({ style: true })));
                        i += rest[..mark.len() * 2 + end].chars().count();
                        break;
                    }
                }
            }
        }
        if i < chars.len() && chars[i..].iter().collect::<String>() == rest {
            buf.push(chars[i]);
            i += 1;
        }
    }
    flush(&mut buf, &mut out);
    out
}

fn block(kind: &str, props: Value, content: Value) -> Value {
    json!({ "id": new_id(), "type": kind, "props": props, "content": content, "children": [] })
}

struct Parsed {
    blocks: Vec<Value>,
    links: Vec<String>,
    tags: Vec<String>,
    plain: String,
}

fn markdown_to_blocks(md: &str, titles: &HashMap<String, String>) -> Parsed {
    let mut blocks = Vec::new();
    let mut links = Vec::new();
    let mut para: Vec<String> = Vec::new();
    let mut lines = md.lines().peekable();
    let push_para = |para: &mut Vec<String>, blocks: &mut Vec<Value>, links: &mut Vec<String>| {
        if !para.is_empty() {
            let text = para.join("\n");
            blocks.push(block("paragraph", json!({}), Value::Array(inline(&text, titles, links))));
            para.clear();
        }
    };
    while let Some(line) = lines.next() {
        let t = line.trim_end();
        let trimmed = t.trim_start();
        if trimmed.is_empty() {
            push_para(&mut para, &mut blocks, &mut links);
            continue;
        }
        if trimmed.starts_with("```") {
            push_para(&mut para, &mut blocks, &mut links);
            let lang = trimmed.trim_start_matches('`').trim();
            let mut code = Vec::new();
            for l in lines.by_ref() {
                if l.trim_start().starts_with("```") {
                    break;
                }
                code.push(l.to_string());
            }
            blocks.push(block(
                "codeBlock",
                json!({ "language": if lang.is_empty() { "text" } else { lang } }),
                json!([text_node(&code.join("\n"), json!({}))]),
            ));
            continue;
        }
        let hashes = trimmed.chars().take_while(|c| *c == '#').count();
        if (1..=6).contains(&hashes) && trimmed.chars().nth(hashes) == Some(' ') {
            push_para(&mut para, &mut blocks, &mut links);
            let level = hashes.min(3);
            blocks.push(block("heading", json!({ "level": level }), Value::Array(inline(trimmed[hashes + 1..].trim(), titles, &mut links))));
            continue;
        }
        let lower = trimmed.to_lowercase();
        if lower.starts_with("- [ ] ") || lower.starts_with("- [x] ") || lower.starts_with("* [ ] ") || lower.starts_with("* [x] ") {
            push_para(&mut para, &mut blocks, &mut links);
            let checked = lower.as_bytes()[3] == b'x';
            blocks.push(block("checkListItem", json!({ "checked": checked }), Value::Array(inline(&trimmed[6..], titles, &mut links))));
            continue;
        }
        if trimmed.starts_with("- ") || trimmed.starts_with("* ") || trimmed.starts_with("+ ") {
            push_para(&mut para, &mut blocks, &mut links);
            blocks.push(block("bulletListItem", json!({}), Value::Array(inline(&trimmed[2..], titles, &mut links))));
            continue;
        }
        let digits = trimmed.chars().take_while(|c| c.is_ascii_digit()).count();
        if digits > 0 && trimmed[digits..].starts_with(". ") {
            push_para(&mut para, &mut blocks, &mut links);
            blocks.push(block("numberedListItem", json!({}), Value::Array(inline(&trimmed[digits + 2..], titles, &mut links))));
            continue;
        }
        if let Some(q) = trimmed.strip_prefix('>') {
            push_para(&mut para, &mut blocks, &mut links);
            blocks.push(block("quote", json!({}), Value::Array(inline(q.trim(), titles, &mut links))));
            continue;
        }
        if trimmed == "---" || trimmed == "***" {
            push_para(&mut para, &mut blocks, &mut links);
            blocks.push(block("paragraph", json!({}), json!([text_node("---", json!({}))])));
            continue;
        }
        para.push(trimmed.to_string());
    }
    push_para(&mut para, &mut blocks, &mut links);

    // Texto plano sin marcas de Markdown (lo usan la búsqueda y la IA de la app).
    let plain = blocks
        .iter()
        .map(|b| inline_to_md(b.get("content").unwrap_or(&Value::Null)).replace("**", "").replace("`", ""))
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join("
");
    let tag_source = md.to_string();
    let mut tags: Vec<String> = Vec::new();
    for word in tag_source.split(|c: char| c.is_whitespace() || c == ',' || c == '.' || c == ';' || c == '(' || c == ')') {
        if let Some(tag) = word.strip_prefix('#') {
            let tag: String = tag.chars().filter(|c| c.is_alphanumeric() || *c == '/' || *c == '_' || *c == '-').collect();
            if !tag.is_empty() && !tag.chars().all(|c| c.is_ascii_digit()) {
                let tag = tag.to_lowercase();
                if !tags.contains(&tag) {
                    tags.push(tag);
                }
            }
        }
    }
    links.sort();
    links.dedup();
    Parsed { blocks, links, tags, plain }
}

fn inline_to_md(content: &Value) -> String {
    match content {
        Value::String(t) => t.clone(),
        Value::Array(nodes) => nodes
            .iter()
            .map(|n| match s(n, "type") {
                "text" => {
                    let mut t = s(n, "text").to_string();
                    let st = n.get("styles").cloned().unwrap_or(json!({}));
                    if st.get("code").and_then(Value::as_bool).unwrap_or(false) {
                        t = format!("`{t}`");
                    }
                    if st.get("bold").and_then(Value::as_bool).unwrap_or(false) {
                        t = format!("**{t}**");
                    }
                    if st.get("italic").and_then(Value::as_bool).unwrap_or(false) {
                        t = format!("*{t}*");
                    }
                    t
                }
                "link" => format!("[{}]({})", inline_to_md(n.get("content").unwrap_or(&Value::Null)), s(n, "href")),
                "wikilink" => {
                    let p = n.get("props").cloned().unwrap_or(json!({}));
                    let alias = s(&p, "alias");
                    if alias.is_empty() { format!("[[{}]]", s(&p, "title")) } else { format!("[[{}|{alias}]]", s(&p, "title")) }
                }
                _ => n.get("content").map(inline_to_md).unwrap_or_default(),
            })
            .collect(),
        _ => String::new(),
    }
}

fn blocks_to_md(blocks: &[Value], depth: usize, out: &mut String) {
    let indent = "  ".repeat(depth);
    let mut n = 0;
    for b in blocks {
        let props = b.get("props").cloned().unwrap_or(json!({}));
        let content = b.get("content").cloned().unwrap_or(Value::Null);
        let text = inline_to_md(&content);
        let kind = s(b, "type");
        if kind != "numberedListItem" {
            n = 0;
        }
        match kind {
            "heading" => {
                let level = props.get("level").and_then(Value::as_u64).unwrap_or(1) as usize;
                out.push_str(&format!("\n{} {text}\n\n", "#".repeat(level.min(6))));
            }
            "bulletListItem" => out.push_str(&format!("{indent}- {text}\n")),
            "numberedListItem" => {
                n += 1;
                out.push_str(&format!("{indent}{n}. {text}\n"));
            }
            "checkListItem" => {
                let c = if props.get("checked").and_then(Value::as_bool).unwrap_or(false) { "x" } else { " " };
                out.push_str(&format!("{indent}- [{c}] {text}\n"));
            }
            "quote" => out.push_str(&format!("> {text}\n\n")),
            "codeBlock" => out.push_str(&format!("```{}\n{text}\n```\n\n", s(&props, "language"))),
            "callout" => out.push_str(&format!("> [!{}]\n> {text}\n\n", if s(&props, "type").is_empty() { "nota" } else { s(&props, "type") })),
            "image" => out.push_str(&format!("![{}](imagen)\n\n", s(&props, "caption"))),
            "audio" | "video" | "file" => out.push_str(&format!("[{}]\n\n", if s(&props, "name").is_empty() { kind } else { s(&props, "name") })),
            "table" => {
                if let Some(rows) = content.get("rows").and_then(Value::as_array) {
                    for (i, r) in rows.iter().enumerate() {
                        let cells: Vec<String> = r
                            .get("cells")
                            .and_then(Value::as_array)
                            .map(|cs| cs.iter().map(|c| if c.is_array() { inline_to_md(c) } else { inline_to_md(c.get("content").unwrap_or(&Value::Null)) }).collect())
                            .unwrap_or_default();
                        out.push_str(&format!("| {} |\n", cells.join(" | ")));
                        if i == 0 {
                            out.push_str(&format!("|{}\n", " --- |".repeat(cells.len())));
                        }
                    }
                    out.push('\n');
                }
            }
            _ => {
                if text.is_empty() {
                    out.push('\n');
                } else {
                    out.push_str(&format!("{text}\n\n"));
                }
            }
        }
        if let Some(children) = b.get("children").and_then(Value::as_array) {
            if !children.is_empty() {
                blocks_to_md(children, depth + 1, out);
            }
        }
    }
}

fn note_titles(db: &Db) -> HashMap<String, String> {
    let mut m = HashMap::new();
    for n in db.all("notes") {
        m.insert(norm(s(&n, "title")), s(&n, "id").to_string());
        if let Some(aliases) = n.get("aliases").and_then(Value::as_array) {
            for a in aliases.iter().filter_map(Value::as_str) {
                m.entry(norm(a)).or_insert_with(|| s(&n, "id").to_string());
            }
        }
    }
    m
}

// ---------------------------------------------------------------- implementación

fn resumen(db: &Db) -> Result<String, String> {
    let degrees = db.all("degrees");
    let subjects = db.all("subjects");
    let tasks = db.all("tasks");
    let notes = db.all("notes");
    let cards = db.all("flashcards");
    let mut out = String::new();
    out.push_str(&format!("Hoy: {}\n\n## Carreras\n", db.today()));
    for d in &degrees {
        let ds: Vec<&Value> = subjects.iter().filter(|x| s(x, "degreeId") == s(d, "id")).collect();
        let aprob: Vec<f64> = ds.iter().filter(|x| s(x, "status") == "APROBADA").filter_map(|x| x.get("finalGrade").and_then(Value::as_f64)).collect();
        let prom = if aprob.is_empty() { "–".to_string() } else { format!("{:.2}", aprob.iter().sum::<f64>() / aprob.len() as f64) };
        out.push_str(&format!(
            "- {} ({}): {}/{} aprobadas, promedio {prom} [id {}]\n",
            s(d, "name"), s(d, "shortName"),
            ds.iter().filter(|x| s(x, "status") == "APROBADA").count(), ds.len(), s(d, "id")
        ));
    }
    out.push_str("\n## Cursando\n");
    for x in subjects.iter().filter(|x| s(x, "status") == "CURSANDO") {
        let n = notes.iter().filter(|n| s(n, "subjectId") == s(x, "id")).count();
        out.push_str(&format!("- {} ({} notas) [id {}]\n", s(x, "name"), n, s(x, "id")));
    }
    out.push_str("\n## Próximos 14 días\n");
    let mut upcoming: Vec<(f64, &Value)> = tasks
        .iter()
        .filter(|t| s(t, "status") != "DONE" && s(t, "status") != "INBOX_EMAIL")
        .filter_map(|t| db.days_from_now(s(t, "dueDate")).filter(|d| *d <= 14.0).map(|d| (d, t)))
        .collect();
    upcoming.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    if upcoming.is_empty() {
        out.push_str("- Nada con fecha.\n");
    }
    for (d, t) in upcoming {
        let when = if d < 0.0 { "VENCIDA".to_string() } else { db.local_date(s(t, "dueDate")) };
        out.push_str(&format!("- {when} · {} · {} ({}) [id {}]\n", s(t, "type"), s(t, "title"), subject_label(db, s(t, "subjectId")), s(t, "id")));
    }
    let inbox = tasks.iter().filter(|t| s(t, "status") == "INBOX_EMAIL").count();
    let due = cards.iter().filter(|c| db.days_from_now(s(c, "due")).map(|d| d <= 0.0).unwrap_or(true)).count();
    out.push_str(&format!("\nMails sin confirmar: {inbox} · Flashcards para hoy: {due} · Notas: {}\n", notes.len()));
    Ok(out)
}

fn listar_materias(db: &Db, a: &Value) -> Result<String, String> {
    let degree = match s(a, "carrera") {
        "" => None,
        q => Some(find_degree(db, q).ok_or(format!("No encontré la carrera «{q}»."))?),
    };
    let estado = s(a, "estado");
    let subjects = db.all("subjects");
    let names: HashMap<&str, &str> = subjects.iter().map(|x| (s(x, "id"), s(x, "name"))).collect();
    let mut list: Vec<&Value> = subjects
        .iter()
        .filter(|x| degree.as_ref().map(|d| s(x, "degreeId") == s(d, "id")).unwrap_or(true))
        .filter(|x| estado.is_empty() || s(x, "status") == estado)
        .collect();
    list.sort_by_key(|x| (x.get("year").and_then(Value::as_i64).unwrap_or(0), x.get("semester").and_then(Value::as_i64).unwrap_or(0), s(x, "name").to_string()));
    let mut out = String::new();
    for x in list {
        let corr: Vec<&str> = x.get("correlatives").and_then(Value::as_array).map(|c| c.iter().filter_map(Value::as_str).filter_map(|id| names.get(id).copied()).collect()).unwrap_or_default();
        let grade = x.get("finalGrade").and_then(Value::as_f64).map(|g| format!(" nota {g}")).unwrap_or_default();
        out.push_str(&format!(
            "- {}.º año {}C · {} · {}{grade}{} [id {}]\n",
            x.get("year").and_then(Value::as_i64).unwrap_or(0),
            x.get("semester").and_then(Value::as_i64).unwrap_or(0),
            s(x, "name"), s(x, "status"),
            if corr.is_empty() { String::new() } else { format!(" · correlativas: {}", corr.join(", ")) },
            s(x, "id")
        ));
    }
    Ok(if out.is_empty() { "Sin materias.".into() } else { out })
}

fn snippet(text: &str, q: &str) -> String {
    let nt = norm(text);
    let chars: Vec<char> = text.chars().collect();
    match nt.find(q) {
        Some(byte_pos) => {
            let pos = nt[..byte_pos].chars().count();
            let start = pos.saturating_sub(80);
            let end = (pos + q.chars().count() + 120).min(chars.len());
            format!("…{}…", chars[start..end].iter().collect::<String>().replace('\n', " "))
        }
        None => chars.iter().take(160).collect::<String>().replace('\n', " "),
    }
}

fn buscar_notas(db: &Db, a: &Value) -> Result<String, String> {
    let q = norm(s(a, "consulta").trim());
    if q.is_empty() {
        return Err("Falta la consulta.".into());
    }
    let subject = match s(a, "materia") {
        "" => None,
        m => Some(find_subject(db, m)?),
    };
    let tag = norm(s(a, "etiqueta").trim_start_matches('#'));
    let limit = a.get("limite").and_then(Value::as_u64).unwrap_or(10) as usize;
    let terms: Vec<&str> = q.split_whitespace().collect();
    let mut hits: Vec<(usize, Value)> = db
        .all("notes")
        .into_iter()
        .filter(|n| subject.as_ref().map(|x| s(n, "subjectId") == s(x, "id")).unwrap_or(true))
        .filter(|n| tag.is_empty() || n.get("tags").and_then(Value::as_array).map(|t| t.iter().any(|x| norm(x.as_str().unwrap_or("")).starts_with(&tag))).unwrap_or(false))
        .filter_map(|n| {
            let hay = format!("{} {} {}", s(&n, "title"), n.get("aliases").map(|v| v.to_string()).unwrap_or_default(), s(&n, "plainTextCache"));
            let nh = norm(&hay);
            if !terms.iter().all(|t| nh.contains(t)) {
                return None;
            }
            let score = terms.iter().map(|t| nh.matches(t).count()).sum::<usize>() + if norm(s(&n, "title")).contains(&q) { 50 } else { 0 };
            Some((score, n))
        })
        .collect();
    hits.sort_by(|a, b| b.0.cmp(&a.0));
    let mut out = String::new();
    for (_, n) in hits.iter().take(limit) {
        out.push_str(&format!(
            "- {} ({}) [id {}]\n  {}\n",
            s(n, "title"), subject_label(db, s(n, "subjectId")), s(n, "id"),
            snippet(s(n, "plainTextCache"), terms[0])
        ));
    }
    Ok(if out.is_empty() { "Sin resultados.".into() } else { format!("{} resultados\n{out}", hits.len()) })
}

fn listar_notas(db: &Db, a: &Value) -> Result<String, String> {
    let folder = if !s(a, "carpeta").is_empty() {
        folder_of(s(a, "carpeta")).ok_or("Carpeta inválida.")?.to_string()
    } else if !s(a, "materia").is_empty() {
        s(&find_subject(db, s(a, "materia"))?, "id").to_string()
    } else {
        return Err("Indicá materia o carpeta.".into());
    };
    let mut notes: Vec<Value> = db.all("notes").into_iter().filter(|n| s(n, "subjectId") == folder).collect();
    notes.sort_by_key(|n| (n.get("unitNumber").and_then(Value::as_i64).unwrap_or(1), s(n, "dailyDate").to_string(), s(n, "createdAt").to_string()));
    let out: String = notes
        .iter()
        .map(|n| format!("- U{} · {} [id {}]\n", n.get("unitNumber").and_then(Value::as_i64).unwrap_or(1), s(n, "title"), s(n, "id")))
        .collect();
    Ok(if out.is_empty() { "Sin notas.".into() } else { out })
}

fn leer_nota(db: &Db, a: &Value) -> Result<String, String> {
    let note = if !s(a, "id").is_empty() {
        db.get("notes", s(a, "id"))
    } else {
        let t = norm(s(a, "titulo"));
        db.all("notes").into_iter().find(|n| norm(s(n, "title")) == t)
    }
    .ok_or("No encontré la nota.")?;
    let mut out = format!("# {}\n\nMateria: {} · Unidad {} · id {}\n", s(&note, "title"), subject_label(db, s(&note, "subjectId")), note.get("unitNumber").and_then(Value::as_i64).unwrap_or(1), s(&note, "id"));
    if let Some(p) = note.get("properties").and_then(Value::as_object) {
        for (k, v) in p {
            out.push_str(&format!("{k}: {}\n", if let Some(t) = v.as_str() { t.to_string() } else { v.to_string() }));
        }
    }
    if let Some(t) = note.get("tags").and_then(Value::as_array) {
        if !t.is_empty() {
            out.push_str(&format!("Etiquetas: {}\n", t.iter().filter_map(Value::as_str).map(|x| format!("#{x}")).collect::<Vec<_>>().join(" ")));
        }
    }
    out.push_str("\n---\n");
    if let Some(blocks) = note.get("content").and_then(Value::as_array) {
        blocks_to_md(blocks, 0, &mut out);
    }
    Ok(out)
}

fn crear_nota(db: &Db, a: &Value) -> Result<String, String> {
    let title = s(a, "titulo").trim();
    if title.is_empty() {
        return Err("Falta el título.".into());
    }
    let subject_id = if !s(a, "carpeta").is_empty() {
        folder_of(s(a, "carpeta")).ok_or("Carpeta inválida.")?.to_string()
    } else if !s(a, "materia").is_empty() {
        s(&find_subject(db, s(a, "materia"))?, "id").to_string()
    } else {
        LOOSE.to_string()
    };
    let parsed = markdown_to_blocks(s(a, "contenido"), &note_titles(db));
    let now = db.now_iso();
    let id = new_id();
    let mut note = json!({
        "id": id,
        "subjectId": subject_id,
        "title": title,
        "unitNumber": a.get("unidad").and_then(Value::as_i64).unwrap_or(1),
        "content": parsed.blocks,
        "plainTextCache": parsed.plain,
        "tags": parsed.tags,
        "links": parsed.links,
        "createdAt": now,
        "updatedAt": now,
    });
    if let Some(p) = a.get("propiedades").filter(|p| p.is_object()) {
        note["properties"] = p.clone();
    }
    if subject_id == DAILY {
        note["dailyDate"] = json!(db.today());
    }
    db.put("notes", &note)?;
    Ok(format!("Nota creada: «{title}» en {} [id {id}]", subject_label(db, &subject_id)))
}

fn agregar_a_nota(db: &Db, a: &Value) -> Result<String, String> {
    let mut note = db.get("notes", s(a, "id")).ok_or("No encontré la nota.")?;
    let parsed = markdown_to_blocks(s(a, "contenido"), &note_titles(db));
    let mut content = note.get("content").and_then(Value::as_array).cloned().unwrap_or_default();
    content.extend(parsed.blocks);
    note["content"] = Value::Array(content);
    note["plainTextCache"] = json!(format!("{}\n\n{}", s(&note, "plainTextCache"), parsed.plain));
    let mut tags: Vec<String> = note.get("tags").and_then(Value::as_array).map(|t| t.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default();
    tags.extend(parsed.tags);
    tags.sort();
    tags.dedup();
    note["tags"] = json!(tags);
    let mut links: HashSet<String> = note.get("links").and_then(Value::as_array).map(|t| t.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default();
    links.extend(parsed.links);
    note["links"] = json!(links.into_iter().collect::<Vec<_>>());
    note["updatedAt"] = json!(db.now_iso());
    db.put("notes", &note)?;
    Ok(format!("Agregado a «{}».", s(&note, "title")))
}

fn listar_tareas(db: &Db, a: &Value) -> Result<String, String> {
    let days = a.get("dias").and_then(Value::as_f64).unwrap_or(30.0);
    let estado = s(a, "estado");
    let subject = match s(a, "materia") {
        "" => None,
        m => Some(find_subject(db, m)?),
    };
    let sin_fecha = a.get("incluir_sin_fecha").and_then(Value::as_bool).unwrap_or(true);
    let mut list: Vec<(f64, Value)> = db
        .all("tasks")
        .into_iter()
        .filter(|t| if estado.is_empty() { s(t, "status") != "DONE" } else { s(t, "status") == estado })
        .filter(|t| subject.as_ref().map(|x| s(t, "subjectId") == s(x, "id")).unwrap_or(true))
        .filter_map(|t| match db.days_from_now(s(&t, "dueDate")) {
            Some(d) if d <= days => Some((d, t)),
            Some(_) => None,
            None if sin_fecha && s(&t, "dueDate").is_empty() => Some((f64::MAX, t)),
            None => None,
        })
        .collect();
    list.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let out: String = list
        .iter()
        .map(|(d, t)| {
            let when = if *d == f64::MAX { "sin fecha".into() } else if *d < 0.0 { format!("VENCIDA {}", db.local_date(s(t, "dueDate"))) } else { db.local_date(s(t, "dueDate")) };
            format!("- {when} · {} · {} · {} ({}) [id {}]\n", s(t, "type"), s(t, "status"), s(t, "title"), subject_label(db, s(t, "subjectId")), s(t, "id"))
        })
        .collect();
    Ok(if out.is_empty() { "Sin tareas.".into() } else { out })
}

const TASK_TYPES: [&str; 6] = ["PARCIAL", "FINAL", "TP", "FORO", "LECTURA", "TAREA"];

fn crear_tarea(db: &Db, a: &Value) -> Result<String, String> {
    let title = s(a, "titulo").trim();
    if title.is_empty() {
        return Err("Falta el título.".into());
    }
    let kind = if TASK_TYPES.contains(&s(a, "tipo")) { s(a, "tipo") } else { "TAREA" };
    let mut task = json!({
        "id": new_id(),
        "title": title,
        "type": kind,
        "status": "TODO",
        "priority": if ["LOW", "MEDIUM", "HIGH"].contains(&s(a, "prioridad")) { s(a, "prioridad") } else { "MEDIUM" },
        "source": "MANUAL",
        "createdAt": db.now_iso(),
    });
    if !s(a, "descripcion").is_empty() {
        task["description"] = json!(s(a, "descripcion"));
    }
    if !s(a, "fecha").is_empty() {
        task["dueDate"] = json!(db.local_to_iso(s(a, "fecha")).ok_or("Fecha inválida: usá YYYY-MM-DD o YYYY-MM-DDTHH:MM.")?);
    }
    if !s(a, "materia").is_empty() {
        let subj = find_subject(db, s(a, "materia"))?;
        task["subjectId"] = json!(s(&subj, "id"));
        task["degreeId"] = json!(s(&subj, "degreeId"));
    }
    db.put("tasks", &task)?;
    Ok(format!("Tarea creada: {kind} «{title}» [id {}]", s(&task, "id")))
}

fn actualizar_tarea(db: &Db, a: &Value) -> Result<String, String> {
    let mut t = db.get("tasks", s(a, "id")).ok_or("No encontré la tarea.")?;
    if ["TODO", "IN_PROGRESS", "DONE"].contains(&s(a, "estado")) {
        t["status"] = json!(s(a, "estado"));
    }
    if !s(a, "fecha").is_empty() {
        t["dueDate"] = json!(db.local_to_iso(s(a, "fecha")).ok_or("Fecha inválida.")?);
    }
    if !s(a, "titulo").is_empty() {
        t["title"] = json!(s(a, "titulo"));
    }
    if !s(a, "descripcion").is_empty() {
        t["description"] = json!(s(a, "descripcion"));
    }
    db.put("tasks", &t)?;
    Ok(format!("Tarea actualizada: «{}» ({})", s(&t, "title"), s(&t, "status")))
}

fn listar_flashcards(db: &Db, a: &Value) -> Result<String, String> {
    let subject = match s(a, "materia") {
        "" => None,
        m => Some(find_subject(db, m)?),
    };
    let hoy = a.get("solo_para_hoy").and_then(Value::as_bool).unwrap_or(false);
    let out: String = db
        .all("flashcards")
        .into_iter()
        .filter(|c| subject.as_ref().map(|x| s(c, "subjectId") == s(x, "id")).unwrap_or(true))
        .filter(|c| !hoy || db.days_from_now(s(c, "due")).map(|d| d <= 0.0).unwrap_or(true))
        .map(|c| format!("- {} → {} (próximo: {}) [id {}]\n", s(&c, "front"), s(&c, "back"), db.local_date(s(&c, "due")), s(&c, "id")))
        .collect();
    Ok(if out.is_empty() { "Sin flashcards.".into() } else { out })
}

fn crear_flashcards(db: &Db, a: &Value) -> Result<String, String> {
    let subj = find_subject(db, s(a, "materia"))?;
    let cards = a.get("tarjetas").and_then(Value::as_array).ok_or("Faltan las tarjetas.")?;
    let now = db.now_iso();
    let mut n = 0;
    for c in cards {
        let (front, back) = (s(c, "frente").trim(), s(c, "dorso").trim());
        if front.is_empty() || back.is_empty() {
            continue;
        }
        db.put(
            "flashcards",
            &json!({
                "id": new_id(), "subjectId": s(&subj, "id"), "front": front, "back": back,
                "due": now, "stability": 0, "difficulty": 0, "elapsedDays": 0, "scheduledDays": 0,
                "learningSteps": 0, "reps": 0, "lapses": 0, "state": 0, "createdAt": now
            }),
        )?;
        n += 1;
    }
    Ok(format!("{n} flashcards agregadas a {}.", s(&subj, "name")))
}

fn listar_bibliografia(db: &Db, a: &Value) -> Result<String, String> {
    let subj = find_subject(db, s(a, "materia"))?;
    let out: String = db
        .all("documents")
        .into_iter()
        .filter(|d| s(d, "subjectId") == s(&subj, "id"))
        .map(|d| {
            let hl = d.get("highlights").and_then(Value::as_array).map(|h| h.len()).unwrap_or(0);
            format!(
                "- {} · {} págs · {} caracteres{} [id {}]\n",
                s(&d, "fileName"),
                d.get("pageCount").and_then(Value::as_i64).unwrap_or(0),
                s(&d, "extractedText").chars().count(),
                if hl > 0 { format!(" · {hl} resaltados") } else { String::new() },
                s(&d, "id")
            )
        })
        .collect();
    Ok(if out.is_empty() { "Sin PDFs en esta materia.".into() } else { out })
}

fn leer_documento(db: &Db, a: &Value) -> Result<String, String> {
    let d = db.get("documents", s(a, "id")).ok_or("No encontré el documento.")?;
    let text: Vec<char> = s(&d, "extractedText").chars().collect();
    let from = (a.get("desde").and_then(Value::as_u64).unwrap_or(0) as usize).min(text.len());
    let len = a.get("largo").and_then(Value::as_u64).unwrap_or(12000) as usize;
    let to = (from + len).min(text.len());
    let mut out = format!("{} · caracteres {from}–{to} de {}\n\n", s(&d, "fileName"), text.len());
    out.push_str(&text[from..to].iter().collect::<String>());
    if let Some(hl) = d.get("highlights").and_then(Value::as_array) {
        if !hl.is_empty() && from == 0 {
            out.push_str("\n\n## Resaltados\n");
            for h in hl {
                out.push_str(&format!("- pág. {}: «{}»{}\n", h.get("page").and_then(Value::as_i64).unwrap_or(0), s(h, "text"), if s(h, "note").is_empty() { String::new() } else { format!(" — {}", s(h, "note")) }));
            }
        }
    }
    if to < text.len() {
        out.push_str(&format!("\n\n[Sigue: usá desde={to}]"));
    }
    Ok(out)
}

#[allow(dead_code)]
fn _unused(_: Map<String, Value>) {}
