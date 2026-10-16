"use client";

// Conversor de unidades (motor: mathjs). Se elige la magnitud, el valor y las dos unidades.

import { useMemo, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { unit } from "mathjs";
import { Select } from "@/components/ui/select";

type U = [id: string, label: string];

const GROUPS: { name: string; units: U[] }[] = [
  { name: "Longitud", units: [["mm", "milímetros"], ["cm", "centímetros"], ["m", "metros"], ["km", "kilómetros"], ["inch", "pulgadas"], ["ft", "pies"], ["yd", "yardas"], ["mi", "millas"], ["nmi", "millas náuticas"]] },
  { name: "Masa", units: [["mg", "miligramos"], ["g", "gramos"], ["kg", "kilogramos"], ["tonne", "toneladas"], ["oz", "onzas"], ["lb", "libras"]] },
  { name: "Temperatura", units: [["degC", "°C"], ["degF", "°F"], ["K", "kelvin"]] },
  { name: "Tiempo", units: [["ms", "milisegundos"], ["s", "segundos"], ["min", "minutos"], ["h", "horas"], ["day", "días"], ["week", "semanas"], ["year", "años"]] },
  { name: "Superficie", units: [["mm2", "mm²"], ["cm2", "cm²"], ["m2", "m²"], ["hectare", "hectáreas"], ["km2", "km²"], ["sqft", "pies²"], ["acre", "acres"]] },
  { name: "Volumen", units: [["ml", "mililitros"], ["l", "litros"], ["m3", "m³"], ["cm3", "cm³"], ["gallon", "galones (EE. UU.)"], ["cup", "tazas"], ["floz", "onzas líquidas"]] },
  { name: "Velocidad", units: [["m/s", "m/s"], ["km/h", "km/h"], ["mi/h", "mi/h"], ["knot", "nudos"]] },
  { name: "Energía", units: [["J", "joules"], ["kJ", "kilojoules"], ["cal", "calorías"], ["kcal", "kilocalorías"], ["Wh", "Wh"], ["kWh", "kWh"], ["eV", "electronvoltios"]] },
  { name: "Potencia", units: [["W", "watts"], ["kW", "kilowatts"], ["hp", "caballos de fuerza"]] },
  { name: "Presión", units: [["Pa", "pascales"], ["kPa", "kilopascales"], ["bar", "bar"], ["atm", "atmósferas"], ["mmHg", "mmHg"], ["psi", "psi"]] },
  { name: "Ángulo", units: [["deg", "grados"], ["rad", "radianes"], ["grad", "gradianes"]] },
  { name: "Datos", units: [["b", "bits"], ["B", "bytes"], ["kB", "kilobytes"], ["MB", "megabytes"], ["GB", "gigabytes"], ["TB", "terabytes"], ["KiB", "kibibytes"], ["MiB", "mebibytes"], ["GiB", "gibibytes"]] },
];

const parse = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));
const show = (n: number) => (Number.isFinite(n) ? String(Number(n.toPrecision(10))).replace(".", ",") : "—");

export function UnitsTool() {
  const [g, setG] = useState(0);
  const [value, setValue] = useState("1");
  const [from, setFrom] = useState(GROUPS[0].units[2][0]);
  const [to, setTo] = useState(GROUPS[0].units[3][0]);
  const group = GROUPS[g];

  const result = useMemo(() => {
    const n = parse(value);
    if (!Number.isFinite(n)) return NaN;
    try {
      return unit(n, from).toNumber(to);
    } catch {
      return NaN;
    }
  }, [value, from, to]);

  const pickGroup = (i: number) => {
    setG(i);
    setFrom(GROUPS[i].units[0][0]);
    setTo(GROUPS[i].units[1][0]);
  };

  const opts = group.units.map(([id, label]) => (
    <option key={id} value={id}>
      {label}
    </option>
  ));

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap gap-1">
        {GROUPS.map((x, i) => (
          <button key={x.name} type="button" className={i === g ? "badge badge-primary" : "badge cursor-pointer hover:text-text"} onClick={() => pickGroup(i)}>
            {x.name}
          </button>
        ))}
      </div>
      <label className="field">
        <span>Valor</span>
        <input className="input num" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <div className="flex items-end gap-1.5">
        <label className="field min-w-0 flex-1">
          <span>De</span>
          <Select value={from} onChange={(e) => setFrom(e.target.value)}>
            {opts}
          </Select>
        </label>
        <button
          type="button"
          className="btn btn-ghost btn-icon mb-0.5"
          aria-label="Invertir unidades"
          title="Invertir unidades"
          onClick={() => {
            setFrom(to);
            setTo(from);
          }}
        >
          <ArrowLeftRight className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <label className="field min-w-0 flex-1">
          <span>A</span>
          <Select value={to} onChange={(e) => setTo(e.target.value)}>
            {opts}
          </Select>
        </label>
      </div>
      <div className="rounded-md border border-border bg-surface p-3 text-center">
        <div className="t-h2 num">{show(result)}</div>
        <div className="t-small text-muted">{group.units.find((u) => u[0] === to)?.[1]}</div>
      </div>
      <div className="flex flex-col gap-0.5">
        {group.units
          .filter((u) => u[0] !== from)
          .map(([id, label]) => {
            let v = NaN;
            try {
              v = unit(parse(value), from).toNumber(id);
            } catch {}
            return (
              <div key={id} className="flex justify-between t-small">
                <span className="text-muted">{label}</span>
                <span className="num">{show(v)}</span>
              </div>
            );
          })}
      </div>
    </div>
  );
}
