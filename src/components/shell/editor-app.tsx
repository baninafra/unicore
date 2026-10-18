"use client";

// Los botones de Word, Excel, PowerPoint y PDF de la barra izquierda abren el editor en una pestaña
// de UniCore (con las barras y las pestañas, como cualquier nota). El archivo nuevo queda en Notas;
// si se cierra la pestaña sin haber escrito nada, no queda un archivo vacío.

import { useEffect, useRef } from "react";
import { pickFolder } from "./folder-picker";
import { db } from "@/lib/db";
import { createOfficeDoc, deleteOfficeDoc } from "@/lib/editors/editors";
import { useWorkspace } from "@/lib/workspace";
import type { OfficeKind } from "@/lib/types";

const EVENT = "uc:editor-app";

// Abre un editor nuevo. Con `file`, lo abre con ese archivo (el PDF).
export function openEditorApp(kind: OfficeKind, file?: File) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { kind, file } }));
}

export function EditorApp() {
  const { openView, panes } = useWorkspace();
  // Archivos creados desde estos botones que todavía no se guardaron.
  const fresh = useRef(new Set<string>());

  useEffect(() => {
    const onOpen = (e: Event) => {
      const { kind, file } = (e as CustomEvent<{ kind: OfficeKind; file?: File }>).detail;
      void (async () => {
        // Primero se elige dónde queda (materia o carpeta); si se cancela, no se crea nada.
        const to = await pickFolder("¿Dónde lo guardo?");
        if (!to) return;
        const id = await createOfficeDoc({ kind, subjectId: to, file });
        if (!file) fresh.current.add(id);
        openView({ type: "editor", id }, "tab");
      })();
    };
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  }, [openView]);

  // Cuando se cierra la pestaña de un archivo nuevo que quedó vacío, se borra.
  useEffect(() => {
    const open = new Set(panes.flatMap((p) => p.tabs.map((t) => t.view)).flatMap((v) => (v.type === "editor" ? [v.id] : [])));
    for (const id of [...fresh.current]) {
      if (open.has(id)) continue;
      fresh.current.delete(id);
      void db.officeDocs.get(id).then((d) => {
        if (d && !d.fileId) void deleteOfficeDoc(id);
      });
    }
  }, [panes]);

  return null;
}
