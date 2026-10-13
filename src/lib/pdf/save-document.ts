"use client";

import { db, newId, nowIso, saveFile } from "@/lib/db";
import type { PdfExtraction } from "./import-pdf";

// Guarda el PDF original y su texto extraído como documento de la materia. Devuelve el id del documento.
export async function savePdfDocument(
  file: File,
  extraction: PdfExtraction,
  subjectId: string,
  unitNumber = 1,
): Promise<string> {
  const id = newId();
  await db.transaction("rw", db.files, db.documents, async () => {
    const url = await saveFile(file);
    await db.documents.add({
      id,
      subjectId,
      unitNumber,
      fileName: file.name,
      extractedText: extraction.plainText,
      pageCount: extraction.pages.length,
      fileId: url.startsWith("idb://") ? url.slice(6) : url,
      createdAt: nowIso(),
    });
  });
  return id;
}
