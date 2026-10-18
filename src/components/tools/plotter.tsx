"use client";

// Graficador de funciones: una función por renglón ("sin(x)", "x^2 - 3", "1/x").
// Rueda para acercar o alejar, arrastrar para moverse, doble clic para volver al origen.

import { useEffect, useMemo, useRef, useState } from "react";
import { compile, type EvalFunction } from "mathjs";
import { ImageDown, RotateCcw } from "lucide-react";
import { saveFile } from "@/lib/db";
import { toast } from "@/lib/undo";

const LS_KEY = "uc-plot-functions";
const COLORS = ["#8b7cf6", "#34d399", "#f59e0b", "#f472b6", "#22d3ee", "#f87171"];

type View = { cx: number; cy: number; scale: number }; // píxeles por unidad

const HOME: View = { cx: 0, cy: 0, scale: 40 };

// Paso "lindo" de la grilla (1, 2 o 5 por potencia de 10).
function niceStep(pixelsPerUnit: number): number {
  const raw = 80 / pixelsPerUnit;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

const fmt = (n: number) => (Math.abs(n) < 1e-10 ? "0" : String(Number(n.toPrecision(6))).replace(".", ","));

export function PlotTool() {
  const [text, setText] = useState("sin(x)\nx^2 / 4 - 2");
  const [view, setView] = useState<View>(HOME);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 300, h: 260 });
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) setText(saved);
    } catch {}
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: Math.max(220, Math.round(el.clientWidth * 0.85)) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fns = useMemo(() => {
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line, i) => {
        const expr = line.replace(/^\s*[a-z]\s*\(\s*x\s*\)\s*=|^\s*y\s*=/i, "").trim();
        try {
          return { line, color: COLORS[i % COLORS.length], f: compile(expr) as EvalFunction, error: "" };
        } catch (e) {
          return { line, color: COLORS[i % COLORS.length], f: null, error: e instanceof Error ? e.message : "Error" };
        }
      });
  }, [text]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(c);
    const grid = css.getPropertyValue("--border").trim() || "#333";
    const axis = css.getPropertyValue("--border-strong").trim() || "#666";
    const label = css.getPropertyValue("--text-faint").trim() || "#888";
    g.clearRect(0, 0, size.w, size.h);

    const toPx = (x: number, y: number) => [size.w / 2 + (x - view.cx) * view.scale, size.h / 2 - (y - view.cy) * view.scale] as const;
    const x0 = view.cx - size.w / 2 / view.scale;
    const x1 = view.cx + size.w / 2 / view.scale;
    const y0 = view.cy - size.h / 2 / view.scale;
    const y1 = view.cy + size.h / 2 / view.scale;
    const step = niceStep(view.scale);

    g.lineWidth = 1;
    g.font = "10px system-ui, sans-serif";
    g.fillStyle = label;
    g.strokeStyle = grid;
    g.beginPath();
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      const [px] = toPx(x, 0);
      g.moveTo(px, 0);
      g.lineTo(px, size.h);
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      const [, py] = toPx(0, y);
      g.moveTo(0, py);
      g.lineTo(size.w, py);
    }
    g.stroke();

    // Ejes y números
    const [ox, oy] = toPx(0, 0);
    g.strokeStyle = axis;
    g.beginPath();
    g.moveTo(0, oy);
    g.lineTo(size.w, oy);
    g.moveTo(ox, 0);
    g.lineTo(ox, size.h);
    g.stroke();
    const ly = Math.min(size.h - 4, Math.max(12, oy + 12));
    const lx = Math.min(size.w - 30, Math.max(4, ox + 4));
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) if (Math.abs(x) > step / 2) g.fillText(fmt(x), toPx(x, 0)[0] + 2, ly);
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) if (Math.abs(y) > step / 2) g.fillText(fmt(y), lx, toPx(0, y)[1] - 2);

    // Curvas: se corta el trazo en saltos grandes (asíntotas) y donde no hay valor.
    g.lineWidth = 2;
    for (const fn of fns) {
      if (!fn.f) continue;
      g.strokeStyle = fn.color;
      g.beginPath();
      let pen = false;
      let lastY = 0;
      for (let px = 0; px <= size.w; px += 1) {
        const x = x0 + px / view.scale;
        let y: number;
        try {
          const v = fn.f.evaluate({ x });
          y = typeof v === "number" ? v : NaN;
        } catch {
          y = NaN;
        }
        if (!Number.isFinite(y)) {
          pen = false;
          continue;
        }
        const py = toPx(x, y)[1];
        if (pen && Math.abs(py - lastY) > size.h * 2) pen = false;
        if (pen) g.lineTo(px, py);
        else g.moveTo(px, py);
        pen = true;
        lastY = py;
      }
      g.stroke();
    }
  }, [fns, view, size]);

  const drag = useRef<{ x: number; y: number; view: View } | null>(null);

  return (
    <div className="tool-pane">
      <label className="field">
        <span>Funciones de x (una por renglón)</span>
        <textarea
          className="input num min-h-[64px] resize-y"
          value={text}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            try {
              localStorage.setItem(LS_KEY, e.target.value);
            } catch {}
          }}
        />
      </label>
      {fns.some((f) => f.error) && <div className="t-small text-rose">Revisá: {fns.find((f) => f.error)?.line}</div>}

      <div ref={box} className="relative w-full overflow-hidden rounded-md border border-border bg-surface">
        <canvas
          ref={canvas}
          style={{ width: size.w, height: size.h, touchAction: "none", cursor: drag.current ? "grabbing" : "crosshair" }}
          onWheel={(e) => {
            const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
            setView((v) => ({ ...v, scale: Math.min(5000, Math.max(0.5, v.scale * f)) }));
          }}
          onPointerDown={(e) => {
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, view };
          }}
          onPointerMove={(e) => {
            const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
            const px = e.clientX - r.left;
            const py = e.clientY - r.top;
            setHover({ x: view.cx + (px - size.w / 2) / view.scale, y: view.cy - (py - size.h / 2) / view.scale });
            const d = drag.current;
            if (d) setView({ ...d.view, cx: d.view.cx - (e.clientX - d.x) / d.view.scale, cy: d.view.cy + (e.clientY - d.y) / d.view.scale });
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={() => setView(HOME)}
        />
        {hover && (
          <div className="pointer-events-none absolute bottom-1 left-1 rounded-sm bg-surface-raised px-1.5 py-0.5 t-small num text-muted">
            x {fmt(hover.x)} · y {fmt(hover.y)}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {fns.map((f) => (
          <span key={f.line} className="t-small num flex items-center gap-1.5 text-muted">
            <span className="inline-block h-0.5 w-4 rounded-full" style={{ background: f.color }} />
            {f.line}
          </span>
        ))}
        <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => setView(HOME)}>
          <RotateCcw className="h-4 w-4" strokeWidth={1.75} />
          Centrar
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          title="Pega el gráfico como imagen donde está el cursor en la nota abierta"
          onClick={() => {
            const c = canvas.current;
            if (!c) return;
            c.toBlob(async (blob) => {
              if (!blob) return;
              const url = await saveFile(new File([blob], "grafico.png", { type: "image/png" }));
              const caption = fns.map((f) => `y = ${f.line}`).join(" · ");
              const detail = { blocks: [{ type: "image", props: { url, caption, previewWidth: 520 } }], handled: false };
              window.dispatchEvent(new CustomEvent("uc:insert-blocks", { detail }));
              toast(detail.handled ? "Pegué el gráfico en la nota." : "Abrí una nota para pegar el gráfico.", detail.handled ? {} : { tone: "error" });
            }, "image/png");
          }}
        >
          <ImageDown className="h-4 w-4" strokeWidth={1.75} />
          Pegar en la nota
        </button>
      </div>
    </div>
  );
}
