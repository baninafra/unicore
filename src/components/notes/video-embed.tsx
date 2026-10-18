"use client";

import { useState } from "react";
import { ExternalLink, MonitorPlay, Sparkles } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { parseVideoUrl } from "@/lib/video";

// Le pide a la IA que trabaje sobre un video (abre el panel si estaba cerrado).
export function askAIAboutVideo(setAiOpen: (open: boolean) => void, url: string) {
  setAiOpen(true);
  window.setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent("uc:ai-ask", { detail: { text: `Resumí este video en puntos clave: ${url}`, send: true } }),
    );
  }, 300);
}

export function VideoEmbedView({ url, editable, onUrl }: { url: string; editable: boolean; onUrl: (url: string) => void }) {
  const { setAiOpen } = useAppState();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(false);
  const video = url ? parseVideoUrl(url) : null;

  if (!video) {
    if (!editable) return null;
    return (
      <form
        contentEditable={false}
        className="flex w-full items-center gap-2 rounded-md border border-border bg-surface-raised p-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = parseVideoUrl(draft);
          if (v) onUrl(v.url);
          else setError(true);
        }}
      >
        <MonitorPlay className="h-4 w-4 flex-none text-faint" strokeWidth={1.75} />
        <input
          autoFocus
          className="input h-8 min-w-0 flex-1"
          placeholder="Pegá un link de YouTube, Vimeo o Drive"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(false);
          }}
        />
        <button type="submit" className="btn btn-sm">
          Insertar
        </button>
        {error && <span className="text-[length:calc(12px*var(--ui-scale,1))] text-rose">Ese link no es de un video.</span>}
      </form>
    );
  }

  return (
    <div contentEditable={false} className="uc-video-embed w-full overflow-hidden rounded-md border border-border bg-surface-raised">
      <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
        <iframe
          src={video.embed}
          title="Video"
          className="absolute inset-0 h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <div className="flex items-center gap-2 px-2 py-1.5 text-[length:calc(12px*var(--ui-scale,1))] text-faint">
        <a href={video.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1 truncate hover:text-text">
          <ExternalLink className="h-3.5 w-3.5 flex-none" strokeWidth={1.75} />
          <span className="truncate">{video.url}</span>
        </a>
        <button
          type="button"
          className="ml-auto flex flex-none items-center gap-1 text-primary-soft hover:text-text"
          onClick={() => askAIAboutVideo(setAiOpen, video.url)}
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
          Resumir con IA
        </button>
      </div>
    </div>
  );
}
