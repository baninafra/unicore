"use client";

// Cuestionario abierto como página: responder, ver la explicación, puntaje, historial de intentos,
// "Hacer otro sobre lo mismo" (lo arma la IA) y pasar las preguntas a flashcards.

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, Check, ClipboardCheck, Layers, RotateCcw, Sparkles, X } from "lucide-react";
import { db } from "@/lib/db";
import { useLocalAI } from "@/lib/ai/use-local-ai";
import { useOpen } from "@/components/workspace/use-open";
import { newFlashcardRecord } from "@/components/flashcards/fsrs-card";
import { makeAnother, readQuiz, recordAttempt } from "@/lib/quiz/quiz-store";
import { specialFolderName } from "@/lib/panes/note-data";
import { toast } from "@/lib/undo";
import type { Note } from "@/lib/types";

export function QuizPage({ note }: { note: Note }) {
  const meta = useMemo(() => readQuiz(note), [note]);
  const qs = meta.questions;
  const ai = useLocalAI();
  const open = useOpen();
  const subject = useLiveQuery(() => db.subjects.get(note.subjectId), [note.subjectId]);
  const clase = useLiveQuery(() => (meta.claseId ? db.notes.get(meta.claseId) : undefined), [meta.claseId]);
  const [answers, setAnswers] = useState<(number | undefined)[]>(() => qs.map(() => undefined));
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const answered = answers.filter((a) => a !== undefined).length;
  const correct = answers.reduce<number>((acc, a, i) => acc + (a === qs[i]?.answerIndex ? 1 : 0), 0);
  const done = qs.length > 0 && answered === qs.length;

  // Al terminar se guarda el intento (una vez por intento).
  useEffect(() => {
    if (!done || saved) return;
    setSaved(true);
    void recordAttempt(note, correct, qs.length);
  }, [done, saved, note, correct, qs.length]);

  const choose = (qi: number, oi: number) =>
    setAnswers((prev) => (prev[qi] !== undefined ? prev : prev.map((a, i) => (i === qi ? oi : a))));

  const restart = () => {
    setAnswers(qs.map(() => undefined));
    setSaved(false);
    window.scrollTo({ top: 0 });
  };

  async function another(e: React.MouseEvent) {
    setBusy("La IA está armando otro cuestionario sobre lo mismo…");
    try {
      const id = await makeAnother(ai, note);
      open({ type: "nota", id }, { ctrlKey: !e.shiftKey });
    } catch (err) {
      toast(err instanceof Error ? err.message : "No pudimos armar otro cuestionario.", { tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function toCards() {
    const subjectId = note.subjectId;
    await db.flashcards.bulkAdd(
      qs.map((q) =>
        newFlashcardRecord({ subjectId, noteId: note.id, front: q.question, back: `${q.options[q.answerIndex]}${q.explanation ? ` — ${q.explanation}` : ""}` }),
      ),
    );
    toast(`Creamos ${qs.length} flashcards`);
  }

  const place = subject?.name ?? specialFolderName(note.subjectId);
  const pct = qs.length ? Math.round((correct / qs.length) * 100) : 0;

  return (
    <div className="view-readable mx-auto w-full px-6 py-6">
      <header className="mb-5 space-y-2">
        <div className="flex items-center gap-2 text-[13px] text-faint">
          <ClipboardCheck className="h-4 w-4 text-primary-soft" strokeWidth={1.75} />
          <span>Cuestionario</span>
          {place && <span>· {place}</span>}
        </div>
        <h1 className="t-h1">{note.title}</h1>
        <div className="flex flex-wrap items-center gap-1.5">
          {meta.parcial && <span className="badge badge-rose">Para: {meta.parcial}</span>}
          {clase && (
            <button type="button" className="tag hover:text-text" onClick={(e) => open({ type: "nota", id: clase.id }, e)}>
              <BookOpen className="h-3 w-3" strokeWidth={1.75} />
              {clase.title}
            </button>
          )}
          <span className="tag">{qs.length} preguntas</span>
          {meta.intentos.length > 0 && <span className="tag">Último intento: {meta.intentos[meta.intentos.length - 1]}</span>}
        </div>
      </header>

      {/* Progreso */}
      <div className="sticky top-0 z-10 -mx-2 mb-4 flex items-center gap-3 rounded-md bg-surface/95 px-2 py-2 backdrop-blur">
        <div className="progress h-1.5 flex-1">
          <i style={{ width: `${qs.length ? (answered / qs.length) * 100 : 0}%` }} />
        </div>
        <span className="num text-[13px] text-muted">
          {answered}/{qs.length} · {correct} bien
        </span>
      </div>

      {qs.length === 0 && <p className="t-body text-muted">Este cuestionario no tiene preguntas.</p>}

      <ol className="space-y-4">
        {qs.map((q, qi) => {
          const a = answers[qi];
          const answeredQ = a !== undefined;
          return (
            <li key={qi} className="card space-y-3 p-4">
              <p className="t-body font-medium text-text">
                <span className="num mr-2 text-faint">{qi + 1}.</span>
                {q.question}
              </p>
              <div className="grid gap-1.5">
                {q.options.map((o, oi) => {
                  const isRight = oi === q.answerIndex;
                  const isPicked = a === oi;
                  return (
                    <button
                      key={oi}
                      type="button"
                      disabled={answeredQ}
                      onClick={() => choose(qi, oi)}
                      className={clsx(
                        "flex items-start gap-2.5 rounded-md border px-3 py-2 text-left text-[14px] transition-colors",
                        !answeredQ && "border-border hover:border-primary hover:bg-primary-tint",
                        answeredQ && isRight && "border-mint bg-mint-tint text-text",
                        answeredQ && isPicked && !isRight && "border-rose bg-rose-tint text-text",
                        answeredQ && !isRight && !isPicked && "border-border text-muted opacity-70",
                      )}
                    >
                      <span className="num mt-px w-4 flex-none text-faint">{"ABCDEF"[oi]}</span>
                      <span className="flex-1">{o}</span>
                      {answeredQ && isRight && <Check className="mt-0.5 h-4 w-4 flex-none text-mint" strokeWidth={2} />}
                      {answeredQ && isPicked && !isRight && <X className="mt-0.5 h-4 w-4 flex-none text-rose" strokeWidth={2} />}
                    </button>
                  );
                })}
              </div>
              {answeredQ && q.explanation && <p className="t-small text-muted">{q.explanation}</p>}
            </li>
          );
        })}
      </ol>

      <div className="mt-6 space-y-3">
        {done && (
          <div className={clsx("card p-4", pct >= 60 ? "border-mint" : "border-amber")}>
            <p className="t-h2">
              {correct} de {qs.length} bien · {pct} %
            </p>
            <p className="t-small text-muted">{pct >= 80 ? "Muy bien. Probá con otro para seguir afianzando." : pct >= 60 ? "Bien. Repasá las que fallaste." : "Conviene repasar el tema y volver a intentar."}</p>
          </div>
        )}
        {busy && <p className="t-small text-muted">{busy}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ai" onClick={(e) => void another(e)} disabled={!!busy}>
            <Sparkles className="h-4 w-4" strokeWidth={1.75} />
            Hacer otro sobre lo mismo
          </button>
          <button type="button" className="btn" onClick={restart}>
            <RotateCcw className="h-4 w-4" strokeWidth={1.75} />
            Rehacer
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void toCards()} disabled={!qs.length}>
            <Layers className="h-4 w-4" strokeWidth={1.75} />
            Pasar a flashcards
          </button>
        </div>
        {meta.intentos.length > 1 && (
          <details className="t-small text-muted">
            <summary className="cursor-pointer">Intentos anteriores</summary>
            <ul className="mt-1 space-y-0.5">
              {[...meta.intentos].reverse().map((t, i) => (
                <li key={i} className="num">
                  {t}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
