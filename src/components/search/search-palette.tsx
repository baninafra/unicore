"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import clsx from "clsx";
import { BookOpen, CheckSquare, FileText, Layers, NotebookPen, Plus, Sparkles, type LucideIcon } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useAppState } from "@/lib/app-state";
import { db } from "@/lib/db";
import { useDegreeMap } from "@/lib/hooks";
import { shortDate } from "@/lib/format";
import type { Note, Subject, SubjectDocument, Task } from "@/lib/types";

const PER_GROUP = 6;

// Minúsculas y sin acentos: "Análisis" → "analisis".
function normalizeText(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Cada registro se normaliza una sola vez (al cambiar la base), no en cada tecla.
type Indexed =
  | { kind: "subject"; item: Subject; text: string }
  | { kind: "note"; item: Note; text: string }
  | { kind: "task"; item: Task; text: string }
  | { kind: "document"; item: SubjectDocument; text: string };

// Pedazo del texto alrededor de la primera coincidencia, con acentos.
function snippetFor(text: string, words: string[]) {
  if (!text || !words.length) return undefined;
  const chars = [...text];
  const folded = chars.map((c) => {
    const f = normalizeText(c);
    return f.length === 1 ? f : c;
  });
  const flat = folded.join("");
  const idx = words.reduce((best, w) => {
    const i = flat.indexOf(w);
    return i >= 0 && i < best ? i : best;
  }, Number.POSITIVE_INFINITY);
  const start = Number.isFinite(idx) ? Math.max(0, idx - 40) : 0;
  const piece = chars.slice(start, start + 110).join("").replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${piece}…`;
}

interface Result {
  key: string;
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  snippet?: string;
  onSelect: () => void;
}

interface Group {
  label: string;
  items: Result[];
}

// Ctrl+K. Se monta sólo cuando está abierto, así arranca limpio cada vez.
export function SearchPalette() {
  const { searchOpen, setSearchOpen } = useAppState();
  if (!searchOpen) return null;
  return <SearchDialog onClose={() => setSearchOpen(false)} />;
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { openTaskDialog, setAiOpen } = useAppState();
  const degreeMap = useDegreeMap();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const data = useLiveQuery(async () => {
    const [subjects, notes, tasks, documents] = await Promise.all([
      db.subjects.toArray(),
      db.notes.toArray(),
      db.tasks.toArray(),
      db.documents.toArray(),
    ]);
    return { subjects, notes, tasks, documents };
  }, []);

  const subjectById = useMemo(() => Object.fromEntries((data?.subjects ?? []).map((s) => [s.id, s])), [data]);
  const subjectName = (id?: string) => (id ? subjectById[id]?.name : undefined);

  const index = useMemo<Indexed[]>(() => {
    if (!data) return [];
    return [
      ...data.subjects.map((s): Indexed => ({ kind: "subject", item: s, text: normalizeText(`${s.name} ${s.code ?? ""}`) })),
      ...data.notes.map((n): Indexed => ({ kind: "note", item: n, text: normalizeText(`${n.title} ${n.plainTextCache}`) })),
      ...data.tasks.map((t): Indexed => ({ kind: "task", item: t, text: normalizeText(`${t.title} ${t.description ?? ""}`) })),
      ...data.documents.map((d): Indexed => ({ kind: "document", item: d, text: normalizeText(`${d.fileName} ${d.extractedText}`) })),
    ];
  }, [data]);

  const words = normalizeText(query.trim()).split(/\s+/).filter(Boolean);
  const go = (href: string) => {
    onClose();
    router.push(href);
  };
  const run = (fn: () => void) => {
    onClose();
    fn();
  };

  // Filtra por tipo: cada palabra de la búsqueda tiene que aparecer en el texto indexado.
  function hits<K extends Indexed["kind"]>(kind: K): Extract<Indexed, { kind: K }>[] {
    return index.filter((x): x is Extract<Indexed, { kind: K }> => x.kind === kind && words.every((w) => x.text.includes(w)));
  }

  const groups: Group[] = [];
  if (words.length) {
    const subjects: Result[] = hits("subject").map(({ item: s }) => ({
      key: `s-${s.id}`,
      icon: BookOpen,
      title: s.name,
      subtitle: degreeMap[s.degreeId]?.shortName,
      onSelect: () => go(`/materias/${s.id}`),
    }));
    const notes: Result[] = hits("note").map(({ item: n }) => ({
      key: `n-${n.id}`,
      icon: NotebookPen,
      title: n.title || "Apunte sin título",
      subtitle: [subjectName(n.subjectId), `Unidad ${n.unitNumber}`].filter(Boolean).join(" · "),
      snippet: snippetFor(n.plainTextCache, words),
      onSelect: () => go(`/materias/${n.subjectId}`),
    }));
    const tasks: Result[] = hits("task").map(({ item: t }) => ({
      key: `t-${t.id}`,
      icon: CheckSquare,
      title: t.title,
      subtitle: [subjectName(t.subjectId), t.dueDate ? shortDate(t.dueDate) : ""].filter(Boolean).join(" · "),
      onSelect: () => run(() => openTaskDialog(t)),
    }));
    const documents: Result[] = hits("document").map(({ item: d }) => ({
      key: `d-${d.id}`,
      icon: FileText,
      title: d.fileName,
      subtitle: [subjectName(d.subjectId), `Unidad ${d.unitNumber}`].filter(Boolean).join(" · "),
      snippet: snippetFor(d.extractedText, words),
      onSelect: () => go(`/materias/${d.subjectId}`),
    }));

    for (const [label, items] of [
      ["Materias", subjects],
      ["Apuntes", notes],
      ["Tareas", tasks],
      ["Documentos", documents],
    ] as const) {
      if (items.length) groups.push({ label, items: items.slice(0, PER_GROUP) });
    }
  }

  const actions: Result[] = [
    { key: "a-task", icon: Plus, title: "Agregar tarea", onSelect: () => run(() => openTaskDialog()) },
    { key: "a-repaso", icon: Layers, title: "Empezar repaso", onSelect: () => go("/repaso") },
    { key: "a-ai", icon: Sparkles, title: "Abrir asistente", onSelect: () => run(() => setAiOpen(true)) },
  ].filter((a) => !words.length || words.every((w) => normalizeText(a.title).includes(w)));
  if (actions.length) groups.push({ label: "Acciones", items: actions });

  const flat = groups.flatMap((g) => g.items);
  const flatIndex = new Map(flat.map((r, i) => [r.key, i]));
  const current = Math.min(active, Math.max(flat.length - 1, 0));
  const nothingFound = words.length > 0 && flat.length === 0;

  // Mantiene visible la opción activa al navegar con flechas.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current]);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (flat.length) setActive((i) => (i + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length) setActive((i) => (i - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      flat[current]?.onSelect();
    }
  }

  return (
    <Modal open onClose={onClose} width={600}>
      <input
        className="input"
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="Buscar materias, apuntes, tareas o documentos"
        aria-label="Buscar"
      />

      {!words.length && (
        <p className="t-small mt-3 px-2.5 text-faint">Escribí para buscar en materias, apuntes, tareas y documentos.</p>
      )}
      {nothingFound && (
        <p className="t-small mt-3 px-2.5 py-4 text-center text-muted">No encontramos nada para &quot;{query.trim()}&quot;.</p>
      )}

      <div ref={listRef} className="mt-3 flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            <div className="t-label px-2.5 pb-1">{group.label}</div>
            {group.items.map((item) => {
              const idx = flatIndex.get(item.key) ?? -1;
              const selected = idx === current;
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  data-active={selected}
                  onMouseEnter={() => setActive(idx)}
                  onClick={item.onSelect}
                  className={clsx(
                    "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors",
                    selected ? "bg-primary-tint" : "hover:bg-surface-raised",
                  )}
                >
                  <Icon className="h-4 w-4 flex-none text-muted" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1">
                    <span className="t-h3 block truncate">{item.title}</span>
                    {item.subtitle && <span className="t-small block truncate text-faint">{item.subtitle}</span>}
                    {item.snippet && <span className="t-small block truncate text-muted">{item.snippet}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </Modal>
  );
}
