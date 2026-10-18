"use client";

// Soltar o pegar archivos en cualquier parte de la app.
// Si nadie más los tomó (el editor de notas, el lienzo, el chat), se importan:
// - en una nota abierta, las imágenes se agregan al final;
// - Word, Excel, PowerPoint y PDF: preguntamos si abrirlos en su editor o convertirlos en nota;
// - el resto (imagen, texto, CSV) se vuelve una nota nueva.

import { useEffect, useRef, useState } from "react";
import { DraftingCompass, FileSpreadsheet, FileText, FileType, NotebookPen, Presentation } from "lucide-react";
import { useWorkspace } from "@/lib/workspace";
import { folderForView } from "@/lib/nav/actions";
import { importFileAsNote, fileKind } from "@/lib/import/import-file";
import { createOfficeDoc, officeKindOf } from "@/lib/editors/editors";
import { saveFile } from "@/lib/db";
import { toast } from "@/lib/undo";
import { isVideoFile } from "@/lib/video";
import { Modal } from "@/components/ui/modal";
import type { OfficeKind } from "@/lib/types";
import { t } from "@/lib/i18n";

const KIND_ICON = { doc: FileText, sheet: FileSpreadsheet, deck: Presentation, pdf: FileType, geo: DraftingCompass } as const;
const EDITOR_NAME: Record<OfficeKind, string> = { doc: t("documentos"), sheet: t("planillas"), deck: t("presentaciones"), pdf: "PDF", geo: t("construcciones de geometría") };
const EDITOR_HINT: Record<OfficeKind, string> = {
  doc: t("Lo editás con formato, como en Word."),
  sheet: t("Lo editás con fórmulas y gráficos, como en Excel."),
  deck: t("Lo editás y lo presentás, como en PowerPoint."),
  pdf: t("Lo anotás, firmás, ordenás y combinás."),
  geo: t("La abrís con gráficos, geometría, 3D y cálculo simbólico."),
};

type Ask = { files: File[]; folder: string };

export function GlobalFiles() {
  const { activeView, openView } = useWorkspace();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const ctx = useRef({ activeView, openView });
  ctx.current = { activeView, openView };

  async function importAsNotes(files: File[], folder: string) {
    for (const f of files) {
      if (isVideoFile(f)) {
        toast(t("Para guardar un video, abrí una nota y soltalo ahí."), { tone: "error" });
        continue;
      }
      if (!fileKind(f)) {
        toast(t("No sabemos leer «{name}».", { name: f.name }), { tone: "error" });
        continue;
      }
      setBusy(t("Importando {name}…", { name: f.name }));
      try {
        const id = await importFileAsNote(f, folder, (msg) => setBusy(msg));
        ctx.current.openView({ type: "nota", id }, "tab");
        toast(t("Importamos «{name}» como nota", { name: f.name }));
      } catch (err) {
        toast(err instanceof Error ? err.message : t("No pudimos importar el archivo."), { tone: "error" });
      } finally {
        setBusy(null);
      }
    }
  }
  const importRef = useRef(importAsNotes);
  importRef.current = importAsNotes;

  async function openInEditors(files: File[], folder: string) {
    for (const f of files) {
      const kind = officeKindOf(f.name);
      if (!kind) continue;
      try {
        const id = await createOfficeDoc({ kind, subjectId: folder, file: f });
        ctx.current.openView({ type: "editor", id }, "tab");
      } catch {
        toast(t("No pudimos guardar «{name}».", { name: f.name }), { tone: "error" });
      }
    }
  }

  const answer = (choice: "editor" | "nota") => {
    if (!ask) return;
    setAsk(null);
    // Los que no se pueden pasar a nota (.odt, .xls, .rtf) se abren igual en el editor.
    const toNote = choice === "nota" ? ask.files.filter((f) => fileKind(f) && fileKind(f) !== "old-office") : [];
    const toEditor = ask.files.filter((f) => !toNote.includes(f));
    void openInEditors(toEditor, ask.folder).then(() => importAsNotes(toNote, ask.folder));
  };

  useEffect(() => {
    let depth = 0;

    async function handle(files: File[]) {
      const { activeView: view } = ctx.current;
      // Nota abierta + sólo imágenes o videos: van a la nota.
      if (view.type === "nota" && files.every((f) => f.type.startsWith("image/") || isVideoFile(f))) {
        const blocks = [];
        for (const f of files)
          blocks.push({ type: isVideoFile(f) ? "video" : "image", props: { url: await saveFile(f), name: f.name } });
        window.dispatchEvent(new CustomEvent("uc:insert-blocks", { detail: { blocks } }));
        return;
      }
      const folder = await folderForView(view);
      // Word, Excel, PowerPoint y PDF: que el usuario elija entre el editor y una nota.
      const forEditor = files.filter((f) => !f.type.startsWith("image/") && officeKindOf(f.name));
      const rest = files.filter((f) => !forEditor.includes(f));
      if (forEditor.length) setAsk({ files: forEditor, folder });
      await importRef.current(rest, folder);
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
      const target = e.target as Element;
      if (target.closest?.("input, textarea, [contenteditable='true'], .bn-editor, .uc-canvas")) return;
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

  const kinds = ask ? [...new Set(ask.files.map((f) => officeKindOf(f.name)).filter((k): k is OfficeKind => !!k))] : [];
  const single = ask?.files.length === 1 ? ask.files[0] : null;
  const EditorIcon = kinds.length === 1 ? KIND_ICON[kinds[0]] : FileText;
  const canNote = !!ask?.files.some((f) => fileKind(f) && fileKind(f) !== "old-office");

  return (
    <>
      <Modal open={!!ask} onClose={() => setAsk(null)} title={single ? t("Abrir «{name}»", { name: single.name }) : t("Abrir {n} archivos", { n: ask?.files.length ?? 0 })} width={480}>
        <div className="flex flex-col gap-2">
          <button type="button" autoFocus className="card card-hover flex items-start gap-3 p-3 text-left" onClick={() => answer("editor")}>
            <EditorIcon className="mt-0.5 h-5 w-5 flex-none text-primary-soft" strokeWidth={1.75} />
            <span>
              <span className="t-h3 block">
                {kinds.length === 1 ? t("Abrir en el editor de {editor}", { editor: EDITOR_NAME[kinds[0]] }) : t("Abrir en sus editores")}
              </span>
              <span className="t-small text-muted">
                {kinds.length === 1 ? EDITOR_HINT[kinds[0]] : t("Cada archivo en el suyo: documento, planilla, presentación o PDF.")} {t("Queda guardado en UniCore.")}
              </span>
            </span>
          </button>
          {canNote && (
            <button type="button" className="card card-hover flex items-start gap-3 p-3 text-left" onClick={() => answer("nota")}>
              <NotebookPen className="mt-0.5 h-5 w-5 flex-none text-primary-soft" strokeWidth={1.75} />
              <span>
                <span className="t-h3 block">{t("Convertir en nota")}</span>
                <span className="t-small text-muted">{t("Pasamos el contenido a una nota: texto editable, enlaces, etiquetas, y la IA lo puede leer.")}</span>
              </span>
            </button>
          )}
        </div>
      </Modal>
      {busy ? (
        <div className="pointer-events-none fixed bottom-9 left-1/2 z-[70] -translate-x-1/2 rounded-md border border-border-strong bg-surface-raised px-3 py-2 text-[length:calc(13px*var(--ui-scale,1))] shadow-pop">
          {busy}
        </div>
      ) : (
        over && (
          <div className="pointer-events-none fixed inset-0 z-[65] border-2 border-dashed border-primary/70 bg-primary-tint/20">
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 rounded-md bg-surface-raised px-3 py-1.5 text-[length:calc(13px*var(--ui-scale,1))] text-text shadow-pop">
              {t("Soltá para agregar: en una nota, en el lienzo, en el chat, como nota nueva o en su editor")}
            </div>
          </div>
        )
      )}
    </>
  );
}
