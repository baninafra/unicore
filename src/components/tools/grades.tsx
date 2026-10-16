"use client";

// Promedio ponderado y nota necesaria: se cargan las notas con su peso (por ejemplo, parciales y TP)
// y se ve el promedio actual y qué hace falta sacar en lo que queda para llegar a la nota buscada.

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { grade } from "@/lib/format";

const LS_KEY = "uc-grades-tool";

type Row = { name: string; nota: string; peso: string };

const num = (s: string) => {
  const n = Number(s.replace(",", ".").trim());
  return s.trim() && Number.isFinite(n) ? n : NaN;
};

const START: Row[] = [
  { name: "Parcial 1", nota: "", peso: "35" },
  { name: "Parcial 2", nota: "", peso: "35" },
  { name: "TP", nota: "", peso: "30" },
];

export function GradesTool() {
  const [rows, setRows] = useState<Row[]>(START);
  const [target, setTarget] = useState("6");
  const [max, setMax] = useState("10");

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) ?? "null") as { rows: Row[]; target: string; max: string } | null;
      if (s?.rows?.length) {
        setRows(s.rows);
        setTarget(s.target);
        setMax(s.max);
      }
    } catch {}
  }, []);

  const persist = (r: Row[], t = target, m = max) => {
    setRows(r);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ rows: r, target: t, max: m }));
    } catch {}
  };
  const update = (i: number, patch: Partial<Row>) => persist(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // Pesos sin cargar: se reparten en partes iguales.
  const weights = rows.map((r) => num(r.peso));
  const explicit = weights.filter((w) => !Number.isNaN(w)).reduce((a, b) => a + b, 0);
  const blank = weights.filter((w) => Number.isNaN(w)).length;
  const share = blank ? Math.max(0, 100 - explicit) / blank : 0;
  const w = weights.map((x) => (Number.isNaN(x) ? share : x));
  const totalW = w.reduce((a, b) => a + b, 0);

  const done = rows.map((r, i) => ({ n: num(r.nota), w: w[i] })).filter((x) => !Number.isNaN(x.n));
  const doneW = done.reduce((a, x) => a + x.w, 0);
  const doneSum = done.reduce((a, x) => a + x.n * x.w, 0);
  const current = doneW ? doneSum / doneW : NaN;
  const pending = totalW - doneW;
  const t = num(target);
  const m = num(max);
  const needed = pending > 0 && !Number.isNaN(t) ? (t * totalW - doneSum) / pending : NaN;

  let verdict = "";
  if (!done.length) verdict = "Cargá al menos una nota.";
  else if (pending <= 0) verdict = current >= t ? `Llegaste: ${grade(current)}.` : `Te faltó ${grade(t - current)} para el ${grade(t, 0)}.`;
  else if (needed <= 0) verdict = "Ya llegaste aunque saques lo mínimo en lo que falta.";
  else if (!Number.isNaN(m) && needed > m) verdict = `Necesitarías ${grade(needed)}: no alcanza ni con la nota máxima.`;
  else verdict = `En lo que falta (${grade(pending, 0)} %) necesitás un ${grade(needed)} de promedio.`;

  return (
    <div className="tool-pane">
      <div className="grid grid-cols-[1fr_64px_64px_24px] items-center gap-1.5">
        <span className="t-label text-muted">Instancia</span>
        <span className="t-label text-muted">Nota</span>
        <span className="t-label text-muted">Peso %</span>
        <span />
        {rows.map((r, i) => (
          <div key={i} className="contents">
            <input className="input" value={r.name} onChange={(e) => update(i, { name: e.target.value })} aria-label="Instancia" />
            <input className="input num" inputMode="decimal" placeholder="—" value={r.nota} onChange={(e) => update(i, { nota: e.target.value })} aria-label="Nota" />
            <input
              className="input num"
              inputMode="decimal"
              placeholder={grade(share, 0)}
              value={r.peso}
              onChange={(e) => update(i, { peso: e.target.value })}
              aria-label="Peso"
            />
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Quitar" onClick={() => persist(rows.filter((_, j) => j !== i))}>
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-ghost btn-sm self-start" onClick={() => persist([...rows, { name: `Instancia ${rows.length + 1}`, nota: "", peso: "" }])}>
        <Plus className="h-4 w-4" strokeWidth={1.75} />
        Agregar instancia
      </button>
      {Math.round(totalW) !== 100 && <div className="t-small text-amber">Los pesos suman {grade(totalW, 0)} %: se toma esa suma como el total.</div>}

      <div className="flex gap-2">
        <label className="field flex-1">
          <span>Quiero llegar a</span>
          <input
            className="input num"
            inputMode="decimal"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              persist(rows, e.target.value, max);
            }}
          />
        </label>
        <label className="field flex-1">
          <span>Nota máxima</span>
          <input
            className="input num"
            inputMode="decimal"
            value={max}
            onChange={(e) => {
              setMax(e.target.value);
              persist(rows, target, e.target.value);
            }}
          />
        </label>
      </div>

      <div className="rounded-md border border-border bg-surface p-3">
        <div className="flex items-baseline justify-between">
          <span className="t-small text-muted">Promedio actual</span>
          <span className="t-h2 num">{grade(current)}</span>
        </div>
        <div className="t-small mt-1 text-text">{verdict}</div>
      </div>
    </div>
  );
}
