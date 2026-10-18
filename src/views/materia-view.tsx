"use client";

import { newSubmenu } from "@/components/ui/new-menu";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { isQuizNote, readQuiz } from "@/lib/quiz/quiz-store";
import { NewQuizDialog } from "@/components/quiz/new-quiz-dialog";
import { Download, ExternalLink, FilePlus, Plus, Sparkles, Trash2, X } from "lucide-react";
import { exportMenuItem } from "@/components/export/export-menu";
import { useAppState } from "@/lib/app-state";
import { useWorkspace, type ViewState } from "@/lib/workspace";
import { db, newId, nowIso } from "@/lib/db";
import { useAllSubjects, useDegrees } from "@/lib/hooks";
import { cap, useProfiles } from "@/lib/profiles";
import { SUBJECT_STATUS_LABEL, type Note, type SubjectDocument, type SubjectStatus, type Subject } from "@/lib/types";
import { ConfirmDialog } from "@/components/careers/confirm-dialog";
import { saveSubject, type SubjectInput } from "@/components/careers/actions";
import { FlashcardFormModal } from "@/components/flashcards/flashcard-form-modal";
import { CronogramaSection } from "@/components/subjects/cronograma-section";
import { PdfImportButton } from "@/components/pdf/pdf-import-button";
import { createNote, paragraphBlocks, sortNotes } from "@/components/notes/note-utils";
import { useNow } from "@/components/dashboard/use-now";
import { TaskRow } from "@/components/tasks/task-row";
import { byDueDate } from "@/components/tasks/task-meta";
import { useContextMenu, type MenuItem } from "@/components/ui/menu";
import { useOpen } from "@/components/workspace/use-open";
import { Select } from "@/components/ui/select";

const CONTROL = "input h-7 min-w-0 border-transparent bg-transparent px-2 hover:bg-surface-raised";

// Propiedad "nombre · control", como en las propiedades de una nota.
function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prop-row min-h-[30px]">
      <span>{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5">
      <div className="mb-1 flex items-center justify-between pr-1">
        <h2 className="section-label">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="t-small px-2 py-1 text-faint">{children}</p>;
}

// Fila de lista con clic (abre), clic derecho (abrir en pestaña nueva y acciones extra).
function ListRow({
  title,
  meta,
  view,
  extra = [],
  onDelete,
}: {
  title: string;
  meta?: string;
  view: ViewState;
  extra?: MenuItem[];
  onDelete?: () => void;
}) {
  const { openView } = useWorkspace();
  const openFromEvent = useOpen();
  const { open, menu } = useContextMenu();

  const items: MenuItem[] = [
    { label: "Abrir", onSelect: () => openView(view) },
    { label: "Abrir en pestaña nueva", onSelect: () => openView(view, "tab") },
    ...extra,
  ];
  if (onDelete) items.push({ type: "separator" }, { label: "Eliminar", icon: Trash2, danger: true, onSelect: onDelete });

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        className="row"
        onClick={(e) => openFromEvent(view, e)}
        onKeyDown={(e) => {
          if (e.key === "Enter") openView(view);
        }}
        onContextMenu={(e) => open(e, items)}
      >
        <span className="min-w-0 flex-1 truncate text-text">{title}</span>
        {meta && <span className="t-small num flex-none text-faint">{meta}</span>}
      </div>
      {menu}
    </>
  );
}

// Fila con el valor de un link (Campus, Drive): input editable y un ícono para abrirlo.
function LinkField({ value, onSave, placeholder }: { value?: string; onSave: (v?: string) => void; placeholder: string }) {
  return (
    <>
      <input
        key={value ?? ""}
        type="url"
        defaultValue={value ?? ""}
        placeholder={placeholder}
        className={`${CONTROL} flex-1`}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v !== (value ?? "")) onSave(v || undefined);
        }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        aria-label={placeholder}
      />
      {value && (
        <a href={value} target="_blank" rel="noopener noreferrer" className="icon-btn" aria-label="Abrir enlace" title="Abrir enlace">
          <ExternalLink strokeWidth={1.75} />
        </a>
      )}
    </>
  );
}

// Materia: título y propiedades editables, y secciones con notas, lienzos, bibliografía, flashcards y tareas.
export function MateriaView({ id }: { id: string }) {
  // key: al cambiar de materia se reinician los diálogos y los campos.
  return <MateriaContent key={id} subjectId={id} />;
}

function inputOf(s: Subject): SubjectInput {
  return {
    degreeId: s.degreeId,
    name: s.name,
    year: s.year,
    semester: s.semester,
    status: s.status,
    finalGrade: s.finalGrade,
    correlatives: s.correlatives,
    professorEmail: s.professorEmail,
    campusUrl: s.campusUrl,
    driveUrl: s.driveUrl,
  };
}

function MateriaContent({ subjectId }: { subjectId: string }) {
  const { setCurrentSubjectId, setAiOpen, openTaskDialog } = useAppState();
  const { openView } = useWorkspace();
  const now = useNow();
  const degrees = useDegrees();
  const allSubjects = useAllSubjects();
  // null = no existe; undefined = todavía cargando
  const subject = useLiveQuery(async () => (await db.subjects.get(subjectId)) ?? null, [subjectId]);
  const notes = useLiveQuery(() => db.notes.where("subjectId").equals(subjectId).toArray(), [subjectId]);
  const docs = useLiveQuery(() => db.documents.where("subjectId").equals(subjectId).toArray(), [subjectId]);
  const canvases = useLiveQuery(() => db.canvases.where("subjectId").equals(subjectId).toArray(), [subjectId]);
  const cards = useLiveQuery(() => db.flashcards.where("subjectId").equals(subjectId).toArray(), [subjectId]);
  const tasks = useLiveQuery(() => db.tasks.where("subjectId").equals(subjectId).toArray(), [subjectId]);

  const [noteToDelete, setNoteToDelete] = useState<Note | null>(null);
  const [docToDelete, setDocToDelete] = useState<SubjectDocument | null>(null);
  const [cardForm, setCardForm] = useState(false);
  const [quizForm, setQuizForm] = useState(false);
  const pageMenu = useContextMenu();
  const { termsForSubject } = useProfiles();
  const pt = termsForSubject(subjectId);

  useEffect(() => {
    setCurrentSubjectId(subjectId);
    return () => setCurrentSubjectId(undefined);
  }, [subjectId, setCurrentSubjectId]);

  const sortedNotes = useMemo(() => sortNotes((notes ?? []).filter((n) => !isQuizNote(n))), [notes]);
  const quizzes = useMemo(() => (notes ?? []).filter(isQuizNote).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [notes]);
  const notesByUnit = useMemo(() => {
    const map = new Map<number, Note[]>();
    for (const n of sortedNotes) map.set(n.unitNumber, [...(map.get(n.unitNumber) ?? []), n]);
    return [...map.entries()];
  }, [sortedNotes]);

  if (subject === undefined) return null;

  if (subject === null) {
    return (
      <div className="view-readable">
        <p className="t-small text-faint">No {pt.item.f ? "encontramos esta" : "encontramos este"} {pt.item.one}</p>
        <button type="button" className="btn btn-sm mt-3" onClick={() => openView({ type: "carreras" })}>
          {pt.spacesView}
        </button>
      </div>
    );
  }

  const save = (changes: Partial<SubjectInput>) => saveSubject({ ...inputOf(subject), ...changes }, subject);

  const yearOptions = Array.from({ length: Math.max(degrees.find((d) => d.id === subject.degreeId)?.totalYears ?? 0, subject.year, 1) }, (_, i) => i + 1);
  const correlatives = subject.correlatives
    .map((cid) => allSubjects.find((s) => s.id === cid))
    .filter((s): s is Subject => !!s);
  const candidates = allSubjects
    .filter((s) => s.degreeId === subject.degreeId && s.id !== subject.id && !subject.correlatives.includes(s.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const sortedTasks = (tasks ?? []).filter((t) => t.status !== "DONE" && t.status !== "INBOX_EMAIL").sort(byDueDate);
  const totalCards = cards?.length ?? 0;
  const dueCards = now && cards ? cards.filter((c) => new Date(c.due).getTime() <= now.getTime()).length : 0;

  async function createNewNote() {
    const unit = sortedNotes.length ? sortedNotes[sortedNotes.length - 1].unitNumber : 1;
    const id = await createNote({ subjectId, title: "", unitNumber: unit });
    openView({ type: "nota", id });
  }

  async function createCanvas() {
    const id = newId();
    const stamp = nowIso();
    await db.canvases.add({ id, name: "Lienzo sin título", subjectId, data: { nodes: [], edges: [] }, createdAt: stamp, updatedAt: stamp });
    openView({ type: "canvas", id });
  }

  async function confirmDeleteDoc() {
    if (!docToDelete) return;
    const doc = docToDelete;
    await db.transaction("rw", db.documents, db.files, db.bookmarks, async () => {
      if (doc.fileId) await db.files.delete(doc.fileId);
      await db.bookmarks.where("targetId").equals(doc.id).delete();
      await db.documents.delete(doc.id);
    });
    setDocToDelete(null);
  }

  async function docAsNote(doc: SubjectDocument) {
    const id = await createNote({
      subjectId,
      title: doc.fileName,
      unitNumber: doc.unitNumber,
      content: paragraphBlocks(doc.extractedText),
      plainTextCache: doc.extractedText,
    });
    openView({ type: "nota", id });
  }

  async function confirmDeleteNote() {
    if (!noteToDelete) return;
    const noteId = noteToDelete.id;
    await db.snapshots.where("noteId").equals(noteId).delete();
    await db.bookmarks.where("targetId").equals(noteId).delete();
    await db.notes.delete(noteId);
    setNoteToDelete(null);
  }

  // Gramos: "8,5" → 8.5. Vacío borra la nota.
  function saveGrade(raw: string) {
    const clean = raw.trim().replace(",", ".");
    if (clean === "") return save({ finalGrade: undefined });
    const n = Number(clean);
    if (Number.isFinite(n) && n >= 0 && n <= 10) return save({ finalGrade: n });
  }

  // Clic derecho en cualquier parte de la materia (las filas tienen su propio menú).
  const pageItems: MenuItem[] = [
    newSubmenu({ open: (v) => openView(v), openTask: (d) => openTaskDialog(d), subjectId, taskDefaults: { subjectId, degreeId: subject.degreeId } }),
    exportMenuItem({ kind: "subject", id: subjectId }),
  ];

  return (
    <div className="view-readable flex flex-col gap-7" onContextMenu={(e) => pageMenu.open(e, pageItems)}>
      {pageMenu.menu}
      <div className="flex items-start gap-3">
        <input
          key={subject.name}
          defaultValue={subject.name}
          aria-label={`Nombre ${pt.item.f ? "de la" : "del"} ${pt.item.one}`}
          className="min-w-0 flex-1 bg-transparent text-[26px] font-semibold leading-tight text-text outline-none"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== subject.name) void save({ name: v });
            else e.target.value = subject.name;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <button
          type="button"
          className="icon-btn mt-1"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            pageMenu.open({ clientX: r.left, clientY: r.bottom + 4 }, [exportMenuItem({ kind: "subject", id: subjectId })]);
          }}
          aria-label="Exportar"
          title="Exportar"
        >
          <Download strokeWidth={1.75} />
        </button>
        <button type="button" className="icon-btn mt-1" onClick={() => setAiOpen(true)} aria-label="Preguntarle a la IA" title="Preguntarle a la IA">
          <Sparkles strokeWidth={1.75} />
        </button>
      </div>

      <div className="flex flex-col">
        <Prop label={cap(pt.space.one)}>
          <Select className={CONTROL} value={subject.degreeId} onChange={(e) => {
            const degreeId = e.target.value;
            void save({
              degreeId,
              correlatives: subject.correlatives.filter((cid) => allSubjects.some((s) => s.id === cid && s.degreeId === degreeId)),
            });
          }}>
            {degrees.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Prop>

        {pt.study && <Prop label="Año">
          <Select className={CONTROL} value={subject.year} onChange={(e) => void save({ year: Number(e.target.value) })}>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}.º año
              </option>
            ))}
          </Select>
          <Select className={CONTROL} value={subject.semester} onChange={(e) => void save({ semester: Number(e.target.value) as 1 | 2 })} aria-label="Cuatrimestre">
            <option value={1}>1.º cuatrimestre</option>
            <option value={2}>2.º cuatrimestre</option>
          </Select>
        </Prop>}

        <Prop label="Estado">
          <Select className={CONTROL} value={subject.status} onChange={(e) => void save({ status: e.target.value as SubjectStatus })}>
            {(Object.keys(SUBJECT_STATUS_LABEL) as SubjectStatus[]).map((st) => (
              <option key={st} value={st}>
                {pt.statuses[st]}
              </option>
            ))}
          </Select>
        </Prop>

        {pt.study && <Prop label="Nota">
          <input
            key={subject.finalGrade ?? "sin-nota"}
            defaultValue={subject.finalGrade === undefined ? "" : String(subject.finalGrade).replace(".", ",")}
            placeholder="–"
            inputMode="decimal"
            aria-label="Nota final"
            className={`${CONTROL} w-20`}
            onBlur={(e) => saveGrade(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        </Prop>}

        {pt.study && <Prop label="Correlativas">
          {correlatives.map((c) => (
            <span key={c.id} className="tag gap-1 pr-1">
              {c.name}
              <button
                type="button"
                aria-label={`Quitar ${c.name}`}
                className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-surface-raised"
                onClick={() => void save({ correlatives: subject.correlatives.filter((x) => x !== c.id) })}
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            </span>
          ))}
          {candidates.length > 0 && (
            <Select
              className={`${CONTROL} w-auto text-faint`}
              value=""
              aria-label="Agregar correlativa"
              onChange={(e) => {
                if (e.target.value) void save({ correlatives: [...subject.correlatives, e.target.value] });
              }}
            >
              <option value="">Agregar</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Prop>}

        <Prop label={pt.study ? "Profesor" : "Contacto"}>
          <input
            key={subject.professorEmail ?? ""}
            type="email"
            defaultValue={subject.professorEmail ?? ""}
            placeholder="–"
            aria-label={pt.study ? "Profesor" : "Contacto"}
            className={`${CONTROL} flex-1`}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (subject.professorEmail ?? "")) void save({ professorEmail: v || undefined });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        </Prop>

        <Prop label={pt.study ? "Campus" : "Link"}>
          <LinkField value={subject.campusUrl} placeholder={pt.study ? "Campus" : "Link"} onSave={(v) => void save({ campusUrl: v })} />
        </Prop>

        <Prop label="Drive">
          <LinkField value={subject.driveUrl} placeholder="Drive" onSave={(v) => void save({ driveUrl: v })} />
        </Prop>
      </div>

      <CronogramaSection subject={subject} />

      <Section
        title="Notas"
        action={
          <button type="button" className="icon-btn" onClick={() => void createNewNote()} aria-label="Nueva nota" title="Nueva nota">
            <Plus strokeWidth={1.75} />
          </button>
        }
      >
        {notes === undefined ? null : sortedNotes.length === 0 ? (
          <Empty>Sin notas</Empty>
        ) : (
          notesByUnit.map(([unit, list]) => (
            <div key={unit} className="flex flex-col">
              <div className="t-small px-2 pt-2 text-faint">{pt.unit} {unit}</div>
              {list.map((note) => (
                <ListRow
                  key={note.id}
                  title={note.title || "Sin título"}
                  view={{ type: "nota", id: note.id }}
                  onDelete={() => setNoteToDelete(note)}
                />
              ))}
            </div>
          ))
        )}
      </Section>

      <Section
        title="Lienzos"
        action={
          <button type="button" className="icon-btn" onClick={() => void createCanvas()} aria-label="Nuevo lienzo" title="Nuevo lienzo">
            <Plus strokeWidth={1.75} />
          </button>
        }
      >
        {canvases && canvases.length > 0 ? (
          canvases
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map((c) => <ListRow key={c.id} title={c.name} view={{ type: "canvas", id: c.id }} />)
        ) : (
          <Empty>Sin lienzos</Empty>
        )}
      </Section>

      <Section title={pt.study ? "Bibliografía" : "Documentos"} action={<PdfImportButton subjectId={subjectId} label="Subir PDF" onImported={() => undefined} />}>
        {docs && docs.length > 0 ? (
          [...docs]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((doc) => (
              <ListRow
                key={doc.id}
                title={doc.fileName}
                meta={`${doc.pageCount} p`}
                view={{ type: "pdf", id: doc.id }}
                onDelete={() => setDocToDelete(doc)}
                extra={[{ label: "Abrir como apunte", icon: FilePlus, onSelect: () => void docAsNote(doc) }]}
              />
            ))
        ) : (
          <Empty>Sin PDFs</Empty>
        )}
      </Section>

      {(pt.study || quizzes.length > 0) && <Section
        title="Cuestionarios"
        action={
          <button type="button" className="icon-btn" onClick={() => setQuizForm(true)} aria-label="Nuevo cuestionario" title="Nuevo cuestionario con IA">
            <Plus strokeWidth={1.75} />
          </button>
        }
      >
        {quizzes.length > 0 ? (
          quizzes.map((q) => {
            const m = readQuiz(q);
            const last = m.intentos[m.intentos.length - 1];
            return <ListRow key={q.id} title={q.title} meta={last ? last.split(" · ")[1] : m.parcial ? m.parcial : `${m.questions.length} preg.`} view={{ type: "nota", id: q.id }} />;
          })
        ) : (
          <button type="button" className="row text-left text-faint hover:text-text" onClick={() => setQuizForm(true)}>
            Armar un cuestionario para estudiar
          </button>
        )}
      </Section>}
      {quizForm && <NewQuizDialog subjectId={subjectId} onClose={() => setQuizForm(false)} />}

      {(pt.study || totalCards > 0) && <Section
        title="Flashcards"
        action={
          <button type="button" className="icon-btn" onClick={() => setCardForm(true)} aria-label="Nueva flashcard" title="Nueva flashcard">
            <Plus strokeWidth={1.75} />
          </button>
        }
      >
        <div className="row justify-between">
          <span className="t-small num text-muted">
            {totalCards} {totalCards === 1 ? "tarjeta" : "tarjetas"} · {dueCards} para hoy
          </span>
          <button
            type="button"
            className="btn btn-sm"
            disabled={totalCards === 0}
            onClick={() => openView({ type: "repaso", subjectId })}
          >
            Repasar
          </button>
        </div>
      </Section>}

      <Section
        title="Tareas"
        action={
          <button
            type="button"
            className="icon-btn"
            onClick={() => openTaskDialog({ subjectId, degreeId: subject.degreeId })}
            aria-label="Nueva tarea"
            title="Nueva tarea"
          >
            <Plus strokeWidth={1.75} />
          </button>
        }
      >
        {sortedTasks.length === 0 ? (
          <Empty>Sin tareas pendientes</Empty>
        ) : (
          sortedTasks.map((t) => <TaskRow key={t.id} task={t} />)
        )}
      </Section>

      {cardForm && <FlashcardFormModal subjectId={subjectId} onClose={() => setCardForm(false)} />}

      {docToDelete && (
        <ConfirmDialog
          title="Eliminar PDF"
          message={`Se borra "${docToDelete.fileName}" de la bibliografía, con sus resaltados. No se puede deshacer.`}
          confirmLabel="Eliminar PDF"
          onConfirm={confirmDeleteDoc}
          onClose={() => setDocToDelete(null)}
        />
      )}

      {noteToDelete && (
        <ConfirmDialog
          title="Eliminar nota"
          message={`Se borra "${noteToDelete.title || "Sin título"}". No se puede deshacer.`}
          confirmLabel="Eliminar nota"
          onConfirm={confirmDeleteNote}
          onClose={() => setNoteToDelete(null)}
        />
      )}
    </div>
  );
}
