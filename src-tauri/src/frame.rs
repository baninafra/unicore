//! Borde de la ventana sin barra de título.
//!
//! Maximizada y con la barra de tareas que se oculta sola, la ventana deja 1 píxel abajo
//! fuera del contenido (para que la barra pueda aparecer al llevar el mouse ahí). Ese píxel
//! es "borde" de la ventana y Windows lo pinta de blanco cada vez que lo redibuja: se veía
//! como una franja blanca abajo. Acá se intercepta ese pintado y se pinta del color de fondo
//! de la app.

#[cfg(windows)]
mod imp {
    use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        ClientToScreen, CreateSolidBrush, DeleteObject, ExcludeClipRect, FillRect, GetWindowDC, ReleaseDC,
    };
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, GetWindowRect, WM_NCACTIVATE, WM_NCPAINT};

    // #16161a, el fondo de la app (tauri.conf.json → backgroundColor). COLORREF es 0x00BBGGRR.
    const BG: COLORREF = COLORREF(0x001a_1616);

    unsafe fn paint_border(hwnd: HWND) {
        let (mut win, mut client) = (RECT::default(), RECT::default());
        if GetWindowRect(hwnd, &mut win).is_err() || GetClientRect(hwnd, &mut client).is_err() {
            return;
        }
        let mut origin = POINT::default();
        let _ = ClientToScreen(hwnd, &mut origin);
        // Coordenadas relativas a la esquina de la ventana.
        let (w, h) = (win.right - win.left, win.bottom - win.top);
        let (cx, cy) = (origin.x - win.left, origin.y - win.top);
        let dc = GetWindowDC(Some(hwnd));
        if dc.is_invalid() {
            return;
        }
        // Se pinta todo lo que no es contenido.
        ExcludeClipRect(dc, cx, cy, cx + client.right, cy + client.bottom);
        let brush = CreateSolidBrush(BG);
        FillRect(dc, &RECT { left: 0, top: 0, right: w, bottom: h }, brush);
        let _ = DeleteObject(brush.into());
        ReleaseDC(Some(hwnd), dc);
    }

    unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM, _id: usize, _data: usize) -> LRESULT {
        let r = DefSubclassProc(hwnd, msg, wparam, lparam);
        if msg == WM_NCPAINT || msg == WM_NCACTIVATE {
            paint_border(hwnd);
        }
        r
    }

    pub fn install(hwnd: isize) {
        let hwnd = HWND(hwnd as _);
        unsafe {
            let _ = SetWindowSubclass(hwnd, Some(proc), 0x5543, 0);
            paint_border(hwnd);
        }
    }

    pub fn repaint(hwnd: isize) {
        unsafe { paint_border(HWND(hwnd as _)) }
    }
}

/// Se llama una vez, al crear la ventana principal.
pub fn install(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    if let Ok(h) = window.hwnd() {
        imp::install(h.0 as isize);
    }
    #[cfg(not(windows))]
    let _ = window;
}

/// Vuelve a pintar el borde (por ejemplo, justo después de mostrar la ventana).
pub fn repaint(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    if let Ok(h) = window.hwnd() {
        imp::repaint(h.0 as isize);
    }
    #[cfg(not(windows))]
    let _ = window;
}
