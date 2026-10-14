"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { PartialBlock } from "@blocknote/core";
import { useLiveQuery } from "dexie-react-hooks";
import {
  BookOpen,
  Bookmark,
  BookmarkCheck,
  ClipboardCheck,
  ExternalLink,
  FileUp,
  FolderInput,
  History,
  ImagePlus,
  Link,
  Merge,
  Mic,
  MoreHorizontal,
  Network,
  Pencil,
  PanelRight,
  Presentation,
  Replace,
  Scissors,
  Search,
  Sparkles,
  Square,
  Trash2,
  type LucideIcon, ListPlus } from "lucide-react";
import { ConfirmDialog } from "@/components/notes/confirm-dialog";
import { FlashcardsReviewModal } from "@/components/flashcards/flashcards-review-modal";
import { HistoryModal } from "@/components/notes/history-modal";
import { ListPicker, type PickItem } from "@/components/notes/list-picker";
import { NoteEditor } from "@/components/notes/note-editor";
import type { NoteBlockEditor } from "@/components/notes/note-schema";
import { NoteProperties } from "@/components/notes/note-properties";
import { NoteTasks } from "@/components/tasks/note-tasks";
import { quizFromNote } from "@/lib/quiz/quiz-store";
import { taskFromNote } from "@/lib/tasks/class-tasks";
import { MIN_CHARS_FOR_AI, createNote } from "@/components/notes/note-utils";
import { PromptModal } from "@/components/ui/prompt-modal";
import { useContextMenu, type MenuItem } from "@/components/ui/menu";
import { exportMenuItem } from "@/components/export/export-menu";
import { useOpen } from "@/components/workspace/use-open";
import { useAppState } from "@/lib/app-state";
import { generateFlashcards, type FlashcardDraft } from "@/lib/ai/prompts";
import { useLocalAI } from "@/lib/ai/use-local-ai";
import { db, newId, nowIso, saveFile } from "@/lib/db";
import { savePdfDocument } from "@/lib/pdf/save-document";
import { plainTextOf, type BlockLike } from "@/lib/notes/index-note";
import { combineNotes, deleteNote, moveNote, noteLocationLabel, saveNoteContent, snapshotNote } from "@/lib/notes/note-ops";
import { useRegisterCommands, useStatusItem, useWorkspace, type Command, type ViewState } from "@/lib/workspace";
import {
  DAILY_FOLDER,
  LOOSE_FOLDER,
  TEMPLATES_FOLDER,
  type Degree,
  type Note,
  type NoteSnapshot,
  type Subject,
} from "@/lib/types";

// Lista vacía estable: evita que los hooks que dependen de la lista se recalculen en cada render.
const NO_ITEMS: never[] = [];

type CmdAct = { id: string; name: string; hotkey?: string; icon?: LucideIcon; run: () => void; danger?: boolean };
type Act = CmdAct | { sep: true };

function prettyKey(hotkey?: string) {
  return hotkey?.replace("Mod", "Ctrl").replace(/\+/g, " + ");
}

type NoteBlock = NoteBlockEditor["document"][number];

// Quita los ids de bloques para que una copia (nota nueva) reciba ids propios.
function stripIds(blocks: NoteBlock[]): PartialBlock[] {
  return blocks.map((b) => {
    const { id, children, ...rest } = b;
    void id;
    return { ...rest, children: stripIds(children as NoteBlock[]) } as PartialBlock;
  });
}

// Título de la nota: input sin borde, se guarda al escribir. Enter pasa al editor.
function TitleField({ noteId, title, onEnter }: { noteId: string; title: string; onEnter: () => void }) {
  const [value, setValue] = useState(title);
  const ref = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingTitle = useRef<string | null>(null);

  useEffect(() => {
    if (document.activeElement !== ref.current) setValue(title);
  }, [title]);

  // Nota recién creada: el título queda seleccionado para escribir encima (como en Obsidian).
  useEffect(() => {
    if (title === "Sin título" || title === "") {
      ref.current?.focus();
      ref.current?.select();
    }
    // Sólo al abrir la nota.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  // Escribe el título con una pausa corta, para no re-renderizar el editor en cada tecla.
  useEffect(() => {
    return () => {
      clearTimeout(timer.current);
      const v = pendingTitle.current;
      pendingTitle.current = null;
      if (v !== null) void db.notes.update(noteId, { title: v, updatedAt: nowIso() });
    };
  }, [noteId]);

  const schedule = (v: string) => {
    pendingTitle.current = v;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const latest = pendingTitle.current;
      pendingTitle.current = null;
      if (latest !== null) void db.notes.update(noteId, { title: latest, updatedAt: nowIso() });
    }, 300);
  };

  return (
    <input
      ref={ref}
      aria-label="Título de la nota"
      className="w-full bg-transparent text-[28px] font-semibold leading-tight text-text outline-none placeholder:text-faint"
      placeholder="Sin título"
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        schedule(e.target.value);
      }}
      onBlur={() => {
        if (!value.trim()) {
          setValue("Sin título");
          schedule("Sin título");
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onEnter();
        }
      }}
    />
  );
}

// Vista de una nota: barra de herramientas, título, propiedades, editor y comandos.
export function NotaView({ id }: { id: string }) {
  const note = useLiveQuery(async () => (await db.notes.get(id)) ?? null, [id]);
  const subjects: Subject[] = useLiveQuery(() => db.subjects.toArray(), []) ?? NO_ITEMS;
  const degrees: Degree[] = useLiveQuery(() => db.degrees.toArray(), []) ?? NO_ITEMS;
  const allNotes: Note[] = useLiveQuery(() => db.notes.toArray(), []) ?? NO_ITEMS;
  const bookmark = useLiveQuery(
    async () => (await db.bookmarks.where("targetId").equals(id).toArray()).find((b) => b.kind === "note"),
    [id],
  );

  const { activeView, activePane, activeTab, openView, closeTab } = useWorkspace();
  const open = useOpen();
  const { setCurrentSubjectId, openTaskDialog } = useAppState();
  const ai = useLocalAI();
  const menu = useContextMenu();

  const [editor, setEditor] = useState<NoteBlockEditor | null>(null);
  const [reading, setReading] = useState(false);
  const [findMode, setFindMode] = useState<"find" | "replace" | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [picker, setPicker] = useState<"combinar" | "mover" | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<FlashcardDraft[] | null>(null);
  const [recording, setRecording] = useState(false);

  const photoInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const mounted = useRef(true);
  const pendingExtract = useRef<NoteBlock[] | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recorderRef.current?.stop();
    };
  }, []);

  const view: ViewState = { type: "nota", id };
  const isActive = activeView.type === "nota" && activeView.id === id;
  const subject = note ? subjects.find((s) => s.id === note.subjectId) : undefined;
  const degree = subject ? degrees.find((d) => d.id === subject.degreeId) : undefined;
  const special = note ? noteLocationLabel(note) : "";
  const subjectForAI = subject?.id;

  // La materia de la nota es el contexto de la IA mientras la nota está en primer plano.
  useEffect(() => {
    if (!isActive) return;
    setCurrentSubjectId(subjectForAI);
  }, [isActive, subjectForAI, setCurrentSubjectId]);

  const insertAtCursor = (blocks: PartialBlock[]) => {
    if (!editor) return;
    editor.insertBlocks(blocks, editor.getTextCursorPosition().block, "after");
  };

  const appendBlocks = (blocks: PartialBlock[]) => {
    if (!editor) return;
    const doc = editor.document;
    const last = doc[doc.length - 1];
    if (!last) return;
    const onlyEmpty = doc.length === 1 && last.type === "paragraph" && Array.isArray(last.content) && last.content.length === 0;
    if (onlyEmpty) editor.replaceBlocks([last], blocks);
    else editor.insertBlocks(blocks, last, "after");
  };

  // ----- foto, PDF, audio -----

  const addPhoto = async (file: File) => {
    try {
      const url = await saveFile(file);
      insertAtCursor([{ type: "image", props: { url } }]);
    } catch {
      setNotice("No pudimos guardar la foto. Probá con otra imagen.");
    }
  };

  const importPdf = async (file: File) => {
    setBusy("Leyendo PDF…");
    try {
      const { extractPdf, pdfToBlocks } = await import("@/lib/pdf/import-pdf");
      const extraction = await extractPdf(file, (p) =>
        setBusy(p.stage === "ocr" ? `Reconociendo texto de la página ${p.page} de ${p.total}…` : `Leyendo página ${p.page} de ${p.total}…`),
      );
      const blocks = pdfToBlocks(extraction) as PartialBlock[];
      if (!blocks.length) {
        setNotice("No encontramos texto en el PDF.");
        return;
      }
      // Sólo las materias tienen bibliografía; en carpetas el texto queda sólo en la nota.
      if (subject && note) await savePdfDocument(file, extraction, note.subjectId);
      appendBlocks(blocks);
      setNotice(`Importamos "${extraction.fileName}" al final de la nota.`);
    } catch {
      setNotice("No pudimos leer el PDF. Probá con otro archivo.");
    } finally {
      setBusy(null);
    }
  };

  const toggleRecording = async () => {
    const current = recorderRef.current;
    if (current) {
      current.stop();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setNotice("No pudimos usar el micrófono. Revisá los permisos.");
      return;
    }
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
      setRecording(false);
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      void saveFile(blob, `Grabación ${new Date().toISOString()}.webm`)
        .then((url) => {
          if (mounted.current) insertAtCursor([{ type: "audio", props: { url } }]);
        })
        .catch(() => setNotice("No pudimos guardar la grabación. Probá de nuevo."));
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
  };

  // ----- IA -----

  const runAI = async (kind: "cards" | "quiz") => {
    const text = plainTextOf((editor?.document ?? []) as BlockLike[]);
    if (text.trim().length < MIN_CHARS_FOR_AI) {
      setNotice(kind === "cards" ? "Escribí un poco más en la nota para generar tarjetas." : "Escribí un poco más en la nota para tomar un examen.");
      return;
    }
    setNotice(undefined);
    setBusy(kind === "cards" ? "Generando flashcards…" : "Armando el examen…");
    try {
      if (kind === "cards") {
        const result = await generateFlashcards(ai, text);
        if (result.length) setDrafts(result);
        else setNotice("No pudimos sacar tarjetas de esta nota. Probá agregar más texto.");
      } else {
        // Se guarda en la materia como página, enlazado a esta clase o nota.
        const current = await db.notes.get(id);
        if (!current) return;
        const quizId = await quizFromNote(ai, { ...current, plainTextCache: text });
        openView({ type: "nota", id: quizId }, "tab");
      }
    } catch {
      setNotice("No pudimos usar la IA para esta nota. Probá de nuevo.");
    } finally {
      setBusy(null);
    }
  };

  // ----- acciones de nota -----

  const toggleBookmark = async () => {
    if (!note) return;
    if (bookmark) {
      await db.bookmarks.delete(bookmark.id);
      return;
    }
    const count = await db.bookmarks.count();
    await db.bookmarks.add({ id: newId(), kind: "note", targetId: id, title: note.title, order: count + 1, createdAt: nowIso() });
  };

  const restore = async (snap: NoteSnapshot) => {
    if (!editor || !note) return;
    const current = editor.document;
    await snapshotNote({ id, title: note.title, content: current, plainTextCache: plainTextOf(current as BlockLike[]) }, true);
    const blocks = snap.content as PartialBlock[];
    editor.replaceBlocks(
      current.map((b) => b.id),
      blocks.length ? blocks : [{ type: "paragraph", content: "" }],
    );
    await db.notes.update(id, { title: snap.title, updatedAt: nowIso() });
    setHistoryOpen(false);
    setNotice("Versión restaurada.");
  };

  const combineWith = async (target: PickItem) => {
    setPicker(null);
    if (!editor) return;
    // Guardamos lo que está escrito antes de mover el contenido.
    await saveNoteContent(id, editor.document);
    await combineNotes(id, target.id);
    openView({ type: "nota", id: target.id });
  };

  const moveTo = async (target: PickItem) => {
    setPicker(null);
    await moveNote(id, target.id);
    setNotice("Nota movida.");
  };

  const startExtract = () => {
    if (!editor) return;
    const sel = editor.getSelection();
    pendingExtract.current = sel?.blocks?.length ? sel.blocks : [editor.getTextCursorPosition().block];
    setExtracting(true);
  };

  const confirmExtract = async (title: string) => {
    const blocks = pendingExtract.current;
    pendingExtract.current = null;
    if (!editor || !note || !blocks?.length) return;
    const name = title.trim() || "Sin título";
    const newNoteId = await createNote({
      subjectId: note.subjectId,
      title: name,
      unitNumber: note.unitNumber,
      content: stripIds(blocks),
    });
    editor.replaceBlocks(blocks.map((b) => b.id), [
      { type: "paragraph", content: [{ type: "wikilink", props: { noteId: newNoteId, title: name, alias: "" } }] },
    ]);
    setNotice(`Creamos la nota «${name}».`);
  };

  const copyLink = () => {
    if (!note) return;
    void navigator.clipboard?.writeText(`[[${note.title}]]`).then(() => setNotice("Enlace copiado."));
  };

  const remove = async () => {
    setConfirmDelete(false);
    await deleteNote(id);
    closeTab(activePane.id, activeTab.id);
  };

  // ----- comandos y menú "…" -----

  const cid = (k: string) => `nota-${id}:${k}`;
  const actions: Act[] = note
    ? [
        { id: cid("editar"), name: reading ? "Editar nota" : "Modo lectura", hotkey: "Mod+E", icon: reading ? Pencil : BookOpen, run: () => setReading((v) => !v) },
        { id: cid("buscar"), name: "Buscar en la nota", hotkey: "Mod+F", icon: Search, run: () => setFindMode("find") },
        { id: cid("reemplazar"), name: "Reemplazar en la nota", hotkey: "Mod+H", icon: Replace, run: () => setFindMode("replace") },
        { id: cid("historial"), name: "Historial de versiones", hotkey: "Mod+Shift+H", icon: History, run: () => setHistoryOpen(true) },
        { sep: true },
        { id: cid("foto"), name: "Agregar foto", icon: ImagePlus, run: () => photoInput.current?.click() },
        { id: cid("pdf"), name: "Importar PDF", icon: FileUp, run: () => pdfInput.current?.click() },
        { id: cid("audio"), name: recording ? "Detener grabación" : "Grabar audio", icon: recording ? Square : Mic, run: () => void toggleRecording() },
        { id: cid("flashcards"), name: "Generar flashcards", icon: Sparkles, run: () => void runAI("cards") },
        { id: cid("tarea"), name: "Crear tarea desde esta nota", icon: ListPlus, run: () => void taskFromNote(note).then(openTaskDialog) },
        { id: cid("examen"), name: "Cuestionario de esta nota", icon: ClipboardCheck, run: () => void runAI("quiz") },
        { sep: true },
        { id: cid("presentacion"), name: "Presentación", icon: Presentation, run: () => openView({ type: "slides", id }) },
        { id: cid("grafo"), name: "Grafo local", icon: Network, run: () => openView({ type: "grafo", noteId: id }, "split") },
        { id: cid("combinar"), name: "Combinar con otra nota…", icon: Merge, run: () => setPicker("combinar") },
        { id: cid("extraer"), name: "Extraer selección a nota nueva", icon: Scissors, run: startExtract },
        { id: cid("copiar"), name: "Copiar enlace [[Título]]", icon: Link, run: copyLink },
        { id: cid("pestana"), name: "Abrir en pestaña nueva", icon: ExternalLink, run: () => openView(view, "tab") },
        { id: cid("derecha"), name: "Abrir a la derecha", icon: PanelRight, run: () => openView(view, "split") },
        { id: cid("mover"), name: "Mover a…", icon: FolderInput, run: () => setPicker("mover") },
        { sep: true },
        { id: cid("eliminar"), name: "Eliminar nota", icon: Trash2, danger: true, run: () => setConfirmDelete(true) },
      ]
    : [];

  const commands: Command[] = isActive
    ? actions.flatMap((a) => ("sep" in a ? [] : [{ id: a.id, name: a.name, hotkey: a.hotkey, icon: a.icon, run: a.run }]))
    : [];
  useRegisterCommands("nota-" + id, commands);

  const menuItems: MenuItem[] = actions.map((a) =>
    "sep" in a ? { type: "separator" } : { label: a.name, icon: a.icon, hint: prettyKey(a.hotkey), danger: a.danger, onSelect: a.run },
  );
  // "Exportar" va antes del último separador (el de Eliminar).
  menuItems.splice(Math.max(0, menuItems.length - 2), 0, exportMenuItem({ kind: "note", id }));

  const saveTitleFromBar = () => editor?.focus();

  // Barra de estado: grabación en curso.
  const recNode = useMemo(() => <span>Grabando…</span>, []);
  useStatusItem("nota-grabando", recording ? recNode : null);

  const moveItems: PickItem[] = useMemo(
    () => [
      { id: DAILY_FOLDER, label: "Diario", group: "Carpetas" },
      { id: LOOSE_FOLDER, label: "Notas", group: "Carpetas" },
      { id: TEMPLATES_FOLDER, label: "Plantillas", group: "Carpetas" },
      ...subjects.map((s) => ({
        id: s.id,
        label: s.name,
        group: degrees.find((d) => d.id === s.degreeId)?.name ?? "Materias",
      })),
    ].filter((i) => i.id !== note?.subjectId),
    [subjects, degrees, note?.subjectId],
  );

  const combineItems: PickItem[] = useMemo(
    () =>
      allNotes
        .filter((n) => n.id !== id)
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((n) => ({
          id: n.id,
          label: n.title || "Sin título",
          hint: subjects.find((s) => s.id === n.subjectId)?.name ?? noteLocationLabel(n),
        })),
    [allNotes, subjects, id],
  );

  // ----- render -----

  if (note === undefined) return <div className="p-6 t-small text-faint">Cargando…</div>;
  if (note === null) return <div className="p-6 t-small text-faint">Esta nota ya no existe.</div>;

  const crumbs = special ? (
    <span>{special}</span>
  ) : subject ? (
    <>
      {degree && <span>{degree.shortName}</span>}
      {degree && <span className="text-faint">/</span>}
      <button type="button" className="truncate hover:text-text" onClick={(e) => open({ type: "materia", id: subject.id }, e)}>
        {subject.name}
      </button>
    </>
  ) : (
    <span>Sin materia</span>
  );

  return (
    <div className="flex min-h-full flex-col">
      <div
        className="sticky top-0 z-10 flex h-9 flex-none items-center gap-1 border-b border-border bg-surface px-3"
        onContextMenu={(e) => menu.open(e, menuItems)}
      >
        <div className="t-small mr-auto flex min-w-0 items-center gap-1.5 truncate text-muted">{crumbs}</div>
        <button type="button" className="icon-btn" aria-pressed={!!bookmark} aria-label="Marcador" onClick={() => void toggleBookmark()}>
          {bookmark ? <BookmarkCheck /> : <Bookmark />}
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-pressed={reading}
          aria-label={reading ? "Volver a editar" : "Modo lectura"}
          onClick={() => setReading((v) => !v)}
        >
          {reading ? <Pencil /> : <BookOpen />}
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Más opciones"
          onClick={(e) => menu.open(e, menuItems)}
        >
          <MoreHorizontal />
        </button>
        {menu.menu}
      </div>

      <div className="view-readable w-full">
        <div className="group flex flex-col gap-4">
          <TitleField key={id} noteId={id} title={note.title} onEnter={saveTitleFromBar} />
          <NoteProperties note={note} />
          <NoteTasks note={note} />
        </div>

        {(notice || busy) && (
          <div className="mt-3 flex flex-col gap-2">
            {notice && <p className="t-small text-muted">{notice}</p>}
            {busy && (
              <>
                <p className="t-small text-muted">{ai.status === "loading" && ai.progressText ? ai.progressText : busy}</p>
                {ai.status === "loading" && (
                  <div className="progress">
                    <i style={{ width: `${Math.round(ai.progress * 100)}%` }} />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="mt-6">
          <NoteEditor
            key={id}
            note={note}
            active={isActive}
            editable={!reading}
            findMode={findMode}
            onFindClose={() => setFindMode(null)}
            onEditor={setEditor}
          />
        </div>
      </div>

      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void addPhoto(file);
        }}
      />
      <input
        ref={pdfInput}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void importPdf(file);
        }}
      />

      {historyOpen && <HistoryModal noteId={id} onClose={() => setHistoryOpen(false)} onRestore={(s) => void restore(s)} />}

      <ListPicker
        open={picker === "combinar"}
        title="Combinar con otra nota"
        placeholder="Buscar nota"
        items={combineItems}
        onPick={(item) => void combineWith(item)}
        onClose={() => setPicker(null)}
      />
      <ListPicker
        open={picker === "mover"}
        title="Mover a"
        placeholder="Buscar materia o carpeta"
        items={moveItems}
        onPick={(item) => void moveTo(item)}
        onClose={() => setPicker(null)}
      />

      <PromptModal
        open={extracting}
        title="Nombre de la nota nueva"
        placeholder="Nombre"
        confirmLabel="Crear nota"
        onConfirm={(name) => void confirmExtract(name)}
        onClose={() => {
          setExtracting(false);
          pendingExtract.current = null;
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Eliminar nota"
        text="La nota y sus versiones se borran. No se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={() => void remove()}
        onClose={() => setConfirmDelete(false)}
      />

      {drafts && (
        <FlashcardsReviewModal
          drafts={drafts}
          subjectId={note.subjectId}
          noteId={id}
          onClose={() => setDrafts(null)}
          onSaved={(count) => {
            setDrafts(null);
            setNotice(count === 1 ? "Se guardó 1 tarjeta." : `Se guardaron ${count} tarjetas.`);
          }}
        />
      )}
    </div>
  );
}
