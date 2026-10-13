"use client";

import { useState, type FormEvent } from "react";
import { db, newId, nowIso } from "@/lib/db";
import { newCardFields } from "@/lib/fsrs";
import { useAllSubjects } from "@/lib/hooks";

// Formulario rápido para crear una tarjeta a mano. Vence ya, así que aparece en el repaso de hoy.
export function QuickCardForm({ defaultSubjectId }: { defaultSubjectId: string }) {
  const subjects = useAllSubjects();
  const [subjectId, setSubjectId] = useState(defaultSubjectId);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!subjectId) {
      setError("Elegí una materia para la tarjeta.");
      return;
    }
    if (!front.trim() || !back.trim()) {
      setError("Completá el frente y el dorso.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await db.flashcards.add({
        id: newId(),
        subjectId,
        front: front.trim(),
        back: back.trim(),
        createdAt: nowIso(),
        ...newCardFields(),
      });
      setFront("");
      setBack("");
    } catch (err) {
      console.error(err);
      setError("No pudimos guardar la tarjeta. Probá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  const sorted = [...subjects].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-xl flex-col gap-2">
      <select
        className="input h-8 w-auto self-start"
        value={subjectId}
        onChange={(e) => setSubjectId(e.target.value)}
        aria-label="Materia"
        disabled={subjects.length === 0}
      >
        <option value="">{subjects.length === 0 ? "Sin materias" : "Elegí una materia"}</option>
        {sorted.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <textarea className="input" rows={2} value={front} onChange={(e) => setFront(e.target.value)} placeholder="Pregunta" aria-label="Pregunta" />
      <textarea className="input" rows={3} value={back} onChange={(e) => setBack(e.target.value)} placeholder="Respuesta" aria-label="Respuesta" />

      {error && <p className="t-small text-rose">{error}</p>}

      <div className="flex justify-end">
        <button type="submit" className="btn btn-sm" disabled={saving || subjects.length === 0}>
          Guardar tarjeta
        </button>
      </div>
    </form>
  );
}
