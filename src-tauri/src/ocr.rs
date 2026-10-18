//! OCR con el reconocedor que trae Windows (Windows.Media.Ocr): no descarga nada y es
//! mucho más rápido que Tesseract en la interfaz. Recibe una imagen (PNG, JPG, etc.).
//!
//! Si Windows no tiene un idioma de OCR instalado devuelve `None` y la interfaz usa Tesseract.

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};

#[derive(Serialize, Clone)]
pub struct Word {
    text: String,
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
}

// Un renglón: arriba, abajo, texto y sus palabras con la caja en píxeles de la imagen.
type Line = (f32, f32, String, Vec<Word>);

#[cfg(windows)]
fn recognize(bytes: &[u8]) -> windows::core::Result<Option<Vec<Line>>> {
    use windows::Graphics::Imaging::BitmapDecoder;
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    // El hilo puede venir ya inicializado: si falla, seguimos igual.
    let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };

    // Preferimos español; si no está, el idioma del usuario.
    let spanish = OcrEngine::AvailableRecognizerLanguages()?
        .into_iter()
        .find(|l| l.LanguageTag().map(|t| t.to_string().starts_with("es")).unwrap_or(false));
    let engine = match spanish {
        Some(lang) => OcrEngine::TryCreateFromLanguage(&lang),
        None => OcrEngine::TryCreateFromUserProfileLanguages(),
    };
    let Ok(engine) = engine else { return Ok(None) };

    let stream = InMemoryRandomAccessStream::new()?;
    let writer = DataWriter::CreateDataWriter(&stream)?;
    writer.WriteBytes(bytes)?;
    writer.StoreAsync()?.join()?;
    writer.DetachStream()?;
    stream.Seek(0)?;
    let decoder = BitmapDecoder::CreateAsync(&stream)?.join()?;
    let max = OcrEngine::MaxImageDimension()?;
    if decoder.PixelWidth()? > max || decoder.PixelHeight()? > max {
        return Ok(None);
    }
    let bitmap = decoder.GetSoftwareBitmapAsync()?.join()?;
    let result = engine.RecognizeAsync(&bitmap)?.join()?;

    let mut lines: Vec<Line> = Vec::new();
    for line in result.Lines()? {
        let (mut top, mut bottom) = (f32::MAX, f32::MIN);
        let mut words = Vec::new();
        for word in line.Words()? {
            let r = word.BoundingRect()?;
            top = top.min(r.Y);
            bottom = bottom.max(r.Y + r.Height);
            words.push(Word { text: word.Text()?.to_string(), x0: r.X, y0: r.Y, x1: r.X + r.Width, y1: r.Y + r.Height });
        }
        let text = line.Text()?.to_string();
        if !text.trim().is_empty() && top <= bottom {
            lines.push((top, bottom, text, words));
        }
    }
    Ok(Some(lines))
}

#[cfg(not(windows))]
fn recognize(_bytes: &[u8]) -> Result<Option<Vec<Line>>, String> {
    Ok(None)
}

// Junta los renglones en texto; un hueco grande entre renglones abre otro párrafo.
fn to_text(lines: &[Line]) -> String {
    let mut heights: Vec<f32> = lines.iter().map(|l| l.1 - l.0).collect();
    heights.sort_by(|a, b| a.total_cmp(b));
    let height = heights.get(heights.len() / 2).copied().unwrap_or(10.0);

    let mut out = String::new();
    let mut prev_bottom: Option<f32> = None;
    for (top, bottom, text, _) in lines {
        if let Some(pb) = prev_bottom {
            out.push_str(if top - pb > height * 0.8 { "\n\n" } else { "\n" });
        }
        out.push_str(text.trim());
        prev_bottom = Some(*bottom);
    }
    out
}

#[derive(Serialize)]
pub struct OcrResult {
    text: String,
    words: Vec<Word>,
}

pub(crate) fn recognize_bytes(bytes: Vec<u8>) -> Result<Option<Vec<Line>>, String> {
    recognize(&bytes).map_err(|e| e.to_string())
}

async fn run(request: Request<'_>) -> Result<Option<Vec<Line>>, String> {
    let bytes = match request.body() {
        InvokeBody::Raw(b) => b.clone(),
        InvokeBody::Json(_) => return Err("Se esperaban bytes".into()),
    };
    tauri::async_runtime::spawn_blocking(move || recognize_bytes(bytes))
        .await
        .map_err(|e| e.to_string())?
}

/// Texto de una imagen, con párrafos.
#[tauri::command]
pub async fn ocr_image(request: Request<'_>) -> Result<Option<String>, String> {
    Ok(run(request).await?.map(|lines| to_text(&lines)))
}

/// Texto y palabras con su caja (para la capa de texto de los PDF del escáner).
#[tauri::command]
pub async fn ocr_words(request: Request<'_>) -> Result<Option<OcrResult>, String> {
    Ok(run(request).await?.map(|lines| OcrResult {
        text: to_text(&lines),
        words: lines.into_iter().flat_map(|l| l.3).collect(),
    }))
}

#[cfg(test)]
mod tests {
    // UNICORE_OCR_TEST=<imagen> cargo test ocr -- --nocapture
    #[test]
    fn ocr_de_una_imagen() {
        let Some(path) = std::env::var_os("UNICORE_OCR_TEST") else { return };
        let lines = super::recognize_bytes(std::fs::read(path).unwrap()).unwrap().expect("sin idioma de OCR");
        let text = super::to_text(&lines);
        println!("{text}");
        assert!(!text.trim().is_empty());
    }
}
