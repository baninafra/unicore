import { createEmptyCard } from "ts-fsrs";
import { newId, nowIso } from "@/lib/db";
import type { Flashcard } from "@/lib/types";

// Crea el registro de una flashcard nueva con los campos FSRS iniciales de ts-fsrs.
export function newFlashcardRecord(
  input: { subjectId: string; noteId?: string; front: string; back: string },
  now: Date = new Date(),
): Flashcard {
  const card = createEmptyCard(now);
  return {
    id: newId(),
    subjectId: input.subjectId,
    ...(input.noteId ? { noteId: input.noteId } : {}),
    front: input.front,
    back: input.back,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps ?? 0,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    ...(card.last_review ? { lastReview: card.last_review.toISOString() } : {}),
    createdAt: nowIso(),
  };
}
