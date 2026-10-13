"use client";

import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import clsx from "clsx";
import { db } from "@/lib/db";
import type { Degree, Subject, Task, TaskStatus } from "@/lib/types";
import { TaskCard } from "@/components/tasks/task-card";
import { byDueDate } from "@/components/tasks/task-meta";

const COLUMNS: { status: Exclude<TaskStatus, "INBOX_EMAIL">; label: string }[] = [
  { status: "TODO", label: "Por hacer" },
  { status: "IN_PROGRESS", label: "En curso" },
  { status: "DONE", label: "Hecho" },
];

// Tablero de tareas. Arrastrar a otra columna cambia el estado en la base.
// Dentro de una misma columna el orden es por fecha, así que no hace falta guardar posiciones.
export function Kanban({
  tasks,
  degreeMap,
  subjectMap,
}: {
  tasks: Task[]; // sin las que están en el inbox
  degreeMap: Record<string, Degree>;
  subjectMap: Record<string, Subject>;
}) {
  function onDragEnd(result: DropResult) {
    const { destination, source, draggableId } = result;
    if (!destination || destination.droppableId === source.droppableId) return;
    void db.tasks.update(draggableId, { status: destination.droppableId as TaskStatus });
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {COLUMNS.map((col) => {
          const columnTasks = tasks.filter((t) => t.status === col.status).sort(byDueDate);
          return (
            <section key={col.status} className="flex min-w-0 flex-col gap-2.5">
              <header className="flex items-center justify-between px-1">
                <h3 className="t-h3">{col.label}</h3>
                <span className="num t-small text-faint">{columnTasks.length}</span>
              </header>
              <Droppable droppableId={col.status}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={clsx(
                      "flex min-h-[160px] flex-col gap-2 rounded-lg border border-dashed p-2 transition-colors",
                      snapshot.isDraggingOver ? "border-primary bg-primary-tint" : "border-border",
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
                            <TaskCard task={task} degree={task.degreeId ? degreeMap[task.degreeId] : undefined} subject={task.subjectId ? subjectMap[task.subjectId] : undefined} />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {columnTasks.length === 0 && !snapshot.isDraggingOver && (
                      <p className="t-small px-1 py-4 text-center text-faint">Nada por acá</p>
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
