# Rediseño estilo Obsidian

Leé esto y `docs/convenciones.md` antes de tocar código. Si algo de convenciones.md choca con este archivo, **gana este**.

## Qué cambió
- UniCore es una sola pantalla (`src/app/page.tsx` → `AppShell`). No hay más rutas de Next: todo se abre como **vista dentro de una pestaña**.
- `src/lib/workspace.tsx` (`useWorkspace()`): paneles con pestañas, `openView(view, "current" | "tab" | "split")`, `goBack/goForward`, barra izquierda (`setLeft(open, "explorer" | "search" | "bookmarks")`), barra derecha (`setRight(open, "ia" | "backlinks" | "outgoing" | "outline" | "tags" | "properties")`), `activeView`, comandos (`useRegisterCommands(owner, cmds)`, `runCommand(id)`), barra de estado (`useStatusItem(key, nodo)`), espacios de trabajo (`saveWorkspace/loadWorkspace/deleteWorkspace/savedWorkspaces`).
- `ViewState` (en workspace.tsx): inicio, calendario, mails, repaso{subjectId?}, carreras, materia{id}, nota{id}, grafo{noteId?}, canvas{id}, pdf{id,page?}, busqueda{query?}, web{url}, slides{id}, base, ajustes{section?}, vacia.
- Abrir con modificadores: `useOpen()` de `src/components/workspace/use-open.ts` → `open(view, event)` (Ctrl+clic = pestaña nueva, Ctrl+Alt+clic = dividir).
- **Nunca** uses `next/link`, `useRouter` ni rutas. Para navegar: `openView`.
- Marco ya hecho (no lo toques salvo que tu tarea lo diga): `src/components/workspace/*` (ribbon, sidebars, tab-bar, view-host, status-bar, view-title, use-open) y `src/components/shell/app-shell.tsx`.
- Primitivas: `src/components/ui/menu.tsx` (`useContextMenu()` → `open(e, items)` y `menu` para renderizar; `<Menu>`), `prompt-modal.tsx` (pedir un texto), `modal.tsx`.
- Datos nuevos (`src/lib/types.ts`, `src/lib/db.ts` v2): `Note.properties/aliases/tags/links/dailyDate`, carpetas especiales `DAILY_FOLDER`, `TEMPLATES_FOLDER`, `LOOSE_FOLDER` (van en `Note.subjectId`), tablas `canvases`, `snapshots`, `bookmarks`, y `SubjectDocument.highlights/usedOcr`.

## Eventos entre módulos (window CustomEvent)
- `uc:goto-block` `{ noteId, blockId }`: el editor de esa nota hace scroll y resalta el bloque (lo emite el panel Esquema y la búsqueda).
- `uc:insert-blocks` `{ blocks }`: el editor de la nota activa inserta esos bloques (PartialBlock[]) en el cursor (lo emite el lector de PDF al "Copiar como cita").
- `uc:note-saved` `{ noteId }`: lo emite el editor después de guardar (para refrescar paneles si hace falta; igual Dexie es reactivo).

## Reglas de diseño (lo más importante)
1. **Cero texto de relleno.** Nada de subtítulos debajo de títulos, párrafos explicativos, "Acá vas a poder…", descripciones en tarjetas ni tooltips que repiten el label. Estados vacíos: una sola línea corta en `text-faint` ("Sin notas", "Sin resultados") y, como mucho, una acción.
2. **Listas antes que tarjetas.** Filas de 28 px (`.row`), sin bordes ni sombras. Tarjetas sólo cuando el contenido es un objeto visual (kanban, lienzo).
3. **Denso y tranquilo.** Texto de interfaz 13 px. Íconos 15–16 px trazo 1,75. Botones de ícono `.icon-btn` (26 px, sin borde). Botones con texto sólo cuando hacen falta (`btn btn-sm`). Casi todo en grises; el acento blurple sólo para lo activo, enlaces (`.wikilink`), etiquetas (`.tag`) y la selección.
4. **Clic derecho en todo.** Filas, notas, carpetas, pestañas, nodos: menú contextual con `useContextMenu`.
5. **Teclado primero.** Toda acción importante es también un comando (`useRegisterCommands`) para que aparezca en la paleta (Ctrl+P), con atajo si corresponde.
6. **Vistas de lectura** (nota, materia, ajustes): `.view-readable` (máx. 760 px, centrado). **Vistas anchas** (calendario, kanban, base, grafo, lienzo): `.view-wide` o pantalla completa.
7. **Títulos**: la pestaña ya dice dónde estás. Sólo la nota y la materia muestran título grande (inline, editable en la nota). Las demás vistas no llevan encabezado grande: a lo sumo una barra de herramientas fina arriba.
8. Fondo de la vista: `bg-surface` (ya lo pone el marco). Barras laterales: `bg-bg`.
9. Clases útiles nuevas en globals.css: `.icon-btn`, `.row`, `.tag`, `.wikilink`, `.wikilink-unresolved`, `.prop-row`, `.view-readable`, `.view-wide`, `.section-label`.
10. Sin puntitos de color, sin emojis, sin signos de exclamación, sin nombre del modelo de IA.

## Reglas técnicas
- `npx tsc --noEmit` y `npx eslint <tus archivos>` limpios. No corras `next build` (hay un `next dev` corriendo; podés abrir http://localhost:3000 con curl si querés, pero no lo reinicies).
- No instales paquetes. No hagas commits. Tocá sólo tus archivos; si necesitás algo de un archivo ajeno, decilo en tu respuesta final.
