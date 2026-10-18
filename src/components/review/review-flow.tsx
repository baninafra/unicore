"use client";

import { useCallback, useState } from "react";
import { ReviewSession } from "./review-session";
import { ReviewSetup, type ReviewRun } from "./review-setup";
import { ReviewSummary } from "./review-summary";

// Pasos del repaso: filtros, sesión y cierre.
export function ReviewFlow({ initialSubjectId }: { initialSubjectId: string }) {
  const [run, setRun] = useState<ReviewRun | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);

  const onFinish = useCallback((m: number) => setMinutes(m), []);

  if (run && minutes !== null) {
    return (
      <ReviewSummary
        total={run.cards.length}
        minutes={minutes}
        subjectIds={run.subjectIds}
        onRestart={() => {
          setRun(null);
          setMinutes(null);
        }}
      />
    );
  }
  if (run) {
    return <ReviewSession cards={run.cards} onFinish={onFinish} />;
  }
  return (
    <ReviewSetup
      initialSubjectId={initialSubjectId}
      onStart={(r) => {
        setMinutes(null);
        setRun(r);
      }}
    />
  );
}
