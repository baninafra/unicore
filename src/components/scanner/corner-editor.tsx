"use client";

// Ajuste a mano de las esquinas de la hoja: se arrastran los cuatro puntos sobre la foto.
// Mientras se arrastra aparece una lupa para clavar la esquina justo en el borde del papel.

import { useEffect, useRef, useState } from "react";
import type { Pt } from "@/lib/scanner/scanner";
import { t } from "@/lib/i18n";

const LOUPE = 120; // tamaño de la lupa en pantalla
const ZOOM = 2.5;

export function CornerEditor({ url, width, height, corners, onChange }: { url: string; width: number; height: number; corners: Pt[]; onChange: (c: Pt[]) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const k = Math.min(r.width / width, r.height / height);
      setSize({ w: width * k, h: height * k });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  const k = size.w / width || 0;
  const pts = corners.map((p) => ({ x: p.x * k, y: p.y * k }));

  const move = (i: number, clientX: number, clientY: number, rect: DOMRect) => {
    const x = Math.min(width, Math.max(0, (clientX - rect.left) / k));
    const y = Math.min(height, Math.max(0, (clientY - rect.top) / k));
    onChange(corners.map((p, j) => (j === i ? { x, y } : p)));
  };

  const active = drag !== null ? pts[drag] : null;

  return (
    <div ref={box} className="flex h-full w-full items-center justify-center">
      <div className="relative select-none" style={{ width: size.w, height: size.h }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" draggable={false} className="h-full w-full rounded-sm" />
        <svg className="absolute inset-0 h-full w-full overflow-visible">
          <path
            d={`M0 0H${size.w}V${size.h}H0Z M${pts.map((p) => `${p.x} ${p.y}`).join(" L")} Z`}
            fillRule="evenodd"
            fill="rgba(0,0,0,0.45)"
          />
          <polygon points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="var(--primary)" strokeWidth={2} />
        </svg>
        {pts.map((p, i) => (
          <div
            key={i}
            role="slider"
            aria-label={[t("Esquina de arriba a la izquierda"), t("Esquina de arriba a la derecha"), t("Esquina de abajo a la derecha"), t("Esquina de abajo a la izquierda")][i]}
            aria-valuenow={Math.round(corners[i].x)}
            tabIndex={0}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 20 : 4;
              const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
              if (!d) return;
              e.preventDefault();
              onChange(corners.map((c, j) => (j === i ? { x: Math.min(width, Math.max(0, c.x + d[0])), y: Math.min(height, Math.max(0, c.y + d[1])) } : c)));
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              setDrag(i);
            }}
            onPointerMove={(e) => {
              if (drag !== i) return;
              const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
              move(i, e.clientX, e.clientY, rect);
            }}
            onPointerUp={() => setDrag(null)}
            className="absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing"
            style={{ left: p.x, top: p.y }}
          >
            <span className="h-3.5 w-3.5 rounded-full border-2 border-white bg-primary shadow" />
          </div>
        ))}
        {active && (
          <div
            className="pointer-events-none absolute overflow-hidden rounded-full border-2 border-white shadow-pop"
            style={{
              width: LOUPE,
              height: LOUPE,
              left: active.x < size.w / 2 ? size.w - LOUPE - 8 : 8,
              top: 8,
              backgroundImage: `url(${url})`,
              backgroundRepeat: "no-repeat",
              backgroundSize: `${size.w * ZOOM}px ${size.h * ZOOM}px`,
              backgroundPosition: `${-active.x * ZOOM + LOUPE / 2}px ${-active.y * ZOOM + LOUPE / 2}px`,
            }}
          >
            <span className="absolute left-1/2 top-0 h-full w-px bg-primary" />
            <span className="absolute left-0 top-1/2 h-px w-full bg-primary" />
          </div>
        )}
      </div>
    </div>
  );
}
