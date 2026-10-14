"use client";

// Videos: links de YouTube/Vimeo (se ven embebidos) y archivos de video subidos.
// Para la IA: transcripción de YouTube y fotogramas de un archivo (la IA potente ve imágenes).

import { get } from "./ai/web";
import { isDesktop } from "./desktop";

export interface VideoLink {
  provider: "youtube" | "vimeo" | "drive";
  id: string;
  url: string; // link limpio
  embed: string; // URL para el iframe
}

const YT_ID = /^[\w-]{11}$/;

export function parseVideoUrl(raw: string): VideoLink | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = u.searchParams.get("v") ?? u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/)?.[1] ?? null;
  }
  if (id && YT_ID.test(id)) {
    const t = u.searchParams.get("t") ?? u.searchParams.get("start");
    const start = t ? parseInt(t, 10) : 0;
    return {
      provider: "youtube",
      id,
      url: `https://www.youtube.com/watch?v=${id}`,
      embed: `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ""}`,
    };
  }
  if (host === "drive.google.com") {
    const did = u.pathname.match(/\/file\/d\/([\w-]{10,})/)?.[1] ?? u.searchParams.get("id");
    if (did)
      return {
        provider: "drive",
        id: did,
        url: `https://drive.google.com/file/d/${did}/view`,
        embed: `https://drive.google.com/file/d/${did}/preview`,
      };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const vid = u.pathname.match(/(\d{6,})/)?.[1];
    if (vid) return { provider: "vimeo", id: vid, url: `https://vimeo.com/${vid}`, embed: `https://player.vimeo.com/video/${vid}` };
  }
  return null;
}

// Todos los links de video que aparecen en un texto.
export function videoLinksIn(text: string): VideoLink[] {
  const out = new Map<string, VideoLink>();
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
    const v = parseVideoUrl(m[0]);
    if (v) out.set(v.url, v);
  }
  return [...out.values()];
}

export interface VideoInfo {
  titulo: string;
  canal?: string;
  descripcion?: string;
  transcripcion?: string;
  url: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function decodeEntities(s: string): string {
  const el = document.createElement("textarea");
  el.innerHTML = s;
  return el.value;
}

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
}

function pickTrack(tracks: CaptionTrack[]): CaptionTrack | undefined {
  const by = (fn: (t: CaptionTrack) => boolean) => tracks.find(fn);
  return (
    by((t) => t.languageCode.startsWith("es") && t.kind !== "asr") ??
    by((t) => t.languageCode.startsWith("es")) ??
    by((t) => t.kind !== "asr") ??
    tracks[0]
  );
}

// Pasa el XML/JSON de subtítulos de YouTube a texto con marcas de minuto cada tanto.
function captionsToText(raw: string): string {
  const lines: string[] = [];
  let lastMark = -60;
  const push = (sec: number, text: string) => {
    const t = text.replace(/\s+/g, " ").trim();
    if (!t) return;
    if (sec - lastMark >= 60) {
      lastMark = sec;
      const m = Math.floor(sec / 60);
      lines.push(`\n[${m}:${String(Math.floor(sec % 60)).padStart(2, "0")}]`);
    }
    lines.push(t);
  };
  if (raw.trimStart().startsWith("{")) {
    const data = JSON.parse(raw) as { events?: { tStartMs?: number; segs?: { utf8?: string }[] }[] };
    for (const e of data.events ?? []) push((e.tStartMs ?? 0) / 1000, (e.segs ?? []).map((s) => s.utf8 ?? "").join(""));
  } else {
    const doc = new DOMParser().parseFromString(raw, "text/xml");
    doc.querySelectorAll("text, p").forEach((n) => {
      const start = Number(n.getAttribute("start") ?? Number(n.getAttribute("t") ?? 0) / 1000);
      push(start, decodeEntities(n.textContent ?? ""));
    });
  }
  return lines.join(" ").replace(/ \n/g, "\n").trim();
}

async function youtubeCaptions(id: string, tracks: CaptionTrack[]): Promise<string> {
  const track = pickTrack(tracks);
  if (!track) return "";
  const raw = await get(track.baseUrl.replace(/&fmt=[^&]*/, ""));
  return raw.trim() ? captionsToText(raw) : "";
}

// Plan B: la API interna con el cliente de Android, que devuelve subtítulos sin token extra.
async function youtubeCaptionsAndroid(id: string): Promise<string> {
  const body = JSON.stringify({
    context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30, hl: "es" } },
    videoId: id,
  });
  const raw = await get("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", body);
  const data = JSON.parse(raw) as { captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } } };
  const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  return tracks.length ? youtubeCaptions(id, tracks) : "";
}

async function youtubeInfo(v: VideoLink, maxChars: number): Promise<VideoInfo> {
  const info: VideoInfo = { titulo: "Video de YouTube", url: v.url };
  try {
    const o = JSON.parse(await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(v.url)}`)) as {
      title?: string;
      author_name?: string;
    };
    if (o.title) info.titulo = o.title;
    if (o.author_name) info.canal = o.author_name;
  } catch {
    // seguimos con lo que haya
  }
  if (!isDesktop()) return info; // en el navegador YouTube no deja leer la página

  let transcript = "";
  try {
    const html = await get(`${v.url}&hl=es`);
    const desc = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/)?.[1];
    if (desc) info.descripcion = clip(JSON.parse(`"${desc}"`) as string, 1500);
    const tracksJson = html.match(/"captionTracks":(\[.*?\])/)?.[1];
    if (tracksJson) transcript = await youtubeCaptions(v.id, JSON.parse(tracksJson) as CaptionTrack[]);
  } catch (err) {
    console.warn("[video] página de YouTube", err);
  }
  if (!transcript) {
    try {
      transcript = await youtubeCaptionsAndroid(v.id);
    } catch (err) {
      console.warn("[video] subtítulos (Android)", err);
    }
  }
  if (transcript) info.transcripcion = clip(transcript, maxChars);
  return info;
}

async function vimeoInfo(v: VideoLink): Promise<VideoInfo> {
  try {
    const o = JSON.parse(await get(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(v.url)}`)) as {
      title?: string;
      author_name?: string;
      description?: string;
    };
    return { titulo: o.title ?? "Video de Vimeo", canal: o.author_name, descripcion: o.description && clip(o.description, 1500), url: v.url };
  } catch {
    return { titulo: "Video de Vimeo", url: v.url };
  }
}

// Drive no expone subtítulos sin iniciar sesión: sólo el nombre del archivo (si es público).
async function driveInfo(v: VideoLink): Promise<VideoInfo> {
  const info: VideoInfo = { titulo: "Video de Google Drive", url: v.url };
  if (!isDesktop()) return info;
  try {
    const html = await get(v.url);
    const t = html.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/\s*-\s*Google Drive\s*$/, "").trim();
    if (t && !/^(Google Drive|Iniciar sesión|Sign in)/i.test(t)) info.titulo = decodeEntities(t);
  } catch {
    // privado o sin conexión
  }
  return info;
}

export async function videoInfo(v: VideoLink, maxChars = 20000): Promise<VideoInfo> {
  if (v.provider === "drive") return driveInfo(v);
  return v.provider === "youtube" ? youtubeInfo(v, maxChars) : vimeoInfo(v);
}

// Texto listo para mandarle a la IA.
export function videoInfoText(info: VideoInfo): string {
  const head = [`[Video: ${info.titulo}${info.canal ? ` — ${info.canal}` : ""}] ${info.url}`];
  if (info.descripcion) head.push(`Descripción:\n${info.descripcion}`);
  head.push(
    info.transcripcion
      ? `Transcripción (con marcas de minuto):\n"""\n${info.transcripcion}\n"""`
      : info.url.includes("drive.google.com")
        ? "(Es un video de Google Drive: no se puede leer su audio. Respondé con el título y sugerí descargarlo y adjuntarlo en el chat para ver los fotogramas.)"
        : "(No pudimos leer la transcripción de este video: respondé sólo con el título y la descripción, y aclaralo.)",
  );
  return head.join("\n");
}

// ---------- Archivos de video ----------

export const isVideoFile = (f: File) => f.type.startsWith("video/") || /\.(mp4|webm|mov|m4v|mkv|ogv)$/i.test(f.name);

export const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

// Saca `count` fotogramas repartidos a lo largo del video (lado mayor 768 px).
export async function videoFrames(file: Blob, count = 8): Promise<{ duration: number; frames: { t: number; dataUrl: string }[] }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise<void>((ok, bad) => {
      video.onloadedmetadata = () => ok();
      video.onerror = () => bad(new Error("No pudimos abrir el video. Probá con MP4 o WebM."));
    });
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const scale = Math.min(1, 768 / Math.max(video.videoWidth || 1, video.videoHeight || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round((video.videoWidth || 640) * scale);
    canvas.height = Math.round((video.videoHeight || 360) * scale);
    const g = canvas.getContext("2d")!;
    const frames: { t: number; dataUrl: string }[] = [];
    const n = duration > 0 ? count : 1;
    for (let i = 0; i < n; i++) {
      const t = duration > 0 ? (duration * (i + 0.5)) / n : 0;
      await new Promise<void>((ok) => {
        video.onseeked = () => ok();
        video.currentTime = t;
        if (t === 0 && video.readyState >= 2) ok();
      });
      g.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push({ t, dataUrl: canvas.toDataURL("image/jpeg", 0.8) });
    }
    return { duration, frames };
  } finally {
    URL.revokeObjectURL(url);
  }
}
