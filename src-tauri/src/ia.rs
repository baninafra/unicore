//! IA potente local: un `llama-server` (llama.cpp) que corre en esta PC.
//!
//! Vive en `C:\Users\<usuario>\UniCore-IA` (fuera de Documentos para que OneDrive no sincronice 13 GB):
//! - `llama\llama-server.exe` (versión Vulkan, anda con placas AMD, NVIDIA e Intel)
//! - `modelos\*.gguf` (el modelo; el `mmproj*.gguf` opcional le da visión)
//!
//! La app lo arranca sola cuando hace falta y lo cierra al salir. También deja buscar en
//! internet usando el curl que trae Windows (la ventana de la app no puede por CORS).

use std::fs;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub const PORT: u16 = 8642;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
pub struct Ia {
    child: Mutex<Option<Child>>,
}

impl Drop for Ia {
    fn drop(&mut self) {
        if let Ok(mut c) = self.child.lock() {
            if let Some(mut ch) = c.take() {
                let _ = ch.kill();
            }
        }
    }
}

// En la carpeta del usuario (no en AppData: ahí Windows a veces separa lo que escriben
// distintas apps, y no en Documentos: OneDrive no tiene que subir 14 GB).
fn ia_root() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join("UniCore-IA")
}

fn server_exe() -> PathBuf {
    ia_root().join("llama").join("llama-server.exe")
}

// El modelo más grande de la carpeta (el mmproj es aparte).
fn find_model() -> Option<(PathBuf, Option<PathBuf>)> {
    let dir = ia_root().join("modelos");
    let mut models = Vec::new();
    let mut mmproj = None;
    for e in fs::read_dir(&dir).ok()?.flatten() {
        let p = e.path();
        let name = p.file_name()?.to_string_lossy().to_lowercase();
        if !name.ends_with(".gguf") {
            continue;
        }
        let size = e.metadata().map(|m| m.len()).unwrap_or(0);
        if name.starts_with("mmproj") {
            mmproj = Some(p);
        } else if size > 1_000_000_000 {
            models.push((size, p));
        }
    }
    models.sort();
    models.pop().map(|(_, p)| (p, mmproj))
}

fn port_open() -> bool {
    TcpStream::connect_timeout(&([127, 0, 0, 1], PORT).into(), Duration::from_millis(300)).is_ok()
}

#[derive(serde::Serialize)]
pub struct IaInfo {
    installed: bool,
    running: bool,
    port: u16,
    model: Option<String>,
    vision: bool,
}

fn info(running: bool) -> IaInfo {
    let found = find_model();
    IaInfo {
        installed: server_exe().exists() && found.is_some(),
        running,
        port: PORT,
        model: found.as_ref().and_then(|(p, _)| p.file_stem().map(|s| s.to_string_lossy().into_owned())),
        vision: found.map(|(_, m)| m.is_some()).unwrap_or(false),
    }
}

#[tauri::command]
pub fn ia_info(ia: tauri::State<Ia>) -> IaInfo {
    let alive = ia
        .child
        .lock()
        .map(|mut c| c.as_mut().map(|ch| matches!(ch.try_wait(), Ok(None))).unwrap_or(false))
        .unwrap_or(false);
    info(alive || port_open())
}

/// Arranca el servidor si no está corriendo. `ctx` = tamaño de contexto en tokens.
#[tauri::command]
pub fn ia_start(ia: tauri::State<Ia>, ctx: Option<u32>) -> Result<IaInfo, String> {
    let mut guard = ia.child.lock().map_err(|e| e.to_string())?;
    if let Some(ch) = guard.as_mut() {
        if matches!(ch.try_wait(), Ok(None)) {
            return Ok(info(true));
        }
    }
    if port_open() {
        return Ok(info(true));
    }
    let exe = server_exe();
    let (model, mmproj) = find_model().ok_or("No encontramos el modelo en UniCore-IA\\modelos")?;
    if !exe.exists() {
        return Err("No encontramos llama-server en UniCore-IA\\llama".into());
    }

    let mut cmd = Command::new(&exe);
    cmd.current_dir(exe.parent().unwrap())
        .args(["-m", &model.to_string_lossy()])
        .args(["--host", "127.0.0.1", "--port", &PORT.to_string()])
        // --fit llena la placa de video y deja en la RAM los expertos que no entran (MoE).
        // Medido en una RX 9060 XT 8 GB: ~460 tokens/s leyendo y ~24 tokens/s escribiendo.
        .args(["--fit", "on", "--fit-target", "768"])
        .args(["-c", &ctx.unwrap_or(32768).to_string(), "-np", "1"])
        // Lotes grandes: la placa procesa los documentos largos mucho más rápido.
        .args(["-b", "2048", "-ub", "2048"])
        .args(["-fa", "on", "-ctk", "q8_0", "-ctv", "q8_0"])
        // Plantilla del modelo (llamadas a herramientas) y el razonamiento aparte.
        .args(["--jinja", "--reasoning-format", "deepseek"])
        .args(["-t", "8", "--no-webui"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(
            fs::File::create(ia_root().join("servidor.log")).map_err(|e| e.to_string())?,
        ));
    match mmproj {
        Some(m) => {
            // La visión va en la CPU para dejarle la placa al modelo.
            cmd.args(["--mmproj", &m.to_string_lossy(), "--no-mmproj-offload"]);
        }
        None => {
            cmd.arg("--no-mmproj");
        }
    }
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let child = cmd.spawn().map_err(|e| format!("No se pudo abrir llama-server: {e}"))?;
    *guard = Some(child);
    Ok(info(true))
}

#[tauri::command]
pub fn ia_stop(ia: tauri::State<Ia>) {
    if let Ok(mut c) = ia.child.lock() {
        if let Some(mut ch) = c.take() {
            let _ = ch.kill();
        }
    }
}

/// Últimas líneas del registro del servidor (para mostrar por qué no arrancó).
#[tauri::command]
pub fn ia_log() -> String {
    let raw = fs::read_to_string(ia_root().join("servidor.log")).unwrap_or_default();
    let lines: Vec<&str> = raw.lines().collect();
    lines[lines.len().saturating_sub(40)..].join("\n")
}

/// GET o POST a una URL de internet (búsqueda web de la IA). Devuelve el cuerpo como texto.
#[tauri::command]
pub async fn web_get(url: String, body: Option<String>) -> Result<String, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("URL inválida".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new("curl.exe");
        cmd.args(["-sL", "--compressed", "--max-time", "15", "--max-filesize", "4000000"])
            .args(["-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"])
            .args(["-H", "Accept-Language: es-AR,es;q=0.9,en;q=0.6"]);
        // Con cuerpo es un POST JSON (lo usa la transcripción de YouTube).
        if let Some(b) = &body {
            cmd.args(["-X", "POST", "-H", "Content-Type: application/json", "--data-binary", b]);
        }
        cmd.arg(&url);
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let out = cmd.output().map_err(|e| e.to_string())?;
        if !out.status.success() && out.stdout.is_empty() {
            return Err("No pudimos abrir la página".into());
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- Descarga desde la app ----------

const LLAMA_URL: &str = "https://github.com/ggml-org/llama.cpp/releases/download/b11609/llama-b11609-bin-win-vulkan-x64.zip";
const MODEL_URL: &str = "https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/Qwen3.5-35B-A3B-UD-IQ3_XXS.gguf";
const MMPROJ_URL: &str = "https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/mmproj-F16.gguf";
// Tamaños aproximados, para la barra de progreso.
const TOTAL_BYTES: u64 = 32_000_000 + 13_080_000_000 + 903_000_000;

#[derive(Default, Clone, serde::Serialize)]
pub struct DownloadState {
    running: bool,
    done: u64,
    total: u64,
    step: String,
    error: Option<String>,
    finished: bool,
}

#[derive(Default)]
pub struct Downloads {
    state: std::sync::Arc<Mutex<DownloadState>>,
}

fn curl_to(url: &str, dest: &PathBuf) -> Result<(), String> {
    let mut cmd = Command::new("curl.exe");
    // -C - retoma si se cortó a la mitad.
    cmd.args(["-L", "-C", "-", "--retry", "5", "-s", "-f", "-o"]).arg(dest).arg(url);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let st = cmd.status().map_err(|e| e.to_string())?;
    // 33 = el servidor no soporta retomar porque el archivo ya está completo.
    if st.success() || st.code() == Some(33) {
        Ok(())
    } else {
        Err(format!("La descarga falló (código {:?}). Revisá tu conexión y probá de nuevo.", st.code()))
    }
}

fn size_of(p: &PathBuf) -> u64 {
    fs::metadata(p).map(|m| m.len()).unwrap_or(0)
}

#[tauri::command]
pub fn ia_download(dl: tauri::State<Downloads>) -> Result<(), String> {
    let state = dl.state.clone();
    {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        if s.running {
            return Ok(());
        }
        *s = DownloadState { running: true, total: TOTAL_BYTES, step: "Preparando…".into(), ..Default::default() };
    }
    std::thread::spawn(move || {
        let root = ia_root();
        let models = root.join("modelos");
        let llama = root.join("llama");
        let _ = fs::create_dir_all(&models);
        let _ = fs::create_dir_all(&llama);
        let zip = root.join("llama.zip");
        let model = models.join("Qwen3.5-35B-A3B-UD-IQ3_XXS.gguf");
        let mmproj = models.join("mmproj-F16.gguf");

        // Hilo que mide cuánto se bajó.
        let watch = state.clone();
        let (z, m, p) = (zip.clone(), model.clone(), mmproj.clone());
        let llama_done = llama.join("llama-server.exe");
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(700));
            let mut s = match watch.lock() {
                Ok(s) => s,
                Err(_) => return,
            };
            if !s.running {
                return;
            }
            let zip_bytes = if llama_done.exists() { 32_000_000 } else { size_of(&z) };
            s.done = zip_bytes + size_of(&m) + size_of(&p);
        });

        let set_step = |t: &str| {
            if let Ok(mut s) = state.lock() {
                s.step = t.into();
            }
        };
        let result = (|| -> Result<(), String> {
            if !llama.join("llama-server.exe").exists() {
                set_step("Descargando el motor (llama.cpp)…");
                curl_to(LLAMA_URL, &zip)?;
                let mut tar = Command::new("tar");
                tar.args(["-xf"]).arg(&zip).arg("-C").arg(&llama);
                #[cfg(windows)]
                tar.creation_flags(CREATE_NO_WINDOW);
                tar.status().map_err(|e| e.to_string())?;
                let _ = fs::remove_file(&zip);
            }
            set_step("Descargando el modelo Qwen3.5 35B (13 GB)…");
            if size_of(&model) < 13_000_000_000 {
                curl_to(MODEL_URL, &model)?;
            }
            set_step("Descargando la visión (para leer fotos)…");
            if size_of(&mmproj) < 900_000_000 {
                curl_to(MMPROJ_URL, &mmproj)?;
            }
            Ok(())
        })();
        if let Ok(mut s) = state.lock() {
            s.running = false;
            match result {
                Ok(()) => {
                    s.finished = true;
                    s.done = s.total;
                    s.step = "Lista".into();
                }
                Err(e) => s.error = Some(e),
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub fn ia_download_status(dl: tauri::State<Downloads>) -> DownloadState {
    dl.state.lock().map(|s| s.clone()).unwrap_or_default()
}

/// Borra el modelo potente (libera ~14 GB). Primero apaga el servidor.
#[tauri::command]
pub fn ia_remove(ia: tauri::State<Ia>) -> Result<(), String> {
    ia_stop(ia);
    std::thread::sleep(Duration::from_millis(500));
    let root = ia_root();
    if root.exists() {
        fs::remove_dir_all(&root).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Espacio libre en el disco donde va la IA (en bytes).
#[tauri::command]
pub fn ia_free_space() -> u64 {
    let root = ia_root();
    let drive = root.to_string_lossy().chars().next().unwrap_or('C');
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-Command", &format!("(Get-PSDrive {drive}).Free")]);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.output()
        .ok()
        .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse().ok())
        .unwrap_or(0)
}

/// Guarda un archivo exportado en Descargas y lo muestra en el Explorador. Cabecera x-file: nombre.
#[tauri::command]
pub fn save_export(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    use tauri_plugin_opener::OpenerExt;
    let name = request
        .headers()
        .get("x-file")
        .and_then(|h| h.to_str().ok())
        .map(|s| percent_decode(s))
        .ok_or("Falta el nombre del archivo")?;
    let clean: String = name
        .chars()
        .map(|c| if r#"<>:"/\|?*"#.contains(c) || c.is_control() { '_' } else { c })
        .collect();
    let dir = dirs::download_dir().unwrap_or_else(|| PathBuf::from("."));
    let (stem, ext) = clean.rsplit_once('.').unwrap_or((clean.as_str(), ""));
    let mut path = dir.join(&clean);
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => fs::write(&path, bytes).map_err(|e| e.to_string())?,
        _ => return Err("Se esperaban bytes".into()),
    }
    let _ = app.opener().reveal_item_in_dir(&path);
    Ok(path.to_string_lossy().into_owned())
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
