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

// ---------- Bloques → Markdown (para que la IA lea y reescriba una nota sin perder la estructura) ----------

type InlineLike = { type?: string; text?: string; href?: string; styles?: Styles; content?: unknown; props?: Record<string, unknown> };
type BlockMd = { type?: string; props?: Record<string, unknown>; content?: unknown; children?: BlockMd[] };

function inlineToMd(items: unknown): string {
  if (!Array.isArray(items)) return typeof items === "string" ? items : "";
  return (items as InlineLike[])
    .map((n) => {
      if (n?.type === "link") return `[${inlineToMd(n.content)}](${n.href ?? ""})`;
      if (n?.type === "wikilink") {
        const title = String(n.props?.title ?? "");
        const alias = n.props?.alias ? String(n.props.alias) : "";
        return alias && alias !== title ? `[[${title}|${alias}]]` : `[[${title}]]`;
      }
      let t = typeof n?.text === "string" ? n.text : "";
      if (!t.trim()) return t;
      const s = n.styles ?? {};
      if (s.code) t = `\`${t}\``;
      if (s.bold) t = `**${t}**`;
      if (s.italic) t = `*${t}*`;
      if (s.strike) t = `~~${t}~~`;
      return t;
    })
    .join("");
}

// Bloques que el Markdown no puede describir (imágenes de la nota, videos, archivos, dibujos…).
export const TEXT_BLOCKS = new Set(["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "quote", "codeBlock", "table"]);

export function blocksToMarkdown(blocks: unknown[], depth = 0): string {
  const pad = "  ".repeat(depth);
  // Los ítems de lista van pegados; el resto, separado por una línea en blanco (si no, dos párrafos se juntan).
  const out: { md: string; list: boolean }[] = [];
  let n = 0;
  for (const b of blocks as BlockMd[]) {
    const text = inlineToMd(b.content);
    n = b.type === "numberedListItem" ? n + 1 : 0;
    let md: string;
    switch (b.type) {
      case "heading":
        md = `${"#".repeat(Number(b.props?.level) || 1)} ${text}`;
        break;
      case "bulletListItem":
        md = `${pad}- ${text}`;
        break;
      case "numberedListItem":
        md = `${pad}${n}. ${text}`;
        break;
      case "checkListItem":
        md = `${pad}- [${b.props?.checked ? "x" : " "}] ${text}`;
        break;
      case "quote":
        md = `> ${text}`;
        break;
      case "codeBlock":
        md = "```" + (b.props?.language && b.props.language !== "text" ? b.props.language : "") + "\n" + text + "\n```";
        break;
      case "table": {
        const rows = ((b.content as { rows?: { cells?: unknown[] }[] })?.rows ?? []).map((r) =>
          (r.cells ?? []).map((c) => inlineToMd(Array.isArray(c) ? c : (c as { content?: unknown } | null)?.content).replace(/\|/g, "\\|")),
        );
        md = rows.length
          ? [`| ${rows[0].join(" | ")} |`, `|${rows[0].map(() => " --- ").join("|")}|`, ...rows.slice(1).map((r) => `| ${r.join(" | ")} |`)].join("\n")
          : "";
        break;
      }
      case "paragraph":
        md = text ? `${pad}${text}` : "";
        break;
      default:
        // Imagen, video, archivo…: queda un marcador para que la IA sepa que está ahí (no se pierde al reescribir).
        md = `${pad}[${b.type}${b.props?.caption ? `: ${b.props.caption}` : b.props?.name ? `: ${b.props.name}` : ""}]`;
    }
    const list = /ListItem$/.test(b.type ?? "");
    if (b.children?.length) md += `\n${blocksToMarkdown(b.children, depth + 1)}`;
    if (md) out.push({ md, list });
  }
  return out.map((o, i) => (i === 0 ? "" : o.list && out[i - 1].list ? "\n" : "\n\n") + o.md).join("");
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
