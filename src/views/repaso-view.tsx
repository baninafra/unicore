"use client";

import { ReviewFlow } from "@/components/review/review-flow";

// Repaso centrado en la pantalla (a lo ancho y a lo alto), sin encabezado: la pestaña ya dice dónde estás.
export function RepasoView({ subjectId = "" }: { subjectId?: string }) {
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-10">
      <div className="w-full max-w-[640px]">
        <ReviewFlow key={subjectId} initialSubjectId={subjectId} />
      </div>
    </div>
  );
}
