"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ReviewFlow } from "@/components/review/review-flow";

// Lee ?materia=<id>. La key reinicia el flujo cuando cambia la materia de la URL.
function RepasoContent() {
  const materia = useSearchParams().get("materia") ?? "";
  return <ReviewFlow key={materia} initialSubjectId={materia} />;
}

export default function RepasoPage() {
  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="t-h1">Repaso</h1>
        <p className="t-small text-muted">Repasá lo que te toca hoy.</p>
      </header>
      <Suspense fallback={null}>
        <RepasoContent />
      </Suspense>
    </div>
  );
}
