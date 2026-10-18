"use client";

// Ideas al estilo Google Keep: tarjetas de colores en mosaico, fijadas arriba, listas con casillas
// que se tildan desde la tarjeta, y al abrir una idea se ve y se edita completa en grande.
// Cada idea es una nota de la carpeta "Ideas" (propiedades: color, fijada, archivada), así
// también aparece en la búsqueda, el grafo y la IA.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Archive,
  ArchiveRestore,
  CheckSquare,
  ListPlus,
  Maximize2,
  Palette,
  Pin,
  PinOff,
  Search,
  Lightbulb,
  Trash2,
  X,
} from "lucide-react";
import { db, nowIso, resolveFileUrl } from "@/lib/db";
import { createNote } from "@/components/notes/note-utils";
import { useContextMenu, type MenuItem } from "@/components/ui/menu";
import { useOpen } from "@/components/workspace/use-open";
import { useAppState } from "@/lib/app-state";
import { deleteNote } from "@/lib/nav/actions";
import { saveNoteContent } from "@/lib/notes/note-ops";
import { markdownToBlocks } from "@/lib/notes/md-blocks";
import { deleteWithUndo, toast } from "@/lib/undo";
import { IDEAS_FOLDER, type Note } from "@/lib/types";
import { PromptModal } from "@/components/ui/prompt-modal";
import { folderName, renameFolder, useFolderNames } from "@/lib/folder-names";

const NoteEditor = dynamic(() => import("@/components/notes/note-editor").then((m) => m.NoteEditor), { ssr: false });

// Colores translúcidos: se ven bien en tema claro y oscuro.
export const IDEA_COLORS = [
  { key: "", label: "Sin color", bg: "transparent", border: "var(--border)" },
  { key: "rojo", label: "Rojo", bg: "rgba(244, 63, 94, 0.16)", border: "rgba(244, 63, 94, 0.38)" },
  { key: "naranja", label: "Naranja", bg: "rgba(249, 115, 22, 0.16)", border: "rgba(249, 115, 22, 0.38)" },
  { key: "amarillo", label: "Amarillo", bg: "rgba(234, 179, 8, 0.17)", border: "rgba(234, 179, 8, 0.4)" },
  { key: "verde", label: "Verde", bg: "rgba(34, 197, 94, 0.15)", border: "rgba(34, 197, 94, 0.36)" },
  { key: "turquesa", label: "Turquesa", bg: "rgba(20, 184, 166, 0.15)", border: "rgba(20, 184, 166, 0.36)" },
  { key: "celeste", label: "Celeste", bg: "rgba(56, 189, 248, 0.15)", border: "rgba(56, 189, 248, 0.38)" },
  { key: "violeta", label: "Violeta", bg: "rgba(139, 92, 246, 0.17)", border: "rgba(139, 92, 246, 0.4)" },
  { key: "rosa", label: "Rosa", bg: "rgba(236, 72, 153, 0.15)", border: "rgba(236, 72, 153, 0.36)" },
  { key: "gris", label: "Gris", bg: "rgba(148, 163, 184, 0.15)", border: "rgba(148, 163, 184, 0.36)" },
] as const;

const colorOf = (n: Note) => IDEA_COLORS.find((c) => c.key === (n.properties?.color ?? "")) ?? IDEA_COLORS[0];
const isPinned = (n: Note) => n.properties?.fijada === true;
const isArchived = (n: Note) => n.properties?.archivada === true;

function setProps(n: Note, patch: Record<string, string | boolean>) {
  return db.notes.update(n.id, { properties: { ...(n.properties ?? {}), ...patch }, updatedAt: nowIso() });
}

export async function addIdea(title: string, opts: { body?: string; checklist?: boolean; color?: string } = {}): Promise<string> {
  const body = opts.body ?? "";
  const content = opts.checklist
    ? body
        .split("\n")
        .map((l) => l.replace(/^\s*[-*•]?\s*(\[[ xX]\])?\s*/, "").trim())
        .filter(Boolean)
        .map((t) => ({ type: "checkListItem", props: { checked: false }, content: t }))
    : markdownToBlocks(body);
  const id = await createNote({ subjectId: IDEAS_FOLDER, title: title || "Sin título", unitNumber: 1, content });
  await db.notes.update(id, { properties: { color: opts.color ?? "", fijada: false, archivada: false } });
  return id;
}

// ---------- Vista previa de los bloques en la tarjeta ----------

type Block = { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: Block[] };

function inlineText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((n) => {
      const o = n as Record<string, unknown>;
      if (o.type === "text") return String(o.text ?? "");
      if (o.type === "link") return inlineText(o.content);
      const p = (o.props ?? {}) as Record<string, unknown>;
      return String(p.alias || p.title || "");
    })
    .join("");
}

function IdbImage({ url, className }: { url: string; className?: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let alive = true;
    resolveFileUrl(url).then((u) => alive && setSrc(u));
    return () => {
      alive = false;
    };
  }, [url]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" className={className} draggable={false} /> : null;
}

function Preview({ note, maxBlocks = 12 }: { note: Note; maxBlocks?: number }) {
  const blocks = (Array.isArray(note.content) ? note.content : []) as Block[];
  const image = blocks.find((b) => b.type === "image" && typeof b.props?.url === "string");
  const rest = blocks.filter((b) => b !== image);
  const shown = rest.slice(0, maxBlocks);

  async function toggle(e: React.MouseEvent, index: number) {
    e.stopPropagation();
    const target = shown[index];
    const next = blocks.map((b) => (b === target ? { ...b, props: { ...(b.props ?? {}), checked: !b.props?.checked } } : b));
    await saveNoteContent(note.id, next);
  }

  return (
    <>
      {image && <IdbImage url={String(image.props!.url)} className="-mx-3 -mt-3 mb-2 block max-h-56 w-[calc(100%+1.5rem)] max-w-none rounded-t-[9px] object-cover" />}
      <div className="space-y-1 text-[length:calc(13px*var(--ui-scale,1))] leading-5 text-text/90">
        {shown.map((b, i) => {
          const t = inlineText(b.content);
          if (b.type === "checkListItem")
            return (
              <div key={i} className="flex items-start gap-2">
                <span
                  role="checkbox"
                  aria-checked={!!b.props?.checked}
                  onClick={(e) => void toggle(e, i)}
                  className={clsx(
                    "mt-[3px] flex h-3.5 w-3.5 flex-none items-center justify-center rounded-[3px] border",
                    b.props?.checked ? "border-primary bg-primary text-white" : "border-border-strong hover:border-primary",
                  )}
                >
                  {!!b.props?.checked && <span className="text-[length:calc(10px*var(--ui-scale,1))] leading-none">✓</span>}
                </span>
                <span className={clsx("min-w-0 break-words", !!b.props?.checked && "text-faint line-through")}>{t}</span>
              </div>
            );
          if (!t.trim()) return null;
          if (b.type === "heading") return <p key={i} className="font-semibold">{t}</p>;
          if (b.type === "bulletListItem" || b.type === "numberedListItem")
            return (
              <p key={i} className="break-words pl-3 -indent-3">
                • {t}
              </p>
            );
          return (
            <p key={i} className="whitespace-pre-wrap break-words">
              {t}
            </p>
          );
        })}
        {rest.length > maxBlocks && <p className="text-faint">…</p>}
      </div>
    </>
  );
}

// ---------- Paleta de colores ----------

function ColorPicker({ value, onPick }: { value: string; onPick: (key: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 p-1">
      {IDEA_COLORS.map((c) => (
        <button
          key={c.key || "none"}
          type="button"
          title={c.label}
          aria-label={c.label}
          onClick={(e) => {
            e.stopPropagation();
            onPick(c.key);
          }}
          className={clsx("h-6 w-6 rounded-full border-2", value === c.key ? "border-primary" : "border-border")}
          style={{ background: c.key ? c.border : "var(--surface)" }}
        />
      ))}
    </div>
  );
}

// ---------- Captura rápida (como "Crear una nota…" de Keep) ----------

function Capture() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [checklist, setChecklist] = useState(false);
  const [color, setColor] = useState("");
  const [palette, setPalette] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const c = IDEA_COLORS.find((x) => x.key === color) ?? IDEA_COLORS[0];

  const save = async () => {
    const t = title.trim();
    const b = body.trim();
    if (t || b) await addIdea(t || b.split("\n")[0].slice(0, 60), { body: t ? b : b.split("\n").slice(1).join("\n"), checklist, color });
    setTitle("");
    setBody("");
    setChecklist(false);
    setColor("");
    setPalette(false);
    setOpen(false);
  };

  // Clic afuera guarda y cierra.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) void save();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  });

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [body, open]);

  return (
    <div
      ref={ref}
      className="mx-auto w-full max-w-[600px] rounded-lg border shadow-pop transition-colors"
      style={{ background: c.key ? c.bg : "var(--surface-raised)", borderColor: c.border }}
    >
      {!open ? (
        <div className="flex items-center gap-2 px-4 py-3">
          <button type="button" className="flex-1 text-left text-[length:calc(14px*var(--ui-scale,1))] text-faint" onClick={() => setOpen(true)}>
            Anotá una idea…
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Nueva lista"
            aria-label="Nueva lista"
            onClick={() => {
              setChecklist(true);
              setOpen(true);
            }}
          >
            <CheckSquare strokeWidth={1.75} />
          </button>
        </div>
      ) : (
        <div className="space-y-1 px-4 pb-2 pt-3">
          <input
            autoFocus={!checklist}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && bodyRef.current?.focus()}
            placeholder="Título"
            className="w-full bg-transparent text-[length:calc(15px*var(--ui-scale,1))] font-medium text-text outline-none placeholder:text-faint"
          />
          <textarea
            ref={bodyRef}
            autoFocus={checklist}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void save();
              if (e.key === "Escape") void save();
            }}
            rows={2}
            placeholder={checklist ? "Un elemento por renglón" : "Anotá una idea… (Markdown: **negrita**, - listas, # títulos)"}
            className="w-full resize-none bg-transparent text-[length:calc(14px*var(--ui-scale,1))] leading-6 text-text outline-none placeholder:text-faint"
          />
          <div className="flex items-center gap-1">
            <button type="button" className="icon-btn" title="Color" aria-label="Color" onClick={() => setPalette((p) => !p)}>
              <Palette strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className={clsx("icon-btn", checklist && "text-primary-soft")}
              title={checklist ? "Pasar a texto" : "Pasar a lista con casillas"}
              aria-pressed={checklist}
              onClick={() => setChecklist((v) => !v)}
            >
              <CheckSquare strokeWidth={1.75} />
            </button>
            <span className="ml-auto text-[length:calc(11px*var(--ui-scale,1))] text-faint">Ctrl+Enter para guardar</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void save()}>
              Cerrar
            </button>
          </div>
          {palette && <ColorPicker value={color} onPick={setColor} />}
        </div>
      )}
    </div>
  );
}

// ---------- Detalle (la idea abierta en grande) ----------

function Detail({ note, onClose, actions }: { note: Note; onClose: () => void; actions: (n: Note) => MenuItem[] }) {
  const c = colorOf(note);
  const [title, setTitle] = useState(note.title);
  const [palette, setPalette] = useState(false);
  const open = useOpen();
  const menu = useContextMenu();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc cierra salvo que haya un menú del editor abierto.
      if (e.key === "Escape" && !document.querySelector(".bn-suggestion-menu, [role='menu']")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const saveTitle = () => {
    const t = title.trim() || "Sin título";
    if (t !== note.title) void db.notes.update(note.id, { title: t, updatedAt: nowIso() });
  };

  const edited = new Date(note.updatedAt).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onMouseDown={(e) => e.target === e.currentTarget && (saveTitle(), onClose())}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={note.title}
        className="flex max-h-[88vh] w-full max-w-[760px] flex-col overflow-hidden rounded-xl border shadow-pop"
        style={{ background: `linear-gradient(${c.bg}, ${c.bg}), var(--surface)`, borderColor: c.border }}
      >
        <div className="flex items-start gap-2 px-6 pt-5">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur(), saveTitle())}
            className="min-w-0 flex-1 bg-transparent text-[22px] font-semibold leading-8 text-text outline-none"
            aria-label="Título de la idea"
          />
          <button
            type="button"
            className="icon-btn mt-1"
            title={isPinned(note) ? "Dejar de fijar" : "Fijar arriba"}
            onClick={() => void setProps(note, { fijada: !isPinned(note) })}
          >
            {isPinned(note) ? <PinOff strokeWidth={1.75} /> : <Pin strokeWidth={1.75} />}
          </button>
          <button
            type="button"
            className="icon-btn mt-1"
            title="Abrir como nota en una pestaña"
            onClick={() => {
              saveTitle();
              onClose();
              open({ type: "nota", id: note.id }, { ctrlKey: true });
            }}
          >
            <Maximize2 strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-btn mt-1" title="Cerrar (Esc)" aria-label="Cerrar" onClick={() => (saveTitle(), onClose())}>
            <X strokeWidth={1.75} />
          </button>
        </div>

        <div className="uc-idea-editor min-h-[200px] flex-1 overflow-y-auto px-2 pb-4">
          <NoteEditor key={note.id} note={note} active />
        </div>

        {palette && (
          <div className="border-t px-5 py-2" style={{ borderColor: c.border }}>
            <ColorPicker value={c.key} onPick={(k) => void setProps(note, { color: k })} />
          </div>
        )}
        <div className="flex items-center gap-1 border-t px-4 py-2" style={{ borderColor: c.border }}>
          <button type="button" className="icon-btn" title="Color" aria-label="Color" onClick={() => setPalette((p) => !p)}>
            <Palette strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={isArchived(note) ? "Sacar del archivo" : "Archivar"}
            onClick={() => {
              void setProps(note, { archivada: !isArchived(note) });
              onClose();
            }}
          >
            {isArchived(note) ? <ArchiveRestore strokeWidth={1.75} /> : <Archive strokeWidth={1.75} />}
          </button>
          <button type="button" className="icon-btn" title="Más opciones" onClick={(e) => menu.open(e, actions(note))}>
            <ListPlus strokeWidth={1.75} />
          </button>
          <span className="ml-auto text-[length:calc(12px*var(--ui-scale,1))] text-faint">Editada {edited}</span>
        </div>
      </div>
      {menu.menu}
    </div>,
    document.body,
  );
}

// ---------- Vista ----------

export function IdeasView() {
  const ideas = useLiveQuery(() => db.notes.where("subjectId").equals(IDEAS_FOLDER).toArray(), []);
  const subjects = useLiveQuery(() => db.subjects.toArray(), []) ?? [];
  const { openTaskDialog } = useAppState();
  const menu = useContextMenu();
  const [filter, setFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [renaming, setRenaming] = useState(false);
  useFolderNames();
  const ideasName = folderName(IDEAS_FOLDER) ?? "Ideas";
  const [openId, setOpenId] = useState<string | null>(null);
  const [paletteFor, setPaletteFor] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (ideas ?? [])
      .filter((n) => isArchived(n) === showArchived)
      .filter((n) => !q || `${n.title} ${n.plainTextCache} ${(n.tags ?? []).join(" ")}`.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [ideas, filter, showArchived]);
  const pinned = visible.filter(isPinned);
  const others = visible.filter((n) => !isPinned(n));
  const opened = ideas?.find((n) => n.id === openId);

  const remove = (n: Note) => {
    if (openId === n.id) setOpenId(null);
    void deleteWithUndo(`Se eliminó «${n.title}»`, () => deleteNote(n.id));
  };

  const actions = (n: Note): MenuItem[] => [
    {
      label: "Convertir en tarea",
      icon: ListPlus,
      onSelect: () => {
        setOpenId(null);
        openTaskDialog({ title: n.title, description: n.plainTextCache.slice(0, 1000) || undefined, type: "TAREA" });
      },
    },
    ...subjects
      .filter((s) => s.status === "CURSANDO")
      .slice(0, 8)
      .map(
        (s): MenuItem => ({
          label: `Pasar a apuntes de ${s.name}`,
          onSelect: async () => {
            setOpenId(null);
            await db.notes.update(n.id, { subjectId: s.id, updatedAt: nowIso() });
            toast(`«${n.title}» ahora está en ${s.name}`);
          },
        }),
      ),
    { type: "separator" },
    { label: isPinned(n) ? "Dejar de fijar" : "Fijar arriba", icon: Pin, onSelect: () => void setProps(n, { fijada: !isPinned(n) }) },
    { label: isArchived(n) ? "Sacar del archivo" : "Archivar", icon: Archive, onSelect: () => void setProps(n, { archivada: !isArchived(n) }) },
    { label: "Eliminar", icon: Trash2, danger: true, onSelect: () => remove(n) },
  ];

  const card = (n: Note) => {
    const c = colorOf(n);
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpenId(n.id)}
        onKeyDown={(e) => e.key === "Enter" && setOpenId(n.id)}
        onContextMenu={(e) => menu.open(e, actions(n))}
        key={n.id}
        className="group relative mb-3 break-inside-avoid cursor-default overflow-hidden rounded-[10px] border p-3 transition-shadow hover:shadow-pop"
        style={{ background: c.key ? c.bg : "var(--surface)", borderColor: c.border }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void setProps(n, { fijada: !isPinned(n) });
          }}
          title={isPinned(n) ? "Dejar de fijar" : "Fijar arriba"}
          className={clsx(
            "absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-full text-faint hover:bg-surface-raised hover:text-text",
            isPinned(n) ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <Pin className="h-4 w-4" strokeWidth={1.75} fill={isPinned(n) ? "currentColor" : "none"} />
        </button>
        {n.title && n.title !== "Sin título" && <p className="mb-1 pr-7 text-[length:calc(14px*var(--ui-scale,1))] font-semibold leading-5 text-text">{n.title}</p>}
        <Preview note={n} />
        {(n.tags?.length ?? 0) > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {n.tags!.slice(0, 5).map((t) => (
              <span key={t} className="tag">
                #{t}
              </span>
            ))}
          </div>
        )}
        {/* Barra de acciones al pasar el mouse, como en Keep */}
        <div className="-mb-1 mt-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="icon-btn" title="Color" aria-label="Color" onClick={() => setPaletteFor((p) => (p === n.id ? null : n.id))}>
            <Palette strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-btn" title={isArchived(n) ? "Sacar del archivo" : "Archivar"} onClick={() => void setProps(n, { archivada: !isArchived(n) })}>
            {isArchived(n) ? <ArchiveRestore strokeWidth={1.75} /> : <Archive strokeWidth={1.75} />}
          </button>
          <button type="button" className="icon-btn" title="Eliminar" aria-label="Eliminar" onClick={() => remove(n)}>
            <Trash2 strokeWidth={1.75} />
          </button>
        </div>
        {paletteFor === n.id && (
          <div onClick={(e) => e.stopPropagation()}>
            <ColorPicker
              value={c.key}
              onPick={(k) => {
                void setProps(n, { color: k });
                setPaletteFor(null);
              }}
            />
          </div>
        )}
      </div>
    );
  };

  const grid = (list: Note[]) => (
    <div className="columns-1 gap-3 @min-[520px]:columns-2 @min-[800px]:columns-3 @min-[1080px]:columns-4 @min-[1360px]:columns-5">
      {list.map(card)}
    </div>
  );

  return (
    <div className="@container mx-auto flex min-h-full max-w-[1500px] flex-col gap-6 px-6 py-6">
      <header className="flex flex-wrap items-center gap-3">
        <Lightbulb className="h-5 w-5 text-amber" strokeWidth={1.75} />
        <h1
          className="t-h1 mr-auto cursor-text rounded-md px-1 hover:bg-surface-raised"
          title="Clic para cambiar el nombre"
          onClick={() => setRenaming(true)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setRenaming(true);
          }}
        >
          {showArchived ? `${ideasName} archivadas` : ideasName}
        </h1>
        <PromptModal
          open={renaming}
          title="Renombrar carpeta"
          initial={ideasName}
          confirmLabel="Renombrar"
          onConfirm={(v) => renameFolder(IDEAS_FOLDER, v)}
          onClose={() => setRenaming(false)}
        />
        <label className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2 text-[length:calc(13px*var(--ui-scale,1))]">
          <Search className="h-3.5 w-3.5 text-faint" strokeWidth={1.75} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar ideas" className="w-40 bg-transparent outline-none placeholder:text-faint" />
        </label>
        <button type="button" className={clsx("btn btn-sm", showArchived && "btn-ai")} onClick={() => setShowArchived((v) => !v)}>
          <Archive className="h-4 w-4" strokeWidth={1.75} />
          {showArchived ? "Ver ideas" : "Archivadas"}
        </button>
      </header>

      {!showArchived && <Capture />}

      {ideas && visible.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-faint">
          <Lightbulb className="h-14 w-14 opacity-40" strokeWidth={1.25} />
          <p className="t-body">{showArchived ? "No hay ideas archivadas." : filter ? "Ninguna idea coincide." : "Las ideas que anotes aparecen acá."}</p>
        </div>
      )}

      {pinned.length > 0 && (
        <section className="space-y-2">
          <p className="section-label">Fijadas</p>
          {grid(pinned)}
        </section>
      )}
      {others.length > 0 && (
        <section className="space-y-2">
          {pinned.length > 0 && <p className="section-label">Otras</p>}
          {grid(others)}
        </section>
      )}

      {opened && <Detail note={opened} onClose={() => setOpenId(null)} actions={actions} />}
      {menu.menu}
    </div>
  );
}
