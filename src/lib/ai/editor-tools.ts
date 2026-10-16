"use client";

// Herramientas de la IA para los editores incrustados (documento, planilla, presentación, PDF):
// crear archivos, leerlos y manejar el editor con sus propios comandos (los mismos de la cinta de opciones).

import { db } from "../db";
import type { OfficeDoc, OfficeKind } from "../types";
import { createOfficeDoc, EDITOR_KINDS, liveEditor, waitForEditor, type EditorCommandInfo, type LiveEditor } from "../editors/editors";
import { folderForView } from "../nav/actions";
import type { ApiTool } from "./server";
import type { ToolContext, ToolResult } from "./tools";

type Args = Record<string, unknown>;

const S = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const json = (v: unknown) => JSON.stringify(v);
const fail = (msg: string, label = msg): ToolResult => ({ ok: false, content: json({ error: msg }), label });
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const KIND_BY_WORD: Record<string, OfficeKind> = { documento: "doc", word: "doc", planilla: "sheet", excel: "sheet", presentacion: "deck", powerpoint: "deck", pdf: "pdf" };

export const EDITOR_TOOL_DEFS: ApiTool[] = [
  {
    type: "function",
    function: {
      name: "listar_archivos",
      description: "Lista los archivos de Word, Excel, PowerPoint y PDF guardados en UniCore (los que se abren en los editores).",
      parameters: obj({ texto: S("Parte del nombre (opcional)") }),
    },
  },
  {
    type: "function",
    function: {
      name: "crear_archivo",
      description: "Crea un documento de Word, una planilla de Excel o una presentación de PowerPoint vacíos y los abre en su editor.",
      parameters: obj(
        {
          tipo: { type: "string", enum: ["documento", "planilla", "presentacion"] },
          nombre: S("Nombre del archivo, sin extensión"),
          materia: S("Materia donde guardarlo (opcional)"),
        },
        ["tipo"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "leer_archivo",
      description: "Lee el contenido de un archivo de Word, Excel, PowerPoint o PDF. Sin 'archivo', lee el que está abierto.",
      parameters: obj({ archivo: S("Nombre o id del archivo (opcional)") }),
    },
  },
  {
    type: "function",
    function: {
      name: "comandos_editor",
      description:
        "Busca los comandos que acepta el editor abierto (formato, insertar, celdas, diapositivas, páginas…) con sus parámetros. Usala antes de ejecutar_en_editor para saber el id y los parámetros exactos.",
      parameters: obj({ buscar: S("Palabras en inglés del comando, ej: 'bold', 'insert table', 'cell value', 'new slide'"), archivo: S("Nombre del archivo (opcional)") }),
    },
  },
  {
    type: "function",
    function: {
      name: "ejecutar_en_editor",
      description:
        "Ejecuta un comando en el editor abierto (como apretar un botón de la cinta): escribir texto, dar formato, completar celdas, agregar diapositivas, rotar páginas, guardar… Se puede deshacer con Ctrl+Z.",
      parameters: obj(
        {
          comando: S("Id exacto del comando (de comandos_editor)"),
          parametros: { type: "object", description: "Parámetros del comando como objeto JSON (opcional)" },
          archivo: S("Nombre del archivo (opcional; por defecto, el abierto)"),
        },
        ["comando"],
      ),
    },
  },
];

async function findDoc(q: string | undefined): Promise<OfficeDoc | undefined> {
  if (!q) return undefined;
  const byId = await db.officeDocs.get(q);
  if (byId) return byId;
  const all = await db.officeDocs.toArray();
  const f = fold(q);
  return all.find((d) => fold(d.name) === f) ?? all.find((d) => fold(d.name).replace(/\.[a-z0-9]+$/, "") === f) ?? all.find((d) => fold(d.name).includes(f));
}

// El editor de ese archivo (abriéndolo si hace falta) o el que está abierto.
async function editorFor(archivo: string | undefined, ctx: ToolContext): Promise<{ ed?: LiveEditor; error?: string }> {
  if (archivo) {
    const doc = await findDoc(archivo);
    if (!doc) return { error: `No encontré el archivo "${archivo}". Usá listar_archivos.` };
    let ed = liveEditor(doc.id);
    if (!ed?.ready) {
      ctx.openView({ type: "editor", id: doc.id });
      ed = await waitForEditor(doc.id);
    }
    return ed ? { ed } : { error: "El editor no terminó de cargar." };
  }
  const ed = liveEditor();
  return ed ? { ed } : { error: "No hay ningún archivo abierto en un editor. Pasá 'archivo' o usá crear_archivo." };
}

function parseParams(v: unknown): unknown {
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" ? v : {};
}

// Devuelve null si la herramienta no es de los editores.
export async function runEditorTool(name: string, a: Args, ctx: ToolContext): Promise<ToolResult | null> {
  switch (name) {
    case "listar_archivos": {
      const t = str(a.texto) ? fold(String(a.texto)) : "";
      const docs = (await db.officeDocs.toArray()).filter((d) => !t || fold(d.name).includes(t));
      const out = docs.map((d) => ({ id: d.id, nombre: d.name, tipo: EDITOR_KINDS[d.kind].label, vacio: !d.fileId }));
      return { ok: true, content: json(out.slice(0, 80)), label: "Revisé tus archivos" };
    }

    case "crear_archivo": {
      const kind = KIND_BY_WORD[fold(String(a.tipo ?? ""))];
      if (!kind || kind === "pdf") return fail("El tipo tiene que ser documento, planilla o presentacion.");
      let subjectId = await folderForView({ type: "inicio" });
      if (str(a.materia)) {
        const m = fold(String(a.materia));
        const s = (await db.subjects.toArray()).find((x) => fold(x.name) === m || fold(x.name).includes(m) || (x.code && fold(x.code) === m));
        if (s) subjectId = s.id;
      }
      const id = await createOfficeDoc({ kind, subjectId, name: str(a.nombre) });
      ctx.openView({ type: "editor", id });
      const ed = await waitForEditor(id);
      const doc = await db.officeDocs.get(id);
      return {
        ok: true,
        content: json({ id, nombre: doc?.name, listo: !!ed }),
        label: `Creé ${EDITOR_KINDS[kind].label.toLowerCase()} «${doc?.name ?? ""}»`,
      };
    }

    case "leer_archivo": {
      const doc = str(a.archivo) ? await findDoc(String(a.archivo)) : undefined;
      if (str(a.archivo) && !doc) return fail(`No encontré el archivo "${a.archivo}".`);
      const ed = doc ? liveEditor(doc.id) : liveEditor();
      if (ed?.ready) {
        try {
          const r = (await ed.command("uc.read")) as { name?: string; text?: string };
          return { ok: true, content: json({ nombre: r?.name, contenido: (r?.text ?? "").slice(0, 20000) }), label: `Leí «${r?.name ?? "el archivo"}»` };
        } catch (err) {
          return fail(err instanceof Error ? err.message : "No pude leer el archivo.");
        }
      }
      if (doc?.textCache) return { ok: true, content: json({ nombre: doc.name, contenido: doc.textCache.slice(0, 20000) }), label: `Leí «${doc.name}»` };
      if (doc) {
        const r = await editorFor(doc.id, ctx);
        if (!r.ed) return fail(r.error ?? "No pude abrir el archivo.");
        const read = (await r.ed.command("uc.read")) as { text?: string };
        return { ok: true, content: json({ nombre: doc.name, contenido: (read?.text ?? "").slice(0, 20000) }), label: `Leí «${doc.name}»` };
      }
      return fail("No hay ningún archivo abierto. Pasá el nombre del archivo.");
    }

    case "comandos_editor": {
      const r = await editorFor(str(a.archivo), ctx);
      if (!r.ed) return fail(r.error ?? "No hay editor abierto.");
      let list: EditorCommandInfo[];
      try {
        list = ((await r.ed.command("uc.commands")) as EditorCommandInfo[]) ?? [];
      } catch (err) {
        return fail(err instanceof Error ? err.message : "El editor no respondió.");
      }
      const words = fold(str(a.buscar) ?? "")
        .split(/\s+/)
        .filter(Boolean);
      const score = (c: EditorCommandInfo) => {
        const hay = fold(`${c.id} ${c.label ?? ""} ${c.description ?? ""}`);
        return words.filter((w) => hay.includes(w)).length;
      };
      const ranked = words.length ? list.map((c) => ({ c, s: score(c) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s).map((x) => x.c) : list;
      const out = ranked.slice(0, 30).map((c) => ({ id: c.id, nombre: c.label, descripcion: c.description, parametros: c.params }));
      return { ok: true, content: json({ total: list.length, comandos: out }), label: `Busqué comandos del editor${words.length ? `: ${a.buscar}` : ""}` };
    }

    case "ejecutar_en_editor": {
      const comando = str(a.comando);
      if (!comando) return fail("Falta el comando.");
      const r = await editorFor(str(a.archivo), ctx);
      if (!r.ed) return fail(r.error ?? "No hay editor abierto.");
      try {
        const result = await r.ed.command(comando, parseParams(a.parametros));
        const text = json(result ?? {});
        return { ok: true, content: text.length > 4000 ? `${text.slice(0, 4000)}…` : text, label: `Ejecuté ${comando} en el editor` };
      } catch (err) {
        return fail(err instanceof Error ? err.message : "El comando falló.", `No pude ejecutar ${comando}`);
      }
    }
  }
  return null;
}
