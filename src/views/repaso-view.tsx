"use client";

import { ReviewFlow } from "@/components/review/review-flow";

export function RepasoView({ subjectId = "" }: { subjectId?: string }) {
  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="t-h1">Repaso</h1>
        <p className="t-small text-muted">Repasá lo que te toca hoy.</p>
      </header>
      <ReviewFlow key={subjectId} initialSubjectId={subjectId} />
    </div>
  );
}
