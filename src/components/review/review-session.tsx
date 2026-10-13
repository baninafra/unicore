"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { previewIntervals, rateCard, type Calificacion } from "@/lib/fsrs";
import { useSubjectMap } from "@/lib/hooks";
import type { Flashcard } from "@/lib/types";

const OPCIONES: { rating: Calificacion; label: string; textClass: string }[] = [
  { rating: 1, label: "Otra vez", textClass: "text-rose" },
  { rating: 2, label: "Difícil", textClass: "" },
  { rating: 3, label: "Bien", textClass: "" },
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
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="t-small truncate text-faint">{subjectName}</span>
        <span className="t-small num flex-none text-faint">
          {graduated} de {total}
        </span>
      </div>
      <div className="progress" style={{ height: 2 }}>
        <i style={{ width: `${pct}%` }} />
      </div>

      <div className="flex min-h-[220px] flex-col items-center justify-center gap-6 rounded-md border border-border bg-surface px-8 py-10 text-center">
        <div className="t-h2 whitespace-pre-wrap">{current.front}</div>

        {!revealed ? (
          <button type="button" className="btn btn-sm" onClick={() => setRevealed(true)}>
            Mostrar respuesta
            <span className="kbd">Espacio</span>
          </button>
        ) : (
          <>
            <div className="h-px w-full bg-border" />
            <div className="t-body whitespace-pre-wrap text-muted">{current.back}</div>
          </>
        )}
      </div>

      {revealed && (
        <>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {OPCIONES.map((o) => (
              <button
                key={o.rating}
                type="button"
                disabled={busy}
                onClick={() => void rate(o.rating)}
                className={clsx("btn gap-2", o.rating === 3 && "border-primary")}
              >
                <span className={o.textClass}>{o.label}</span>
                <span className="t-small num text-faint">{previews?.[o.rating]}</span>
                <span className="kbd">{o.rating}</span>
              </button>
            ))}
          </div>
          {error && <p className="t-small text-center text-rose">{error}</p>}
        </>
      )}
    </div>
  );
}
