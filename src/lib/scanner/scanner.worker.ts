// Trabajo pesado del escáner, fuera de la pantalla: encontrar la hoja en la foto, enderezarla y aplicar el filtro.
// Usa OpenCV.js (public/vendor/opencv/opencv.js, lo baja scripts/fetch-vendor.sh). La detección sigue la idea de
// jscanify (MIT): el contorno más grande de los bordes; primero se intenta un cuadrilátero limpio y, si no hay,
// las esquinas más alejadas del centro en cada cuadrante.
//
// Mensajes: { id, type: "detect", image: ImageData } → { id, corners: Pt[] | null }
//           { id, type: "warp", image: ImageData, corners: Pt[], filter } → { id, image: ImageData }

/* eslint-disable @typescript-eslint/no-explicit-any */

declare function importScripts(...urls: string[]): void;

type Pt = { x: number; y: number };
type Filter = "color" | "mejorado" | "gris" | "byn";

const ctx = self as unknown as { postMessage: (msg: unknown, transfer?: Transferable[]) => void; onmessage: ((e: MessageEvent) => void) | null; cv?: any };

let cvReady: Promise<any> | null = null;

function loadCv(): Promise<any> {
  cvReady ??= new Promise((resolve, reject) => {
    try {
      importScripts("/vendor/opencv/opencv.js");
    } catch {
      reject(new Error("Falta el motor del escáner. Corré scripts/fetch-vendor.sh."));
      return;
    }
    const mod = ctx.cv;
    if (!mod) return reject(new Error("No se pudo iniciar el escáner."));
    if (typeof mod.then === "function") {
      // Algunas versiones exponen una promesa que resuelve al módulo ya listo.
      mod.then((m: any) => {
        delete m.then;
        resolve(m);
      });
      return;
    }
    if (mod.Mat) return resolve(mod);
    mod.onRuntimeInitialized = () => resolve(mod);
  });
  return cvReady;
}

// Ordena 4 puntos como arriba-izquierda, arriba-derecha, abajo-derecha, abajo-izquierda.
function order(pts: Pt[]): Pt[] {
  const bySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...pts].sort((a, b) => a.y - a.x - (b.y - b.x));
  return [bySum[0], byDiff[0], bySum[3], byDiff[3]];
}

function quadArea(q: Pt[]): number {
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    const b = q[(i + 1) % q.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

function detect(cv: any, image: ImageData): Pt[] | null {
  const src = cv.matFromImageData(image);
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const total = image.width * image.height;
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    cv.Canny(gray, edges, 40, 140);
    // Cierra huecos en los bordes de la hoja (sombras, dedos, renglones que tocan el borde).
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
    kernel.delete();
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const list: { i: number; area: number }[] = [];
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      list.push({ i, area: cv.contourArea(c) });
      c.delete();
    }
    list.sort((a, b) => b.area - a.area);

    // 1) Un cuadrilátero convexo grande.
    for (const { i, area } of list.slice(0, 6)) {
      if (area < total * 0.15) break;
      const c = contours.get(i);
      const approx = new cv.Mat();
      const peri = cv.arcLength(c, true);
      cv.approxPolyDP(c, approx, 0.02 * peri, true);
      const ok = approx.rows === 4 && cv.isContourConvex(approx);
      const pts: Pt[] = [];
      if (ok) for (let k = 0; k < 4; k++) pts.push({ x: approx.data32S[k * 2], y: approx.data32S[k * 2 + 1] });
      approx.delete();
      c.delete();
      if (ok) return order(pts);
    }

    // 2) Como jscanify: en el contorno más grande, el punto más alejado del centro en cada cuadrante.
    const best = list[0];
    if (!best || best.area < total * 0.15) return null;
    const c = contours.get(best.i);
    const rect = cv.minAreaRect(c);
    const center = rect.center as Pt;
    const corners: (Pt | undefined)[] = [undefined, undefined, undefined, undefined];
    const dist = [0, 0, 0, 0];
    for (let k = 0; k < c.data32S.length; k += 2) {
      const p = { x: c.data32S[k], y: c.data32S[k + 1] };
      const q = p.y < center.y ? (p.x < center.x ? 0 : 1) : p.x < center.x ? 3 : 2;
      const d = Math.hypot(p.x - center.x, p.y - center.y);
      if (d > dist[q]) {
        dist[q] = d;
        corners[q] = p;
      }
    }
    c.delete();
    if (corners.some((p) => !p)) return null;
    const quad = corners as Pt[];
    return quadArea(quad) > total * 0.15 ? quad : null;
  } finally {
    src.delete();
    gray.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
  }
}

const MAX_SIDE = 2400;

function warp(cv: any, image: ImageData, corners: Pt[], filter: Filter): ImageData {
  const [tl, tr, br, bl] = corners;
  let w = Math.max(Math.hypot(tr.x - tl.x, tr.y - tl.y), Math.hypot(br.x - bl.x, br.y - bl.y));
  let h = Math.max(Math.hypot(bl.x - tl.x, bl.y - tl.y), Math.hypot(br.x - tr.x, br.y - tr.y));
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  w = Math.max(16, Math.round(w * k));
  h = Math.max(16, Math.round(h * k));

  const src = cv.matFromImageData(image);
  const dst = new cv.Mat();
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
  const M = cv.getPerspectiveTransform(from, to);
  try {
    cv.warpPerspective(src, dst, M, new cv.Size(w, h), cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());
    const out = applyFilter(cv, dst, filter);
    const data = new ImageData(new Uint8ClampedArray(out.data), out.cols, out.rows);
    if (out !== dst) out.delete();
    return data;
  } finally {
    src.delete();
    dst.delete();
    from.delete();
    to.delete();
    M.delete();
  }
}

// Saca la sombra y el tono del papel: divide cada canal por su fondo (un desenfoque grande).
function flatten(cv: any, gray: any): any {
  const bg = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
  cv.dilate(gray, bg, kernel);
  kernel.delete();
  const size = Math.max(21, (Math.round(Math.min(gray.cols, gray.rows) / 40) | 1));
  cv.medianBlur(bg, bg, size % 2 ? size : size + 1);
  const out = new cv.Mat();
  cv.divide(gray, bg, out, 255);
  bg.delete();
  return out;
}

function applyFilter(cv: any, rgba: any, filter: Filter): any {
  if (filter === "color") return rgba;
  const out = new cv.Mat();
  if (filter === "mejorado") {
    const planes = new cv.MatVector();
    cv.split(rgba, planes);
    const merged = new cv.MatVector();
    for (let i = 0; i < 3; i++) {
      const ch = planes.get(i);
      const flat = flatten(cv, ch);
      cv.normalize(flat, flat, 0, 255, cv.NORM_MINMAX);
      merged.push_back(flat);
      ch.delete();
      flat.delete();
    }
    const alpha = planes.get(3);
    merged.push_back(alpha);
    alpha.delete();
    cv.merge(merged, out);
    planes.delete();
    merged.delete();
    return out;
  }
  const gray = new cv.Mat();
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
  if (filter === "gris") {
    const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
    clahe.apply(gray, gray);
    clahe.delete();
    cv.cvtColor(gray, out, cv.COLOR_GRAY2RGBA);
  } else {
    const flat = flatten(cv, gray);
    const bw = new cv.Mat();
    cv.adaptiveThreshold(flat, bw, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 25, 12);
    cv.cvtColor(bw, out, cv.COLOR_GRAY2RGBA);
    flat.delete();
    bw.delete();
  }
  gray.delete();
  return out;
}

ctx.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { id: number; type: "detect" | "warp" | "init"; image?: ImageData; corners?: Pt[]; filter?: Filter };
  try {
    const cv = await loadCv();
    if (msg.type === "init") return ctx.postMessage({ id: msg.id, ok: true });
    if (msg.type === "detect") return ctx.postMessage({ id: msg.id, ok: true, corners: detect(cv, msg.image!) });
    const image = warp(cv, msg.image!, msg.corners!, msg.filter ?? "color");
    ctx.postMessage({ id: msg.id, ok: true, image }, [image.data.buffer]);
  } catch (err) {
    ctx.postMessage({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
