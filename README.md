# UniCore

Una app de escritorio para organizar el estudio, el trabajo, tus proyectos y tu vida personal en un solo lugar. Todo se guarda en tu equipo, sin cuentas.

## Qué tiene

- **Perfiles**: Universidad, Colegio, Trabajo, Proyectos y Personal. Podés tener varios, incluso del mismo tipo. Cada perfil cambia los nombres (carreras y materias, proyectos, áreas), los tipos de tarea, las secciones y lo que muestra Inicio.
- **Bienvenida guiada**: la primera vez te hace unas preguntas y deja todo armado: carrera y materias, trabajo y horario, proyectos y preferencias.
- **Notas tipo Obsidian**: enlaces `[[…]]`, etiquetas, notas del día, lienzos, grafo, historial y plantillas.
- **Tareas y calendario**: tablero, agenda, calendarios propios con repeticiones y recordatorios, y suscripción a calendarios externos (iCal).
- **Repaso**: flashcards con repetición espaciada y cuestionarios.
- **Archivos**: documentos, planillas, presentaciones, PDF y geometría que se editan dentro de la app. También tiene un escáner de documentos.
- **Asistente de IA** que crea tareas, notas y flashcards, resume la bibliografía y conoce tus perfiles.
- **Carpetas libres** con el nombre y el ícono que quieras.
- **Idiomas**: español, inglés, francés, alemán, portugués y chino.

## Cómo correrla

Requisitos: Node.js 20+ y, para la app de escritorio, Rust con [Tauri 2](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run dev            # en el navegador, en http://localhost:3000
npx tauri dev          # como app de escritorio
npx tauri build        # instalador para Windows (src-tauri/target/release/bundle)
```

Los editores de documentos se arman aparte con `bash scripts/build-editors.sh` (necesita Rust con el target `wasm32-unknown-unknown` y `trunk`).

## Traducciones

Los textos se escriben en español dentro de `t("…")` (`src/lib/i18n.ts`). Cada idioma tiene su archivo en `src/locales/`. Para ver qué falta traducir:

```bash
node scripts/i18n-extract.mjs
```

## Estructura

- `src/views/`: pantallas (Inicio, nota, materia o proyecto, calendario, ajustes…).
- `src/components/`: piezas de la interfaz.
- `src/lib/`: base local (Dexie), perfiles, IA, calendario e idiomas.
- `src-tauri/`: la app de escritorio. Los datos se guardan en `Documentos\UniCore`.
- `docs/convenciones.md`: cómo está escrito el código.

## Licencia

MIT. Los editores incrustados se basan en proyectos con licencia MIT/Apache-2.0; sus licencias se copian al compilarlos.
