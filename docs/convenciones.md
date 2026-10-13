# Convenciones de UniCore

Leé esto antes de tocar código.

## Producto
App para organizar una o más carreras universitarias en simultáneo. Todo en español rioplatense (de vos). Sin login. Los datos viven en el navegador (IndexedDB con Dexie); más adelante se migran a Supabase.

## Stack
Next.js 15 (App Router) + React 19.2 + TypeScript + Tailwind v4. Dependencias ya instaladas: dexie, dexie-react-hooks, @mlc-ai/web-llm, pdfjs-dist, tesseract.js, @blocknote/core/react/mantine, @mantine/core, ts-fsrs, chrono-node, @hello-pangea/dnd, @xyflow/react, lucide-react, clsx, date-fns, nanoid.
**No instales paquetes nuevos** sin avisar al director. No uses shadcn.

## Archivos base (no los modifiques salvo que tu tarea lo diga)
- `src/lib/types.ts`: modelos (Degree, Subject, Task, Note, SubjectDocument, StoredFile, Flashcard, StudySession) y labels.
- `src/lib/db.ts`: base Dexie `db` con tablas degrees, subjects, tasks, notes, documents, files, flashcards, studySessions. `newId()`, `nowIso()`, `saveFile(file)` → `"idb://<id>"`, `resolveFileUrl(url)` → blob URL.
- `src/lib/hooks.ts`: `useDegrees`, `useDegreeMap`, `useAllSubjects`, `useSubjects` (filtrado por carrera), `useSubjectMap`, `useTasks` (filtrado). Para otras lecturas usá `useLiveQuery` de dexie-react-hooks.
- `src/lib/app-state.tsx`: `useAppState()` con `degreeFilter` ("all" o id), `aiOpen/setAiOpen`, `currentSubjectId/setCurrentSubjectId`, `taskDialog/openTaskDialog(task?)/closeTaskDialog`, `searchOpen/setSearchOpen`, `theme/toggleTheme`. Ctrl+J y Ctrl+K ya están conectados.
- `src/lib/ai/use-local-ai.tsx`: contrato de la IA: `useLocalAI()` → `{ status, progress, progressText, error, load(), generate(messages, { onToken, json, maxTokens, temperature }), stop() }`.
- `src/lib/format.ts`: `shortDate`, `shortDateTime`, `relativeDays`, `daysUntil`, `isUrgent`, `grade` (coma decimal), `degreeBadgeClass`, `TASK_TYPE_BADGE`, `isSubjectEnabled`, `missingCorrelatives`, `average`.
- `src/components/ui/modal.tsx` (`<Modal open onClose title footer width>`), `empty-state.tsx`, `logo.tsx`.
- `src/components/shell/*`: sidebar, topbar, app-shell.

## Diseño
Clases CSS globales en `src/app/globals.css` — usalas en vez de inventar estilos:
- Tipografía: `t-display`, `t-timer`, `t-h1`, `t-h2`, `t-h3`, `t-body`, `t-small`, `t-label`, `num` (cifras tabulares).
- Botones: `btn` + `btn-primary` | `btn-ghost` | `btn-ai` | `btn-danger`, tamaños `btn-sm`, `btn-icon`. **Un solo `btn-primary` por pantalla** (la barra superior ya tiene "Agregar tarea", así que en páginas usá secundarios salvo en modales).
- Badges: `badge` + `badge-rose` (parcial/final) | `badge-amber` (TP/foro/mail) | `badge-mint` (aprobada/hecho) | `badge-primary` (Carrera 1, cursando) | `badge-cyan` (Carrera 2).
- `card`, `card-hover`, `kbd`, `field` (label > span + input), `input`, `input-error`, `progress` (con `<i style={{width}}>`), `nav-item`.
- Colores Tailwind: `bg-bg`, `bg-surface`, `bg-surface-raised`, `border-border`, `border-border-strong`, `text-text`, `text-muted`, `text-faint`, `text-primary-soft`, `bg-primary-tint`, `border-primary`, `text-rose`, `text-amber`, `text-mint`, `text-cyan`, `shadow-pop`. Radios `rounded-sm` (6), `rounded-md` (10), `rounded-lg` (14).
- Íconos: lucide-react con `strokeWidth={1.75}`, 16 px en botones/filas. La IA es siempre `Sparkles`.
- **No uses puntitos de color** (círculos de 8 px) para indicar estado o carrera: usá badges o texto.
- Sin sombras en tarjetas; `shadow-pop` sólo para lo que flota.
- **Nunca mostrar el nombre del modelo de IA** en la interfaz.

## Voz
- Botones: verbo primero, 1 a 3 palabras ("Agregar tarea", "Empezar repaso").
- Fechas: "vie 17/10 · 23:59", "en 3 días". Notas con coma: 8,42.
- Errores: qué pasó y qué hacer. "No pudimos leer el PDF. Probá con otro archivo."
- Sin signos de exclamación ni emojis en la interfaz.

## Reglas técnicas
- Todo componente que use hooks/navegador lleva `"use client"`.
- Librerías pesadas o que tocan `window` (pdfjs, tesseract, web-llm, BlockNote, React Flow) se cargan con `next/dynamic` (`ssr: false`) o `import()` dentro de funciones.
- Verificá con `npx tsc --noEmit` y `npx eslint <tus archivos>`. **No corras `next build` ni `next dev`** (hay otros agentes trabajando en paralelo).
- Tocá sólo los archivos de tu tarea. Si necesitás un cambio en un archivo base, explicalo en tu respuesta final en vez de hacerlo.
