"use client";

// Muestra los cuestionarios que arma la IA desde el chat (evento "uc:quiz").

import { useEffect, useState } from "react";
import type { QuizQuestion } from "@/lib/ai/prompts";
import { QuizModal } from "./quiz-modal";

export function QuizHost() {
  const [quiz, setQuiz] = useState<{ title?: string; questions: QuizQuestion[] } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setQuiz((e as CustomEvent<{ title?: string; questions: QuizQuestion[] }>).detail);
    window.addEventListener("uc:quiz", on);
    return () => window.removeEventListener("uc:quiz", on);
  }, []);
  if (!quiz) return null;
  return <QuizModal key={JSON.stringify(quiz.questions).length} title={quiz.title} questions={quiz.questions} onClose={() => setQuiz(null)} />;
}
