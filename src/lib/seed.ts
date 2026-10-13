"use client";

import { db, newId, nowIso } from "./db";
import type { Degree, Subject, Task } from "./types";

// Carga datos de ejemplo la primera vez que se abre la app (base vacía).
export async function seedIfEmpty() {
  if ((await db.degrees.count()) > 0) return;

  const admin: Degree = {
    id: newId(),
    name: "Tecnicatura en Administración",
    shortName: "ADMIN",
    institution: "Ejemplo",
    color: "primary",
    totalYears: 3,
    createdAt: nowIso(),
  };
  const ing: Degree = {
    id: newId(),
    name: "Ingeniería en Sistemas",
    shortName: "ING",
    institution: "Ejemplo",
    color: "cyan",
    totalYears: 5,
    createdAt: nowIso(),
  };

  const s = (degreeId: string, name: string, year: number, semester: 1 | 2, status: Subject["status"], correlatives: string[] = [], finalGrade?: number): Subject => ({
    id: newId(),
    degreeId,
    name,
    year,
    semester,
    status,
    correlatives,
    finalGrade,
    createdAt: nowIso(),
  });

  const cont1 = s(admin.id, "Contabilidad I", 1, 1, "APROBADA", [], 9);
  const adm = s(admin.id, "Principios de Administración", 1, 1, "APROBADA", [], 8);
  const mat1 = s(admin.id, "Matemática I", 1, 1, "REGULAR");
  const eco = s(admin.id, "Economía", 1, 2, "CURSANDO");
  const cont2 = s(admin.id, "Contabilidad II", 2, 1, "PENDIENTE", [cont1.id]);
  const matfin = s(admin.id, "Matemática Financiera", 2, 2, "PENDIENTE", [mat1.id, eco.id]);
  const costos = s(admin.id, "Costos", 2, 2, "PENDIENTE", [cont2.id]);

  const alg = s(ing.id, "Álgebra", 1, 1, "CURSANDO");
  const am1 = s(ing.id, "Análisis Matemático I", 1, 1, "CURSANDO");
  const sist = s(ing.id, "Análisis de Sistemas", 1, 2, "CURSANDO");
  const prog = s(ing.id, "Algoritmos y Estructuras de Datos", 1, 1, "APROBADA", [], 7);
  const am2 = s(ing.id, "Análisis Matemático II", 2, 1, "PENDIENTE", [am1.id, alg.id]);
  const disenio = s(ing.id, "Diseño de Sistemas", 3, 1, "PENDIENTE", [sist.id, prog.id]);

  const subjects = [cont1, adm, mat1, eco, cont2, matfin, costos, alg, am1, sist, prog, am2, disenio];

  const inDays = (d: number, h = 23, m = 59) => {
    const date = new Date();
    date.setDate(date.getDate() + d);
    date.setHours(h, m, 0, 0);
    return date.toISOString();
  };

  const t = (partial: Partial<Task> & Pick<Task, "title" | "type" | "status">): Task => ({
    id: newId(),
    priority: "MEDIUM",
    source: "MANUAL",
    createdAt: nowIso(),
    ...partial,
  });

  const tasks: Task[] = [
    t({ title: "Primer parcial: unidades 1 a 4", type: "PARCIAL", status: "TODO", degreeId: admin.id, subjectId: eco.id, dueDate: inDays(4, 18, 0), priority: "HIGH" }),
    t({ title: "TP 2: Diagrama de clases", type: "TP", status: "TODO", degreeId: ing.id, subjectId: sist.id, dueDate: inDays(14) }),
    t({ title: "Leer Mankiw, capítulo 4", type: "LECTURA", status: "IN_PROGRESS", degreeId: admin.id, subjectId: eco.id }),
    t({ title: "Foro: metodologías ágiles", type: "FORO", status: "IN_PROGRESS", degreeId: ing.id, subjectId: sist.id, dueDate: inDays(2) }),
    t({ title: "Guía de ejercicios 3", type: "TAREA", status: "DONE", degreeId: ing.id, subjectId: alg.id }),
    t({
      title: "Cambio de fecha del parcial de Álgebra",
      type: "PARCIAL",
      status: "INBOX_EMAIL",
      source: "EMAIL_AUTO",
      degreeId: ing.id,
      subjectId: alg.id,
      dueDate: inDays(9, 9, 0),
      rawEmailFrom: "catedra.algebra@ejemplo.edu.ar",
      rawEmailBody:
        "Hola a todos. Les aviso que el primer parcial de Álgebra se mueve al miércoles de la semana que viene a las 9 hs en el aula 12. Entran los temas de matrices y determinantes. Saludos, la cátedra.",
    }),
  ];

  await db.transaction("rw", db.degrees, db.subjects, db.tasks, async () => {
    await db.degrees.bulkAdd([admin, ing]);
    await db.subjects.bulkAdd(subjects);
    await db.tasks.bulkAdd(tasks);
  });
}
