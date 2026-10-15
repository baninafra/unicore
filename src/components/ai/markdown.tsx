// Renderiza Markdown de las respuestas de la IA con elementos de React (sin HTML crudo).
// Cubre: títulos, párrafos, listas, negrita, cursiva, código inline y en bloque, tablas GFM,
// citas, reglas y enlaces http(s).

import { Fragment, type ReactNode } from "react";

type Align = "left" | "center" | "right" | undefined;

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "table"; header: string[]; align: Align[]; rows: string[][] }
  | { kind: "quote"; lines: string[] }
  | { kind: "rule" };

const FENCE = /^\s*```/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const UL = /^\s*[-*+]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((cell) => cell.trim());
}

function parseAlign(separator: string): Align[] {
  return splitRow(separator).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return undefined;
  });
}

function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i];
  if (FENCE.test(line) || HEADING.test(line) || RULE.test(line)) return true;
  if (QUOTE.test(line) || UL.test(line) || OL.test(line)) return true;
  return line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]);
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    if (FENCE.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // cierre del bloque
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const header = splitRow(line);
      const align = parseAlign(lines[i + 1]);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", header, align, rows });
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        const m = QUOTE.exec(lines[i]);
        quoted.push(m ? m[1] : "");
        i++;
      }
      blocks.push({ kind: "quote", lines: quoted });
      continue;
    }

    const ul = UL.exec(line);
    const ol = OL.exec(line);
    if (ul || ol) {
      const ordered = !ul;
      const marker = ordered ? OL : UL;
      const items: string[] = [];
      while (i < lines.length) {
        const m = marker.exec(lines[i]);
        if (m) {
          items.push(m[1]);
          i++;
        } else if (items.length > 0 && /^\s{2,}\S/.test(lines[i])) {
          // línea sangrada: continúa el ítem anterior
          items[items.length - 1] += " " + lines[i].trim();
          i++;
        } else {
          break;
        }
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) {
      paragraph.push(lines[i]);
      i++;
    }
    if (paragraph.length === 0) {
      // por seguridad: nunca nos quedamos clavados en una línea
      paragraph.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "paragraph", lines: paragraph });
  }

  return blocks;
}

// Negrita, cursiva, código inline y enlaces. Recursivo para negrita con cursiva adentro.
function renderInline(text: string, prefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|\*([^*\s][^*\n]*?)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let n = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${prefix}-${n++}`;
    if (m[1] !== undefined) {
      out.push(
        <code key={key} className="rounded-sm bg-surface-raised px-1 font-mono text-[length:calc(13px*var(--ui-scale,1))]">
          {m[1]}
        </code>,
      );
    } else if (m[2] !== undefined) {
      out.push(
        <strong key={key} className="font-semibold">
          {renderInline(m[2], key)}
        </strong>,
      );
    } else if (m[3] !== undefined) {
      out.push(<em key={key}>{renderInline(m[3], key)}</em>);
    } else if (m[4] !== undefined && m[5] !== undefined) {
      out.push(
        <a
          key={key}
          href={m[5]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary-soft underline underline-offset-2"
        >
          {m[4]}
        </a>,
      );
    }
    last = re.lastIndex;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "heading": {
      const Tag = block.level <= 2 ? "h3" : block.level === 3 ? "h4" : "h5";
      const size = block.level <= 2 ? "text-[length:calc(14px*var(--ui-scale,1))] leading-[22px]" : "text-[length:calc(13px*var(--ui-scale,1))] leading-5";
      return <Tag className={`${size} font-semibold text-text`}>{renderInline(block.text)}</Tag>;
    }

    case "paragraph":
      return (
        <p className="text-[length:calc(14px*var(--ui-scale,1))] leading-[22px]">
          {block.lines.map((line, k) => (
            <Fragment key={k}>
              {k > 0 && <br />}
              {renderInline(line, `p${k}`)}
            </Fragment>
          ))}
        </p>
      );

    case "list": {
      const ordered = block.ordered;
      const Tag = ordered ? "ol" : "ul";
      return (
        <Tag className={`${ordered ? "list-decimal" : "list-disc"} space-y-0.5 pl-4 text-[length:calc(14px*var(--ui-scale,1))] leading-[22px]`}>
          {block.items.map((item, k) => (
            <li key={k}>{renderInline(item, `li${k}`)}</li>
          ))}
        </Tag>
      );
    }

    case "code":
      return (
        <pre className="overflow-x-auto rounded-md border border-border bg-bg p-2.5 font-mono text-[length:calc(12px*var(--ui-scale,1))] leading-5">
          <code>{block.text}</code>
        </pre>
      );

    case "table":
      return (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse text-[length:calc(12px*var(--ui-scale,1))]">
            <thead>
              <tr>
                {block.header.map((cell, k) => (
                  <th
                    key={k}
                    scope="col"
                    style={{ textAlign: block.align[k] }}
                    className="border-b border-border-strong px-3 py-2 font-medium text-text"
                  >
                    {renderInline(cell, `th${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {block.header.map((_, k) => (
                    <td
                      key={k}
                      style={{ textAlign: block.align[k] }}
                      className="border-b border-border px-3 py-2 align-top text-muted"
                    >
                      {renderInline(row[k] ?? "", `td${r}-${k}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "quote":
      return (
        <blockquote className="border-l-2 border-primary pl-3 text-[length:calc(14px*var(--ui-scale,1))] leading-[22px] text-muted">
          {block.lines.map((line, k) => (
            <Fragment key={k}>
              {k > 0 && <br />}
              {renderInline(line, `q${k}`)}
            </Fragment>
          ))}
        </blockquote>
      );

    case "rule":
      return <hr className="border-border" />;
  }
}

export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-2 break-words">
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </div>
  );
}
