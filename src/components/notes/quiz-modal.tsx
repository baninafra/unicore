"use client";

import clsx from "clsx";
import { useState } from "react";
import { t } from "@/lib/i18n";
import { Modal } from "@/components/ui/modal";
import type { QuizQuestion } from "@/lib/ai/prompts";

// Examen de autoevaluación: corrige al elegir, muestra la explicación y el puntaje final.
export function QuizModal({ questions, onClose, title }: { questions: QuizQuestion[]; onClose: () => void; title?: string }) {
  const [answers, setAnswers] = useState<(number | undefined)[]>(() => questions.map(() => undefined));

  const answered = answers.filter((a) => a !== undefined).length;
  const score = answers.reduce<number>((acc, a, i) => acc + (a === questions[i].answerIndex ? 1 : 0), 0);
  const done = answered === questions.length;

  const choose = (qi: number, oi: number) => {
    if (answers[qi] !== undefined) return;
    setAnswers((prev) => prev.map((a, i) => (i === qi ? oi : a)));
  };

  const restart = () => setAnswers(questions.map(() => undefined));

  return (
    <Modal
      open
      onClose={onClose}
      title={title ? t("Cuestionario: {title}", { title }) : t("Tomame examen")}
      width={640}
      footer={
        <>
          {done ? (
            <button type="button" className="btn" onClick={restart}>
              {t("Repetir examen")}
            </button>
          ) : (
            <span className="t-small num text-muted">
              {t("{answered} de {total} respondidas", { answered, total: questions.length })}
            </span>
          )}
          <button type="button" className="btn" onClick={onClose}>
            {t("Cerrar")}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <ol className="flex flex-col gap-6">
          {questions.map((q, qi) => {
            const chosen = answers[qi];
            const revealed = chosen !== undefined;
            return (
              <li key={qi} className="flex flex-col gap-2">
                <p className="t-h3">
                  {qi + 1}. {q.question}
                </p>
                <div className="flex flex-col gap-2">
                  {q.options.map((option, oi) => {
                    const isCorrect = oi === q.answerIndex;
                    const isChosen = chosen === oi;
                    return (
                      <button
                        key={oi}
                        type="button"
                        disabled={revealed}
                        onClick={() => choose(qi, oi)}
                        className={clsx(
                          "flex items-start gap-3 rounded-md border px-3 py-2 text-left t-body transition-colors disabled:cursor-default",
                          revealed && isCorrect && "border-mint bg-mint-tint text-text",
                          revealed && isChosen && !isCorrect && "border-rose bg-rose-tint text-text",
                          !revealed && "border-border bg-surface-raised hover:border-border-strong",
                          revealed && !isCorrect && !isChosen && "border-border bg-surface-raised text-muted",
                        )}
                      >
                        <span className="num t-small mt-0.5 text-faint">{String.fromCharCode(65 + oi)}</span>
                        <span className="min-w-0 flex-1">{option}</span>
                      </button>
                    );
                  })}
                </div>
                {revealed && (
                  <p className="t-small text-muted">
                    <span className={chosen === q.answerIndex ? "text-mint" : "text-rose"}>
                      {chosen === q.answerIndex ? t("Correcta.") : t("Incorrecta.")}
                    </span>{" "}
                    {q.explanation}
                  </p>
                )}
              </li>
            );
          })}
        </ol>

        {done && (
          <div className="flex items-baseline justify-between gap-3 rounded-md border border-border bg-surface-raised px-4 py-3">
            <span className="t-h3">{t("Puntaje final")}</span>
            <span className="t-h2 num">
              {t("{score} de {total}", { score, total: questions.length })}
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
}
