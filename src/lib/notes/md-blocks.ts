// Markdown liviano → bloques de BlockNote. Lo usan la IA (crear notas) y los importadores
// (PDF, Excel, PowerPoint, Word) para que todo quede como nota editable de la app.

type Styles = { bold?: true; italic?: true; code?: true; strike?: true };
type Inline = { type: "text"; text: string; styles: Styles } | { type: "link"; href: string; content: { type: "text"; text: string; styles: Styles }[] };
export type MdBlock = Record<string, unknown>;

// **negrita**, *itálica*, `código`, ~~tachado~~ y [texto](url)
export function inlineMd(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|`([^`]+)`|~~([^~]+)~~|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (t: string, styles: Styles = {}) => t && out.push({ type: "text", text: t, styles });
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index));
    if (m[2] ?? m[3]) push((m[2] ?? m[3])!, { bold: true });
    else if (m[4] ?? m[5]) push((m[4] ?? m[5])!, { italic: true });
    else if (m[6]) push(m[6], { code: true });
    else if (m[7]) push(m[7], { strike: true });
    else if (m[8]) out.push({ type: "link", href: m[9], content: [{ type: "text", text: m[8], styles: {} }] });
    last = m.index + m[0].length;
  }
  push(text.slice(last));
  return out;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function tableBlock(rows: string[][]): MdBlock {
  const width = Math.max(1, ...rows.map((r) => r.length));
  return {
    type: "table",
    content: {
      type: "tableContent",
      rows: rows.map((r) => ({ cells: Array.from({ length: width }, (_, i) => inlineMd(r[i] ?? "")) })),
    },
  };
}

export function markdownToBlocks(md: string): MdBlock[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "paragraph", content: inlineMd(para.join(" ")) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    // Bloque de código
    const fence = line.match(/^\s*```(\w*)/);
    if (fence) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      blocks.push({ type: "codeBlock", props: { language: fence[1] || "text" }, content: code.join("\n") });
      continue;
    }
    // Tabla
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const rows = [splitRow(line)];
      i++;
      while (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i + 1])) rows.push(splitRow(lines[++i]));
      blocks.push(tableBlock(rows));
      continue;
    }
    const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      blocks.push({ type: "heading", props: { level: Math.min(3, h[1].length) }, content: inlineMd(h[2]) });
      continue;
    }
    const img = line.match(/^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/);
    if (img) {
      flush();
      blocks.push({ type: "image", props: { url: img[2], caption: img[1] } });
      continue;
    }
    const check = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (check) {
      flush();
      blocks.push({ type: "checkListItem", props: { checked: check[1] !== " " }, content: inlineMd(check[2]) });
      continue;
    }
    const bullet = line.match(/^(\s*)[-*+•]\s+(.*)$/);
    if (bullet) {
      flush();
      const item = { type: "bulletListItem", content: inlineMd(bullet[2]), children: [] as MdBlock[] };
      const parent = bullet[1].length >= 2 ? blocks[blocks.length - 1] : undefined;
      if (parent && (parent.type === "bulletListItem" || parent.type === "numberedListItem")) (parent.children as MdBlock[]).push(item);
      else blocks.push(item);
      continue;
    }
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (num) {
      flush();
      blocks.push({ type: "numberedListItem", content: inlineMd(num[1]), children: [] });
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flush();
      blocks.push({ type: "quote", content: inlineMd(quote[1]) });
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flush();
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

// Texto plano para el índice y la búsqueda.
export function markdownToPlain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*/g, ""))
    .replace(/[*_`~#>|]/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[ \t]+/g, " ")
    .trim();
}
