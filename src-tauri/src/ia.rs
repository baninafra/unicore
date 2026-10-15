//! IA local: un `llama-server` (llama.cpp) que corre en esta PC con un modelo Qwen 3.5.
//!
//! Vive en `C:\Users\<usuario>\UniCore-IA` (fuera de Documentos para que OneDrive no sincronice GB):
//! - `llama\llama-server.exe` (versión Vulkan, anda con placas AMD, NVIDIA e Intel)
//! - `modelos\<id>\*.gguf` un modelo Qwen 3.5 por carpeta (ver `CATALOG`), con su `mmproj-F16.gguf` (visión)
//!
//! La app lo arranca sola cuando hace falta (con el modelo que pida) y lo cierra al salir. También
//! deja buscar en internet usando el curl que trae Windows (la ventana de la app no puede por CORS).

use std::fs;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub const PORT: u16 = 8642;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Un tamaño de Qwen 3.5 que se puede bajar. `rank`: cuanto más alto, más capaz.
pub struct ModelDef {
    id: &'static str,
    label: &'static str,
    repo: &'static str,
    file: &'static str,
    bytes: u64,
    mmproj_bytes: u64,
    rank: u8,
    moe: bool,
}

const HF: &str = "https://huggingface.co/unsloth";
pub const CATALOG: &[ModelDef] = &[
    ModelDef { id: "0.8b", label: "Qwen3.5 0.8B", repo: "Qwen3.5-0.8B-GGUF", file: "Qwen3.5-0.8B-Q4_K_M.gguf", bytes: 530_000_000, mmproj_bytes: 200_000_000, rank: 1, moe: false },
    ModelDef { id: "2b", label: "Qwen3.5 2B", repo: "Qwen3.5-2B-GGUF", file: "Qwen3.5-2B-Q4_K_M.gguf", bytes: 1_280_000_000, mmproj_bytes: 670_000_000, rank: 2, moe: false },
    ModelDef { id: "4b", label: "Qwen3.5 4B", repo: "Qwen3.5-4B-GGUF", file: "Qwen3.5-4B-Q4_K_M.gguf", bytes: 2_740_000_000, mmproj_bytes: 670_000_000, rank: 3, moe: false },
    ModelDef { id: "9b", label: "Qwen3.5 9B", repo: "Qwen3.5-9B-GGUF", file: "Qwen3.5-9B-Q4_K_M.gguf", bytes: 5_680_000_000, mmproj_bytes: 920_000_000, rank: 4, moe: false },
    // MoE: activa 3B por palabra, así que anda rápido aunque no entre entero en la placa.
    ModelDef { id: "35b-a3b", label: "Qwen3.5 35B-A3B", repo: "Qwen3.5-35B-A3B-GGUF", file: "Qwen3.5-35B-A3B-UD-IQ3_XXS.gguf", bytes: 13_080_000_000, mmproj_bytes: 900_000_000, rank: 5, moe: true },
    ModelDef { id: "27b", label: "Qwen3.5 27B", repo: "Qwen3.5-27B-GGUF", file: "Qwen3.5-27B-IQ4_XS.gguf", bytes: 14_980_000_000, mmproj_bytes: 930_000_000, rank: 6, moe: false },
];

fn def(id: &str) -> Option<&'static ModelDef> {
    CATALOG.iter().find(|m| m.id == id)
}

fn url(m: &ModelDef, file: &str) -> String {
    format!("{HF}/{}/resolve/main/{file}", m.repo)
}

#[derive(Default)]
pub struct Ia {
    child: Mutex<Option<(Child, String)>>,
}

impl Drop for Ia {
    fn drop(&mut self) {
        if let Ok(mut c) = self.child.lock() {
            if let Some((mut ch, _)) = c.take() {
                let _ = ch.kill();
            }
        }
    }
}

// En la carpeta del usuario (no en AppData: ahí Windows a veces separa lo que escriben
// distintas apps, y no en Documentos: OneDrive no tiene que subir GB).
fn ia_root() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join("UniCore-IA")
}

fn server_exe() -> PathBuf {
    ia_root().join("llama").join("llama-server.exe")
}

fn model_dir(m: &ModelDef) -> PathBuf {
    ia_root().join("modelos").join(m.id)
}

fn model_path(m: &ModelDef) -> PathBuf {
    model_dir(m).join(m.file)
}

fn installed(m: &ModelDef) -> bool {
    model_path(m).exists()
}

// Las versiones anteriores dejaban el 35B suelto en `modelos\`: lo pasamos a su carpeta.
fn migrate() {
    let root = ia_root().join("modelos");
    let Some(m) = def("35b-a3b") else { return };
    let old = root.join(m.file);
    if old.exists() && !installed(m) {
        let _ = fs::create_dir_all(model_dir(m));
        let _ = fs::rename(&old, model_path(m));
        let _ = fs::rename(root.join("mmproj-F16.gguf"), model_dir(m).join("mmproj-F16.gguf"));
    }
}

fn port_open() -> bool {
    TcpStream::connect_timeout(&([127, 0, 0, 1], PORT).into(), Duration::from_millis(300)).is_ok()
}

#[derive(serde::Serialize)]
pub struct IaInfo {
    installed: bool,
    running: bool,
    port: u16,
    /// Id del modelo que está cargado (si lo arrancamos nosotros).
    model: Option<String>,
    vision: bool,
}

fn info(running: Option<String>, external: bool) -> IaInfo {
    migrate();
    let vision = running
        .as_deref()
        .and_then(def)
        .map(|m| model_dir(m).join("mmproj-F16.gguf").exists())
        .unwrap_or(false);
    IaInfo {
        installed: server_exe().exists() && CATALOG.iter().any(installed),
        running: running.is_some() || external,
        port: PORT,
        model: running,
        vision,
    }
}

// Id del modelo que corre en nuestro proceso, si sigue vivo.
fn running_model(ia: &Ia) -> Option<String> {
    let mut guard = ia.child.lock().ok()?;
    let alive = guard.as_mut().map(|(ch, _)| matches!(ch.try_wait(), Ok(None))).unwrap_or(false);
    if alive {
        guard.as_ref().map(|(_, id)| id.clone())
    } else {
        None
    }
}

#[tauri::command]
pub fn ia_info(ia: tauri::State<Ia>) -> IaInfo {
    let running = running_model(&ia);
    let external = running.is_none() && port_open();
    info(running, external)
}

/// Arranca el servidor con `model` (o el más capaz descargado). Si corre otro modelo, lo cambia.
/// `ctx` = tamaño de contexto en tokens.
#[tauri::command]
pub fn ia_start(ia: tauri::State<Ia>, model: Option<String>, ctx: Option<u32>) -> Result<IaInfo, String> {
    migrate();
    let m = match model.as_deref() {
        Some(id) => def(id).filter(|m| installed(m)).ok_or("Ese modelo no está descargado. Bajalo en Ajustes > IA.")?,
        None => CATALOG
            .iter()
            .filter(|m| installed(m))
            .max_by_key(|m| m.rank)
            .ok_or("No hay ningún modelo Qwen 3.5 descargado. Bajá uno en Ajustes > IA.")?,
    };
    let mut guard = ia.child.lock().map_err(|e| e.to_string())?;
    if let Some((ch, id)) = guard.as_mut() {
        if matches!(ch.try_wait(), Ok(None)) {
            if id == m.id {
                return Ok(info(Some(id.clone()), false));
            }
            // Otro modelo: lo cerramos y esperamos a que suelte el puerto y la memoria.
            let _ = ch.kill();
            let _ = ch.wait();
        }
        *guard = None;
    } else if port_open() {
        // Un servidor que levantó otro (a mano): lo usamos como está.
        return Ok(info(None, true));
    }
    let exe = server_exe();
    if !exe.exists() {
        return Err("No encontramos llama-server en UniCore-IA\\llama".into());
    }
    let mmproj = model_dir(m).join("mmproj-F16.gguf");

    let mut cmd = Command::new(&exe);
    cmd.current_dir(exe.parent().unwrap())
        .args(["-m", &model_path(m).to_string_lossy()])
        .args(["--host", "127.0.0.1", "--port", &PORT.to_string()])
        // --fit llena la placa de video y deja en la RAM lo que no entra (en los MoE, los expertos).
        // Medido en una RX 9060 XT 8 GB con el 35B-A3B: ~460 tokens/s leyendo y ~24 escribiendo.
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
    if mmproj.exists() {
        // La visión va en la CPU para dejarle la placa al modelo.
        cmd.args(["--mmproj", &mmproj.to_string_lossy(), "--no-mmproj-offload"]);
    } else {
        cmd.arg("--no-mmproj");
    }
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let child = cmd.spawn().map_err(|e| format!("No se pudo abrir llama-server: {e}"))?;
    *guard = Some((child, m.id.to_string()));
    Ok(info(Some(m.id.to_string()), false))
}

#[tauri::command]
pub fn ia_stop(ia: tauri::State<Ia>) {
    if let Ok(mut c) = ia.child.lock() {
        if let Some((mut ch, _)) = c.take() {
            let _ = ch.kill();
            let _ = ch.wait();
        }
    }
}

// ---------- Qué tiene esta PC ----------

#[derive(Clone, serde::Serialize)]
pub struct Hardware {
    /// RAM total en bytes.
    ram: u64,
    /// Memoria de la placa de video más grande (0 si sólo hay gráficos integrados chicos).
    vram: u64,
    gpu: String,
}

fn powershell(script: &str) -> String {
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-Command", script]);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default()
}

fn hardware() -> Hardware {
    static HW: OnceLock<Hardware> = OnceLock::new();
    HW.get_or_init(|| {
        let ram = powershell("(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory").trim().parse().unwrap_or(0);
        // Win32_VideoController corta en 4 GB; el registro del driver tiene el número real.
        let out = powershell(
            r#"Get-ItemProperty -Path 'HKLM:\SYSTEM\ControlSet001\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0*' -ErrorAction SilentlyContinue | ForEach-Object { "$($_.'HardwareInformation.qwMemorySize')|$($_.DriverDesc)" }"#,
        );
        let (vram, gpu) = out
            .lines()
            .filter_map(|l| {
                let (n, name) = l.trim().split_once('|')?;
                Some((n.parse::<u64>().unwrap_or(0), name.to_string()))
            })
            .max_by_key(|(n, _)| *n)
            .unwrap_or((0, String::new()));
        Hardware { ram, vram, gpu }
    })
    .clone()
}

#[derive(serde::Serialize)]
pub struct CatalogModel {
    id: &'static str,
    label: &'static str,
    /// Lo que ocupa en el disco (modelo + visión).
    bytes: u64,
    /// Lo que ocupa el modelo (para estimar si entra en la placa).
    model_bytes: u64,
    rank: u8,
    moe: bool,
    installed: bool,
}

#[derive(serde::Serialize)]
pub struct Catalog {
    hardware: Hardware,
    engine_installed: bool,
    models: Vec<CatalogModel>,
}

/// Los modelos Qwen 3.5 que se pueden bajar, cuáles están y qué tiene la PC.
#[tauri::command]
pub async fn ia_catalog() -> Catalog {
    tauri::async_runtime::spawn_blocking(|| {
        migrate();
        Catalog {
            hardware: hardware(),
            engine_installed: server_exe().exists(),
            models: CATALOG
                .iter()
                .map(|m| CatalogModel {
                    id: m.id,
                    label: m.label,
                    bytes: m.bytes + m.mmproj_bytes,
                    model_bytes: m.bytes,
                    rank: m.rank,
                    moe: m.moe,
                    installed: installed(m),
                })
                .collect(),
        }
    })
    .await
    .unwrap_or(Catalog { hardware: Hardware { ram: 0, vram: 0, gpu: String::new() }, engine_installed: false, models: vec![] })
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
const LLAMA_BYTES: u64 = 32_000_000;

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

// Se baja a `.part` y se renombra al terminar: así un archivo a medias nunca cuenta como descargado.
fn fetch(url: &str, dest: &PathBuf) -> Result<(), String> {
    if dest.exists() {
        return Ok(());
    }
    let part = part_of(dest);
    curl_to(url, &part)?;
    fs::rename(&part, dest).map_err(|e| e.to_string())
}

fn part_of(p: &PathBuf) -> PathBuf {
    let mut s = p.clone().into_os_string();
    s.push(".part");
    PathBuf::from(s)
}

fn size_of(p: &PathBuf) -> u64 {
    fs::metadata(p).map(|m| m.len()).unwrap_or(0)
}

/// Baja el motor (si falta) y los modelos pedidos, uno detrás del otro.
#[tauri::command]
pub fn ia_download(dl: tauri::State<Downloads>, models: Vec<String>) -> Result<(), String> {
    migrate();
    let wanted: Vec<&'static ModelDef> = models.iter().filter_map(|id| def(id)).filter(|m| !installed(m)).collect();
    let need_llama = !server_exe().exists();
    if wanted.is_empty() && !need_llama {
        return Ok(());
    }
    let state = dl.state.clone();
    {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        if s.running {
            return Err("Ya hay una descarga en curso.".into());
        }
        let total = wanted.iter().map(|m| m.bytes + m.mmproj_bytes).sum::<u64>() + if need_llama { LLAMA_BYTES } else { 0 };
        *s = DownloadState { running: true, total, step: "Preparando…".into(), ..Default::default() };
    }
    std::thread::spawn(move || {
        let root = ia_root();
        let llama = root.join("llama");
        let _ = fs::create_dir_all(&llama);
        let zip = root.join("llama.zip");

        // Todo lo que se va a bajar, en orden, para medir el progreso.
        let mut files: Vec<(String, PathBuf, String)> = Vec::new();
        for m in &wanted {
            let _ = fs::create_dir_all(model_dir(m));
            files.push((url(m, m.file), model_path(m), format!("Descargando {}…", m.label)));
            files.push((url(m, "mmproj-F16.gguf"), model_dir(m).join("mmproj-F16.gguf"), format!("Descargando la visión de {}…", m.label)));
        }

        // Hilo que mide cuánto se bajó.
        let watch = state.clone();
        let paths: Vec<PathBuf> = files.iter().map(|(_, p, _)| p.clone()).collect();
        let (z, llama_done) = (zip.clone(), llama.join("llama-server.exe"));
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(700));
            let done = (if !need_llama { 0 } else if llama_done.exists() { LLAMA_BYTES } else { size_of(&z) })
                + paths.iter().map(|p| size_of(p).max(size_of(&part_of(p)))).sum::<u64>();
            let mut s = match watch.lock() {
                Ok(s) => s,
                Err(_) => return,
            };
            if !s.running {
                return;
            }
            s.done = done.min(s.total);
        });

        let set_step = |t: &str| {
            if let Ok(mut s) = state.lock() {
                s.step = t.into();
            }
        };
        let result = (|| -> Result<(), String> {
            if need_llama {
                set_step("Descargando el motor (llama.cpp)…");
                curl_to(LLAMA_URL, &zip)?;
                let mut tar = Command::new("tar");
                tar.args(["-xf"]).arg(&zip).arg("-C").arg(&llama);
                #[cfg(windows)]
                tar.creation_flags(CREATE_NO_WINDOW);
                tar.status().map_err(|e| e.to_string())?;
                let _ = fs::remove_file(&zip);
            }
            // La visión primero: el modelo es lo que marca "descargado", así que va al final.
            for pair in files.chunks(2) {
                let (vurl, vpath, vstep) = &pair[1];
                set_step(vstep);
                fetch(vurl, vpath)?;
                let (murl, mpath, mstep) = &pair[0];
                set_step(mstep);
                fetch(murl, mpath)?;
            }
            Ok(())
        })();
        if let Ok(mut s) = state.lock() {
            s.running = false;
            match result {
                Ok(()) => {
                    s.finished = true;
                    s.done = s.total;
                    s.step = "Listo".into();
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

/// Borra un modelo (o todo, motor incluido, si no se dice cuál). Si está cargado, apaga el servidor.
#[tauri::command]
pub fn ia_remove(ia: tauri::State<Ia>, model: Option<String>) -> Result<(), String> {
    migrate();
    match model.as_deref() {
        Some(id) => {
            let m = def(id).ok_or("Modelo desconocido")?;
            if running_model(&ia).as_deref() == Some(id) {
                ia_stop(ia);
            }
            let dir = model_dir(m);
            if dir.exists() {
                fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
            }
        }
        None => {
            ia_stop(ia);
            std::thread::sleep(Duration::from_millis(500));
            let root = ia_root();
            if root.exists() {
                fs::remove_dir_all(&root).map_err(|e| e.to_string())?;
            }
        }
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
