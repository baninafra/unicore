"use client";

// Calculadora científica (motor: mathjs, github.com/josdejong/mathjs).
// Se escribe la expresión o se usan las teclas; Enter calcula. Entiende unidades ("5 cm to inch"),
// fracciones, matrices y variables ("a = 3", después "a^2"). "ans" es el último resultado.

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { all, create, type MathJsInstance } from "mathjs";
import { Copy, Trash2 } from "lucide-react";
import { toast } from "@/lib/undo";

const LS_HISTORY = "uc-calc-history";
const LS_ANGLE = "uc-calc-angle";

type Entry = { expr: string; result: string; error?: boolean };

// En grados, las funciones trigonométricas convierten la entrada (y las inversas, la salida).
function makeMath(deg: boolean): MathJsInstance {
  const m = create(all, { number: "number", precision: 64 });
  if (deg) {
    const k = Math.PI / 180;
    const wrap = (f: (x: number) => number) => (x: number) => f(x * k);
    const inv = (f: (x: number) => number) => (x: number) => f(x) / k;
    m.import(
      {
        sin: wrap(Math.sin),
        cos: wrap(Math.cos),
        tan: wrap(Math.tan),
        asin: inv(Math.asin),
        acos: inv(Math.acos),
        atan: inv(Math.atan),
      },
      { override: true },
    );
  }
  return m;
}

const KEYS: { label: string; insert?: string; action?: "clear" | "back" | "eval"; wide?: boolean; tone?: "op" | "fn" | "eq" }[] = [
  { label: "sin", insert: "sin(", tone: "fn" },
  { label: "cos", insert: "cos(", tone: "fn" },
  { label: "tan", insert: "tan(", tone: "fn" },
  { label: "ln", insert: "log(", tone: "fn" },
  { label: "log", insert: "log10(", tone: "fn" },
  { label: "asin", insert: "asin(", tone: "fn" },
  { label: "acos", insert: "acos(", tone: "fn" },
  { label: "atan", insert: "atan(", tone: "fn" },
  { label: "√", insert: "sqrt(", tone: "fn" },
  { label: "x²", insert: "^2", tone: "fn" },
  { label: "xʸ", insert: "^", tone: "fn" },
  { label: "n!", insert: "!", tone: "fn" },
  { label: "π", insert: "pi", tone: "fn" },
  { label: "e", insert: "e", tone: "fn" },
  { label: "|x|", insert: "abs(", tone: "fn" },
  { label: "(", insert: "(" },
  { label: ")", insert: ")" },
  { label: "%", insert: "%", tone: "op" },
  { label: "AC", action: "clear", tone: "op" },
  { label: "⌫", action: "back", tone: "op" },
  { label: "7", insert: "7" },
  { label: "8", insert: "8" },
  { label: "9", insert: "9" },
  { label: "÷", insert: "/", tone: "op" },
  { label: "ans", insert: "ans", tone: "fn" },
  { label: "4", insert: "4" },
  { label: "5", insert: "5" },
  { label: "6", insert: "6" },
  { label: "×", insert: "*", tone: "op" },
  { label: "mod", insert: " mod ", tone: "fn" },
  { label: "1", insert: "1" },
  { label: "2", insert: "2" },
  { label: "3", insert: "3" },
  { label: "−", insert: "-", tone: "op" },
  { label: "nCr", insert: "combinations(", tone: "fn" },
  { label: "0", insert: "0" },
  { label: ".", insert: "." },
  { label: ",", insert: ", " },
  { label: "+", insert: "+", tone: "op" },
  { label: "=", action: "eval", tone: "eq" },
];

function readHistory(): Entry[] {
  try {
    return JSON.parse(localStorage.getItem(LS_HISTORY) ?? "[]") as Entry[];
  } catch {
    return [];
  }
}

export function CalculatorTool() {
  const [deg, setDeg] = useState(true);
  const [expr, setExpr] = useState("");
  const [history, setHistory] = useState<Entry[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const scope = useRef<Record<string, unknown>>({});
  const math = useMemo(() => makeMath(deg), [deg]);

  useEffect(() => {
    setHistory(readHistory());
    try {
      if (localStorage.getItem(LS_ANGLE) === "rad") setDeg(false);
    } catch {}
  }, []);

  const save = (h: Entry[]) => {
    setHistory(h);
    try {
      localStorage.setItem(LS_HISTORY, JSON.stringify(h.slice(0, 50)));
    } catch {}
  };

  // Resultado provisorio mientras se escribe.
  const preview = useMemo(() => {
    if (!expr.trim() || /=(?!=)/.test(expr)) return "";
    try {
      const r = math.evaluate(expr, { ...scope.current });
      return typeof r === "function" || r === undefined ? "" : math.format(r, { precision: 12 });
    } catch {
      return "";
    }
  }, [expr, math]);

  const evaluate = () => {
    const e = expr.trim();
    if (!e) return;
    try {
      const r = math.evaluate(e, scope.current);
      const text = r === undefined ? "" : typeof r === "function" ? "función definida" : math.format(r, { precision: 14 });
      if (r !== undefined && typeof r !== "function") scope.current.ans = r;
      save([{ expr: e, result: text }, ...history]);
      setExpr("");
    } catch (err) {
      save([{ expr: e, result: err instanceof Error ? err.message : "No se pudo calcular", error: true }, ...history]);
    }
  };

  const press = (k: (typeof KEYS)[number]) => {
    if (k.action === "clear") setExpr("");
    else if (k.action === "back") setExpr((x) => x.slice(0, -1));
    else if (k.action === "eval") evaluate();
    else if (k.insert) {
      const el = input.current;
      const start = el?.selectionStart ?? expr.length;
      const end = el?.selectionEnd ?? expr.length;
      const next = expr.slice(0, start) + k.insert + expr.slice(end);
      setExpr(next);
      requestAnimationFrame(() => {
        el?.focus();
        const pos = start + k.insert!.length;
        el?.setSelectionRange(pos, pos);
      });
      return;
    }
    input.current?.focus();
  };

  const toggleAngle = () => {
    setDeg((d) => {
      try {
        localStorage.setItem(LS_ANGLE, d ? "rad" : "deg");
      } catch {}
      return !d;
    });
  };

  return (
    <div className="tool-pane">
      <div className="flex flex-col-reverse gap-1 overflow-y-auto rounded-md border border-border bg-surface p-2" style={{ maxHeight: 180, minHeight: 72 }}>
        {history.length === 0 && <div className="t-small text-faint">Escribí una cuenta y apretá Enter. Probá «sin(30)», «5 cm to inch» o «det([1,2;3,4])».</div>}
        {history.map((h, i) => (
          <button
            key={i}
            type="button"
            title="Usar este resultado"
            className="group flex flex-col items-end rounded-sm px-1 py-0.5 text-right hover:bg-surface-raised"
            onClick={() => !h.error && setExpr((x) => x + h.result)}
          >
            <span className="t-small num text-muted">{h.expr}</span>
            <span className={clsx("num text-[15px]", h.error ? "text-rose" : "text-text")}>{h.error ? h.result : `= ${h.result}`}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <input
          ref={input}
          className="input num text-right text-[17px]"
          value={expr}
          placeholder="0"
          spellCheck={false}
          aria-label="Expresión"
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") evaluate();
            if (e.key === "Escape") setExpr("");
          }}
        />
        <div className="flex h-5 items-center justify-between">
          <button type="button" className="badge badge-primary cursor-pointer" onClick={toggleAngle} title="Cambiar entre grados y radianes">
            {deg ? "DEG" : "RAD"}
          </button>
          <span className="t-small num text-faint">{preview && `= ${preview}`}</span>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-1">
        {KEYS.map((k) => (
          <button
            key={k.label}
            type="button"
            onClick={() => press(k)}
            className={clsx(
              "btn btn-sm h-9 justify-center px-0 text-[13px]",
              k.tone === "eq" ? "btn-primary" : k.tone === "op" ? "bg-surface-raised text-primary-soft" : k.tone === "fn" ? "btn-ghost text-muted" : "bg-surface-raised",
            )}
          >
            {k.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            const last = history.find((h) => !h.error);
            if (last) void navigator.clipboard.writeText(last.result).then(() => toast("Copiamos el resultado"));
          }}
        >
          <Copy className="h-4 w-4" strokeWidth={1.75} />
          Copiar resultado
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => save([])} disabled={!history.length}>
          <Trash2 className="h-4 w-4" strokeWidth={1.75} />
          Borrar historial
        </button>
      </div>
    </div>
  );
}
