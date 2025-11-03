'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Method,
  forecastAvg6m,
  forecastTrend,
  forecastExp,
  forecastWeighted,
  normalize,
} from '@/lib/forecast';

// --------- helpers ----------
const mxn = (n: number) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

function ymKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function parseYm(ym: string) {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1); // local
}
function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
// ISO local (evita desfases por UTC)
function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-MX', {
    month: 'long',
    year: 'numeric',
  });
}
function monthStartISO(ym: string) { return `${ym}-01`; }

// Extraer YYYY-MM directo del string ISO almacenado (evita timezone bugs)
const ymFromISO = (isoDate: string) => String(isoDate).slice(0, 7);

// convierte 170 => 1.70; deja 1.70 como 1.70
function fixFactor(x: number | null | undefined, fallback = 1.7) {
  const v = Number(x ?? fallback);
  if (!isFinite(v) || v <= 0) return fallback;
  return v > 10 ? v / 100 : v;
}

type HistRow = {
  supplier_id: string;
  supplier_name: string;
  months: Record<string, number>;
  factor: number; // ya normalizado
};
type ThisMonthSale = {
  supplier_id: string;
  supplier_name: string;
  amount: number;
  factor: number; // ya normalizado
};

type PlanInsert = {
  plan_month: string;
  method: string;
  weights: any;
  policy: string;
  budget: number;
  scale: number;
  totals: any;
};
type PlanLineInsert = {
  plan_id: string;
  supplier_id: string;
  supplier_name: string;
  factor: number;
  forecast_next: number;
  proposed: number;
  final: number;
};

type WindowMode = 'auto6' | 'manual';

export default function PlannerPage() {
  // ---------- controles ----------
  const now = new Date();
  const [ym, setYm] = useState(ymKey(now)); // Mes de trabajo (solo para KPIs/UX)
  const monthStart = useMemo(() => parseYm(ym)!, [ym]);
  const monthEnd   = useMemo(() => addMonths(monthStart, 1), [monthStart]);

  // método de forecast y pesos
  const [method, setMethod] = useState<Method>('weighted');
  const [wAvg, setWAvg]     = useState(0.2);
  const [wTrend, setWTrend] = useState(0.3);
  const [wExp, setWExp]     = useState(0.5);
  const [p1, p2, p3]        = normalize([wAvg, wTrend, wExp]);

  // ---------- ventana histórica ----------
  const [winMode, setWinMode] = useState<WindowMode>('manual');
  const autoFromYm = useMemo(() => ymKey(addMonths(monthStart, -6)), [monthStart]);
  // controles manuales
  const [fromYm, setFromYm] = useState(autoFromYm);
  const [toYm,   setToYm]   = useState(ymKey(addMonths(monthStart, -1))); // por defecto: mes anterior al de trabajo

  // Cuando cambie el mes de trabajo y estamos en automática, refrescamos sugeridos
  useEffect(() => {
    if (winMode === 'auto6') {
      setFromYm(ymKey(addMonths(monthStart, -6)));
      setToYm(ymKey(addMonths(monthStart, -1)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStart, winMode]);

  // Derivar rango efectivo para consultas y series
  const { histStartInc, histEndExc, histMonths, histCaption } = useMemo(() => {
    let start: Date;
    let endExc: Date;
    if (winMode === 'manual') {
      const a = parseYm(fromYm) ?? addMonths(monthStart, -6);
      const b = parseYm(toYm)   ?? addMonths(monthStart, -1);
      // corregir si están invertidos
      if (a.getTime() <= b.getTime()) { start = a; endExc = addMonths(b, 1); }
      else { start = b; endExc = addMonths(a, 1); }
    } else {
      start = addMonths(monthStart, -6);
      endExc = monthStart; // exclusivo
    }

    const arr: string[] = [];
    for (let d = new Date(start); d < endExc; d = addMonths(d, 1)) arr.push(ymKey(d));

    const caption = `${ymKey(start)} → ${ymKey(addMonths(endExc, -1))} (${arr.length} meses${winMode==='manual' ? ', rango manual' : ''})`;
    return { histStartInc: start, histEndExc: endExc, histMonths: arr, histCaption: caption };
  }, [winMode, fromYm, toYm, monthStart]);

  // **Mes pronosticado**: SIEMPRE el mes inmediatamente posterior al "Hasta" de la ventana
  const nextYm = useMemo(() => ymKey(histEndExc), [histEndExc]);

  // ---------- parámetros ----------
  const [defaultFactor, setDefaultFactor] = useState(1.7);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('app_params')
        .select('key,value_num')
        .in('key', ['factor_utilidad_default'])
        .limit(1);
      const v = (data?.[0]?.value_num ?? 1.7) as number;
      setDefaultFactor(fixFactor(v, 1.7));
    })();
  }, []);

  // ---------- KPIs informativos (mes de trabajo) ----------
  const [thisMonthSales, setThisMonthSales] = useState<ThisMonthSale[]>([]);
  const [apVencenTotal, setApVencenTotal] = useState(0);
  const [apVencenPagadas, setApVencenPagadas] = useState(0);

  useEffect(() => {
    (async () => {
      // Ventas del mes de trabajo
      const { data: s } = await supabase
        .from('sales')
        .select('amount,supplier_id,suppliers(name,factor)')
        .gte('date', toISODate(monthStart))
        .lt('date', toISODate(monthEnd));

      const map = new Map<string, ThisMonthSale>();
      (s || []).forEach((r: any) => {
        const id   = String(r.supplier_id);
        const name = r.suppliers?.name || '—';
        const f    = fixFactor(r.suppliers?.factor, defaultFactor);
        const amt  = Number(r.amount || 0);
        const prev = map.get(id);
        if (!prev) map.set(id, { supplier_id: id, supplier_name: name, amount: amt, factor: f });
        else prev.amount += amt;
      });
      setThisMonthSales(Array.from(map.values()));

      // Facturas que vencen en el mes (TOTAL por pay_date, pagadas + pendientes)
      const { data: pAll } = await supabase
        .from('purchases')
        .select('amount,pay_date')
        .gte('pay_date', toISODate(monthStart))
        .lt('pay_date', toISODate(monthEnd));
      setApVencenTotal((pAll || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0));

      // De esas, ya pagadas
      const { data: pPaid } = await supabase
        .from('purchases')
        .select('amount,pay_date,paid_at')
        .not('paid_at', 'is', null)
        .gte('pay_date', toISODate(monthStart))
        .lt('pay_date', toISODate(monthEnd));
      setApVencenPagadas((pPaid || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0));
    })();
  }, [monthStart, monthEnd, defaultFactor]);

  const carteraPago = useMemo(
    () => thisMonthSales.reduce(
      (s, r) => s + Number(r.amount || 0) / fixFactor(r.factor, defaultFactor),
      0
    ),
    [thisMonthSales, defaultFactor]
  );

  // Mapa para resurtido (ventas del mes de trabajo)
  const salesNowMap = useMemo(() => {
    const m = new Map<string, { name: string; amount: number; factor: number }>();
    thisMonthSales.forEach(s => {
      m.set(s.supplier_id, { name: s.supplier_name, amount: Number(s.amount || 0), factor: s.factor });
    });
    return m;
  }, [thisMonthSales]);

  // ---------- históricos para forecast (según ventana efectiva) ----------
  const [histRows, setHistRows] = useState<HistRow[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('sales')
        .select('date,amount,supplier_id,suppliers(name,factor)')
        .gte('date', toISODate(histStartInc))
        .lt('date', toISODate(histEndExc));

      if (error) {
        console.error(error);
        setHistRows([]);
        setLoading(false);
        return;
      }

      const map = new Map<string, HistRow>();
      (data || []).forEach((r: any) => {
        const id   = String(r.supplier_id);
        const name = r.suppliers?.name || '—';
        const f    = fixFactor(r.suppliers?.factor, defaultFactor);
        const ym   = ymFromISO(r.date as string); // evita desfases por zona
        const amt  = Number(r.amount || 0);
        if (!map.has(id)) map.set(id, { supplier_id: id, supplier_name: name, factor: f, months: {} });
        const row = map.get(id)!;
        row.months[ym] = (row.months[ym] || 0) + amt;
      });

      setHistRows(Array.from(map.values()));
      setLoading(false);
    })();
  }, [histStartInc, histEndExc, defaultFactor]);

  // ---------- forecast & pedidos ----------
  function runForecast(series: number[], m: Method) {
    switch (m) {
      case 'avg6':     return forecastAvg6m(series, 1)[0] || 0;
      case 'trend':    return forecastTrend(series, 1)[0] || 0;
      case 'exp':      return forecastExp(series, 1)[0] || 0;
      case 'weighted': return forecastWeighted(series, 1, p1, p2, p3)[0] || 0;
      default:         return 0;
    }
  }

  const rows = useMemo(() => {
    // Base por proveedores con histórico
    const base = histRows.map((r) => {
      const series  = histMonths.map((m) => r.months[m] || 0); // EXACTAMENTE los mismos meses seleccionados
      const Fnext   = runForecast(series, method);             // ventas pronosticadas del mes siguiente a la ventana
      const f       = fixFactor(r.factor, defaultFactor);

      const proposed = Fnext / f;                              // costos pronosticados (ventas ÷ factor)
      const nowAmt   = salesNowMap.get(r.supplier_id)?.amount || 0;
      const restock  = nowAmt / f;                             // resurtido por ventas del mes de trabajo
      const mix      = (proposed + restock) / 2;               // pedido promedio

      return {
        supplier_id: r.supplier_id,
        supplier_name: r.supplier_name,
        factor: f,
        forecast_next: Math.max(0, Fnext),
        proposed:      Math.max(0, proposed),
        restock:       Math.max(0, restock),
        mix:           Math.max(0, mix),
      };
    });

    // Proveedores con ventas este mes pero sin histórico en la ventana
    const inBase = new Set(base.map(b => b.supplier_id));
    thisMonthSales.forEach(s => {
      if (!inBase.has(s.supplier_id)) {
        const f = fixFactor(s.factor, defaultFactor);
        const restock = Math.max(0, Number(s.amount || 0) / f);
        base.push({
          supplier_id: s.supplier_id,
          supplier_name: s.supplier_name,
          factor: f,
          forecast_next: 0,
          proposed: 0,
          restock,
          mix: restock / 2,
        });
      }
    });

    const totals = {
      total_forecast: base.reduce((s, x) => s + x.forecast_next, 0),
      total_proposed: base.reduce((s, x) => s + x.proposed, 0),
      total_restock:  base.reduce((s, x) => s + x.restock, 0),
      total_mix:      base.reduce((s, x) => s + x.mix, 0),
      total_final:    base.reduce((s, x) => s + x.proposed, 0), // compat
    };

    const final = base.map(x => ({
      supplier_id: x.supplier_id,
      supplier_name: x.supplier_name,
      factor: x.factor,
      forecast_next: x.forecast_next,
      costos_pronosticados: x.proposed,
      pedido_restock: x.restock,
      pedido_mix: x.mix,
      // compat:
      pedido_propuesto: x.proposed,
      pedido_final: x.proposed,
    }));

    return { final, totals };
  }, [histRows, histMonths, method, p1, p2, p3, defaultFactor, thisMonthSales, salesNowMap]);

  // ---------- Guardar / Exportar ----------
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  async function savePlan() {
    try {
      setSaving(true);
      setMsg('');
      if (!rows.final.length) { setMsg('No hay renglones para guardar.'); return; }

      const plan: PlanInsert = {
        plan_month: monthStartISO(nextYm), // **usa el mes pronosticado (fin de ventana + 1)**
        method,
        weights: method === 'weighted' ? { p1, p2, p3 } : null,
        policy: 'restock',
        budget: 0,
        scale: 1,
        totals: {
          forecast: +rows.totals.total_forecast.toFixed(2),
          proposed: +rows.totals.total_proposed.toFixed(2),
          restock:  +rows.totals.total_restock.toFixed(2),
          final:    +rows.totals.total_final.toFixed(2),
        },
      };

      const { data: planRow, error: e1 } = await supabase
        .from('purchase_plans')
        .insert(plan)
        .select('id')
        .single();
      if (e1) throw e1;

      const plan_id = planRow!.id as string;

      const lines: PlanLineInsert[] = rows.final.map((r: any) => ({
        plan_id,
        supplier_id: r.supplier_id,
        supplier_name: r.supplier_name,
        factor: +r.factor.toFixed(4),
        forecast_next: +r.forecast_next.toFixed(2),
        proposed: +r.costos_pronosticados.toFixed(2),
        // FIX: selecciona final y aplica toFixed una sola vez
        final: +((r.pedido_final ?? r.costos_pronosticados) as number).toFixed(2),
      }));

      const { error: e2 } = await supabase.from('purchase_plan_lines').insert(lines);
      if (e2) throw e2;

      setMsg('✅ Plan guardado.');
    } catch (err: any) {
      console.error(err);
      setMsg('❌ No se pudo guardar: ' + (err?.message ?? err));
    } finally {
      setSaving(false);
    }
  }

  function exportCSV() {
    const header = [
      'Proveedor',
      'Factor',
      `Ventas pronosticadas (${monthLabel(nextYm)})`,
      'Costos pronosticados (ventas ÷ factor)',
      'Resurtido (ventas mes ÷ factor)',
      'Pedido promedio (mix)',
    ];
    const lines = rows.final.map((r: any) => [
      r.supplier_name,
      r.factor.toFixed(2),
      r.forecast_next.toFixed(2),
      r.costos_pronosticados.toFixed(2),
      r.pedido_restock.toFixed(2),
      r.pedido_mix.toFixed(2),
    ]);
    const all = [header, ...lines].map((a) => a.join(',')).join('\n');
    const blob = new Blob([all], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `plan-${nextYm}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- UI ----------
  const prevMonth = () => setYm(ymKey(addMonths(parseYm(ym)!, -1)));
  const nextMonthBtn = () => setYm(ymKey(addMonths(parseYm(ym)!, 1)));

  // valores que se muestran en inputs (cuando es automática, mostramos el rango auto)
  const effectiveFromYm = winMode === 'manual' ? fromYm : ymKey(addMonths(monthStart, -6));
  const effectiveToYm   = winMode === 'manual' ? toYm   : ymKey(addMonths(monthStart, -1));

  return (
    <div className="max-w-6xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4">Planeador (Compras sugeridas)</h2>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="flex items-center gap-2">
          <button className="px-2 py-1 border rounded" onClick={prevMonth}>◀︎</button>
          <div className="min-w-[220px] text-center">
            <div className="text-xs text-gray-500">Mes de trabajo</div>
            <div className="font-semibold capitalize">{monthLabel(ym)}</div>
          </div>
          <button className="px-2 py-1 border rounded" onClick={nextMonthBtn}>▶︎</button>
        </div>

        <div>
          <label className="block text-sm mb-1">Método</label>
          <select className="border rounded px-2 py-2" value={method} onChange={(e)=>setMethod(e.target.value as Method)}>
            <option value="weighted">Ponderado (mix)</option>
            <option value="avg6">Promedio 6m</option>
            <option value="trend">Tendencia lineal</option>
            <option value="exp">Suavizado exponencial</option>
          </select>
        </div>

        {/* Ventana histórica */}
        <div>
          <label className="block text-sm mb-1">Ventana</label>
          <select
            className="border rounded px-2 py-2"
            value={winMode}
            onChange={(e)=>setWinMode(e.target.value as WindowMode)}
          >
            <option value="auto6">Automática (6 meses)</option>
            <option value="manual">Rango manual</option>
          </select>
        </div>

        <div>
          <label className="block text-sm mb-1">Desde</label>
          <input
            type="month"
            className="border rounded px-2 py-2"
            value={effectiveFromYm}
            onChange={(e)=>setFromYm(e.target.value)}
            disabled={winMode !== 'manual'}
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Hasta</label>
          <input
            type="month"
            className="border rounded px-2 py-2"
            value={effectiveToYm}
            onChange={(e)=>setToYm(e.target.value)}
            disabled={winMode !== 'manual'}
          />
        </div>

        {method === 'weighted' && (
          <div className="flex items-end gap-3 text-sm">
            <div>
              <label className="block mb-1">Peso Promedio 6m (%)</label>
              <input
                type="number" min={0}
                className="w-24 border rounded px-2 py-1"
                value={Math.round(p1*100)}
                onChange={(e)=>setWAvg((+e.target.value||0)/100)}
              />
            </div>
            <div>
              <label className="block mb-1">Peso Tendencia (%)</label>
              <input
                type="number" min={0}
                className="w-24 border rounded px-2 py-1"
                value={Math.round(p2*100)}
                onChange={(e)=>setWTrend((+e.target.value||0)/100)}
              />
            </div>
            <div>
              <label className="block mb-1">Peso Exponencial (%)</label>
              <input
                type="number" min={0}
                className="w-24 border rounded px-2 py-1"
                value={Math.round(p3*100)}
                onChange={(e)=>setWExp((+e.target.value||0)/100)}
              />
            </div>
            <div className="text-gray-500">(se normalizan a {(p1+p2+p3).toFixed(2)})</div>
          </div>
        )}
      </div>

      {/* KPIs informativos (mes de trabajo) */}
      <div className="grid md:grid-cols-3 gap-3 mb-3">
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Cartera de pago (ventas del mes ÷ factor)</div>
          <div className="text-lg font-semibold">{mxn(carteraPago)}</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Facturas que vencen en {monthLabel(ym)} (total del mes)</div>
          <div className="text-lg font-semibold">{mxn(apVencenTotal)}</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Facturas ya pagadas (vencían en {monthLabel(ym)})</div>
          <div className="text-lg font-semibold">{mxn(apVencenPagadas)}</div>
        </div>
      </div>

      {/* Acciones */}
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={savePlan}
          disabled={saving || rows.final.length === 0}
          className={`px-4 py-2 rounded text-white ${rows.final.length ? 'bg-black hover:bg-gray-800' : 'bg-gray-400 cursor-not-allowed'}`}
        >
          {saving ? 'Guardando…' : 'Guardar plan'}
        </button>
        <button onClick={exportCSV} className="px-4 py-2 border rounded">Exportar CSV</button>
        {msg && <span className="text-sm">{msg}</span>}
      </div>

      {/* Resumen */}
      <div className="mb-3 text-sm text-gray-600">
        Ventana histórica usada: {histCaption}.<br/>
        Próximo mes considerado: <b>{monthLabel(nextYm)}</b>. Método: <b>{method === 'weighted'
          ? `Ponderado (${Math.round(p1*100)}/${Math.round(p2*100)}/${Math.round(p3*100)})`
          : method}</b>.
      </div>

      {/* Tabla */}
      <div className="border rounded overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2">Proveedor</th>
              <th className="text-right p-2">Factor</th>
              <th className="text-right p-2">Ventas pronosticadas ({monthLabel(nextYm)})</th>
              <th className="text-right p-2">Costos pronosticados (ventas ÷ factor)</th>
              <th className="text-right p-2">Resurtido (ventas mes ÷ factor)</th>
              <th className="text-right p-2">Pedido promedio (mix)</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-3 text-gray-500">Cargando…</td></tr>
            ) : rows.final.length === 0 ? (
              <tr><td colSpan={6} className="p-3 text-gray-500">Sin datos suficientes.</td></tr>
            ) : (
              <>
                {rows.final.map((r: any) => (
                  <tr key={r.supplier_id} className="border-t">
                    <td className="p-2">{r.supplier_name}</td>
                    <td className="p-2 text-right">{r.factor.toFixed(2)}</td>
                    <td className="p-2 text-right">{mxn(r.forecast_next)}</td>
                    <td className="p-2 text-right">{mxn(r.costos_pronosticados)}</td>
                    <td className="p-2 text-right">{mxn(r.pedido_restock)}</td>
                    <td className="p-2 text-right font-semibold">{mxn(r.pedido_mix)}</td>
                  </tr>
                ))}
                <tr className="border-t bg-gray-50 font-semibold">
                  <td className="p-2">Totales</td>
                  <td className="p-2 text-right">—</td>
                  <td className="p-2 text-right">{mxn(rows.totals.total_forecast)}</td>
                  <td className="p-2 text-right">{mxn(rows.totals.total_proposed)}</td>
                  <td className="p-2 text-right">{mxn(rows.totals.total_restock)}</td>
                  <td className="p-2 text-right">{mxn(rows.totals.total_mix)}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500 mt-2">
        “Costos pronosticados” = ventas pronosticadas ÷ factor. “Pedido promedio (mix)” = promedio simple entre resurtido y costos pronosticados.
      </p>
    </div>
  );
}
