import type { PartialBlock } from "@blocknote/core";
import { db, newId, nowIso } from "@/lib/db";
import type { Note } from "@/lib/types";

// Mínimo de caracteres para que la IA tenga material con qué generar tarjetas o un examen.
export const MIN_CHARS_FOR_AI = 200;

interface BlockLike {
  content?: unknown;
  children?: BlockLike[];
}

function inlineText(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const node = item as { type?: unknown; text?: unknown; content?: unknown };
      if (node.type === "link") return inlineText(node.content);
      return typeof node.text === "string" ? node.text : "";
    })
    .join("");
}

// Tablas de BlockNote: content = { type: "tableContent", rows: [{ cells: [...] }] }
function tableText(content: { rows?: { cells?: unknown[] }[] }): string {
  return (content.rows ?? [])
    .map((row) =>
      (row.cells ?? [])
        .map((cell) => inlineText(Array.isArray(cell) ? cell : (cell as { content?: unknown } | null)?.content))
        .join(" | "),
    )
    .join("\n");
}

// Texto plano de los bloques de BlockNote (lo usan la IA y la búsqueda).
export function plainTextOf(blocks: BlockLike[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    const c = block.content;
    let text = "";
    if (Array.isArray(c)) {
      text = inlineText(c);
    } else if (c && typeof c === "object" && (c as { type?: unknown }).type === "tableContent") {
      text = tableText(c as { rows?: { cells?: unknown[] }[] });
    }
    if (text.trim()) lines.push(text.trim());
    if (block.children?.length) {
      const nested = plainTextOf(block.children);
      if (nested) lines.push(nested);
    }
  }
  return lines.join("\n");
}

// Párrafos de un texto plano (separados por líneas en blanco) como bloques de BlockNote.
export function paragraphBlocks(text: string): PartialBlock[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((p) => ({ type: "paragraph" as const, content: p }));
}

// Orden de la lista: por unidad y, dentro de cada unidad, por fecha de creación.
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => a.unitNumber - b.unitNumber || a.createdAt.localeCompare(b.createdAt));
}

export async function createNote(input: {
  subjectId: string;
  title: string;
  unitNumber: number;
  content?: unknown[];
  plainTextCache?: string;
}): Promise<string> {
  const id = newId();
  const now = nowIso();
  await db.notes.add({
    id,
    subjectId: input.subjectId,
    title: input.title.trim() || "Sin título",
    unitNumber: input.unitNumber,
    content: input.content ?? [],
    plainTextCache: input.plainTextCache ?? "",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}
