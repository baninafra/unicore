"use client";

// Conversor de unidades (motor: mathjs). Se elige la magnitud, el valor y las dos unidades.

import { useMemo, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { unit } from "mathjs";
import { Select } from "@/components/ui/select";
import { t } from "@/lib/i18n";

type U = [id: string, label: string];

const GROUPS: { name: string; units: U[] }[] = [
  { name: t("Longitud"), units: [["mm", t("milímetros")], ["cm", t("centímetros")], ["m", t("metros")], ["km", t("kilómetros")], ["inch", t("pulgadas")], ["ft", t("pies")], ["yd", t("yardas")], ["mi", t("millas")], ["nmi", t("millas náuticas")]] },
  { name: t("Masa"), units: [["mg", t("miligramos")], ["g", t("gramos")], ["kg", t("kilogramos")], ["tonne", t("toneladas")], ["oz", t("onzas")], ["lb", t("libras")]] },
  { name: t("Temperatura"), units: [["degC", "°C"], ["degF", "°F"], ["K", t("kelvin")]] },
  { name: t("Tiempo"), units: [["ms", t("milisegundos")], ["s", t("segundos")], ["min", t("minutos")], ["h", t("horas")], ["day", t("días")], ["week", t("semanas")], ["year", t("años")]] },
  { name: t("Superficie"), units: [["mm2", "mm²"], ["cm2", "cm²"], ["m2", "m²"], ["hectare", t("hectáreas")], ["km2", "km²"], ["sqft", t("pies²")], ["acre", t("acres")]] },
  { name: t("Volumen"), units: [["ml", t("mililitros")], ["l", t("litros")], ["m3", "m³"], ["cm3", "cm³"], ["gallon", t("galones (EE. UU.)")], ["cup", t("tazas")], ["floz", t("onzas líquidas")]] },
  { name: t("Velocidad"), units: [["m/s", "m/s"], ["km/h", "km/h"], ["mi/h", "mi/h"], ["knot", t("nudos")]] },
  { name: t("Energía"), units: [["J", t("joules")], ["kJ", t("kilojoules")], ["cal", t("calorías")], ["kcal", t("kilocalorías")], ["Wh", "Wh"], ["kWh", "kWh"], ["eV", t("electronvoltios")]] },
  { name: t("Potencia"), units: [["W", t("watts")], ["kW", t("kilowatts")], ["hp", t("caballos de fuerza")]] },
  { name: t("Presión"), units: [["Pa", t("pascales")], ["kPa", t("kilopascales")], ["bar", "bar"], ["atm", t("atmósferas")], ["mmHg", "mmHg"], ["psi", "psi"]] },
  { name: t("Ángulo"), units: [["deg", t("grados")], ["rad", t("radianes")], ["grad", t("gradianes")]] },
  { name: t("Datos"), units: [["b", t("bits")], ["B", t("bytes")], ["kB", t("kilobytes")], ["MB", t("megabytes")], ["GB", t("gigabytes")], ["TB", t("terabytes")], ["KiB", t("kibibytes")], ["MiB", t("mebibytes")], ["GiB", t("gibibytes")]] },
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
    <div className="tool-pane">
      <div className="flex flex-wrap justify-center gap-1">
        {GROUPS.map((x, i) => (
          <button key={x.name} type="button" className={i === g ? "badge badge-primary" : "badge cursor-pointer hover:text-text"} onClick={() => pickGroup(i)}>
            {x.name}
          </button>
        ))}
      </div>
      <label className="field">
        <span>{t("Valor")}</span>
        <input className="input num" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <div className="flex items-end gap-1.5">
        <label className="field min-w-0 flex-1">
          <span>{t("De")}</span>
          <Select value={from} onChange={(e) => setFrom(e.target.value)}>
            {opts}
          </Select>
        </label>
        <button
          type="button"
          className="btn btn-ghost btn-icon mb-0.5"
          aria-label={t("Invertir unidades")}
          title={t("Invertir unidades")}
          onClick={() => {
            setFrom(to);
            setTo(from);
          }}
        >
          <ArrowLeftRight className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <label className="field min-w-0 flex-1">
          <span>{t("A")}</span>
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
