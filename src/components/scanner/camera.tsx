"use client";

// Cámara del escáner: muestra la imagen en vivo, marca la hoja que encuentra y saca la foto
// (a mano o sola, cuando la hoja queda quieta un momento).

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Camera as CameraIcon, SwitchCamera, Timer, X } from "lucide-react";
import { detectCorners, toBlob, type Pt } from "@/lib/scanner/scanner";

const LS_AUTO = "uc-scan-auto";
const STEADY_FRAMES = 6; // detecciones seguidas sin moverse para la captura automática

export function ScannerCamera({ onCapture, onClose, count }: { onCapture: (photo: Blob, corners: Pt[] | null) => void; onClose: () => void; count: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [quad, setQuad] = useState<Pt[] | null>(null); // en píxeles del video
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [auto, setAuto] = useState(false);
  const [flash, setFlash] = useState(false);
  const steady = useRef(0);
  const last = useRef<Pt[] | null>(null);
  const capturing = useRef(false);

  useEffect(() => {
    try {
      setAuto(localStorage.getItem(LS_AUTO) === "1");
    } catch {}
  }, []);

  // Abre la cámara (la de atrás si hay, con la mejor resolución que dé).
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    setError("");
    navigator.mediaDevices
      ?.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      .then(async (s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const v = video.current;
        if (v) {
          v.srcObject = s;
          await v.play().catch(() => {});
        }
        const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
        setDevices(list);
      })
      .catch((e: unknown) => {
        const name = e instanceof DOMException ? e.name : "";
        setError(
          name === "NotAllowedError"
            ? "No hay permiso para usar la cámara. Habilitalo en la configuración del sistema o subí fotos desde el equipo."
            : name === "NotFoundError"
              ? "No encontramos ninguna cámara. Podés subir fotos desde el equipo."
              : "No pudimos abrir la cámara.",
        );
      });
    if (!navigator.mediaDevices) setError("Este equipo no permite usar la cámara desde la app. Subí fotos desde el equipo.");
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId]);

  const capture = async (corners: Pt[] | null) => {
    const v = video.current;
    if (!v || !v.videoWidth || capturing.current) return;
    capturing.current = true;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 180);
    try {
      onCapture(await toBlob(c, "image/jpeg", 0.92), corners);
    } finally {
      steady.current = 0;
      last.current = null;
      // Un respiro antes de la siguiente captura automática (para dar vuelta la hoja).
      window.setTimeout(() => (capturing.current = false), 1500);
    }
  };

  // Detección en vivo, unas 4 veces por segundo.
  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    const tick = async () => {
      const v = video.current;
      if (stop) return;
      if (v && v.videoWidth && !v.paused) {
        setDims({ w: v.videoWidth, h: v.videoHeight });
        try {
          const found = await detectCorners(v, v.videoWidth, v.videoHeight);
          if (stop) return;
          setQuad(found);
          const diag = Math.hypot(v.videoWidth, v.videoHeight);
          const still = found && last.current && found.every((p, i) => Math.hypot(p.x - last.current![i].x, p.y - last.current![i].y) < diag * 0.015);
          steady.current = found ? (still ? steady.current + 1 : 0) : 0;
          last.current = found;
          if (auto && found && steady.current >= STEADY_FRAMES) void capture(found);
        } catch (e) {
          setError(e instanceof Error ? e.message : "El escáner falló.");
          return;
        }
      }
      timer = window.setTimeout(tick, 250);
    };
    timer = window.setTimeout(tick, 400);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        void capture(quad);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toggleAuto = () => {
    setAuto((a) => {
      try {
        localStorage.setItem(LS_AUTO, a ? "0" : "1");
      } catch {}
      return !a;
    });
  };

  return (
    <div className="relative flex h-full w-full flex-col bg-black">
      <div className="relative min-h-0 flex-1">
        <video ref={video} playsInline muted className="absolute inset-0 h-full w-full object-contain" />
        {quad && dims.w > 0 && (
          <svg viewBox={`0 0 ${dims.w} ${dims.h}`} preserveAspectRatio="xMidYMid meet" className="pointer-events-none absolute inset-0 h-full w-full">
            <polygon
              points={quad.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="rgba(139,124,246,0.18)"
              stroke="var(--primary)"
              strokeWidth={Math.max(3, dims.w / 300)}
              strokeLinejoin="round"
            />
          </svg>
        )}
        {flash && <div className="absolute inset-0 bg-white/70" />}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            <div className="max-w-sm rounded-lg bg-surface p-4 text-[13px] text-text shadow-pop">{error}</div>
          </div>
        )}
        {!error && (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[12px] text-white">
            {quad ? (auto ? "Quedate quieto: la foto sale sola" : "Hoja encontrada") : "Apuntá a la hoja, sobre un fondo que contraste"}
          </div>
        )}
      </div>
      <div className="flex h-24 flex-none items-center justify-between gap-4 px-6">
        <div className="flex w-40 items-center gap-2">
          <button type="button" className="btn btn-ghost btn-sm text-white/80" onClick={onClose}>
            <X />
            {count ? "Listo" : "Cerrar"}
          </button>
        </div>
        <button
          type="button"
          aria-label="Sacar foto"
          title="Sacar foto (Espacio)"
          disabled={!!error}
          onClick={() => void capture(quad)}
          className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white/80 bg-white/10 text-white hover:bg-white/20 disabled:opacity-40"
        >
          <CameraIcon className="h-7 w-7" strokeWidth={1.75} />
        </button>
        <div className="flex w-40 items-center justify-end gap-2">
          <button
            type="button"
            aria-pressed={auto}
            title="Sacar la foto sola cuando la hoja queda quieta"
            onClick={toggleAuto}
            className={clsx("btn btn-sm", auto ? "border-primary bg-primary-tint text-primary-soft" : "border-white/30 text-white/80")}
          >
            <Timer />
            Automática
          </button>
          {devices.length > 1 && (
            <button
              type="button"
              aria-label="Cambiar de cámara"
              title="Cambiar de cámara"
              className="btn btn-sm btn-icon border-white/30 text-white/80"
              onClick={() => {
                const i = devices.findIndex((d) => d.deviceId === deviceId);
                setDeviceId(devices[(i + 1) % devices.length].deviceId);
              }}
            >
              <SwitchCamera />
            </button>
          )}
        </div>
      </div>
      {count > 0 && <div className="pointer-events-none absolute bottom-[104px] left-6 rounded-full bg-black/60 px-3 py-1 text-[12px] text-white">{count === 1 ? "1 página" : `${count} páginas`}</div>}
    </div>
  );
}
