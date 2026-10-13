"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { FileText } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { db } from "@/lib/db";
import { NoteList } from "./note-list";
import { sortNotes } from "./note-utils";

// BlockNote pesa bastante y necesita el navegador: se carga sólo cuando hace falta.
const NoteEditor = dynamic(() => import("./note-editor").then((m) => m.NoteEditor), {
  ssr: false,
  loading: () => <div className="t-small p-4 text-muted">Cargando el editor…</div>,
});

// Pestaña Apuntes: lista agrupada por unidad a la izquierda y el editor a la derecha.
export function NotesWorkspace({
  subjectId,
  selectedId,
  onSelect,
}: {
  subjectId: string;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const notes = useLiveQuery(() => db.notes.where("subjectId").equals(subjectId).toArray(), [subjectId]);
  const sorted = useMemo(() => sortNotes(notes ?? []), [notes]);
  // Si el apunte elegido ya no existe (se borró), se muestra el primero de la lista.
  const selected = sorted.find((n) => n.id === selectedId) ?? sorted[0];

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start">
      <div className="md:w-60 md:shrink-0">
        {notes !== undefined && (
          <NoteList subjectId={subjectId} notes={sorted} selectedId={selected?.id} onSelect={onSelect} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {selected ? (
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <NoteEditor key={selected.id} note={selected} />
          </div>
        ) : (
          notes !== undefined && (
            <EmptyState
              icon={FileText}
              title="Todavía no hay apuntes"
              text="Creá tu primer apunte con el botón de la izquierda."
            />
          )
        )}
      </div>
    </div>
  );
}
