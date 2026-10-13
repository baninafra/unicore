"use client";

import { Rating, State, createEmptyCard, fsrs, generatorParameters, type Card, type Grade } from "ts-fsrs";
import { db } from "./db";
import type { Flashcard } from "./types";

// Scheduler FSRS (repetición espaciada). Un único objeto para todo el módulo.
const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

// 1 Otra vez, 2 Difícil, 3 Bien, 4 Fácil
export type Calificacion = 1 | 2 | 3 | 4;

const GRADE: Record<Calificacion, Grade> = {
  1: Rating.Again,
  2: Rating.Hard,
  3: Rating.Good,
  4: Rating.Easy,
};

// Campos FSRS que guardamos en Flashcard (todo lo que no es contenido).
export type FsrsFields = Pick<
  Flashcard,
  "due" | "stability" | "difficulty" | "elapsedDays" | "scheduledDays" | "learningSteps" | "reps" | "lapses" | "state"
> & { lastReview?: string };

// Flashcard -> Card de ts-fsrs (fechas ISO a Date).
export function toCard(f: Flashcard): Card {
  return {
    due: new Date(f.due),
    stability: f.stability,
    difficulty: f.difficulty,
    elapsed_days: f.elapsedDays,
    scheduled_days: f.scheduledDays,
    learning_steps: f.learningSteps,
    reps: f.reps,
    lapses: f.lapses,
    state: f.state as State,
    last_review: f.lastReview ? new Date(f.lastReview) : undefined,
  };
}

function cardFields(card: Card): FsrsFields {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review?.toISOString(),
  };
}

// Card de ts-fsrs -> campos de Flashcard (Date a ISO).
export function fromCard(card: Card): Partial<Flashcard> {
  return cardFields(card);
}

// Campos FSRS de una tarjeta nueva (createEmptyCard): vence ya.
export function newCardFields(now: Date = new Date()): FsrsFields {
  return cardFields(createEmptyCard(now));
}

// "1 min", "8 min", "3 h", "2 días", "1 día"
function formatWait(due: Date, now: Date): string {
  const mins = Math.max(1, Math.round((due.getTime() - now.getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (mins < 60 * 24) return `${hours} h`;
  const days = Math.round(mins / (60 * 24));
  return days === 1 ? "1 día" : `${days} días`;
}

// Intervalo que quedaría por cada calificación. Usá el mismo `now` que en rateCard
// (ts-fsrs usa la hora de revisión como semilla del fuzz, así coinciden).
export function previewIntervals(f: Flashcard, now: Date = new Date()): Record<Calificacion, string> {
  const preview = scheduler.repeat(toCard(f), now);
  return {
    1: formatWait(preview[GRADE[1]].card.due, now),
    2: formatWait(preview[GRADE[2]].card.due, now),
    3: formatWait(preview[GRADE[3]].card.due, now),
    4: formatWait(preview[GRADE[4]].card.due, now),
  };
}

// Aplica la calificación, guarda la tarjeta en db.flashcards y devuelve la tarjeta actualizada.
export async function rateCard(f: Flashcard, rating: Calificacion, now: Date = new Date()): Promise<Flashcard> {
  const { card } = scheduler.next(toCard(f), now, GRADE[rating]);
  const changes = fromCard(card);
  await db.flashcards.update(f.id, changes);
  return { ...f, ...changes };
}
