"use client";

import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import clsx from "clsx";
import { t } from "@/lib/i18n";
import { db } from "@/lib/db";
import type { Subject, Task, TaskStatus } from "@/lib/types";
import { TaskCard } from "@/components/tasks/task-card";
import { byDueDate } from "@/components/tasks/task-meta";

const COLUMNS: { status: Exclude<TaskStatus, "INBOX_EMAIL">; label: string }[] = [
  { status: "TODO", label: t("Por hacer") },
  { status: "IN_PROGRESS", label: t("En curso") },
  { status: "DONE", label: t("Hecho") },
];

// Tablero compacto de tareas, sin fondos de tarjeta por columna. Arrastrar cambia el estado.
export function Kanban({ tasks, subjectMap }: { tasks: Task[]; subjectMap: Record<string, Subject> }) {
  function onDragEnd(result: DropResult) {
    const { destination, source, draggableId } = result;
    if (!destination || destination.droppableId === source.droppableId) return;
    void db.tasks.update(draggableId, { status: destination.droppableId as TaskStatus });
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="grid grid-cols-1 gap-x-4 gap-y-6 @min-[900px]:grid-cols-3">
        {COLUMNS.map((col) => {
          const columnTasks = tasks.filter((tk) => tk.status === col.status).sort(byDueDate);
          return (
            <section key={col.status} className="flex min-w-0 flex-col gap-1.5">
              <header className="section-label flex items-center justify-between">
                <span>{col.label}</span>
                <span className="num">{columnTasks.length}</span>
              </header>
              <Droppable droppableId={col.status}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={clsx(
                      "flex min-h-[64px] flex-col gap-1.5 rounded-md p-0.5 transition-colors",
                      snapshot.isDraggingOver && "bg-primary-tint",
                    )}
                  >
                    {columnTasks.map((task, index) => (
                      <Draggable key={task.id} draggableId={task.id} index={index}>
                        {(drag, dragSnapshot) => (
                          <div
                            ref={drag.innerRef}
                            {...drag.draggableProps}
                            {...drag.dragHandleProps}
                            className={clsx(dragSnapshot.isDragging && "rounded-md shadow-pop")}
                          >
                            <TaskCard task={task} subject={task.subjectId ? subjectMap[task.subjectId] : undefined} />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {columnTasks.length === 0 && !snapshot.isDraggingOver && (
                      <p className="t-small px-2 py-1 text-faint">{t("Sin tareas")}</p>
                    )}
                  </div>
                )}
              </Droppable>
            </section>
          );
        })}
      </div>
    </DragDropContext>
  );
}
