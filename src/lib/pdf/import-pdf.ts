"use client";

// CONTRATO: importar PDFs como texto. STUB: lo implementa el módulo de PDF.

export interface PdfParagraph {
  text: string;
  kind: "heading" | "paragraph";
}

export interface PdfPage {
  number: number;
  paragraphs: PdfParagraph[];
  usedOcr: boolean;
}

export interface PdfExtraction {
  fileName: string;
  pages: PdfPage[];
  plainText: string;
  usedOcr: boolean;
}

export interface PdfProgress {
  page: number;
  total: number;
  stage: "texto" | "ocr";
}

// Extrae el texto de un PDF en el navegador. Si una página es una imagen (escaneo), usa OCR en español.
export async function extractPdf(file: File, onProgress?: (p: PdfProgress) => void): Promise<PdfExtraction> {
  void onProgress;
  return { fileName: file.name, pages: [], plainText: "", usedOcr: false };
}

// Convierte la extracción en bloques de BlockNote (PartialBlock[]) para insertar en un apunte.
export function pdfToBlocks(extraction: PdfExtraction): unknown[] {
  void extraction;
  return [];
}
