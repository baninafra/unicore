"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { previewIntervals, rateCard, type Calificacion } from "@/lib/fsrs";
import { useSubjectMap } from "@/lib/hooks";
import type { Flashcard } from "@/lib/types";

const OPCIONES: { rating: Calificacion; label: string; textClass: string; sugerida?: boolean }[] = [
  { rating: 1, label: "Otra vez", textClass: "text-rose" },
  { rating: 2, label: "Difícil", textClass: "" },
  { rating: 3, label: "Bien", textClass: "", sugerida: true },
  { rating: 4, label: "Fácil", textClass: "text-mint" },
];

// Sesión de repaso: una tarjeta por vez. "Otra vez" la vuelve a poner al final.
export function ReviewSession({ cards, onFinish }: { cards: Flashcard[]; onFinish: (minutes: number) => void }) {
  const subjects = useSubjectMap();
  const total = cards.length;
  const [queue, setQueue] = useState<Flashcard[]>(cards);
  const [index, setIndex] = useState(0);
  const [graduated, setGraduated] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startedAt] = useState(() => Date.now());
  // Momento en que se muestra la tarjeta: lo usan la vista previa y la calificación (ts-fsrs lo usa como semilla).
  const [shownAt, setShownAt] = useState(() => Date.now());

  const finished = index >= queue.length;
  const current = queue[index];
  const previews = useMemo(() => (current ? previewIntervals(current, new Date(shownAt)) : null), [current, shownAt]);

  useEffect(() => {
    if (finished) onFinish(Math.max(1, Math.round((Date.now() - startedAt) / 60000)));
  }, [finished, onFinish, startedAt]);

  const rate = useCallback(
    async (r: Calificacion) => {
      if (!current || busy) return;
      setBusy(true);
      setError(null);
      try {
        const updated = await rateCard(current, r, new Date(shownAt));
        if (r === 1) setQueue((q) => [...q, updated]);
        else setGraduated((g) => g + 1);
        setIndex((i) => i + 1);
        setRevealed(false);
        setShownAt(Date.now());
      } catch (err) {
        console.error(err);
        setError("No pudimos guardar la calificación. Probá de nuevo.");
      } finally {
        setBusy(false);
      }
    },
    [current, busy, shownAt],
  );

  // Atajos: Espacio muestra la respuesta, 1 a 4 califican.
  useEffect(() => {
    if (finished || !current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (!revealed) {
        if (e.key === " ") {
          e.preventDefault();
          setRevealed(true);
        }
        return;
      }
      if (["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        void rate(Number(e.key) as Calificacion);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, finished, revealed, rate]);

  if (finished || !current) return null;

  const subjectName = subjects[current.subjectId]?.name ?? "";
  const pct = total ? (graduated / total) * 100 : 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="t-small truncate text-muted">{subjectName}</span>
        <span className="t-small num flex-none text-muted">
          {graduated} de {total}
        </span>
      </div>
      <div className="progress">
        <i style={{ width: `${pct}%` }} />
      </div>

      <div className="card p-6 sm:p-8">
        <div className="t-label">Pregunta</div>
        <div className="t-h2 mt-2 whitespace-pre-wrap">{current.front}</div>

        {!revealed ? (
          <button type="button" className="btn mt-8 w-full" onClick={() => setRevealed(true)}>
            Mostrar respuesta
            <span className="kbd">Espacio</span>
          </button>
        ) : (
          <>
            <div className="my-6 border-t border-border" />
            <div className="t-label">Respuesta</div>
            <div className="t-body mt-2 whitespace-pre-wrap text-muted">{current.back}</div>
          </>
        )}
      </div>

      {revealed && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {OPCIONES.map((o) => (
              <button
                key={o.rating}
                type="button"
                disabled={busy}
                onClick={() => void rate(o.rating)}
                className={clsx(
                  "flex flex-col items-center gap-1 rounded-md border bg-surface px-2 py-3 transition-colors hover:bg-surface-raised disabled:opacity-50",
                  o.sugerida ? "!border-primary" : "border-border-strong",
                )}
              >
                <span className={clsx("flex items-center gap-2 text-sm font-medium", o.textClass)}>
                  {o.label}
                  <span className="kbd">{o.rating}</span>
                </span>
                <span className="t-small num text-faint">{previews?.[o.rating]}</span>
              </button>
            ))}
          </div>
          {error && <p className="t-small text-rose">{error}</p>}
        </>
      )}
    </div>
  );
}
