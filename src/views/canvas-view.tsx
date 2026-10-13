"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { CanvasBoard } from "@/components/canvas/canvas-board";

// Lienzo (Canvas): tarjetas de texto, notas, archivos, PDF, webs y grupos sobre un tablero libre.
export function CanvasView({ id }: { id: string }) {
  // undefined mientras carga, null si el lienzo no existe.
  const doc = useLiveQuery(async () => (await db.canvases.get(id)) ?? null, [id], undefined);
  if (doc === undefined) return null;
  if (doc === null) return <div className="p-4 t-small text-faint">Lienzo no encontrado</div>;
  return <CanvasBoard key={doc.id} doc={doc} />;
}
