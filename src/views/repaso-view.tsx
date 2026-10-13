"use client";

import { ReviewFlow } from "@/components/review/review-flow";

// Repaso centrado, sin encabezado: la pestaña ya dice dónde estás.
export function RepasoView({ subjectId = "" }: { subjectId?: string }) {
  return (
    <div className="mx-auto w-full max-w-[640px] px-6 py-10">
      <ReviewFlow key={subjectId} initialSubjectId={subjectId} />
    </div>
  );
}
