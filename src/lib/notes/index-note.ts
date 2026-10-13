// Índice de una nota a partir de sus bloques de BlockNote: texto plano, enlaces [[ ]], etiquetas y títulos.
// Se recalcula en cada guardado (plainTextCache, links, tags) y lo usan la búsqueda, el grafo y el esquema.

export interface BlockLike {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: BlockLike[];
}

export interface NoteIndex {
  plainText: string;
  links: string[]; // ids de notas
  tags: string[]; // sin "#", en minúsculas
  headings: { blockId: string; level: number; text: string }[];
}

// #palabra o #materia/unidad1. No matchea "#" pegado a una palabra (ej. enlaces con ancla).
export const TAG_SOURCE = "(?<![\\p{L}\\p{N}_&/#])#([\\p{L}\\p{N}_][\\p{L}\\p{N}_/-]*)";
export const tagRegex = () => new RegExp(TAG_SOURCE, "gu");

export function normalizeTag(raw: string): string {
  return raw.replace(/^#/, "").replace(/[/-]+$/, "").toLowerCase();
}

// "#tarjeta" es el marcador de las tarjetas inline, no una etiqueta de tema.
export const CARD_MARKER = "tarjeta";

export function extractTags(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(tagRegex())) {
    const tag = normalizeTag(m[1]);
    if (tag && tag !== CARD_MARKER) out.add(tag);
  }
  return [...out];
}

function inlineText(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const node = item as { type?: unknown; text?: unknown; content?: unknown; props?: Record<string, unknown> };
      if (node.type === "link") return inlineText(node.content);
      if (node.type === "wikilink") return String(node.props?.alias || node.props?.title || "");
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

// Texto del propio bloque (sin hijos).
export function blockOwnText(block: BlockLike): string {
  const c = block.content;
  if (Array.isArray(c)) return inlineText(c).trim();
  if (c && typeof c === "object" && (c as { type?: unknown }).type === "tableContent") {
    return tableText(c as { rows?: { cells?: unknown[] }[] }).trim();
  }
  return "";
}

// Texto plano de los bloques (lo usan la IA, la búsqueda y las vistas previas).
export function plainTextOf(blocks: BlockLike[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    const text = blockOwnText(block);
    if (text) lines.push(text);
    if (block.children?.length) {
      const nested = plainTextOf(block.children);
      if (nested) lines.push(nested);
    }
  }
  return lines.join("\n");
}

// Recorre todos los bloques (con hijos) y junta los ids de enlaces [[ ]].
function walkBlocks(blocks: BlockLike[], visit: (b: BlockLike) => void) {
  for (const b of blocks) {
    visit(b);
    if (b.children?.length) walkBlocks(b.children, visit);
  }
}

export function indexNote(blocks: BlockLike[]): NoteIndex {
  const links = new Set<string>();
  const headings: NoteIndex["headings"] = [];
  walkBlocks(blocks, (b) => {
    if (Array.isArray(b.content)) {
      for (const item of b.content as { type?: string; props?: { noteId?: string } }[]) {
        if (item?.type === "wikilink" && item.props?.noteId) links.add(item.props.noteId);
      }
    }
    if (b.type === "heading" && b.id) {
      headings.push({ blockId: b.id, level: Number(b.props?.level ?? 1), text: blockOwnText(b) });
    }
  });
  const plainText = plainTextOf(blocks);
  return { plainText, links: [...links], tags: extractTags(plainText), headings };
}

// Cambia el noteId de todos los enlaces [[ ]] (la usa "Combinar con otra nota").
export function mapWikilinks(blocks: BlockLike[], from: string, to: string): BlockLike[] {
  return blocks.map((b) => {
    const content = Array.isArray(b.content)
      ? b.content.map((item) => {
          const node = item as { type?: string; props?: Record<string, unknown> };
          return node?.type === "wikilink" && node.props?.noteId === from ? { ...node, props: { ...node.props, noteId: to } } : item;
        })
      : b.content;
    return {
      ...b,
      content,
      children: b.children ? mapWikilinks(b.children, from, to) : b.children,
    };
  });
}
