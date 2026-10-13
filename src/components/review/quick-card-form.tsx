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
    <form onSubmit={onSubmit} className="card flex flex-col gap-4">
      <div className="t-h3">Nueva tarjeta</div>

      {subjects.length === 0 ? (
        <p className="t-small text-muted">Primero creá una materia en Mis carreras.</p>
      ) : (
        <label className="field">
          <span>Materia</span>
          <select className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">Elegí una materia</option>
            {sorted.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="field">
        <span>Frente</span>
        <textarea className="input" rows={2} value={front} onChange={(e) => setFront(e.target.value)} placeholder="La pregunta" />
      </label>

      <label className="field">
        <span>Dorso</span>
        <textarea className="input" rows={3} value={back} onChange={(e) => setBack(e.target.value)} placeholder="La respuesta" />
      </label>

      {error && <p className="t-small text-rose">{error}</p>}

      <div>
        <button type="submit" className="btn" disabled={saving || subjects.length === 0}>
          Guardar tarjeta
        </button>
      </div>
    </form>
  );
}
