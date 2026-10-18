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
import { t } from "@/lib/i18n";

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
      if (!source.trim()) throw new Error(t("No hay material para armar el cuestionario. Escribí apuntes en las clases o subí bibliografía."));
      const focus = mode === "tema" && tema ? `Concentrate en este tema: ${tema}.\n\n` : mode === "parcial" && tema ? `Hacé foco en: ${tema}.\n\n` : "";
      const questions = await generateQuiz(ai, `${focus}${source}`, Number(count));
      const title =
        mode === "clase"
          ? t("Cuestionario · {name}", { name: clase?.title.replace(/^Clase (\d+) · \d{2}\/\d{2} · /, t("Clase $1: ")) ?? t("Clase") })
          : mode === "parcial"
            ? t("Cuestionario · {name}", { name: exam?.title ?? t("Parcial") })
            : t("Cuestionario · {name}", { name: tema });
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
      setError(err instanceof Error ? err.message : t("No pudimos armar el cuestionario. Probá de nuevo."));
      setBusy(false);
    }
  }

  const disabled = busy || (mode === "clase" && !clase) || (mode === "parcial" && !exam) || (mode === "tema" && !tema.trim());

  return (
    <Modal
      open
      onClose={onClose}
      title={t("Nuevo cuestionario")}
      width={520}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancelar")}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={disabled}>
            <Sparkles className="h-4 w-4" strokeWidth={1.75} />
            {busy ? t("Armando…") : t("Armar cuestionario")}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="field">
          <span>{t("Sobre")}</span>
          <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="parcial">{t("Lo que entra en un parcial o final")}</option>
            <option value="clase">{t("Una clase")}</option>
            <option value="tema">{t("Un tema")}</option>
          </Select>
        </label>

        {mode === "clase" && (
          <label className="field">
            <span>{t("Clase")}</span>
            {classes.length ? (
              <Select value={clase?.id ?? ""} onChange={(e) => setClaseId(e.target.value)}>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="t-small text-muted">{t("Esta materia no tiene clases. Cargá el cronograma con la IA o elegí «Un tema».")}</p>
            )}
          </label>
        )}

        {mode === "parcial" && (
          <>
            <label className="field">
              <span>{t("Para")}</span>
              {exams.length ? (
                <Select value={exam?.id ?? ""} onChange={(e) => setParcialId(e.target.value)}>
                  {exams.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.title}
                      {ex.dueDate ? ` · ${shortDate(ex.dueDate)}` : ""}
                    </option>
                  ))}
                </Select>
              ) : (
                <p className="t-small text-muted">{t("No hay parciales cargados en esta materia. Agregá uno como tarea de tipo Parcial o elegí «Un tema».")}</p>
              )}
            </label>
            <label className="field">
              <span>{t("Enfocarse en (opcional)")}</span>
              <input className="input" value={tema} onChange={(e) => setTema(e.target.value)} placeholder={t("Ej: elasticidades, unidad 2")} />
            </label>
          </>
        )}

        {mode === "tema" && (
          <label className="field">
            <span>{t("Tema")}</span>
            <input className="input" autoFocus value={tema} onChange={(e) => setTema(e.target.value)} placeholder={t("Ej: costos de producción")} />
          </label>
        )}

        <label className="field">
          <span>{t("Preguntas")}</span>
          <Select value={count} onChange={(e) => setCount(e.target.value)}>
            <option value="5">5</option>
            <option value="8">8</option>
            <option value="10">10</option>
            <option value="15">15</option>
          </Select>
        </label>

        {error && <p className="t-small text-rose">{error}</p>}
        {busy && <p className="t-small text-muted">{t("La IA está leyendo el material y armando las preguntas…")}</p>}
      </div>
    </Modal>
  );
}
