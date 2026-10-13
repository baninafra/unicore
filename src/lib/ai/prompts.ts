"use client";

// CONTRATO: tareas de IA reutilizables. STUB: lo implementa el módulo de IA.
import type { LocalAI } from "./use-local-ai";
import type { TaskType } from "../types";

export interface FlashcardDraft {
  front: string;
  back: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

export interface EmailAnalysis {
  summary: string; // un renglón
  dueDate?: string; // ISO
  subjectId?: string;
  type?: TaskType;
}

// Devuelve entre 5 y `count` tarjetas pregunta/respuesta a partir de un texto.
export async function generateFlashcards(ai: LocalAI, text: string, count = 8): Promise<FlashcardDraft[]> {
  void ai; void text; void count;
  return [];
}

// Examen multiple choice de autoevaluación.
export async function generateQuiz(ai: LocalAI, text: string, count = 5): Promise<QuizQuestion[]> {
  void ai; void text; void count;
  return [];
}

// Resume un mail de la facultad y sugiere fecha, materia y tipo.
export async function analyzeEmail(
  ai: LocalAI,
  input: { from?: string; subject?: string; body: string; subjects: { id: string; name: string }[] },
): Promise<EmailAnalysis> {
  void ai;
  return { summary: input.body.slice(0, 120) };
}
