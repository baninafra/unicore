"use client";

// Editores como app: los botones de la barra izquierda abren el editor a pantalla completa,
// sobre todo UniCore, en vez de en una pestaña. Lo que se guarda queda en Notas; si se cierra
// sin escribir nada, no queda un archivo vacío.

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ExternalLink, FolderInput, X } from "lucide-react";
import { pickFolder } from "./folder-picker";
import { useAllSubjects } from "@/lib/hooks";
import { FOLDER_NAME } from "@/lib/nav/actions";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { createOfficeDoc, deleteOfficeDoc, EDITOR_KINDS } from "@/lib/editors/editors";
import { useWorkspace } from "@/lib/workspace";
import { LOOSE_FOLDER, type OfficeKind } from "@/lib/types";

const EditorView = dynamic(() => import("@/views/editor-view").then((m) => m.EditorView), { ssr: false });

const EVENT = "uc:editor-app";

// Abre un editor como app. Con `file`, lo abre con ese archivo (el PDF).
export function openEditorApp(kind: OfficeKind, file?: File) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { kind, file } }));
}

export function EditorApp() {
  const { openView } = useWorkspace();
  const [id, setId] = useState<string | null>(null);
  const doc = useLiveQuery(async () => (id ? ((await db.officeDocs.get(id)) ?? null) : null), [id]);
  const subjects = useAllSubjects();
  const place = doc ? (subjects?.find((x) => x.id === doc.subjectId)?.name ?? FOLDER_NAME[doc.subjectId] ?? "Notas") : "";

  useEffect(() => {
    const onOpen = (e: Event) => {
      const { kind, file } = (e as CustomEvent<{ kind: OfficeKind; file?: File }>).detail;
      void createOfficeDoc({ kind, subjectId: LOOSE_FOLDER, file }).then(setId);
    };
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  }, []);

  const close = async () => {
    const current = id ? await db.officeDocs.get(id) : undefined;
    if (current && !current.fileId) await deleteOfficeDoc(current.id);
    setId(null);
  };

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && e.shiftKey && void close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!id) return null;
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      <div className="flex h-9 flex-none items-center gap-2 border-b border-border px-3">
        <span className="t-label text-muted">{doc ? EDITOR_KINDS[doc.kind].label : ""}</span>
        <span className="truncate text-[13px] text-text">{doc?.name}</span>
        <span className="t-small text-faint">· se guarda solo en {place}</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm ml-auto"
          title="Elegir la materia o carpeta donde queda el archivo"
          onClick={async () => {
            const to = await pickFolder("¿Dónde lo guardo?");
            if (to && id) await db.officeDocs.update(id, { subjectId: to });
          }}
        >
          <FolderInput className="h-4 w-4" strokeWidth={1.75} />
          Guardar en…
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          title="Seguir editando en una pestaña de UniCore"
          onClick={() => {
            openView({ type: "editor", id }, "tab");
            setId(null);
          }}
        >
          <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
          Abrir en pestaña
        </button>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Cerrar" title="Cerrar" onClick={() => void close()}>
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <EditorView key={id} id={id} />
      </div>
    </div>
  );
}
