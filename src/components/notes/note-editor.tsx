"use client";

import "@blocknote/mantine/style.css";
import "./editor.css";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { es } from "@blocknote/core/locales";
import { filterSuggestionItems, type BlockNoteEditorOptions, type PartialBlock } from "@blocknote/core";
import { withCollaboration } from "@blocknote/core/yjs";
import { markSeeded, shareUser, type ShareSession } from "@/lib/share/share";
import { BlockNoteView } from "@blocknote/mantine";
import { SuggestionMenuController, useCreateBlockNote } from "@blocknote/react";
import { modeFromEvent } from "@/components/workspace/use-open";
import { useAppState } from "@/lib/app-state";
import { useSettings } from "@/components/settings/apply-settings";
import { resolveFileUrl, saveFile } from "@/lib/db";
import { plainTextOf, type BlockLike } from "@/lib/notes/index-note";
import { saveNoteContent } from "@/lib/notes/note-ops";
import { useStatusItem, useWorkspace } from "@/lib/workspace";
import type { Note } from "@/lib/types";
import { notesDecorations } from "./decorations";
import { FindBar } from "./find-bar";
import { noteSchema, slashMenuItems, type NoteBlockEditor } from "./note-schema";
import { wikilinkMenuItems } from "./wikilink";
import { startImageDrag } from "./image-drag";
import { parseVideoUrl } from "@/lib/video";

const AUTOSAVE_MS = 1500;

type PasteArgs = Parameters<NonNullable<BlockNoteEditorOptions<NoteBlockEditor["schema"]["blockSchema"], NoteBlockEditor["schema"]["inlineContentSchema"], NoteBlockEditor["schema"]["styleSchema"]>["pasteHandler"]>>[0];

type SaveState = "saved" | "pending" | "error";

function formatStats(text: string): string {
  const words = text.split(/\s+/).filter(Boolean).length;
  const chars = text.length;
  return `${words.toLocaleString("es-AR")} ${words === 1 ? "palabra" : "palabras"} · ${chars.toLocaleString("es-AR")} caracteres`;
}

interface NoteEditorProps {
  note: Note;
  // Si la nota es la que está en primer plano: el estado de la barra y la inserción desde otros módulos dependen de esto.
  active?: boolean;
  editable?: boolean;
  findMode?: "find" | "replace" | null;
  onFindClose?: () => void;
  onEditor?: (editor: NoteBlockEditor | null) => void;
  // Nota compartida en vivo: el contenido viene del documento compartido (se monta otra vez al empezar o cortar).
  share?: ShareSession;
}

// Editor de una nota (BlockNote con enlaces, etiquetas, menú "/" y "[[", guardado automático).
// Se monta con key={note.id}, así cada nota tiene su propia instancia.
export function NoteEditor({ note, active = true, editable = true, findMode = null, onFindClose, onEditor, share }: NoteEditorProps) {
  const { theme } = useAppState();
  const { openView } = useWorkspace();
  const [settings] = useSettings();
  const editorRef = useRef<HTMLDivElement>(null);

  const base = {
    schema: noteSchema,
    extensions: [notesDecorations],
    dictionary: es,
    uploadFile: (file: File) => saveFile(file),
    resolveFileUrl: (url: string) => resolveFileUrl(url),
    // Pegar sólo un link de YouTube o Vimeo lo inserta como video.
    pasteHandler: ({ event, editor: ed, defaultPasteHandler }: PasteArgs) => {
      const text = event.clipboardData?.getData("text/plain")?.trim() ?? "";
      const video = !/\s/.test(text) ? parseVideoUrl(text) : null;
      if (!video) return defaultPasteHandler();
      const at = ed.getTextCursorPosition().block;
      const empty = Array.isArray(at.content) && at.content.length === 0;
      const block = { type: "videoEmbed" as const, props: { url: video.url } };
      if (empty) ed.replaceBlocks([at], [block]);
      else ed.insertBlocks([block], at, "after");
      return true;
    },
  };
  const editor = useCreateBlockNote(
    share
      ? withCollaboration({
          ...base,
          collaboration: { fragment: share.fragment, user: shareUser(share.role), provider: { awareness: share.awareness }, showCursorLabels: "always" },
        })
      : { ...base, initialContent: note.content.length ? (note.content as PartialBlock[]) : undefined },
  );

  // El anfitrión carga su nota en el documento compartido una sola vez (los invitados la reciben de él).
  useEffect(() => {
    if (!share?.needsSeed) return;
    markSeeded(share.noteId);
    if (note.content.length) editor.replaceBlocks(editor.document, note.content as PartialBlock[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [share, editor]);

  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [statsText, setStatsText] = useState(() => formatStats(plainTextOf(note.content as BlockLike[])));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<unknown[] | null>(null);

  const persist = useCallback(
    async (blocks: unknown[]) => {
      try {
        await saveNoteContent(note.id, blocks);
        // Si el usuario siguió escribiendo mientras se guardaba, queda "Guardando…" hasta el próximo guardado.
        if (!pending.current) setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    },
    [note.id],
  );

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const blocks = pending.current;
    if (!blocks) return;
    pending.current = null;
    await persist(blocks);
  }, [persist]);

  useEffect(() => {
    const unsubscribe = editor.onChange((ed) => {
      pending.current = ed.document;
      setSaveState("pending");
      setStatsText(formatStats(plainTextOf(ed.document as BlockLike[])));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
    });
    return () => {
      unsubscribe();
      // Al cambiar de nota o cerrar la pestaña, se guarda lo que quedó pendiente.
      void flush();
    };
  }, [editor, flush]);

  useEffect(() => {
    editor.isEditable = editable;
  }, [editor, editable]);

  useEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  // Barra de estado: palabras y guardado (sólo mientras la nota está activa).
  const saveLabel = saveState === "saved" ? "Guardado" : saveState === "pending" ? "Guardando…" : "No se guardó";
  const statsNode = useMemo(() => <span>{statsText}</span>, [statsText]);
  const saveNode = useMemo(() => <span>{saveLabel}</span>, [saveLabel]);
  useStatusItem("nota-palabras", active && settings.wordCount ? statsNode : null);
  useStatusItem("nota-guardado", active ? saveNode : null);

  // Eventos de otros módulos: ir a un bloque y pegar bloques en el cursor.
  useEffect(() => {
    const onGoto = (e: Event) => {
      const d = (e as CustomEvent<{ noteId: string; blockId: string }>).detail;
      if (d?.noteId !== note.id) return;
      const el = editorRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(d.blockId)}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("uc-flash");
      window.setTimeout(() => el.classList.remove("uc-flash"), 1400);
    };
    const onInsert = (e: Event) => {
      if (!active) return;
      const d = (e as CustomEvent<{ blocks: PartialBlock[]; handled?: boolean }>).detail;
      if (!d?.blocks?.length) return;
      editor.insertBlocks(d.blocks, editor.getTextCursorPosition().block, "after");
      d.handled = true;
    };
    // La IA reescribe (o agrega al final de) la nota: se hace en el editor para que se pueda deshacer con Ctrl+Z
    // y para que el guardado automático no pise el cambio con el contenido viejo.
    const onReplace = (e: Event) => {
      const d = (e as CustomEvent<{ noteId: string; blocks: PartialBlock[]; append?: boolean; handled?: boolean }>).detail;
      if (d?.noteId !== note.id || !d.blocks?.length) return;
      const doc = editor.document;
      const last = doc[doc.length - 1];
      const onlyEmpty = doc.length === 1 && last.type === "paragraph" && Array.isArray(last.content) && last.content.length === 0;
      if (d.append && !onlyEmpty) editor.insertBlocks(d.blocks, last, "after");
      else editor.replaceBlocks(doc.map((b) => b.id), d.blocks);
      d.handled = true;
    };
    window.addEventListener("uc:goto-block", onGoto);
    window.addEventListener("uc:insert-blocks", onInsert);
    window.addEventListener("uc:note-replace", onReplace);
    return () => {
      window.removeEventListener("uc:goto-block", onGoto);
      window.removeEventListener("uc:insert-blocks", onInsert);
      window.removeEventListener("uc:note-replace", onReplace);
    };
  }, [editor, note.id, active]);

  // Clic en una etiqueta: busca todas las notas con esa etiqueta.
  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).closest?.(".uc-tag");
    const text = tag?.textContent?.trim();
    if (!text) return;
    openView({ type: "busqueda", query: `tag:${text}` }, modeFromEvent(e));
  };

  // Las imágenes se arrastran agarrándolas (ver image-drag.ts).
  useEffect(() => {
    const root = editorRef.current;
    if (!root) return;
    const onDown = (e: PointerEvent) => {
      if (startImageDrag(e, editor, root)) e.preventDefault();
    };
    root.addEventListener("pointerdown", onDown, true);
    return () => root.removeEventListener("pointerdown", onDown, true);
  }, [editor]);

  const linkCtx = { noteId: note.id, subjectId: note.subjectId, unitNumber: note.unitNumber };

  return (
    <div className="unicore-note-editor">
      {findMode && (
        <FindBar rootRef={editorRef} replace={findMode === "replace"} onClose={() => onFindClose?.()} />
      )}
      <div ref={editorRef} className="unicore-editor" onClickCapture={onClickCapture}>
        <BlockNoteView editor={editor} theme={theme} slashMenu={false}>
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) => filterSuggestionItems(slashMenuItems(editor), query)}
          />
          <SuggestionMenuController
            triggerCharacter="["
            shouldOpen={(tr) => tr.selection.from >= 1 && tr.doc.textBetween(tr.selection.from - 1, tr.selection.from) === "["}
            getItems={(query) => wikilinkMenuItems(editor, linkCtx, query)}
          />
        </BlockNoteView>
      </div>
    </div>
  );
}
