"use client";

// Bases numéricas: escribís en cualquier base y se ven las demás (binario, octal, decimal, hexadecimal
// o una base a elección), más el complemento a 2 y el texto ASCII cuando corresponde.

import { useState } from "react";

const BASES = [
  { base: 2, label: "Binario", re: /^-?[01]*$/ },
  { base: 8, label: "Octal", re: /^-?[0-7]*$/ },
  { base: 10, label: "Decimal", re: /^-?\d*$/ },
  { base: 16, label: "Hexadecimal", re: /^-?[0-9a-f]*$/i },
];

function parseIn(text: string, base: number): bigint | null {
  const t = text.replace(/[\s_]/g, "").toLowerCase();
  if (!t || t === "-") return null;
  const neg = t.startsWith("-");
  const digits = neg ? t.slice(1) : t;
  let v = BigInt(0);
  for (const ch of digits) {
    const d = parseInt(ch, 36);
    if (Number.isNaN(d) || d >= base) return null;
    v = v * BigInt(base) + BigInt(d);
  }
  return neg ? -v : v;
}

const group = (s: string, n: number) => s.replace(new RegExp(`\\B(?=(.{${n}})+$)`, "g"), " ");

function twos(v: bigint, bits: number): string {
  const mod = BigInt(1) << BigInt(bits);
  return group(((v % mod) + mod) % mod === BigInt(0) ? "0".repeat(bits) : (((v % mod) + mod) % mod).toString(2).padStart(bits, "0"), 4);
}

export function BasesTool() {
  const [value, setValue] = useState<bigint | null>(BigInt(255));
  const [edit, setEdit] = useState<{ base: number; text: string } | null>(null);
  const [custom, setCustom] = useState(36);
  const [bits, setBits] = useState(16);

  const shown = (base: number) => (edit?.base === base ? edit.text : value === null ? "" : value.toString(base).toUpperCase());

  const onType = (base: number, text: string) => {
    setEdit({ base, text });
    setValue(parseIn(text, base));
  };

  const ascii =
    value !== null && value > BigInt(0) && value < BigInt(1) << BigInt(64)
      ? (() => {
          let v = value;
          const chars: string[] = [];
          while (v > BigInt(0)) {
            chars.unshift(String.fromCharCode(Number(v & BigInt(0xff))));
            v >>= BigInt(8);
          }
          return chars.every((c) => c >= " " && c <= "~") ? chars.join("") : "";
        })()
      : "";

  return (
    <div className="tool-pane">
      {BASES.map((b) => (
        <label key={b.base} className="field">
          <span>
            {b.label} <span className="text-faint">(base {b.base})</span>
          </span>
          <input
            className="input num"
            spellCheck={false}
            value={shown(b.base)}
            onFocus={() => setEdit({ base: b.base, text: shown(b.base) })}
            onBlur={() => setEdit(null)}
            onChange={(e) => b.re.test(e.target.value.replace(/[\s_]/g, "")) && onType(b.base, e.target.value)}
          />
        </label>
      ))}
      <label className="field">
        <span className="flex items-center gap-2">
          Base
          <input
            className="input num h-7 w-16 py-0"
            type="number"
            min={2}
            max={36}
            value={custom}
            onChange={(e) => setCustom(Math.min(36, Math.max(2, Number(e.target.value) || 2)))}
          />
        </span>
        <input className="input num" spellCheck={false} value={shown(custom)} onFocus={() => setEdit({ base: custom, text: shown(custom) })} onBlur={() => setEdit(null)} onChange={(e) => onType(custom, e.target.value)} />
      </label>

      {value !== null && (
        <div className="rounded-md border border-border bg-surface p-2 t-small">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="whitespace-nowrap text-muted">Complemento a 2</span>
            <span className="flex gap-1">
              {[8, 16, 32].map((n) => (
                <button key={n} type="button" className={n === bits ? "badge badge-primary" : "badge cursor-pointer"} onClick={() => setBits(n)}>
                  {n} bits
                </button>
              ))}
            </span>
          </div>
          <div className="num mt-1 break-all">{twos(value, bits)}</div>
          {ascii && (
            <div className="mt-2 flex justify-between">
              <span className="text-muted">Como texto ASCII</span>
              <span className="num">«{ascii}»</span>
            </div>
          )}
        </div>
      )}
      {value === null && edit?.text && <div className="t-small text-rose">Ese número no es válido en esa base.</div>}
    </div>
  );
}
