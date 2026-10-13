// Sin ventana de consola en Windows (release).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `unicore.exe --mcp`: servidor MCP para otras IAs (stdio), sin abrir la ventana.
    if std::env::args().any(|a| a == "--mcp") {
        unicore_lib::run_mcp();
    } else {
        unicore_lib::run();
    }
}
