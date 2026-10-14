"use client";

// Guarda un archivo generado por la app. En escritorio va a Descargas y se muestra en el Explorador.

import { isDesktop } from "../desktop";
import { toast } from "../undo";

export async function saveBlob(name: string, blob: Blob): Promise<void> {
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await invoke<string>("save_export", new Uint8Array(await blob.arrayBuffer()), {
      headers: { "x-file": encodeURIComponent(name) },
    });
    toast(`Guardado en ${path}`, { ms: 6000 });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFileName(s: string): string {
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "UniCore";
}
