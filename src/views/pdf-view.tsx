"use client";

// STUB: lector de PDF con resaltado. Lo implementa otro módulo.
export function PdfView({ id, page }: { id: string; page?: number }) {
  return <div className="p-4 t-small text-faint">PDF {id} {page}</div>;
}
