"use client";

import { Fragment, type ReactNode } from "react";

// Markdown simple para las tarjetas de texto: títulos (#), listas (-), citas (>), negrita, cursiva y código.
// Sin HTML crudo: todo se arma con elementos de React.

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null;
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`"))
      return (
        <code key={i} className="rounded-sm bg-surface px-1 text-[12px]">
          {part.slice(1, -1)}
        </code>
      );
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function MiniMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { key: number; items: string[] } | null = null;

  const flushList = () => {
    if (!list) return;
    const { key, items } = list;
    blocks.push(
      <ul key={`ul-${key}`} className="flex list-disc flex-col gap-0.5 pl-4">
        {items.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>,
    );
    list = null;
  };

  text.split("\n").forEach((raw, i) => {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list) list = { key: i, items: [] };
      list.items.push(bullet[1]);
      return;
    }
    flushList();
    if (!line.trim()) return;

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const cls = level === 1 ? "text-[15px] font-semibold" : level === 2 ? "text-[14px] font-semibold" : "font-medium";
      blocks.push(
        <div key={i} className={cls}>
          {inline(heading[2])}
        </div>,
      );
      return;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      blocks.push(
        <div key={i} className="border-l-2 border-primary pl-2 text-muted">
          {inline(quote[1])}
        </div>,
      );
      return;
    }

    blocks.push(<p key={i}>{inline(line)}</p>);
  });
  flushList();

  return <div className="flex flex-col gap-1 text-[13px] leading-snug">{blocks}</div>;
}
