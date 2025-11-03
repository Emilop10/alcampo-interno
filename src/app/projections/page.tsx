'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type SupplierRow = {
  supplier_id: string;
  supplier_name: string;
  months: Record<string, number>; // totales por mes YYYY-MM
};

type Method = 'avg6' | 'trend' | 'exp' | 'weighted';

// ---------- utilidades ----------
const mxn = (n: number) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

function ymKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function parseYm(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, (m || 1) - 1, 1);
}
function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
}
function firstDayOfMonth(y: number, m: number) { return new Date(y, m, 1); }
function addMonths(d: Date, n: number) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

// Formatea YYYY-MM-DD sin usar toISOString (evita desfases por zona horaria)
function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// extraer el mes sin crear Date (evita desfases por timezone)
const ymFromISO = (isoDate: string) => String(isoDate).slice(0, 7);

// ventana histórica por defecto: últimos 6 meses completos (excluye el mes en curso)
function getSixMonthWindow() {
  const now = new Date();
  const endExc = firstDayOfMonth(now.getFullYear(), now.getMonth()); // exclusivo
  const startInc = addMonths(endExc, -6);
  return { startInc, endExc };
}

function normalize(ws: number[]) {
  const safe = ws.map(w => Math.max(0, Number(w) || 0));
  const s = safe.reduce((a, b) => a + b, 0) || 1;
  return safe.map(w => w / s);
}

// ---------- métodos ----------
function forecastAvg6m(series: number[], horizon: number) {
  const last6 = series.slice(-6);
  const mean = last6.length ? last6.reduce((a, b) => a + b, 0) / last6.length : 0;
  return Array(horizon).fill(mean);
}
function forecastTrend(series: number[], horizon: number) {
  const n = series.length;
  if (n < 2) return forecastAvg6m(series, horizon);
  let sumT = 0, sumY = 0, sumTT = 0, sumTY = 0;
  for (let i = 0; i < n; i++) {
    const t = i + 1, y = series[i];
    sumT += t; sumY += y; sumTT += t * t; sumTY += t * y;
  }
  const denom = n * sumTT - sumT * sumT || 1;
  const b = (n * sumTY - sumT * sumY) / denom;
  const a = (sumY - b * sumT) / n;
  const out: number[] = [];
  for (let k = 1; k <= horizon; k++) out.push(a + b * (n + k));
  return out;
}
function forecastExp(series: number[], horizon: number, alpha = 0.5) {
  if (!series.length) return Array(horizon).fill(0);
  let s = series[0];
  for (let i = 1; i < series.length; i++) s = alpha * series[i] + (1 - alpha) * s;
  return Array(horizon).fill(s);
}

export default function ProjectionsPage() {
  // método por defecto: ponderado
  const [method, setMethod] = useState<Method>('weighted');
  const [horizon, setHorizon] = useState<number>(3);

  // pesos del mix (editables)
  const [wAvg, setWAvg] = useState(0.2);
  const [wTrend, setWTrend] = useState(0.3);
  const [wExp, setWExp] = useState(0.5);
  const [p1, p2, p3] = normalize([wAvg, wTrend, wExp]);

  // ----- selección de ventana: automática o manual -----
  const [windowMode, setWindowMode] = useState<'auto' | 'manual'>('auto');

  // estado para rango manual (YYYY-MM)
  const def = getSixMonthWindow();
  const [startYm, setStartYm] = useState<string>(ymKey(def.startInc));
  const [endYm, setEndYm]     = useState<string>(ymKey(addMonths(def.endExc, -1))); // inclusive

  // calcula ventana efectiva (inclusive/exclusive) según el modo
  const { startInc, endExc, histMonths } = useMemo(() => {
    let sYm: string, eYm: string;

    if (windowMode === 'auto') {
      const { startInc, endExc } = getSixMonthWindow();
      sYm = ymKey(startInc);
      eYm = ymKey(addMonths(endExc, -1));
    } else {
      sYm = startYm;
      eYm = endYm;
      // corrige si vienen invertidas
      if (eYm < sYm) { const tmp = sYm; sYm = eYm; eYm = tmp; }
    }

    const sDate = parseYm(sYm);
    const eDateExc = addMonths(parseYm(eYm), 1); // exclusivo
    const months: string[] = [];
    for (let d = new Date(sDate); d < eDateExc; d = addMonths(d, 1)) {
      months.push(ymKey(d));
    }
    return { startInc: sDate, endExc: eDateExc, histMonths: months };
  }, [windowMode, startYm, endYm]);

  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('sales')
        .select('date,amount,supplier_id,suppliers(name)')
        .gte('date', toISODate(startInc))
        .lt('date',  toISODate(endExc));

      if (error) {
        console.error(error);
        setRows([]);
        setLoading(false);
        return;
      }

      // Agrega por proveedor/mes usando YYYY-MM directo del string
      const map = new Map<string, SupplierRow>();
      for (const r of data || []) {
        const ym = ymFromISO((r as any).date as string);
        const id = (r as any).supplier_id as string;
        const name = (r as any).suppliers?.name || '—';
        if (!map.has(id)) map.set(id, { supplier_id: id, supplier_name: name, months: {} });
        const row = map.get(id)!;
        row.months[ym] = (row.months[ym] || 0) + Number((r as any).amount || 0);
      }

      setRows(Array.from(map.values()));
      setLoading(false);
    })();
  }, [startInc, endExc]);

  function forecastForSupplier(series: number[], hz: number, m: Method): number[] {
    switch (m) {
      case 'avg6':  return forecastAvg6m(series, hz);
      case 'trend': return forecastTrend(series, hz);
      case 'exp':   return forecastExp(series, hz);
      case 'weighted': {
        const a = forecastAvg6m(series, hz);
        const b = forecastTrend(series, hz);
        const c = forecastExp(series, hz);
        return a.map((_, i) => p1 * a[i] + p2 * b[i] + p3 * c[i]);
      }
    }
  }

  const table = useMemo(() => {
    return rows.map(r => {
      const histSeries = histMonths.map(ym => r.months[ym] || 0); // en orden
      const totalWindow = histSeries.reduce((a, b) => a + b, 0);
      const forecast = forecastForSupplier(histSeries, horizon, method);
      const nextMonth = forecast[0] || 0;
      const totalH = forecast.reduce((a, b) => a + b, 0);
      return { supplier_name: r.supplier_name, hist: histSeries, totalWindow, nextMonth, totalH };
    });
  }, [rows, histMonths, horizon, method, p1, p2, p3]);

  const totals = useMemo(() => {
    const prox = table.reduce((s, x) => s + x.nextMonth, 0);
    const totH = table.reduce((s, x) => s + x.totalH, 0);
    return { prox, totH };
  }, [table]);

  return (
    <div className="max-w-6xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4">Proyecciones</h2>

      {/* Controles */}
      <div className="flex flex-wrap items-end gap-6 mb-4">
        <div>
          <label className="block text-sm mb-1">Método</label>
          <select
            className="border rounded px-2 py-2"
            value={method}
            onChange={(e) => setMethod(e.target.value as Method)}
          >
            <option value="weighted">Ponderado (mix)</option>
            <option value="avg6">Promedio 6m</option>
            <option value="trend">Tendencia lineal</option>
            <option value="exp">Suavizado exponencial</option>
          </select>
        </div>

        <div>
          <label className="block text-sm mb-1">Horizonte (meses)</label>
          <select
            className="border rounded px-2 py-2"
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
          >
            {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        {/* Selector de ventana */}
        <div>
          <label className="block text-sm mb-1">Ventana</label>
          <select
            className="border rounded px-2 py-2"
            value={windowMode}
            onChange={(e) => setWindowMode(e.target.value as 'auto' | 'manual')}
          >
            <option value="auto">Automática (últimos 6 meses)</option>
            <option value="manual">Rango manual</option>
          </select>
        </div>

        {windowMode === 'manual' && (
          <div className="flex flex-wrap items-end gap-4 text-sm">
            <div>
              <label className="block mb-1">Desde</label>
              <input
                type="month"
                className="border rounded px-2 py-1"
                value={startYm}
                onChange={(e) => setStartYm(e.target.value)}
              />
            </div>
            <div>
              <label className="block mb-1">Hasta</label>
              <input
                type="month"
                className="border rounded px-2 py-1"
                value={endYm}
                onChange={(e) => setEndYm(e.target.value)}
              />
            </div>
          </div>
        )}

        {method === 'weighted' && (
          <div className="flex flex-wrap items-end gap-4 text-sm">
            <div>
              <label className="block mb-1">Peso Promedio 6m (%)</label>
              <input
                type="number" min={0}
                className="w-24 border rounded px-2 py-1"
                value={Math.round(wAvg * 100)}
                onChange={(e) => setWAvg((+e.target.value || 0) / 100)}
              />
            </div>
            <div>
              <label className="block mb-1">Peso Tendencia (%)</label>
              <input
                type="number" min={0}
                className="w-24 border rounded px-2 py-1"
                value={Math.round(wTrend * 100)}
                onChange={(e) => setWTrend((+e.target.value || 0) / 100)}
              />
            </div>
            <div>
              <label className="block mb-1">Peso Exponencial (%)</label>
              <input
                type="number" min={0}
                className="w-24 border rounded px-2 py-1"
                value={Math.round(wExp * 100)}
                onChange={(e) => setWExp((+e.target.value || 0) / 100)}
              />
            </div>
            <div className="text-gray-500">
              (se normalizan automáticamente: {(p1 + p2 + p3).toFixed(2)})
            </div>
          </div>
        )}
      </div>

      {/* Info ventana */}
      <div className="text-sm text-gray-600 mb-3">
        Ventana histórica:&nbsp;
        <b>{histMonths[0]} → {histMonths[histMonths.length - 1]}</b>
        &nbsp;· Próximo mes (total): <b>{mxn(totals.prox)}</b>
        &nbsp;· Horizonte {horizon}m (total): <b>{mxn(totals.totH)}</b>
        {windowMode === 'auto' ? (
          <span className="ml-1">(últimos 6 meses completos)</span>
        ) : (
          <span className="ml-1">(rango manual)</span>
        )}
      </div>

      {/* Tabla */}
      <div className="border rounded overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2">Proveedor</th>
              {histMonths.map(m => <th key={m} className="text-right p-2">{m}</th>)}
              <th className="text-right p-2">Total ventana</th>
              <th className="text-right p-2">Próx. mes</th>
              <th className="text-right p-2">Total {horizon}m</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5 + histMonths.length} className="p-3 text-gray-500">Cargando…</td></tr>
            ) : table.length === 0 ? (
              <tr><td colSpan={5 + histMonths.length} className="p-3 text-gray-500">Sin datos en la ventana histórica.</td></tr>
            ) : (
              table.map(r => (
                <tr key={r.supplier_name} className="border-t">
                  <td className="p-2">{r.supplier_name}</td>
                  {r.hist.map((v, i) => <td key={i} className="p-2 text-right">{mxn(v)}</td>)}
                  <td className="p-2 text-right">{mxn(r.totalWindow)}</td>
                  <td className="p-2 text-right">{mxn(r.nextMonth)}</td>
                  <td className="p-2 text-right">{mxn(r.totalH)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500 mt-2">
        Método:{' '}
        {method === 'weighted'
          ? `Ponderado (Promedio 6m / Tendencia / Exponencial) con pesos normalizados ${p1.toFixed(2)}/${p2.toFixed(2)}/${p3.toFixed(2)}.`
          : method === 'avg6'
          ? 'Promedio simple.'
          : method === 'trend'
          ? 'Regresión lineal sobre los meses históricos.'
          : 'Suavizado exponencial (α=0.5).'}{' '}
        La ventana histórica puede ser automática (últimos 6 meses) o rango manual (Desde/Hasta).
      </p>
    </div>
  );
}
