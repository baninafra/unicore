"use client";

// Bases: tabla de notas con columnas de propiedades, filtros, orden, agrupación y edición inline.
// La configuración se guarda en localStorage (uc-base-config).

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Columns3, Filter, X } from "lucide-react";
import { db, nowIso } from "@/lib/db";
import { shortDateTime } from "@/lib/format";
import { useSubjectMap } from "@/lib/hooks";
import { normalizeText } from "@/lib/ai/rag";
import { useWorkspace } from "@/lib/workspace";
import { useOpen } from "@/components/workspace/use-open";
import { useContextMenu } from "@/components/ui/menu";
import { viewMenuItems } from "@/components/panes/pane-ui";
import { folderLabel, noteTitle } from "@/lib/panes/note-data";
import { useAllNotes } from "@/lib/panes/hooks";
import { displayText, numberOf, summarizeProps, type PropValue } from "@/lib/panes/props";
import {
  BASE_FILTER_EVENT,
  FIXED_FIELDS,
  FILTER_OPS,
  NO_VALUE_OPS,
  isFixedField,
  loadBaseConfig,
  runBaseQuery,
  saveBaseConfig,
  takePendingBaseFilter,
  type BaseConfig,
  type BaseFilter,
  type FilterOp,
} from "@/lib/panes/base-query";
import type { Note } from "@/lib/types";
import { Select } from "@/components/ui/select";

const FIELD_SELECT =
  "h-7 rounded-md border border-border bg-surface-raised px-2 text-[13px] text-text outline-none hover:border-border-strong focus:border-primary";
const EMPTY_FILTER: BaseFilter = { field: "title", op: "contiene", value: "" };

interface EditState {
  noteId: string;
  key: string;
  text: string;
}

// Lo que escribe el usuario en una celda, convertido según el valor que había.
function parseInput(text: string, current: PropValue | undefined): PropValue | undefined {
  const t = text.trim();
  if (!t) return undefined;
  if (Array.isArray(current)) return t.split(",").map((s) => s.trim()).filter(Boolean);
  if (typeof current === "boolean") return ["si", "true", "1", "x"].includes(normalizeText(t));
  if (typeof current === "number" && numberOf(t) !== undefined) return numberOf(t);
  return t;
}

export function BaseView() {
  const notes = useAllNotes();
  const subjects = useSubjectMap();
  const props = useMemo(() => summarizeProps(notes), [notes]);
  const { openView } = useWorkspace();
  const open = useOpen();
  const menu = useContextMenu();

  const [config, setConfig] = useState<BaseConfig>(loadBaseConfig);
  const [draft, setDraft] = useState<BaseFilter>(EMPTY_FILTER);
  const [showFilters, setShowFilters] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [editing, setEditing] = useState<EditState | null>(null);
  const editRef = useRef<EditState | null>(null);
  const columnsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveBaseConfig(config);
  }, [config]);

  // Filtro pedido desde Propiedades: al montarse (pendiente) y mientras está abierta (evento).
  useEffect(() => {
    const apply = () => {
      const f = takePendingBaseFilter();
      if (!f) return;
      setConfig((c) => ({
        ...c,
        filters: [...c.filters, f],
        columns: isFixedField(f.field) || c.columns.includes(f.field) ? c.columns : [...c.columns, f.field],
      }));
      setShowFilters(true);
    };
    apply();
    window.addEventListener(BASE_FILTER_EVENT, apply);
    return () => window.removeEventListener(BASE_FILTER_EVENT, apply);
  }, []);

  // Cierra el selector de columnas al hacer clic afuera.
  useEffect(() => {
    if (!showColumns) return;
    const onDown = (e: MouseEvent) => {
      if (!columnsRef.current?.contains(e.target as Node)) setShowColumns(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showColumns]);

  const groups = useMemo(() => runBaseQuery(notes, config, subjects), [notes, config, subjects]);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const fieldLabel = (key: string) => FIXED_FIELDS.find((f) => f.key === key)?.label ?? key;
  const subjectOf = (n: Note) => folderLabel(n.subjectId, subjects);

  const needsValue = !NO_VALUE_OPS.includes(draft.op);
  const canAdd = !!draft.field && (!needsValue || draft.value.trim() !== "");

  function addFilter() {
    if (!canAdd) return;
    const f: BaseFilter = { ...draft, value: needsValue ? draft.value.trim() : "" };
    setConfig((c) => ({
      ...c,
      filters: [...c.filters, f],
      columns: isFixedField(f.field) || c.columns.includes(f.field) ? c.columns : [...c.columns, f.field],
    }));
    setDraft({ ...draft, value: "" });
  }

  function toggleSort(field: string) {
    setConfig((c) =>
      c.sortField === field
        ? { ...c, sortDir: c.sortDir === "asc" ? "desc" : "asc" }
        : { ...c, sortField: field, sortDir: "asc" },
    );
  }

  function toggleColumn(key: string) {
    setConfig((c) => ({
      ...c,
      columns: c.columns.includes(key) ? c.columns.filter((k) => k !== key) : [...c.columns, key],
    }));
  }

  function startEdit(note: Note, key: string) {
    const state = { noteId: note.id, key, text: displayText(note.properties?.[key]) };
    editRef.current = state;
    setEditing(state);
  }

  // Guarda una celda una sola vez (Enter y blur pueden llegar juntos).
  async function commitEdit() {
    const state = editRef.current;
    editRef.current = null;
    setEditing(null);
    if (!state) return;
    const note = await db.notes.get(state.noteId);
    if (!note) return;
    const current = note.properties?.[state.key];
    const value = parseInput(state.text, current);
    const next = { ...(note.properties ?? {}) };
    if (value === undefined) delete next[state.key];
    else next[state.key] = value;
    await db.notes.update(note.id, { properties: next, updatedAt: nowIso() });
  }

  function cancelEdit() {
    editRef.current = null;
    setEditing(null);
  }

  const columns = config.columns.filter((k) => !isFixedField(k));

  return (
    <div className="view-wide">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-sm" aria-pressed={showFilters} onClick={() => setShowFilters((o) => !o)}>
          <Filter strokeWidth={1.75} />
          Filtros{config.filters.length > 0 ? ` (${config.filters.length})` : ""}
        </button>

        <div ref={columnsRef} className="relative">
          <button type="button" className="btn btn-sm" aria-expanded={showColumns} onClick={() => setShowColumns((o) => !o)}>
            <Columns3 strokeWidth={1.75} />
            Columnas
          </button>
          {showColumns && (
            <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-60 overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-pop">
              {props.length === 0 && <p className="px-2 py-1 t-small text-faint">Sin propiedades</p>}
              {props.map((p) => (
                <label key={p.key} className="row cursor-pointer">
                  <input type="checkbox" checked={config.columns.includes(p.key)} onChange={() => toggleColumn(p.key)} />
                  <span className="min-w-0 flex-1 truncate text-text">{p.key}</span>
                  <span className="text-[12px] text-faint">{p.kind}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <Select
          aria-label="Agrupar por"
          value={config.groupBy}
          onChange={(e) => setConfig((c) => ({ ...c, groupBy: e.target.value }))}
          className={FIELD_SELECT}
        >
          <option value="">Sin agrupar</option>
          <option value="subject">Materia</option>
          {props.map((p) => (
            <option key={p.key} value={p.key}>
              {p.key}
            </option>
          ))}
        </Select>

        <span className="num ml-auto text-[12px] text-faint">
          {total} {total === 1 ? "nota" : "notas"}
        </span>
      </div>

      {showFilters && (
        <div className="mb-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Campo del filtro"
              value={draft.field}
              onChange={(e) => setDraft({ ...draft, field: e.target.value })}
              className={FIELD_SELECT}
            >
              {FIXED_FIELDS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
              {props.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Operador"
              value={draft.op}
              onChange={(e) => setDraft({ ...draft, op: e.target.value as FilterOp })}
              className={FIELD_SELECT}
            >
              {FILTER_OPS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </Select>
            {needsValue && (
              <input
                aria-label="Valor del filtro"
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addFilter();
                }}
                placeholder="Valor"
                className={clsx(FIELD_SELECT, "w-40 placeholder:text-faint")}
              />
            )}
            <button type="button" className="btn btn-sm" disabled={!canAdd} onClick={addFilter}>
              Agregar filtro
            </button>
          </div>

          {config.filters.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {config.filters.map((f, i) => (
                <span key={i} className="tag gap-1">
                  {fieldLabel(f.field)} {f.op}
                  {!NO_VALUE_OPS.includes(f.op) && ` ${f.value}`}
                  <button
                    type="button"
                    aria-label="Quitar filtro"
                    onClick={() => setConfig((c) => ({ ...c, filters: c.filters.filter((_, j) => j !== i) }))}
                    className="flex-none text-primary-soft hover:text-text"
                  >
                    <X className="h-3 w-3" strokeWidth={1.75} />
                  </button>
                </span>
              ))}
              <button
                type="button"
                className="text-[12px] text-faint hover:text-text"
                onClick={() => setConfig((c) => ({ ...c, filters: [] }))}
              >
                Quitar filtros
              </button>
            </div>
          )}
        </div>
      )}

      {notes.length === 0 ? (
        <p className="py-6 t-small text-faint">Sin notas</p>
      ) : total === 0 ? (
        <p className="py-6 t-small text-faint">Sin resultados</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <HeaderCell label="Título" field="title" config={config} onSort={toggleSort} />
                <HeaderCell label="Materia" field="subject" config={config} onSort={toggleSort} />
                <HeaderCell label="Etiquetas" field="tags" config={config} onSort={toggleSort} />
                <HeaderCell label="Modificación" field="updated" config={config} onSort={toggleSort} />
                {columns.map((key) => (
                  <HeaderCell key={key} label={key} field={key} config={config} onSort={toggleSort} />
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group.label || "todas"}>
                  {config.groupBy && (
                    <tr>
                      <td colSpan={4 + columns.length} className="section-label px-0! pb-1 pt-4">
                        {group.label} · {group.rows.length}
                      </td>
                    </tr>
                  )}
                  {group.rows.map((note) => (
                    <tr
                      key={note.id}
                      className="h-[30px] border-b border-border/60 hover:bg-surface-raised"
                      onContextMenu={(e) => menu.open(e, viewMenuItems({ type: "nota", id: note.id }, openView))}
                    >
                      <td className="max-w-[280px] px-2">
                        <button
                          type="button"
                          onClick={(e) => open({ type: "nota", id: note.id }, e)}
                          className="block w-full truncate text-left text-text hover:text-primary-soft"
                        >
                          {noteTitle(note)}
                        </button>
                      </td>
                      <td className="max-w-[160px] truncate px-2 text-muted">{subjectOf(note)}</td>
                      <td className="max-w-[200px] truncate px-2 text-[12px] text-muted">
                        {(note.tags ?? []).map((t) => `#${t}`).join(" ")}
                      </td>
                      <td className="whitespace-nowrap px-2 text-muted">{shortDateTime(note.updatedAt)}</td>
                      {columns.map((key) => {
                        const isEditing = editing?.noteId === note.id && editing.key === key;
                        return (
                          <td
                            key={key}
                            className="max-w-[200px] px-2 text-muted"
                            onDoubleClick={() => !isEditing && startEdit(note, key)}
                          >
                            {isEditing ? (
                              <input
                                autoFocus
                                aria-label={`Editar ${key}`}
                                value={editing.text}
                                onChange={(e) => {
                                  const next = { ...editing, text: e.target.value };
                                  editRef.current = next;
                                  setEditing(next);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void commitEdit();
                                  if (e.key === "Escape") cancelEdit();
                                }}
                                onBlur={() => void commitEdit()}
                                className="h-6 w-full rounded-sm border border-primary bg-surface-raised px-1.5 text-[13px] text-text outline-none"
                              />
                            ) : (
                              <span className="block truncate">{displayText(note.properties?.[key]) || " "}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {menu.menu}
    </div>
  );
}

function HeaderCell({
  label,
  field,
  config,
  onSort,
}: {
  label: string;
  field: string;
  config: BaseConfig;
  onSort: (field: string) => void;
}) {
  const active = config.sortField === field;
  const Arrow = config.sortDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" className="h-7 px-2 text-left font-normal">
      <button
        type="button"
        onClick={() => onSort(field)}
        className={clsx("section-label px-0! flex items-center gap-1 hover:text-text", active && "text-text")}
      >
        {label}
        {active && <Arrow className="h-3 w-3" strokeWidth={1.75} />}
      </button>
    </th>
  );
}
