"use client";

// Búsqueda web para la IA. En la app de escritorio las páginas se piden desde Rust (sin CORS);
// en el navegador sólo queda Wikipedia, que permite pedidos desde cualquier página.

import { isDesktop } from "../desktop";

export interface WebResult {
  titulo: string;
  url: string;
  fragmento: string;
}

export async function get(url: string, body?: string): Promise<string> {
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("web_get", { url, body: body ?? null });
  }
  const r = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    ...(body ? { method: "POST", body, headers: { "Content-Type": "application/json" } } : {}),
  });
  if (!r.ok) throw new Error(`La página respondió ${r.status}`);
  return r.text();
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function realUrl(href: string): string {
  // DuckDuckGo envuelve los links: //duckduckgo.com/l/?uddg=<url>
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const target = u.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : u.href;
  } catch {
    return href;
  }
}

async function duckduckgo(query: string): Promise<WebResult[]> {
  const html = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=ar-es`);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: WebResult[] = [];
  for (const r of doc.querySelectorAll(".result")) {
    if (r.classList.contains("result--ad")) continue;
    const a = r.querySelector<HTMLAnchorElement>("a.result__a");
    if (!a) continue;
    out.push({
      titulo: squash(a.textContent ?? ""),
      url: realUrl(a.getAttribute("href") ?? ""),
      fragmento: clip(squash(r.querySelector(".result__snippet")?.textContent ?? ""), 300),
    });
    if (out.length >= 8) break;
  }
  return out;
}

async function wikipedia(query: string): Promise<WebResult[]> {
  const r = await get(
    `https://es.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=6&srsearch=${encodeURIComponent(query)}`,
  );
  const data = JSON.parse(r) as { query?: { search?: { title: string; snippet: string }[] } };
  return (data.query?.search ?? []).map((s) => ({
    titulo: s.title,
    url: `https://es.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, "_"))}`,
    fragmento: squash(s.snippet.replace(/<[^>]+>/g, "")),
  }));
}

export async function webSearch(query: string): Promise<WebResult[]> {
  if (isDesktop()) {
    try {
      const r = await duckduckgo(query);
      if (r.length) return r;
    } catch (err) {
      console.warn("[IA] DuckDuckGo falló", err);
    }
  }
  const r = await wikipedia(query);
  if (!r.length) throw new Error("No hubo resultados.");
  return r;
}

// Texto principal de una página (sin menús, scripts ni pies).
export async function readPage(url: string): Promise<{ titulo: string; url: string; texto: string }> {
  const html = await get(url);
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, noscript, svg, nav, footer, header, aside, form, iframe, [role=navigation], .ad, .ads").forEach((e) => e.remove());
  const main = doc.querySelector("article") ?? doc.querySelector("main") ?? doc.body;
  const blocks: string[] = [];
  main?.querySelectorAll("h1, h2, h3, h4, p, li, td, th, pre, blockquote").forEach((e) => {
    const t = squash(e.textContent ?? "");
    if (t.length > 1) blocks.push(/^H\d$/.test(e.tagName) ? `## ${t}` : t);
  });
  const texto = blocks.length ? blocks.join("\n") : squash(main?.textContent ?? "");
  return { titulo: squash(doc.title), url, texto: clip(texto, 9000) };
}
