"use client";

// Vista de un archivo de Word, Excel, PowerPoint o PDF abierto en su editor incrustado.
// El editor corre en un iframe (public/editors/<tipo>/) y habla por postMessage:
//   ← uc:ready      el editor escucha: le mandamos el archivo con uc:open
//   ← uc:save       { name, bytes } al guardar o exportar
//   ← uc:dirty      { dirty } cambios sin guardar (guardamos solos al rato)
//   ← uc:failed     { error } no pudo arrancar
//   → uc:command    { id, command, params } y ← uc:result { id, ok, result | error } (lo usa la IA)

import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import {
  EDITOR_KINDS,
  isNativeSave,
  officeBytes,
  registerEditor,
  saveOfficeBytes,
  touchEditor,
  type LiveEditor,
} from "@/lib/editors/editors";
import { saveBlob } from "@/lib/export/save";
import { FileX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

const AUTOSAVE_MS = 1500;
const COMMAND_TIMEOUT_MS = 60000;

export function EditorView({ id }: { id: string }) {
  const doc = useLiveQuery(async () => (await db.officeDocs.get(id)) ?? null, [id]);
  const kind = doc?.kind;
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!kind) return;
    const iframe = frame.current;
    if (!iframe) return;
    const origin = window.location.origin;
    const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    let seq = 0;
    let saveTimer: number | undefined;

    const post = (message: Record<string, unknown>, transfer?: Transferable[]) =>
      iframe.contentWindow?.postMessage(message, origin, transfer ?? []);

    const editor: LiveEditor = {
      docId: id,
      kind,
      ready: false,
      dirty: false,
      lastActive: Date.now(),
      command: (command, params) =>
        new Promise((resolve, reject) => {
          if (!editor.ready) return reject(new Error("El editor todavía está cargando."));
          const cid = `c${++seq}`;
          const timer = window.setTimeout(() => {
            pending.delete(cid);
            reject(new Error("El editor no respondió."));
          }, COMMAND_TIMEOUT_MS);
          pending.set(cid, {
            resolve: (v) => {
              window.clearTimeout(timer);
              resolve(v);
            },
            reject: (e) => {
              window.clearTimeout(timer);
              reject(e);
            },
          });
          post({ type: "uc:command", id: cid, command, params: params ?? {} });
        }),
    };
    const unregister = registerEditor(editor);

    // Texto del archivo para buscar y para la IA.
    const refreshText = async () => {
      try {
        const r = (await editor.command("uc.read")) as { text?: string } | undefined;
        if (typeof r?.text === "string") await db.officeDocs.update(id, { textCache: r.text.slice(0, 60000) });
      } catch {
        // Sin texto no pasa nada: el archivo ya quedó guardado.
      }
    };

    const autosave = () => {
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        if (editor.dirty) editor.command(EDITOR_KINDS[kind].saveCommand).catch(() => {});
      }, AUTOSAVE_MS);
    };

    const onMessage = async (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== iframe.contentWindow) return;
      const data = e.data as { type?: string; [k: string]: unknown };
      switch (data?.type) {
        case "uc:ready": {
          const current = await db.officeDocs.get(id);
          const bytes = current ? await officeBytes(current) : null;
          // Un archivo nuevo no tiene contenido: el editor ya arranca vacío.
          if (current && bytes) post({ type: "uc:open", name: current.name, bytes }, [bytes]);
          editor.ready = true;
          editor.lastActive = Date.now();
          setState("ready");
          if (current && !current.textCache && bytes) window.setTimeout(refreshText, 1500);
          break;
        }
        case "uc:failed":
          setError(String(data.error ?? ""));
          setState("failed");
          break;
        case "uc:dirty":
          editor.dirty = !!data.dirty;
          if (editor.dirty) autosave();
          break;
        case "uc:save": {
          const name = String(data.name ?? EDITOR_KINDS[kind].label);
          const bytes = data.bytes as ArrayBuffer | undefined;
          if (!bytes) break;
          if (isNativeSave(kind, name)) {
            await saveOfficeBytes(id, name, bytes);
            void refreshText();
          } else {
            // Exportaciones (un PDF de la planilla, una imagen de la diapositiva): van a Descargas.
            await saveBlob(name, new Blob([bytes]));
          }
          break;
        }
        case "uc:result": {
          const p = pending.get(String(data.id));
          if (!p) break;
          pending.delete(String(data.id));
          if (data.ok) p.resolve(data.result);
          else p.reject(new Error(String(data.error ?? "El comando falló.")));
          break;
        }
      }
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(saveTimer);
      unregister();
      for (const p of pending.values()) p.reject(new Error("Se cerró el editor."));
    };
  }, [id, kind]);

  if (doc === undefined) return <div className="p-6 t-small text-faint">Cargando…</div>;
  if (!doc)
    return (
      <div className="p-6">
        <EmptyState icon={FileX} title="No encontramos el archivo" text="Puede que lo hayas borrado." />
      </div>
    );

  return (
    <div className="relative h-full w-full" onPointerDown={() => touchEditor(id)} onFocus={() => touchEditor(id)}>
      <iframe
        ref={frame}
        title={doc.name}
        src={`${EDITOR_KINDS[doc.kind].path}index.html?host=parent`}
        className="absolute inset-0 h-full w-full border-0 bg-bg"
        allow="clipboard-read; clipboard-write; fullscreen"
      />
      {state !== "ready" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg text-center">
          {state === "loading" ? (
            <div className="t-small text-faint">Abriendo el editor…</div>
          ) : (
            <>
              <div className="t-h3">No pudimos abrir el editor</div>
              <div className="t-small max-w-md text-muted">
                Hace falta WebGPU o WebGL2. Actualizá la app o probá abrir el archivo como nota.
                {error && <span className="mt-2 block text-faint">{error}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
