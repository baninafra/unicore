"use client";

// Soltar o pegar archivos en cualquier parte de la app.
// Si nadie más los tomó (el editor de notas, el lienzo, el chat), se importan:
// - en una nota abierta, las imágenes se agregan al final;
// - si no, cada archivo (PDF, Excel, PowerPoint, Word, imagen, texto) se vuelve una nota nueva.

import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/lib/workspace";
import { folderForView } from "@/lib/nav/actions";
import { importFileAsNote, fileKind } from "@/lib/import/import-file";
import { saveFile } from "@/lib/db";
import { toast } from "@/lib/undo";
import { isVideoFile } from "@/lib/video";

export function GlobalFiles() {
  const { activeView, openView } = useWorkspace();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ctx = useRef({ activeView, openView });
  ctx.current = { activeView, openView };

  useEffect(() => {
    let depth = 0;

    async function handle(files: File[]) {
      const { activeView: view, openView: open } = ctx.current;
      // Nota abierta + sólo imágenes o videos: van a la nota.
      if (view.type === "nota" && files.every((f) => f.type.startsWith("image/") || isVideoFile(f))) {
        const blocks = [];
        for (const f of files)
          blocks.push({ type: isVideoFile(f) ? "video" : "image", props: { url: await saveFile(f), name: f.name } });
        window.dispatchEvent(new CustomEvent("uc:insert-blocks", { detail: { blocks } }));
        return;
      }
      const folder = await folderForView(view);
      for (const f of files) {
        if (isVideoFile(f)) {
          toast("Para guardar un video, abrí una nota y soltalo ahí.", { tone: "error" });
          continue;
        }
        if (!fileKind(f)) {
          toast(`No sabemos leer «${f.name}».`, { tone: "error" });
          continue;
        }
        setBusy(`Importando ${f.name}…`);
        try {
          const id = await importFileAsNote(f, folder, (t) => setBusy(t));
          open({ type: "nota", id }, "tab");
          toast(`Importamos «${f.name}» como nota`);
        } catch (err) {
          toast(err instanceof Error ? err.message : "No pudimos importar el archivo.", { tone: "error" });
        } finally {
          setBusy(null);
        }
      }
    }

    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const onOver = (e: DragEvent) => {
      // Sin esto el navegador abre el archivo en lugar de dejarlo soltar.
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      depth = 0;
      setOver(false);
      if (e.defaultPrevented || !hasFiles(e)) return;
      // Dentro del editor de notas lo maneja el editor.
      if ((e.target as Element).closest?.(".bn-editor")) return;
      e.preventDefault();
      void handle([...(e.dataTransfer?.files ?? [])]);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as Element;
      if (t.closest?.("input, textarea, [contenteditable='true'], .bn-editor, .uc-canvas")) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      void handle(files);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  if (busy)
    return (
      <div className="pointer-events-none fixed bottom-9 left-1/2 z-[70] -translate-x-1/2 rounded-md border border-border-strong bg-surface-raised px-3 py-2 text-[13px] shadow-pop">
        {busy}
      </div>
    );
  if (!over) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[65] border-2 border-dashed border-primary/70 bg-primary-tint/20">
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 rounded-md bg-surface-raised px-3 py-1.5 text-[13px] text-text shadow-pop">
        Soltá para agregar: en una nota, en el lienzo, en el chat o como nota nueva
      </div>
    </div>
  );
}
