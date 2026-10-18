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
import { t, intlLocale } from "@/lib/i18n";

const SUGGESTED: { title: string; md: string }[] = [
  {
    title: t("Apunte de clase"),
    md: t(`**Fecha:** {{fecha}}  ·  **Tema:**

## Lo más importante
-

## Apuntes
-

## Dudas para preguntar
- [ ]

## Para la próxima clase
- [ ] Leer
- [ ] Hacer ejercicios`),
  },
  {
    title: t("Resumen de unidad"),
    md: t(`# {{titulo}}

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
- `),
  },
  {
    title: t("Trabajo práctico"),
    md: t(`**Materia:**  ·  **Entrega:**  ·  **Grupo:**

## Consigna
> Pegá acá la consigna

## Plan
- [ ] Leer la consigna completa
- [ ] Buscar bibliografía
- [ ] Hacer un borrador
- [ ] Revisar y entregar

## Desarrollo

## Fuentes
- `),
  },
  {
    title: t("Preparar parcial"),
    md: t(`**Fecha del parcial:**  ·  **Unidades que entran:**

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
- [ ] `),
  },
  {
    title: t("Reunión de grupo"),
    md: t(`**Fecha:** {{fecha}} {{hora}}  ·  **Participantes:**

## Temas
-

## Decisiones
-

## Tareas
- [ ] Quién · qué · para cuándo`),
  },
];

export async function addSuggestedTemplates(): Promise<number> {
  const existing = new Set((await listTemplates()).map((tpl) => tpl.title.toLowerCase()));
  let n = 0;
  for (const tpl of SUGGESTED) {
    if (existing.has(tpl.title.toLowerCase())) continue;
    await createNote({ subjectId: TEMPLATES_FOLDER, title: tpl.title, unitNumber: 1, content: markdownToBlocks(tpl.md) });
    n++;
  }
  return n;
}

export function PlantillasView() {
  const templates = useLiveQuery(() => listTemplates(), []);
  const subjects = useLiveQuery(() => db.subjects.toArray(), []) ?? [];
  const open = useOpen();
  const menu = useContextMenu();

  async function createFrom(tpl: Note, folder: string) {
    const blocks = cloneBlocks(tpl.content, templateVars(new Date(), tpl.title));
    const id = await addNote(folder, { title: tpl.title, content: blocks, plainTextCache: plainTextOf(blocks as Parameters<typeof plainTextOf>[0]) });
    open({ type: "nota", id }, { ctrlKey: true });
  }

  // "Usar" pregunta dónde crear la nota: materias que cursás primero, después el resto.
  function chooseWhere(tpl: Note, e: React.MouseEvent) {
    const sorted = [...subjects].sort(
      (a, b) => Number(b.status === "CURSANDO") - Number(a.status === "CURSANDO") || a.name.localeCompare(b.name, intlLocale()),
    );
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu.open({ clientX: r.left, clientY: r.bottom + 4 }, [
      { label: t("Notas sueltas"), icon: FilePlus, onSelect: () => void createFrom(tpl, LOOSE_FOLDER) },
      { label: t("Ideas"), icon: FilePlus, onSelect: () => void createFrom(tpl, IDEAS_FOLDER) },
      { type: "separator" },
      ...sorted.map((s): MenuItem => ({ label: s.name, hint: s.status === "CURSANDO" ? t("cursando") : undefined, onSelect: () => void createFrom(tpl, s.id) })),
    ]);
  }

  const preview = (tpl: Note) => tpl.plainTextCache.replace(/\s+/g, " ").trim().slice(0, 160);

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6 px-6 py-6">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <LayoutTemplate className="h-5 w-5 text-primary-soft" strokeWidth={1.75} />
          <h1 className="t-h1 mr-auto">{t("Plantillas")}</h1>
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => open({ type: "nota", id: await addNote(TEMPLATES_FOLDER, { title: t("Nueva plantilla") }) })}
          >
            <FilePlus className="h-4 w-4" strokeWidth={1.75} />
            {t("Nueva plantilla")}
          </button>
        </div>
        <p className="t-body max-w-[680px] text-muted">
          {t("Son notas modelo para no empezar de cero. Tocá «Usar en…», elegí la materia y se crea una nota nueva con ese formato. Dentro de una nota también podés insertarlas con Alt+T. Si escribís {fecha}, {hora} o {titulo}, se completan solos.", {
            fecha: "{{fecha}}",
            hora: "{{hora}}",
            titulo: "{{titulo}}",
          })}
        </p>
      </header>


      {templates && templates.length === 0 && (
        <div className="card flex flex-col items-start gap-3 p-5">
          <p className="t-body">{t("Todavía no tenés plantillas.")}</p>
          <button
            type="button"
            className="btn btn-ai"
            onClick={async () => {
              const n = await addSuggestedTemplates();
              toast(t("Agregamos {n} plantillas", { n }));
            }}
          >
            <Sparkles className="h-4 w-4" strokeWidth={1.75} />
            {t("Agregar plantillas para la facultad")}
          </button>
        </div>
      )}

      {templates && templates.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((tpl) => (
            <div key={tpl.id} className="card flex flex-col gap-2 p-4">
              <p className="t-h3">{tpl.title}</p>
              <p className="line-clamp-4 flex-1 text-[length:calc(12px*var(--ui-scale,1))] text-muted">{preview(tpl) || t("Vacía")}</p>
              <div className="flex items-center gap-1">
                <button type="button" className="btn btn-sm" onClick={(e) => chooseWhere(tpl, e)} aria-haspopup="menu">
                  {t("Usar en…")}
                </button>
                <button type="button" className="icon-btn" title={t("Editar plantilla")} onClick={(e) => open({ type: "nota", id: tpl.id }, e)}>
                  <Pencil strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className="icon-btn ml-auto"
                  title={t("Eliminar plantilla")}
                  onClick={() => void deleteWithUndo(t("Se eliminó «{name}»", { name: tpl.title }), () => deleteNote(tpl.id))}
                >
                  <Trash2 strokeWidth={1.75} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {templates && templates.length > 0 && SUGGESTED.some((s) => !templates.some((tpl) => tpl.title.toLowerCase() === s.title.toLowerCase())) && (
        <button
          type="button"
          className="self-start text-[length:calc(13px*var(--ui-scale,1))] text-faint underline underline-offset-2 hover:text-text"
          onClick={async () => {
            const n = await addSuggestedTemplates();
            toast(t("Agregamos {n} plantillas", { n }));
          }}
        >
          {t("Agregar las plantillas sugeridas que falten")}
        </button>
      )}
      {menu.menu}
    </div>
  );
}
