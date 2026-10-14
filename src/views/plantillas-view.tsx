"use client";

// Plantillas: notas modelo para no empezar de cero (apunte de clase, resumen, TP, preparar un parcial…).
// "Usar" crea una nota nueva con ese contenido en la materia que elijas.
// {{fecha}}, {{hora}} y {{titulo}} se reemplazan al usarla.

import { useLiveQuery } from "dexie-react-hooks";
import { FilePlus, LayoutTemplate, Pencil, Sparkles, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { addNote, cloneBlocks, deleteNote, listTemplates, templateVars } from "@/lib/nav/actions";
import { markdownToBlocks } from "@/lib/notes/md-blocks";
import { plainTextOf } from "@/lib/notes/index-note";
import { useOpen } from "@/components/workspace/use-open";
import { useContextMenu, type MenuItem } from "@/components/ui/menu";
import { deleteWithUndo, toast } from "@/lib/undo";
import { IDEAS_FOLDER, LOOSE_FOLDER, TEMPLATES_FOLDER, type Note } from "@/lib/types";
import { createNote } from "@/components/notes/note-utils";

const SUGGESTED: { title: string; md: string }[] = [
  {
    title: "Apunte de clase",
    md: `**Fecha:** {{fecha}}  ·  **Tema:**

## Lo más importante
-

## Apuntes
-

## Dudas para preguntar
- [ ]

## Para la próxima clase
- [ ] Leer
- [ ] Hacer ejercicios`,
  },
  {
    title: "Resumen de unidad",
    md: `# {{titulo}}

## Conceptos clave
| Concepto | Definición | Ejemplo |
| --- | --- | --- |
|  |  |  |

## Ideas principales
1.
2.
3.

## Preguntas de repaso
- ¿...? ::
- ¿...? ::

## Bibliografía
- `,
  },
  {
    title: "Trabajo práctico",
    md: `**Materia:**  ·  **Entrega:**  ·  **Grupo:**

## Consigna
> Pegá acá la consigna

## Plan
- [ ] Leer la consigna completa
- [ ] Buscar bibliografía
- [ ] Hacer un borrador
- [ ] Revisar y entregar

## Desarrollo

## Fuentes
- `,
  },
  {
    title: "Preparar parcial",
    md: `**Fecha del parcial:**  ·  **Unidades que entran:**

## Temas
- [ ] Unidad 1
- [ ] Unidad 2
- [ ] Unidad 3

## Lo que más me cuesta
-

## Plan de estudio
| Día | Qué estudio | Hecho |
| --- | --- | --- |
|  |  |  |

## Ejercicios de práctica
- [ ] `,
  },
  {
    title: "Reunión de grupo",
    md: `**Fecha:** {{fecha}} {{hora}}  ·  **Participantes:**

## Temas
-

## Decisiones
-

## Tareas
- [ ] Quién · qué · para cuándo`,
  },
];

export async function addSuggestedTemplates(): Promise<number> {
  const existing = new Set((await listTemplates()).map((t) => t.title.toLowerCase()));
  let n = 0;
  for (const t of SUGGESTED) {
    if (existing.has(t.title.toLowerCase())) continue;
    await createNote({ subjectId: TEMPLATES_FOLDER, title: t.title, unitNumber: 1, content: markdownToBlocks(t.md) });
    n++;
  }
  return n;
}

export function PlantillasView() {
  const templates = useLiveQuery(() => listTemplates(), []);
  const subjects = useLiveQuery(() => db.subjects.toArray(), []) ?? [];
  const open = useOpen();
  const menu = useContextMenu();

  async function createFrom(t: Note, folder: string) {
    const blocks = cloneBlocks(t.content, templateVars(new Date(), t.title));
    const id = await addNote(folder, { title: t.title, content: blocks, plainTextCache: plainTextOf(blocks as Parameters<typeof plainTextOf>[0]) });
    open({ type: "nota", id }, { ctrlKey: true });
  }

  // "Usar" pregunta dónde crear la nota: materias que cursás primero, después el resto.
  function chooseWhere(t: Note, e: React.MouseEvent) {
    const sorted = [...subjects].sort(
      (a, b) => Number(b.status === "CURSANDO") - Number(a.status === "CURSANDO") || a.name.localeCompare(b.name, "es"),
    );
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu.open({ clientX: r.left, clientY: r.bottom + 4 }, [
      { label: "Notas sueltas", icon: FilePlus, onSelect: () => void createFrom(t, LOOSE_FOLDER) },
      { label: "Ideas", icon: FilePlus, onSelect: () => void createFrom(t, IDEAS_FOLDER) },
      { type: "separator" },
      ...sorted.map((s): MenuItem => ({ label: s.name, hint: s.status === "CURSANDO" ? "cursando" : undefined, onSelect: () => void createFrom(t, s.id) })),
    ]);
  }

  const preview = (t: Note) => t.plainTextCache.replace(/\s+/g, " ").trim().slice(0, 160);

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6 px-6 py-6">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <LayoutTemplate className="h-5 w-5 text-primary-soft" strokeWidth={1.75} />
          <h1 className="t-h1 mr-auto">Plantillas</h1>
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => open({ type: "nota", id: await addNote(TEMPLATES_FOLDER, { title: "Nueva plantilla" }) })}
          >
            <FilePlus className="h-4 w-4" strokeWidth={1.75} />
            Nueva plantilla
          </button>
        </div>
        <p className="t-body max-w-[680px] text-muted">
          Son notas modelo para no empezar de cero. Tocá <b className="text-text">Usar en…</b>, elegí la materia y se crea una nota nueva con ese formato. Dentro de una nota también podés
          insertarlas con <span className="kbd">Alt</span>+<span className="kbd">T</span>. Si escribís {"{{fecha}}"}, {"{{hora}}"} o {"{{titulo}}"}, se completan solos.
        </p>
      </header>


      {templates && templates.length === 0 && (
        <div className="card flex flex-col items-start gap-3 p-5">
          <p className="t-body">Todavía no tenés plantillas.</p>
          <button
            type="button"
            className="btn btn-ai"
            onClick={async () => {
              const n = await addSuggestedTemplates();
              toast(`Agregamos ${n} plantillas`);
            }}
          >
            <Sparkles className="h-4 w-4" strokeWidth={1.75} />
            Agregar plantillas para la facultad
          </button>
        </div>
      )}

      {templates && templates.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <div key={t.id} className="card flex flex-col gap-2 p-4">
              <p className="t-h3">{t.title}</p>
              <p className="line-clamp-4 flex-1 text-[12px] text-muted">{preview(t) || "Vacía"}</p>
              <div className="flex items-center gap-1">
                <button type="button" className="btn btn-sm" onClick={(e) => chooseWhere(t, e)} aria-haspopup="menu">
                  Usar en…
                </button>
                <button type="button" className="icon-btn" title="Editar plantilla" onClick={(e) => open({ type: "nota", id: t.id }, e)}>
                  <Pencil strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className="icon-btn ml-auto"
                  title="Eliminar plantilla"
                  onClick={() => void deleteWithUndo(`Se eliminó «${t.title}»`, () => deleteNote(t.id))}
                >
                  <Trash2 strokeWidth={1.75} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {templates && templates.length > 0 && SUGGESTED.some((s) => !templates.some((t) => t.title.toLowerCase() === s.title.toLowerCase())) && (
        <button
          type="button"
          className="self-start text-[13px] text-faint underline underline-offset-2 hover:text-text"
          onClick={async () => {
            const n = await addSuggestedTemplates();
            toast(`Agregamos ${n} plantillas`);
          }}
        >
          Agregar las plantillas sugeridas que falten
        </button>
      )}
      {menu.menu}
    </div>
  );
}
