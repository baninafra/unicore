"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronRight, Hash, Link2, Plus, X } from "lucide-react";
import { db, nowIso } from "@/lib/db";
import { indexNote, normalizeTag, type BlockLike } from "@/lib/notes/index-note";
import { useOpen } from "@/components/workspace/use-open";
import type { Note } from "@/lib/types";

type PropValue = string | number | boolean | string[];
type PropType = "texto" | "numero" | "fecha" | "casilla" | "lista";

const PROP_TYPES: { value: PropType; label: string }[] = [
  { value: "texto", label: "Texto" },
  { value: "numero", label: "Número" },
  { value: "fecha", label: "Fecha" },
  { value: "casilla", label: "Casilla" },
  { value: "lista", label: "Lista" },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function typeOf(v: PropValue): PropType {
  if (typeof v === "boolean") return "casilla";
  if (typeof v === "number") return "numero";
  if (Array.isArray(v)) return "lista";
  return DATE_RE.test(v) ? "fecha" : "texto";
}

function coerce(v: PropValue, t: PropType): PropValue {
  switch (t) {
    case "texto":
      return Array.isArray(v) ? v.join(", ") : String(v);
    case "numero":
      return Number(Array.isArray(v) ? v.length : v) || 0;
    case "fecha":
      return typeof v === "string" && DATE_RE.test(v) ? v : "";
    case "casilla":
      return Boolean(v);
    case "lista":
      return Array.isArray(v) ? v : String(v).split(",").map((s) => s.trim()).filter(Boolean);
  }
}

function displayValue(v: PropValue): string {
  return Array.isArray(v) ? v.join(", ") : String(v);
}

// Valor de una propiedad. Los campos de texto guardan al salir o al apretar Enter, no en cada tecla.
function ValueInput({ value, type, onCommit }: { value: PropValue; type: PropType; onCommit: (v: PropValue) => void }) {
  const [draft, setDraft] = useState(displayValue(value));
  const current = JSON.stringify(value);
  useEffect(() => {
    setDraft(displayValue(value));
    // Sólo se resincroniza cuando cambia el valor guardado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  if (type === "casilla") {
    return (
      <input
        type="checkbox"
        className="h-4 w-4 accent-[var(--primary)]"
        checked={Boolean(value)}
        onChange={(e) => onCommit(e.target.checked)}
      />
    );
  }
  if (type === "fecha") {
    return (
      <input
        type="date"
        className="input h-7 w-auto text-[13px]"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => e.target.value && onCommit(e.target.value)}
      />
    );
  }
  const commit = () => {
    let next: PropValue;
    if (type === "numero") {
      const n = Number(draft.replace(",", "."));
      if (Number.isNaN(n) || draft.trim() === "") return;
      next = n;
    } else if (type === "lista") {
      next = draft.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      next = draft.trim();
    }
    // Sólo escribe si cambió, así salir de un campo no toca la nota.
    if (JSON.stringify(next) !== current) onCommit(next);
  };
  return (
    <input
      inputMode={type === "numero" ? "decimal" : undefined}
      className="w-full min-w-0 bg-transparent text-[13px] text-text outline-none placeholder:text-faint"
      placeholder={type === "lista" ? "Separadas por coma" : "Vacío"}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

// Bloque de propiedades estilo Obsidian: alias, etiquetas y propiedades con tipo.
export function NoteProperties({ note }: { note: Note }) {
  const open = useOpen();
  const [expanded, setExpanded] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newType, setNewType] = useState<PropType>("texto");
  const [newValue, setNewValue] = useState("");
  const [tagDraft, setTagDraft] = useState("");

  const props = note.properties ?? {};
  const entries = Object.entries(props).filter(([k]) => k !== "tags") as [string, PropValue][];
  const aliases = note.aliases ?? [];
  const manualTags = Array.isArray(props.tags) ? (props.tags as string[]) : [];
  const textTags = indexNote((note.content ?? []) as BlockLike[]).tags;
  const allTags = [...new Set([...textTags, ...manualTags.map(normalizeTag)])];
  const hasAny = entries.length > 0 || aliases.length > 0 || allTags.length > 0;

  if (!hasAny && !adding) {
    return (
      <button
        type="button"
        className="t-small text-faint opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        onClick={() => setAdding(true)}
      >
        Agregar propiedad
      </button>
    );
  }

  const patchProps = (next: Record<string, PropValue>) => db.notes.update(note.id, { properties: next, updatedAt: nowIso() });

  const setProp = (key: string, value: PropValue) => void patchProps({ ...props, [key]: value });

  const renameProp = (oldKey: string, rawKey: string) => {
    const key = rawKey.trim();
    if (!key || key === oldKey || key === "tags" || key in props) return;
    const next: Record<string, PropValue> = {};
    for (const [k, v] of Object.entries(props)) next[k === oldKey ? key : k] = v;
    void patchProps(next);
  };

  const removeProp = (key: string) => {
    const next = { ...props };
    delete next[key];
    void patchProps(next);
  };

  const setAliases = (list: string[]) => void db.notes.update(note.id, { aliases: list, updatedAt: nowIso() });

  const addTag = (raw: string) => {
    const tag = normalizeTag(raw.trim());
    setTagDraft("");
    if (!tag || manualTags.includes(tag)) return;
    void db.notes.update(note.id, {
      properties: { ...props, tags: [...manualTags, tag] },
      tags: [...new Set([...allTags, tag])],
      updatedAt: nowIso(),
    });
  };

  const removeTag = (tag: string) => {
    if (!manualTags.includes(tag)) return;
    void db.notes.update(note.id, {
      properties: { ...props, tags: manualTags.filter((t) => t !== tag) },
      tags: allTags.filter((t) => t !== tag || textTags.includes(t)),
      updatedAt: nowIso(),
    });
  };

  const commitNew = () => {
    const key = newKey.trim();
    if (!key || key === "tags" || key === "aliases" || key in props) return;
    void patchProps({ ...props, [key]: coerce(newValue, newType) });
    setNewKey("");
    setNewValue("");
    setNewType("texto");
    setAdding(false);
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="pb-1">
        <button type="button" className="section-label flex items-center gap-1 px-0" onClick={() => setExpanded((v) => !v)}>
          {expanded ? <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} /> : <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} />}
          Propiedades
        </button>
      </div>

      {expanded && (
        <>
          <div className="prop-row">
            <div>
              <Link2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              aliases
            </div>
            <ValueInput value={aliases} type="lista" onCommit={(v) => setAliases(v as string[])} />
          </div>

          <div className="prop-row">
            <div>
              <Hash className="h-3.5 w-3.5" strokeWidth={1.75} />
              tags
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {allTags.map((t) => (
                <span key={t} className="tag cursor-pointer" onClick={(e) => open({ type: "busqueda", query: `tag:#${t}` }, e)}>
                  #{t}
                  {manualTags.includes(t) && (
                    <button
                      type="button"
                      className="ml-1 text-faint hover:text-text"
                      aria-label={`Quitar etiqueta ${t}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeTag(t);
                      }}
                    >
                      <X className="h-3 w-3" strokeWidth={1.75} />
                    </button>
                  )}
                </span>
              ))}
              <input
                className="w-32 bg-transparent text-[13px] outline-none placeholder:text-faint"
                placeholder="Agregar etiqueta"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addTag(tagDraft);
                }}
                onBlur={() => tagDraft.trim() && addTag(tagDraft)}
              />
            </div>
          </div>

          {entries.map(([key, value]) => (
            <div key={key} className="prop-row group">
              <input
                defaultValue={key}
                className="min-w-0 bg-transparent text-[13px] text-faint outline-none"
                onBlur={(e) => renameProp(key, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
              <div className="flex min-w-0 items-center gap-2">
                <select
                  className="h-6 rounded-sm border-0 bg-transparent text-[12px] text-faint outline-none"
                  value={typeOf(value)}
                  onChange={(e) => setProp(key, coerce(value, e.target.value as PropType))}
                  aria-label="Tipo de propiedad"
                >
                  {PROP_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <div className="min-w-0 flex-1">
                  <ValueInput value={value} type={typeOf(value)} onCommit={(v) => setProp(key, v)} />
                </div>
                <button
                  type="button"
                  className="icon-btn opacity-0 group-hover:opacity-100"
                  aria-label={`Quitar ${key}`}
                  onClick={() => removeProp(key)}
                >
                  <X />
                </button>
              </div>
            </div>
          ))}

          {adding ? (
            <div className="prop-row">
              <input
                autoFocus
                className="min-w-0 bg-transparent text-[13px] outline-none placeholder:text-faint"
                placeholder="Nombre"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === "Escape") setAdding(false);
                }}
              />
              <div className="flex min-w-0 items-center gap-2">
                <select
                  className="h-6 rounded-sm border-0 bg-transparent text-[12px] text-faint outline-none"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as PropType)}
                  aria-label="Tipo de propiedad nueva"
                >
                  {PROP_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <input
                  className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
                  placeholder="Valor"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitNew();
                    if (e.key === "Escape") setAdding(false);
                  }}
                />
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="mt-1 flex w-fit items-center gap-1 t-small text-faint hover:text-text"
              onClick={() => setAdding(true)}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
              Agregar propiedad
            </button>
          )}
        </>
      )}
    </div>
  );
}
