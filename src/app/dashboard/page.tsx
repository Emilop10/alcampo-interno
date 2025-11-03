'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, CartesianGrid,
} from 'recharts';

/* ------------------------------- helpers ------------------------------- */
const mxn = (n: number) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

function addMonths(d: Date, n: number) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
function ymKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function parseYm(ym: string) {
  const m = ym.match(/^(\d{4})-(\d{2})$/); if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1);
}
function toISODate(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
}
// 170 -> 1.70, 1.70 -> 1.70; fallback si viene raro
function fixFactor(x: number | null | undefined, fallback = 1.7) {
  const v = Number(x ?? fallback);
  if (!isFinite(v) || v <= 0) return fallback;
  return v > 10 ? v / 100 : v;
}

/* --------------------------- types / constants -------------------------- */
type PurchaseDateCol = 'invoice_date' | 'date' | 'pay_date' | 'created_at';
const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#10b981', '#a78bfa'];

/* ------------------------------- component ------------------------------ */
export default function DashboardPage() {
  // Mes seleccionado
  const [ym, setYm] = useState(ymKey(new Date()));
  const monthStart = useMemo(() => parseYm(ym)!, [ym]);
  const monthEnd   = useMemo(() => addMonths(monthStart, 1), [monthStart]);
  const rangeLabel = useMemo(() => monthLabel(ym), [ym]);

  // Columna de fecha en purchases (detección automática)
  const [purchDateCol, setPurchDateCol] = useState<PurchaseDateCol>('pay_date');
  const detectPurchasesDateCol = useCallback(async (): Promise<PurchaseDateCol> => {
    for (const c of ['invoice_date', 'date', 'pay_date', 'created_at'] as PurchaseDateCol[]) {
      const { error } = await supabase.from('purchases').select(`id, ${c}`).limit(1);
      if (!error) return c;
    }
    return 'pay_date';
  }, []);
  useEffect(() => { (async () => setPurchDateCol(await detectPurchasesDateCol()))(); }, [detectPurchasesDateCol]);

  // Factor default (app_params.factor_utilidad_default)
  const [defaultFactor, setDefaultFactor] = useState(1.7);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('app_params')
        .select('value_num')
        .eq('key', 'factor_utilidad_default')
        .limit(1);
      setDefaultFactor(fixFactor(data?.[0]?.value_num, 1.7));
    })();
  }, []);

  // KPIs
  const [errMsg, setErrMsg] = useState('');
  const [salesAmt, setSalesAmt] = useState(0);
  const [costEst, setCostEst]   = useState(0);
  const [grossProfit, setGrossProfit] = useState(0);

  const [purchasesAmt, setPurchasesAmt] = useState(0);
  const [paidAmt, setPaidAmt] = useState(0);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [pendingDueThisMonth, setPendingDueThisMonth] = useState(0);

  // Gráficas
  const [monthly, setMonthly] = useState<{ ym: string; sales: number; purchases: number; paid: number }[]>([]);
  const [purchasesBySupplier, setPurchasesBySupplier] = useState<{ name: string; amount: number }[]>([]);

  useEffect(() => {
    (async () => {
      setErrMsg('');
      const fromISO = toISODate(monthStart);
      const toISOExc = toISODate(monthEnd);

      try {
        // 1) Ventas del mes + costo estimado por factor del proveedor
        let sTotal = 0, cEst = 0;
        {
          const { data, error } = await supabase
            .from('sales')
            .select('amount,date,supplier_id,suppliers(factor)')
            .gte('date', fromISO)
            .lt('date', toISOExc);

          if (error) throw error;

          (data || []).forEach((r: any) => {
            const amt = Number(r.amount || 0);
            const f   = fixFactor(r.suppliers?.factor, defaultFactor);
            sTotal += amt;
            cEst   += amt / f;
          });
        }
        setSalesAmt(sTotal);
        setCostEst(cEst);
        setGrossProfit(sTotal - cEst);

        // 2) Compras del mes (por columna detectada)
        let pTotal = 0;
        let rowsPurch: any[] = [];
        {
          const { data, error } = await supabase
            .from('purchases')
            .select(`amount, ${purchDateCol}, supplier_id, suppliers(name)`)
            .gte(purchDateCol, fromISO)
            .lt(purchDateCol, toISOExc);

          if (error) throw error;
          rowsPurch = data || [];
          pTotal = rowsPurch.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
        }
        setPurchasesAmt(pTotal);

        // 3) Compras por proveedor (pie)
        {
          const map = new Map<string, number>();
          rowsPurch.forEach((r: any) => {
            const name = r.suppliers?.name || '—';
            map.set(name, (map.get(name) || 0) + Number(r.amount || 0));
          });
          setPurchasesBySupplier(Array.from(map.entries()).map(([name, amount]) => ({ name, amount })));
        }

        // 4) Pagos hechos en el mes (paid_at)
        let paidTotal = 0;
        {
          const { data, error } = await supabase
            .from('purchases')
            .select('amount,paid_at')
            .not('paid_at', 'is', null)
            .gte('paid_at', fromISO)
            .lt('paid_at', toISOExc);

          if (error) throw error;
          paidTotal = (data || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
        }
        setPaidAmt(paidTotal);

        // 5) Pendiente total y vencido este mes
        {
          const { data: pendAll } = await supabase
            .from('purchases')
            .select('amount')
            .is('paid_at', null);
          setPendingTotal((pendAll || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0));

          const { data: pendDue } = await supabase
            .from('purchases')
            .select('amount,pay_date')
            .is('paid_at', null)
            .gte('pay_date', fromISO)
            .lt('pay_date', toISOExc);
          setPendingDueThisMonth((pendDue || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0));
        }

        // Serie (una barra del mes actual)
        setMonthly([{ ym, sales: sTotal, purchases: pTotal, paid: paidTotal }]);
      } catch (e: any) {
        console.error(e);
        setErrMsg(e?.message || String(e));
        setSalesAmt(0); setCostEst(0); setGrossProfit(0);
        setPurchasesAmt(0); setPaidAmt(0);
        setPendingTotal(0); setPendingDueThisMonth(0);
        setMonthly([]); setPurchasesBySupplier([]);
      }
    })();
  }, [ym, monthStart, monthEnd, purchDateCol, defaultFactor]);

  /* --------------------------------- UI --------------------------------- */
  const prevMonth = () => setYm(ymKey(addMonths(parseYm(ym)!, -1)));
  const nextMonth = () => setYm(ymKey(addMonths(parseYm(ym)!, +1)));

  return (
    <div className="max-w-6xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4">Dashboard</h2>

      {/* Selector de mes */}
      <div className="flex items-end gap-3 mb-4">
        <div className="flex items-center gap-2">
          <button className="px-2 py-1 border rounded" onClick={prevMonth}>◀︎</button>
          <div className="min-w-[220px] text-center">
            <div className="text-xs text-gray-500">Mes</div>
            <div className="font-semibold capitalize">{rangeLabel}</div>
          </div>
          <button className="px-2 py-1 border rounded" onClick={nextMonth}>▶︎</button>
        </div>
        <div>
          <label className="block text-sm mb-1">Ir a…</label>
          <input type="month" className="border rounded px-2 py-2" value={ym} onChange={(e)=>setYm(e.target.value)} />
        </div>
        <div className="ml-auto text-sm text-gray-600">
          Rango: <b className="capitalize">{rangeLabel}</b>
        </div>
      </div>

      {errMsg && (
        <div className="mb-3 text-sm text-red-600">
          Error al cargar: {errMsg}<br/>
          (Compras filtradas por <code>{purchDateCol}</code> · Costo estimado = ventas ÷ factor por proveedor)
        </div>
      )}

      {/* KPIs */}
      <div className="grid md:grid-cols-3 gap-3 mb-4">
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Has vendido</div>
          <div className="text-lg font-semibold">{mxn(salesAmt)}</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Costo estimado (ventas ÷ factor)</div>
          <div className="text-lg font-semibold">{mxn(costEst)}</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Utilidad bruta estimada</div>
          <div className="text-lg font-semibold">{mxn(grossProfit)}</div>
        </div>

        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Has comprado (facturas)</div>
          <div className="text-lg font-semibold">{mxn(purchasesAmt)}</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Pagaste</div>
          <div className="text-lg font-semibold">{mxn(paidAmt)}</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Pendiente por pagar (total / vencido este mes)</div>
          <div className="text-lg font-semibold">
            {mxn(pendingTotal)} <span className="text-sm text-gray-500">/ {mxn(pendingDueThisMonth)}</span>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="border rounded p-3">
          <div className="mb-2 text-sm font-medium">Ventas vs Compras vs Pagos (mes)</div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly} margin={{ left: 8, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="ym" tickFormatter={(v) => monthLabel(String(v))} />
                <YAxis />
                <Tooltip formatter={(v: any) => mxn(Number(v))} labelFormatter={(l) => monthLabel(String(l))} />
                <Legend />
                <Bar dataKey="purchases" name="Compras" fill="#22c55e" />
                <Bar dataKey="paid"       name="Pagos"   fill="#a78bfa" />
                <Bar dataKey="sales"      name="Ventas"  fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="border rounded p-3">
          <div className="mb-2 text-sm font-medium">Compras por proveedor (mes)</div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip formatter={(v: any) => mxn(Number(v))} />
                <Legend />
                <Pie data={purchasesBySupplier} dataKey="amount" nameKey="name" cx="50%" cy="50%" outerRadius={90}>
                  {purchasesBySupplier.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Las <b>compras</b> del mes se calculan por <code>{purchDateCol}</code>. Los <b>pagos</b> por <code>paid_at</code>.
        El <b>costo estimado</b> usa el factor de cada proveedor (o el default) aplicado a tus ventas del mes.
      </p>
    </div>
  );
}
