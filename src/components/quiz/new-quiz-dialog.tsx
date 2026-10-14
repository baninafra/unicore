"use client";

// Nuevo cuestionario de una materia: sobre una clase, para un parcial o sobre un tema.

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { db } from "@/lib/db";
import { useLocalAI } from "@/lib/ai/use-local-ai";
import { generateQuiz } from "@/lib/ai/prompts";
import { examsOf, quizSource, saveQuiz } from "@/lib/quiz/quiz-store";
import { isClassNote, classDate } from "@/lib/tasks/class-tasks";
import { useWorkspace } from "@/lib/workspace";
import { shortDate } from "@/lib/format";

export function NewQuizDialog({ subjectId, initialClaseId, onClose }: { subjectId: string; initialClaseId?: string; onClose: () => void }) {
  const ai = useLocalAI();
  const { openView } = useWorkspace();
  const classes = useLiveQuery(
    async () => (await db.notes.where("subjectId").equals(subjectId).toArray()).filter(isClassNote).sort((a, b) => (classDate(a) ?? "").localeCompare(classDate(b) ?? "")),
    [subjectId],
  ) ?? [];
  const exams = useLiveQuery(() => examsOf(subjectId), [subjectId]) ?? [];
  const [mode, setMode] = useState<"clase" | "parcial" | "tema">(initialClaseId ? "clase" : "parcial");
  const [claseId, setClaseId] = useState(initialClaseId ?? "");
  const [parcialId, setParcialId] = useState("");
  const [tema, setTema] = useState("");
  const [count, setCount] = useState("8");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const clase = classes.find((c) => c.id === (claseId || classes[0]?.id));
  const exam = exams.find((e) => e.id === (parcialId || exams[0]?.id));

  async function create() {
    setBusy(true);
    setError(undefined);
    try {
      const subject = await db.subjects.get(subjectId);
      const opts =
        mode === "clase"
          ? { subjectId, claseId: clase?.id }
          : mode === "parcial"
            ? { subjectId, parcialId: exam?.id, tema: tema || undefined }
            : { subjectId, tema };
      const source = await quizSource(opts);
      if (!source.trim()) throw new Error("No hay material para armar el cuestionario. Escribí apuntes en las clases o subí bibliografía.");
      const focus = mode === "tema" && tema ? `Concentrate en este tema: ${tema}.\n\n` : mode === "parcial" && tema ? `Hacé foco en: ${tema}.\n\n` : "";
      const questions = await generateQuiz(ai, `${focus}${source}`, Number(count));
      const title =
        mode === "clase"
          ? `Cuestionario · ${clase?.title.replace(/^Clase (\d+) · \d{2}\/\d{2} · /, "Clase $1: ") ?? "Clase"}`
          : mode === "parcial"
            ? `Cuestionario · ${exam?.title ?? "Parcial"}`
            : `Cuestionario · ${tema}`;
      const id = await saveQuiz({
        subjectId,
        title,
        questions,
        claseId: mode === "clase" ? clase?.id : undefined,
        parcialId: mode === "parcial" ? exam?.id : undefined,
        parcial: mode === "parcial" ? exam?.title : undefined,
        tema: mode === "tema" ? tema : mode === "parcial" ? tema || exam?.title : clase?.title ?? subject?.name,
      });
      onClose();
      openView({ type: "nota", id }, "tab");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos armar el cuestionario. Probá de nuevo.");
      setBusy(false);
    }
  }

  const disabled = busy || (mode === "clase" && !clase) || (mode === "parcial" && !exam) || (mode === "tema" && !tema.trim());

  return (
    <Modal
      open
      onClose={onClose}
      title="Nuevo cuestionario"
      width={520}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={disabled}>
            <Sparkles className="h-4 w-4" strokeWidth={1.75} />
            {busy ? "Armando…" : "Armar cuestionario"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="field">
          <span>Sobre</span>
          <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="parcial">Lo que entra en un parcial o final</option>
            <option value="clase">Una clase</option>
            <option value="tema">Un tema</option>
          </Select>
        </label>

        {mode === "clase" && (
          <label className="field">
            <span>Clase</span>
            {classes.length ? (
              <Select value={clase?.id ?? ""} onChange={(e) => setClaseId(e.target.value)}>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="t-small text-muted">Esta materia no tiene clases. Cargá el cronograma con la IA o elegí «Un tema».</p>
            )}
          </label>
        )}

        {mode === "parcial" && (
          <>
            <label className="field">
              <span>Para</span>
              {exams.length ? (
                <Select value={exam?.id ?? ""} onChange={(e) => setParcialId(e.target.value)}>
                  {exams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                      {t.dueDate ? ` · ${shortDate(t.dueDate)}` : ""}
                    </option>
                  ))}
                </Select>
              ) : (
                <p className="t-small text-muted">No hay parciales cargados en esta materia. Agregá uno como tarea de tipo Parcial o elegí «Un tema».</p>
              )}
            </label>
            <label className="field">
              <span>Enfocarse en (opcional)</span>
              <input className="input" value={tema} onChange={(e) => setTema(e.target.value)} placeholder="Ej: elasticidades, unidad 2" />
            </label>
          </>
        )}

        {mode === "tema" && (
          <label className="field">
            <span>Tema</span>
            <input className="input" autoFocus value={tema} onChange={(e) => setTema(e.target.value)} placeholder="Ej: costos de producción" />
          </label>
        )}

        <label className="field">
          <span>Preguntas</span>
          <Select value={count} onChange={(e) => setCount(e.target.value)}>
            <option value="5">5</option>
            <option value="8">8</option>
            <option value="10">10</option>
            <option value="15">15</option>
          </Select>
        </label>

        {error && <p className="t-small text-rose">{error}</p>}
        {busy && <p className="t-small text-muted">La IA está leyendo el material y armando las preguntas…</p>}
      </div>
    </Modal>
  );
}
