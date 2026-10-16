"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import { Modal } from "@/components/ui/modal";
import { EDITOR_KINDS } from "@/lib/editors/editors";
import { db } from "@/lib/db";
import { useWorkspace } from "@/lib/workspace";
import { useOpen } from "@/components/workspace/use-open";
import { LOOSE_FOLDER } from "@/lib/types";
import { FOLDER_NAME, addNote, runSafe, type ModifierEvent } from "@/lib/nav/actions";
import { foldText, fuzzyScore } from "@/lib/nav/fold";
import { formatHotkey, onPaletteOpen, type PaletteItem, type PaletteOpen } from "@/lib/nav/palette-bus";
import { CoreCommands } from "./core-commands";

const LS_RECENT = "uc-palette-recent";
const MAX_ITEMS = 60;

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(LS_RECENT);
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function rememberRecent(id: string) {
  try {
    const next = [id, ...readRecents().filter((x) => x !== id)].slice(0, 12);
    localStorage.setItem(LS_RECENT, JSON.stringify(next));
  } catch {}
}

// Paleta (Ctrl+P, comandos), selector rápido (Ctrl+O, archivos) y listas puntuales (plantillas, espacios).
// Los comandos base viven en CoreCommands, montado acá adentro.
export function CommandPalette() {
  const [state, setState] = useState<(PaletteOpen & { stamp: number }) | null>(null);

  useEffect(
    () =>
      onPaletteOpen((detail) =>
        setState((prev) => (prev && prev.mode === detail.mode && detail.mode !== "list" ? null : { ...detail, stamp: Date.now() })),
      ),
    [],
  );

  return (
    <>
      <CoreCommands />
      {state && <PaletteDialog key={state.stamp} detail={state} onClose={() => setState(null)} />}
    </>
  );
}

const PLACEHOLDER: Record<PaletteOpen["mode"], string> = {
  commands: "Escribí un comando",
  quick: "Ir a un archivo",
  list: "Elegí una opción",
};

function PaletteDialog({ detail, onClose }: { detail: PaletteOpen; onClose: () => void }) {
  const { commands } = useWorkspace();
  const open = useOpen();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recents] = useState<string[]>(readRecents);
  const listRef = useRef<HTMLDivElement>(null);

  // Archivos para el selector rápido
  const files = useLiveQuery(async () => {
    if (detail.mode !== "quick") return undefined;
    const [notes, canvases, subjects, documents, officeDocs] = await Promise.all([
      db.notes.toArray(),
      db.canvases.toArray(),
      db.subjects.toArray(),
      db.documents.toArray(),
      db.officeDocs.toArray(),
    ]);
    return { notes, canvases, subjects, documents, officeDocs };
  }, [detail.mode]);

  const quickItems = useMemo<PaletteItem[]>(() => {
    if (!files) return [];
    const subjectName = new Map(files.subjects.map((s) => [s.id, s.name]));
    const folderOf = (sid: string) => subjectName.get(sid) ?? FOLDER_NAME[sid] ?? "Notas";
    return [
      ...files.subjects.map((s): PaletteItem => ({
        id: `s:${s.id}`,
        label: s.name,
        hint: "Materia",
        run: (e) => open({ type: "materia", id: s.id }, e),
      })),
      ...files.notes.map((n): PaletteItem => ({
        id: `n:${n.id}`,
        label: n.title || "Sin título",
        hint: folderOf(n.subjectId),
        match: (n.aliases ?? []).join(" "),
        run: (e) => open({ type: "nota", id: n.id }, e),
      })),
      ...files.canvases.map((c): PaletteItem => ({
        id: `c:${c.id}`,
        label: c.name || "Sin título",
        hint: "Lienzo",
        run: (e) => open({ type: "canvas", id: c.id }, e),
      })),
      ...files.documents.map((d): PaletteItem => ({
        id: `d:${d.id}`,
        label: d.fileName,
        hint: "PDF",
        run: (e) => open({ type: "pdf", id: d.id }, e),
      })),
      ...files.officeDocs.map((d): PaletteItem => ({
        id: `e:${d.id}`,
        label: d.name,
        hint: EDITOR_KINDS[d.kind].label,
        run: (e) => open({ type: "editor", id: d.id }, e),
      })),
    ];
  }, [files, open]);

  const base = useMemo<PaletteItem[]>(() => {
    if (detail.mode === "commands") {
      return commands.map((c) => ({
        id: c.id,
        label: c.name,
        hint: c.hotkey ? formatHotkey(c.hotkey) : undefined,
        run: () => c.run(),
      }));
    }
    if (detail.mode === "quick") return quickItems;
    return detail.items ?? [];
  }, [commands, detail, quickItems]);

  // Con el selector: si no hay un archivo con ese nombre, se ofrece crear la nota (Shift+Enter).
  const q = foldText(query.trim());
  const createItem = useMemo<PaletteItem | undefined>(() => {
    if (detail.mode !== "quick" || !query.trim()) return undefined;
    if (quickItems.some((i) => foldText(i.label) === q)) return undefined;
    const name = query.trim();
    return {
      id: "crear",
      label: `Crear nota "${name}"`,
      hint: "Shift Enter",
      run: (e) => runSafe(async () => open({ type: "nota", id: await addNote(LOOSE_FOLDER, { title: name }) }, e)),
    };
  }, [detail.mode, query, quickItems, q, open]);

  const shown = useMemo<PaletteItem[]>(() => {
    if (!q) {
      if (detail.mode !== "commands") return base.slice(0, MAX_ITEMS);
      // Recientes primero; el resto en su orden.
      const rank = new Map(recents.map((id, i) => [id, i]));
      return [...base].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9)).slice(0, MAX_ITEMS);
    }
    return base
      .map((item) => {
        const score = Math.max(fuzzyScore(q, foldText(item.label)), item.match ? fuzzyScore(q, foldText(item.match)) : -1);
        const bonus = detail.mode === "commands" && recents.includes(item.id) ? 2 : 0;
        return { item, score: score < 0 ? -1 : score + bonus };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item)
      .slice(0, MAX_ITEMS);
  }, [base, q, recents, detail.mode]);

  const list = createItem ? [...shown, createItem] : shown;

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Cierra primero: si el comando abre otra paleta, esa queda abierta.
  const act = (item: PaletteItem, e?: ModifierEvent) => {
    if (detail.mode === "commands") rememberRecent(item.id);
    onClose();
    item.run(e);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(list.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = e.shiftKey && createItem ? createItem : list[active];
      if (target) act(target, e);
    }
  };

  return (
    <Modal open onClose={onClose} width={560}>
      <input
        className="input"
        autoFocus
        value={query}
        placeholder={detail.mode === "list" ? (detail.title ?? PLACEHOLDER.list) : PLACEHOLDER[detail.mode]}
        aria-label="Buscar"
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <div ref={listRef} className="mt-2 flex max-h-[52vh] flex-col overflow-y-auto">
        {list.map((item, i) => (
          <button
            key={item.id}
            type="button"
            data-active={i === active}
            onMouseEnter={() => setActive(i)}
            onClick={(e) => act(item, e)}
            className={clsx("row w-full justify-between text-left", i === active && "bg-primary-tint text-text")}
          >
            <span className="min-w-0 truncate text-text">{item.label}</span>
            {item.hint &&
              (detail.mode === "commands" ? (
                <span className="kbd shrink-0">{item.hint}</span>
              ) : (
                <span className="shrink-0 text-[12px] text-faint">{item.hint}</span>
              ))}
          </button>
        ))}
        {!list.length && <p className="px-2 py-3 text-[13px] text-faint">Sin resultados</p>}
      </div>
    </Modal>
  );
}
