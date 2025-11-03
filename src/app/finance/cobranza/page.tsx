'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

/* ========================= TIPOS BASE ========================= */

type Deposit   = { id: string; date: string; bank: 'BBVA'|'BANAMEX'; concept: string; amount: number; notes: string|null; created_at: string };
type ClientPay = { id: string; date: string; bank: 'BBVA'|'BANAMEX'; client: string; invoice_ref: string|null; amount: number; notes: string|null; created_at: string };
type Voucher   = { id: string; date: string; concept: string; amount: number; notes: string|null; created_at: string };
type InvDaily  = { id: string; date: string; cartuchos: number; comerciales: number; importados: number; total: number; created_at: string };
type PendingPay= { id: string; date: string; client: string|null; amount: number; notes: string|null; created_at: string };

type Triple = { facturado: number; pagado: number; pendiente: number };

/* ========================= TABLAS =========================
   Ajusta SOLO los strings si en tu Supabase tienen otro nombre.
*/
const EXPENSES_TABLE = 'finance_expenses';          // gastos operativos (sin proveedores/tecnos/decam)
const PROV_TABLES    = ['finance_supplier_bills'];  // proveedores normales (el módulo /finance/proveedores)

// TECNOS / DECAM:
// Si tienes una tabla conjunta con columna tipo proveedor ("TECNOS"/"DECAM"), colócala en TD_BOTH_TABLES.
// Si las tienes separadas, usa TD_TEC_TABLES y TD_DEC_TABLES.
const TD_BOTH_TABLES = ['finance_tecnos_decam_bills', 'finance_tecnos_decam', 'finance_td'];
const TD_TEC_TABLES  = ['finance_tecnos'];
const TD_DEC_TABLES  = ['finance_decam'];

const TD_TYPE_VALUES = { TECNOS: 'TECNOS', DECAM: 'DECAM' } as const;

/* ========================= FACTORES =========================
   Estos factores son los mismos que ya estabas usando en "daily"
   para estimar costo de mercancía (proveedores) por familia.
*/
const FACTORS = { cartuchos: 1.70, comerciales: 1.82, importados: 1.53 } as const;

/* ========================= HELPERS DE FORMATO ========================= */

const mxn = (n: number) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const toMonthInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;

const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

// convierte "12,345.67", "12 345,67", etc → número
function parseNumFlexible(v: any) {
  if (v == null) return 0;
  let s = String(v).trim().replace(/\s+/g,'');
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasComma && !hasDot) s = s.replace(',', '.');     // coma como decimal
  else if (hasComma && hasDot) s = s.replace(/,/g,'');   // coma como miles
  s = s.replace(/,/g,'');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
const r2 = (x: any) => +parseNumFlexible(x).toFixed(2);

const parseYMDLocal = (ymd: string) => {
  if (!ymd) return new Date();
  const [y,m,d]=ymd.split('-').map(Number);
  return new Date(y,(m??1)-1,d??1);
};
const fmtDateLocal = (ymd: string) =>
  parseYMDLocal(ymd).toLocaleDateString('es-MX');

function monthRange(ym: string) {
  const [y,m] = ym.split('-').map(Number);
  const start = new Date(y, m-1, 1);
  const end   = new Date(y, m,   1); // exclusivo
  return { start: toISO(start), end: toISO(end) };
}

/* ========================= NORMALIZADOR DE FECHAS =========================
   Para poder leer tanto '2025-10-27', como '27/10/2025', como '2025-10-27T00:00:00Z'
   desde tablas viejas.
*/
function normalizeToYMD(raw: any): string {
  if (!raw) return '';

  const s = String(raw).trim();

  // yyyy-mm-dd...
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [_, y, m, d] = isoMatch;
    return `${y}-${m}-${d}`;
  }

  // dd/mm/yyyy o dd-mm-yyyy
  const latinMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (latinMatch) {
    let [_, dd, mm, yyyy] = latinMatch;
    if (dd.length === 1) dd = '0'+dd;
    if (mm.length === 1) mm = '0'+mm;
    return `${yyyy}-${mm}-${dd}`;
  }

  // fallback Date()
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth()+1).padStart(2,'0');
    const d = String(dt.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }

  return '';
}

/* ========================= CANDIDATOS DE COLUMNAS =========================
   Para leer tablas legacy aunque las columnas tengan otros nombres.
*/

// posibles columnas de "fecha de factura / fecha de registro"
const factDateCandidates  = [
  'invoice_date', 'fecha_fac', 'fac_date', 'fecha_factura',
  'exp_date',
  'fecha', 'date', 'created_at',
] as const;

// posibles columnas de "fecha de pago real"
const paidDateCandidates  = [
  'paid_date', 'fecha_pago', 'payment_date', 'date_paid',
  'pagado_en','fecha_pagado','fecha_pagada','paidAt','paid_at',
] as const;

// montos facturados
const amountCandidates    = [
  'amount', 'importe', 'total', 'monto', 'invoice_amount', 'monto_factura',
] as const;

// montos pagados
const paidAmtCandidates   = [
  'paid_amount','importe_pagado','monto_pagado','pagado_amount','paidAmount','pagado',
] as const;

// saldo pendiente
const saldoCandidates     = ['saldo','pendiente','remaining','restante'] as const;

// flag pagado
const paidBoolCandidates  = ['pagado','paid','is_paid','pagada'] as const;

// referencia factura / folio
const invoiceIdCandidates = [
  'invoice_no','factura','invoice','folio','referencia','invoice_ref','numero_factura',
] as const;

// columna que indica si es TECNOS o DECAM
const typeLikeCandidates = [
  'tipo','type','categoria','area','grupo','proveedor','Proveedor','provider','supplier',
] as const;

/* ========================= EXTRACTORES ========================= */

const pickNum = (row: any, keys: readonly string[]) => {
  for (const k of keys) {
    if (row && row[k] != null && row[k] !== '') {
      const n = Number(row[k]);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
};
const pickStr = (row: any, keys: readonly string[]) => {
  for (const k of keys) {
    if (row?.[k] != null && row[k] !== '') return String(row[k]);
  }
  return '';
};
const pickBool = (row: any, keys: readonly string[]) => {
  for (const k of keys) {
    if (typeof row?.[k] === 'boolean') return row[k] as boolean;
    if (row?.[k] === 0 || row?.[k] === 1) return Boolean(row[k]);
  }
  return undefined;
};

const getAmount = (row: any) => pickNum(row, amountCandidates);
const getSaldo  = (row: any) => pickNum(row, saldoCandidates);

const getPaidAmountFromRow = (row: any) => {
  // (1) si la tabla guarda explícito "paid_amount", úsalo
  const direct = pickNum(row, paidAmtCandidates);
  if (direct > 0) return direct;

  // (2) si hay saldo -> pagado = amount - saldo
  const saldo = getSaldo(row);
  if (saldo > 0) {
    const base = getAmount(row);
    return Math.max(base - saldo, 0);
  }

  // (3) si la fila trae flag pagado=true, asumimos pagado total
  const paidFlag = pickBool(row, paidBoolCandidates);
  if (paidFlag === true) {
    return getAmount(row);
  }

  return 0;
};

// identificar TECNOS o DECAM
function rowMatchesType(row: any, desired: string) {
  for (const col of typeLikeCandidates) {
    if (row?.[col] != null) {
      const val = String(row[col]).trim().toUpperCase();
      if (val === desired.toUpperCase()) return true;
      if (val.includes(desired.toUpperCase())) return true;
    }
  }
  return false;
}

// genera una llave estable para no contar doble
const rowKey = (row: any, refDate: string) =>
  (row?.id ?? `${pickStr(row, invoiceIdCandidates)}|${getAmount(row)}|${refDate}`);

/* ========================= RESUMENES POR TABLA ========================= */

const zeroTriple: Triple = { facturado: 0, pagado: 0, pendiente: 0 };

/**
 * Lee TODA la tabla y calcula:
 *  - facturado (por fecha de factura dentro del mes)
 *  - pendiente (saldo no pagado de esas facturas del mes)
 *  - pagado (por fecha de pago dentro del mes)
 * Si pasas factType 'TECNOS' o 'DECAM', filtra las filas que pertenezcan a esa categoría.
 */
async function summarizeTableClientSide(
  table: string,
  opts: { start: string; end: string; factType?: 'TECNOS'|'DECAM' }
): Promise<Triple> {
  const { start, end, factType } = opts;

  const res = await supabase.from(table).select('*');
  if (res.error || !Array.isArray(res.data)) {
    console.warn('[summarizeTableClientSide] error leyendo', table, res.error);
    return zeroTriple;
  }

  let rows: any[] = res.data as any[];

  // si queremos TECNOS/DECAM, filtramos por texto
  if (factType) {
    rows = rows.filter(r => rowMatchesType(r, factType));
  }

  function isInRange(rawDate: any) {
    const norm = normalizeToYMD(rawDate);
    if (!norm) return false;
    return norm >= start && norm < end;
  }

  const seenFact = new Set<string>();
  const seenPaid = new Set<string>();

  let facturado = 0;
  let pendiente = 0;
  let pagado    = 0;

  // A) facturado + pendiente (por fecha de factura)
  for (const r of rows) {
    let usedFactDate: string | null = null;

    for (const fcol of factDateCandidates) {
      if (r[fcol] != null && isInRange(r[fcol])) {
        usedFactDate = normalizeToYMD(r[fcol]);
        break;
      }
    }

    if (!usedFactDate) continue;

    const k = rowKey(r, usedFactDate);
    if (seenFact.has(k)) continue;
    seenFact.add(k);

    const amt     = getAmount(r);
    const paidAmt = getPaidAmountFromRow(r);

    facturado += amt;

    const saldoExplicit = getSaldo(r);
    const pendienteRow = saldoExplicit > 0
      ? saldoExplicit
      : Math.max(amt - paidAmt, 0);

    pendiente += pendienteRow;
  }

  // B) pagado (por fecha de pago)
  for (const r of rows) {
    let usedPaidDate: string | null = null;

    for (const pcol of paidDateCandidates) {
      if (r[pcol] != null && isInRange(r[pcol])) {
        usedPaidDate = normalizeToYMD(r[pcol]);
        break;
      }
    }

    if (!usedPaidDate) continue;

    const k = rowKey(r, usedPaidDate);
    if (seenPaid.has(k)) continue;
    seenPaid.add(k);

    const paidAmt = getPaidAmountFromRow(r);
    pagado += paidAmt > 0 ? paidAmt : getAmount(r);
  }

  return { facturado, pagado, pendiente };
}

// suma varias tablas equivalentes (ej. proveedores puede vivir en varios nombres)
async function sumTablesClientSide(
  tables: string[],
  opts: { start: string; end: string; factType?: 'TECNOS'|'DECAM' }
): Promise<Triple> {
  let total: Triple = { ...zeroTriple };
  for (const t of tables) {
    try {
      const part = await summarizeTableClientSide(t, opts);
      total = {
        facturado: total.facturado + part.facturado,
        pagado:    total.pagado    + part.pagado,
        pendiente: total.pendiente + part.pendiente,
      };
    } catch (e) {
      console.warn('[sumTablesClientSide] error en tabla', t, e);
    }
  }
  return total;
}

/* =======================================================
   COMPONENTE PRINCIPAL
   ======================================================= */

export default function FinanceCobranzaPage() {
  /* -------- mes seleccionado -------- */
  const [ym, setYm] = useState<string>(toMonthInput(new Date()));
  const { start, end } = useMemo(() => monthRange(ym), [ym]);

  /* -------- datos base (ventas, depósitos, etc.) -------- */
  const [invoices,  setInvoices]  = useState<InvDaily[]>([]);
  const [deposits,  setDeposits]  = useState<Deposit[]>([]);
  const [clientPays,setClientPays]= useState<ClientPay[]>([]);
  const [vouchers,  setVouchers]  = useState<Voucher[]>([]);
  const [pendings,  setPendings]  = useState<PendingPay[]>([]);

  /* -------- resúmenes de gasto / proveedores --------
     gastosSum = gastos operativos generales (EXPENSES_TABLE solamente)
     provSum   = proveedores normales (finance_supplier_bills)
     tecnosSum = TECNOS (solo esas facturas)
     decamSum  = DECAM
  */
  const [gastosSum, setGastosSum] = useState<Triple>(zeroTriple);
  const [provSum,   setProvSum]   = useState<Triple>(zeroTriple);
  const [tecnosSum, setTecnosSum] = useState<Triple>(zeroTriple);
  const [decamSum,  setDecamSum]  = useState<Triple>(zeroTriple);

  /* -------- GO disponible mensual (suma de go_del_dia en finance_days) -------- */
  const [goDisponibleMes, setGoDisponibleMes] = useState<number>(0);

  /* -------- mensajitos / export -------- */
  const [msg, setMsg] = useState('');
  const [exporting, setExporting] = useState(false);

  /* -------- formularios de captura en esta vista -------- */
  const [invDate, setInvDate] = useState<string>(toISO(new Date()));
  const [cart, setCart] = useState<number>(0);
  const [com,  setCom]  = useState<number>(0);
  const [imp,  setImp]  = useState<number>(0);
  const [editingInvId, setEditingInvId] = useState<string|null>(null);

  const [depDate, setDepDate] = useState<string>(toISO(new Date()));
  const [depBank, setDepBank] = useState<'BBVA'|'BANAMEX'>('BANAMEX');
  const [depConceptChoice, setDepConceptChoice] = useState<'TARJETAS'|'EFECTIVO'|'ANTICIPO'|'OTRO'>('TARJETAS');
  const [depConceptOther, setDepConceptOther] = useState<string>('');
  const [depAmount, setDepAmount] = useState<number>(0);
  const [depNotes, setDepNotes]   = useState<string>('');

  const [cpDate, setCpDate] = useState<string>(toISO(new Date()));
  const [cpBank, setCpBank] = useState<'BBVA'|'BANAMEX'>('BBVA');
  const [cpClient, setCpClient] = useState<string>('');
  const [cpInvoice, setCpInvoice] = useState<string>('');
  const [cpAmount, setCpAmount] = useState<number>(0);
  const [cpNotes, setCpNotes]   = useState<string>('');

  const [vcDate, setVcDate] = useState<string>(toISO(new Date()));
  const [vcConcept, setVcConcept] = useState<string>('REPOSICIÓN DE GASTOS');
  const [vcAmount, setVcAmount] = useState<number>(0);
  const [vcNotes, setVcNotes]   = useState<string>('');

  const [pdDate, setPdDate] = useState<string>(toISO(new Date()));
  const [pdClient, setPdClient] = useState<string>('');
  const [pdAmount, setPdAmount] = useState<number>(0);
  const [pdNotes, setPdNotes]   = useState<string>('');

  /* -------- carga mensual -------- */
  async function reloadMonth() {
    setMsg('');

    // tablas que ya guardan 'date' ISO
    const [i1, i2, i3, i4, i5] = await Promise.all([
      supabase.from('finance_invoices_daily')
        .select('*')
        .gte('date', start)
        .lt('date', end)
        .order('date', { ascending: true }),

      supabase.from('finance_deposits')
        .select('*')
        .gte('date', start)
        .lt('date', end)
        .order('date', { ascending: true }),

      supabase.from('finance_client_bank_payments')
        .select('*')
        .gte('date', start)
        .lt('date', end)
        .order('date', { ascending: true }),

      supabase.from('finance_vouchers')
        .select('*')
        .gte('date', start)
        .lt('date', end)
        .order('date', { ascending: true }),

      supabase.from('finance_pending_payments')
        .select('*')
        .gte('date', start)
        .lt('date', end)
        .order('date', { ascending: true }),
    ]);

    setInvoices((i1.data || []) as InvDaily[]);
    setDeposits((i2.data || []) as Deposit[]);
    setClientPays((i3.data || []) as ClientPay[]);
    setVouchers((i4.data || []) as Voucher[]);
    setPendings((i5.data || []) as PendingPay[]);

    // ---- RESÚMENES POR SECCIÓN ----

    // Gastos operativos generales (NO proveedores, NO TECNOS/DECAM)
    const gPromise = summarizeTableClientSide(EXPENSES_TABLE, { start, end });

    // Proveedores normales
    const pPromise = sumTablesClientSide(PROV_TABLES, { start, end });

    // TECNOS
    const tPromise = (async () => {
      const joint = await sumTablesClientSide(
        TD_BOTH_TABLES,
        { start, end, factType: TD_TYPE_VALUES.TECNOS }
      );
      if (joint.facturado || joint.pagado || joint.pendiente) return joint;
      return sumTablesClientSide(TD_TEC_TABLES, { start, end });
    })();

    // DECAM
    const dPromise = (async () => {
      const joint = await sumTablesClientSide(
        TD_BOTH_TABLES,
        { start, end, factType: TD_TYPE_VALUES.DECAM }
      );
      if (joint.facturado || joint.pagado || joint.pendiente) return joint;
      return sumTablesClientSide(TD_DEC_TABLES, { start, end });
    })();

    // Cortes diarios del mes => suma de go_del_dia
    const dayRes = await supabase
      .from('finance_days')
      .select('day, totals')
      .gte('day', start)
      .lt('day', end)
      .order('day', { ascending: true });

    let _goDisponibleMes = 0;
    if (!dayRes.error && Array.isArray(dayRes.data)) {
      for (const row of dayRes.data) {
        const t = (row as any).totals || {};
        _goDisponibleMes += Number(t.go_del_dia || 0);
      }
    }

    const [g, p, t, d] = await Promise.all([gPromise, pPromise, tPromise, dPromise]);

    setGastosSum(g);   // gastos operativos pagados/pendientes
    setProvSum(p);     // proveedores normales
    setTecnosSum(t);   // TECNOS
    setDecamSum(d);    // DECAM
    setGoDisponibleMes(_goDisponibleMes); // suma real de GO_del_dia
  }

  useEffect(() => {
    reloadMonth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end]);

  /* -------- totales base (ventas/bancos/etc.) -------- */
  const totals = useMemo(() => {
    const invTotal = invoices.reduce((s,r)=>s + (Number(r.total)||0), 0);

    const famCart  = invoices.reduce((s,r)=>s + (Number(r.cartuchos)||0), 0);
    const famCom   = invoices.reduce((s,r)=>s + (Number(r.comerciales)||0), 0);
    const famImp   = invoices.reduce((s,r)=>s + (Number(r.importados)||0), 0);

    const clientPayTotal = clientPays.reduce((s,r)=>s + (Number(r.amount)||0), 0);

    const depTotal = deposits.reduce((s,r)=>s + (Number(r.amount)||0), 0);
    const depTar   = deposits.filter(d => d.concept?.toUpperCase()==='TARJETAS').reduce((s,r)=>s + Number(r.amount||0), 0);
    const depEfe   = deposits.filter(d => d.concept?.toUpperCase()==='EFECTIVO').reduce((s,r)=>s + Number(r.amount||0), 0);
    const depAnt   = deposits.filter(d => d.concept?.toUpperCase()==='ANTICIPO').reduce((s,r)=>s + Number(r.amount||0), 0);
    const depOtr   = deposits
      .filter(d => !['TARJETAS','EFECTIVO','ANTICIPO'].includes((d.concept||'').toUpperCase()))
      .reduce((s,r)=>s + Number(r.amount||0), 0);

    const vouchersTotal = vouchers.reduce((s,r)=>s + (Number(r.amount)||0), 0);
    const pendientes    = pendings.reduce((s,r)=>s + (Number(r.amount)||0), 0);

    return {
      invTotal,
      famCart, famCom, famImp,
      clientPayTotal,
      depTotal, depTar, depEfe, depAnt, depOtr,
      vouchersTotal,
      pendientes,
    };
  }, [invoices, deposits, clientPays, vouchers, pendings]);

  /* -------- Cálculo Proveedores / Caja --------
     - factorCobrado: qué % de las ventas ya están cobradas (= no pendientes)
     - provTotalEstimado: cuánto "deberíamos pagar a proveedores" del mes (ventas / factor)
     - pagadoProveedoresReal: lo realmente pagado a proveedores este mes
       (proveedores normales + TECNOS + DECAM)
     - faltanteEstimado: lo que aún faltaría pagarles a proveedores según ese estimado
     - liquidezPostVales = caja real sin vales
  */
  const proveedoresCalc = useMemo(() => {
    // qué % de las ventas ya están cobradas
    const factorCobrado  = totals.invTotal > 0
      ? (totals.invTotal - totals.pendientes) / totals.invTotal
      : 0;

    // ventas netas cobradas por familia
    const cartNetoVentas = totals.famCart * factorCobrado;
    const comNetoVentas  = totals.famCom  * factorCobrado;
    const impNetoVentas  = totals.famImp  * factorCobrado;

    // costo estimado de mercancía (proveedores) por familia
    const provCart = FACTORS.cartuchos   > 0 ? cartNetoVentas / FACTORS.cartuchos   : 0;
    const provCom  = FACTORS.comerciales > 0 ? comNetoVentas  / FACTORS.comerciales : 0;
    const provImp  = FACTORS.importados  > 0 ? impNetoVentas  / FACTORS.importados  : 0;

    const provTotalEstimado = provCart + provCom + provImp;

    // Pagado real del mes a proveedores (normales + TECNOS + DECAM)
    const pagadoProveedoresReal =
      provSum.pagado + tecnosSum.pagado + decamSum.pagado;

    // Faltante estimado para proveedores
    const faltanteEstimado = Math.max(
      provTotalEstimado - pagadoProveedoresReal,
      0
    );

    // Liquidez: todo lo que cayó al banco este mes
    const totalDepositado = totals.depTotal + totals.clientPayTotal;

    // Después de vales, lo que queda líquido en bancos
    const liquidezPostVales = totalDepositado - totals.vouchersTotal;

    return {
      factorCobrado,
      cartNetoVentas, comNetoVentas, impNetoVentas,
      provCart, provCom, provImp,
      provTotalEstimado,
      pagadoProveedoresReal,
      faltanteEstimado,
      totalDepositado,
      liquidezPostVales,
    };
  }, [totals, provSum, tecnosSum, decamSum]);

  /* -------- Gasto operativo (GO) mensual --------
     - goDisponibleMes  => suma de go_del_dia (cortes diarios)
     - gastosSum.pagado => lo que se pagó en finance_expenses
     - diffGO           => si el GO disponible alcanza para lo que ya se pagó
  */
  const operativa = useMemo(() => {
    const goDisponible = goDisponibleMes;   // tu "GO_del_día" sumado en el mes
    const goPagado     = gastosSum.pagado;  // finance_expenses pagado
    const diffGO       = goDisponible - goPagado;

    return { goDisponible, goPagado, diffGO };
  }, [goDisponibleMes, gastosSum.pagado]);

  /* ========================= CRUD HANDLERS ========================= */

  async function saveInvDaily() {
    try {
      setMsg('');
      if (!invDate) throw new Error('Falta la fecha');

      const values = {
        cartuchos: r2(cart),
        comerciales: r2(com),
        importados: r2(imp),
      };

      if (editingInvId) {
        const { error } = await supabase
          .from('finance_invoices_daily')
          .update(values)
          .eq('id', editingInvId);
        if (error) throw error;
      } else {
        const { data: existing, error: exErr } = await supabase
          .from('finance_invoices_daily')
          .select('id')
          .eq('date', invDate)
          .maybeSingle();

        if (exErr && exErr.code !== 'PGRST116') throw exErr;

        if (existing?.id) {
          const { error } = await supabase
            .from('finance_invoices_daily')
            .update(values)
            .eq('id', existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('finance_invoices_daily')
            .insert({ date: invDate, ...values });
          if (error) throw error;
        }
      }

      await reloadMonth();
      setEditingInvId(null);
      setMsg('✅ Ventas del día guardadas.');
    } catch (e:any) {
      console.error('saveInvDaily error ->', e);
      setMsg('❌ No se pudo guardar el cuadrito: ' + (e?.message ?? e));
    }
  }

  function editInvRow(row: InvDaily) {
    setInvDate(row.date);
    setCart(row.cartuchos||0);
    setCom(row.comerciales||0);
    setImp(row.importados||0);
    setEditingInvId(row.id);
  }

  async function deleteInvRow(id: string) {
    try {
      await supabase.from('finance_invoices_daily').delete().eq('id', id);
      await reloadMonth();
    } catch (e) { console.error(e); }
  }

  async function addDeposit() {
    try {
      const concept = depConceptChoice === 'OTRO'
        ? (depConceptOther.trim() || 'OTRO')
        : depConceptChoice;

      const payload = {
        date: depDate,
        bank: depBank,
        concept,
        amount: r2(depAmount),
        notes: depNotes?.trim() || null,
      };
      const { error } = await supabase
        .from('finance_deposits')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;

      await reloadMonth();
      setMsg('✅ Depósito agregado.');
    } catch (e:any) {
      console.error(e);
      setMsg('❌ No se pudo agregar el depósito: ' + (e?.message ?? e));
    }
  }

  async function deleteDeposit(id: string) {
    try {
      await supabase.from('finance_deposits').delete().eq('id', id);
      await reloadMonth();
    } catch (e){ console.error(e); }
  }

  async function addClientPay() {
    try {
      const payload = {
        date: cpDate,
        bank: cpBank,
        client: cpClient.trim(),
        invoice_ref: cpInvoice.trim() || null,
        amount: r2(cpAmount),
        notes: cpNotes?.trim() || null,
      };
      const { error } = await supabase
        .from('finance_client_bank_payments')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;

      await reloadMonth();
      setMsg('✅ Pago de cliente agregado.');
    } catch (e:any) {
      console.error(e);
      setMsg('❌ No se pudo agregar el pago de cliente: ' + (e?.message ?? e));
    }
  }

  async function deleteClientPay(id: string) {
    try {
      await supabase
        .from('finance_client_bank_payments')
        .delete()
        .eq('id', id);

      await reloadMonth();
    } catch (e){ console.error(e); }
  }

  async function addVoucher() {
    try {
      const payload = {
        date: vcDate,
        concept: vcConcept.trim(),
        amount: r2(vcAmount),
        notes: vcNotes?.trim() || null,
      };
      const { error } = await supabase
        .from('finance_vouchers')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;

      await reloadMonth();
      setMsg('✅ Vale agregado.');
    } catch (e:any) {
      console.error(e);
      setMsg('❌ No se pudo agregar el vale: ' + (e?.message ?? e));
    }
  }

  async function deleteVoucher(id: string) {
    try {
      await supabase.from('finance_vouchers').delete().eq('id', id);
      await reloadMonth();
    } catch (e){ console.error(e); }
  }

  async function addPending() {
    try {
      const payload = {
        date: pdDate,
        client: pdClient.trim() || null,
        amount: r2(pdAmount),
        notes: pdNotes?.trim() || null,
      };
      const { error } = await supabase
        .from('finance_pending_payments')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;

      await reloadMonth();
      setMsg('✅ Pendiente agregado (se resta del total).');
    } catch (e:any) {
      console.error(e);
      setMsg('❌ No se pudo agregar el pendiente: ' + (e?.message ?? e));
    }
  }

  async function deletePending(id: string) {
    try {
      await supabase
        .from('finance_pending_payments')
        .delete()
        .eq('id', id);

      await reloadMonth();
    } catch (e){ console.error(e); }
  }

  /* ========================= EXPORT EXCEL ========================= */

  async function exportToExcel() {
    try {
      setExporting(true);
      const ExcelJS = await import('exceljs');
      const wb = new ExcelJS.Workbook();

      const cellBorder = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
      const currencyFmt = '$#,##0.00';
      const dateFmt = 'dd/mm/yyyy';

      const resumen = wb.addWorksheet('Resumen', {
        properties: { defaultRowHeight: 18 },
      });

      resumen.getCell('A1').value = 'Contabilidad y Finanzas — Cobranza mensual';
      resumen.getCell('A1').font = { size: 14, bold: true };
      resumen.mergeCells('A1', 'G1');

      resumen.getCell('A2').value = 'Mes';
      resumen.getCell('B2').value = parseYMDLocal(`${ym}-01`);
      resumen.getCell('B2').numFmt = 'mmmm yyyy';

      resumen.getCell('D2').value = 'Generado';
      resumen.getCell('E2').value = new Date();
      resumen.getCell('E2').numFmt = 'dd/mm/yyyy hh:mm';

      const rows: Array<[string, number]> = [
        ['Total facturas del mes', totals.invTotal],
        ['Pagos de clientes (con factura)', totals.clientPayTotal],
        ['Depósitos — Total', totals.depTotal],
        ['• Tarjetas', totals.depTar],
        ['• Efectivo', totals.depEfe],
        ['• Anticipos', totals.depAnt],
        ['• Otros', totals.depOtr],
        ['Vales', totals.vouchersTotal],
        ['Pendientes', totals.pendientes],

        ['Total depositado (Depósitos + Pagos)', proveedoresCalc.totalDepositado],
        ['Liquidez después de vales', proveedoresCalc.liquidezPostVales],

        ['Requerido proveedores (estimado)', proveedoresCalc.provTotalEstimado],
        ['Pagado a proveedores (mes)', proveedoresCalc.pagadoProveedoresReal],
        ['Faltante estimado proveedores', proveedoresCalc.faltanteEstimado],

        ['GO disponible (suma go_del_dia)', operativa.goDisponible],
        ['GO pagado (finance_expenses)', operativa.goPagado],
        ['Resultado GO (Disponible - GO pagado)', operativa.diffGO],

        ['Gastos operativos — Facturado (mes)', gastosSum.facturado],
        ['Gastos operativos — Pagado (mes)', gastosSum.pagado],
        ['Gastos operativos — Pendiente (mes)', gastosSum.pendiente],

        ['Proveedores — Facturado (mes)', provSum.facturado],
        ['Proveedores — Pagado (mes)', provSum.pagado],
        ['Proveedores — Pendiente (mes)', provSum.pendiente],

        ['TECNOS — Facturado (mes)', tecnosSum.facturado],
        ['TECNOS — Pagado (mes)', tecnosSum.pagado],
        ['TECNOS — Pendiente (mes)', tecnosSum.pendiente],

        ['DECAM — Facturado (mes)', decamSum.facturado],
        ['DECAM — Pagado (mes)', decamSum.pagado],
        ['DECAM — Pendiente (mes)', decamSum.pendiente],
      ];

      resumen.addTable({
        name: 'TablaResumen',
        ref: 'A4',
        headerRow: true,
        style: { theme: 'TableStyleLight9', showRowStripes: true },
        columns: [{ name: 'Concepto' }, { name: 'Monto' }],
        rows: rows.map(r => [r[0], r[1]]),
      });

      for (let i = 0; i < rows.length; i++) {
        resumen.getCell(`B${5+i}`).numFmt = currencyFmt;
      }

      // ---------- Hojas detalle ----------

      // Cuadrito
      const s1 = wb.addWorksheet('Cuadrito');
      s1.columns = [
        { header: 'Fecha', key: 'date', width: 12 },
        { header: 'Cartuchos', key: 'cartuchos', width: 14 },
        { header: 'Comerciales', key: 'comerciales', width: 14 },
        { header: 'Importación', key: 'importados', width: 14 },
        { header: 'Total', key: 'total', width: 14 },
      ];
      invoices.forEach(r => s1.addRow({
        date: parseYMDLocal(r.date),
        cartuchos: r.cartuchos,
        comerciales: r.comerciales,
        importados: r.importados,
        total: r.total,
      }));
      s1.getColumn('date').numFmt = dateFmt;
      ['cartuchos','comerciales','importados','total'].forEach(k => {
        s1.getColumn(k).numFmt = currencyFmt;
      });
      s1.views = [{ state: 'frozen', ySplit: 1 }];

      // Depósitos
      const s2 = wb.addWorksheet('Depósitos');
      s2.columns = [
        { header: 'Fecha', key: 'date', width: 12 },
        { header: 'Banco', key: 'bank', width: 12 },
        { header: 'Concepto', key: 'concept', width: 22 },
        { header: 'Importe', key: 'amount', width: 14 },
        { header: 'Notas', key: 'notes', width: 34 },
      ];
      deposits.forEach(r => s2.addRow({
        date: parseYMDLocal(r.date),
        bank: r.bank,
        concept: r.concept,
        amount: r.amount,
        notes: r.notes || '',
      }));
      s2.getColumn('date').numFmt = dateFmt;
      s2.getColumn('amount').numFmt = currencyFmt;
      s2.views=[{state:'frozen',ySplit:1}];

      // Pagos clientes
      const s3 = wb.addWorksheet('Pagos clientes');
      s3.columns = [
        { header: 'Fecha', key: 'date', width: 12 },
        { header: 'Banco', key: 'bank', width: 12 },
        { header: 'Cliente', key: 'client', width: 28 },
        { header: 'Factura', key: 'invoice_ref', width: 14 },
        { header: 'Importe', key: 'amount', width: 14 },
        { header: 'Notas', key: 'notes', width: 34 },
      ];
      clientPays.forEach(r => s3.addRow({
        date: parseYMDLocal(r.date),
        bank: r.bank,
        client: r.client,
        invoice_ref: r.invoice_ref || '—',
        amount: r.amount,
        notes: r.notes || '',
      }));
      s3.getColumn('date').numFmt = dateFmt;
      s3.getColumn('amount').numFmt = currencyFmt;
      s3.views=[{state:'frozen',ySplit:1}];

      // Pendientes
      const s4 = wb.addWorksheet('Pendientes');
      s4.columns = [
        { header: 'Fecha', key: 'date', width: 12 },
        { header: 'Cliente', key: 'client', width: 28 },
        { header: 'Importe', key: 'amount', width: 14 },
        { header: 'Notas', key: 'notes', width: 34 },
      ];
      pendings.forEach(r => s4.addRow({
        date: parseYMDLocal(r.date),
        client: r.client || '—',
        amount: r.amount,
        notes: r.notes || '',
      }));
      s4.getColumn('date').numFmt = dateFmt;
      s4.getColumn('amount').numFmt = currencyFmt;
      s4.views=[{state:'frozen',ySplit:1}];

      // Vales
      const s5 = wb.addWorksheet('Vales');
      s5.columns = [
        { header: 'Fecha', key: 'date', width: 12 },
        { header: 'Concepto', key: 'concept', width: 34 },
        { header: 'Importe', key: 'amount', width: 14 },
        { header: 'Notas', key: 'notes', width: 34 },
      ];
      vouchers.forEach(r => s5.addRow({
        date: parseYMDLocal(r.date),
        concept: r.concept,
        amount: r.amount,
        notes: r.notes || '',
      }));
      s5.getColumn('date').numFmt = dateFmt;
      s5.getColumn('amount').numFmt = currencyFmt;
      s5.views=[{state:'frozen',ySplit:1}];

      ;[s1,s2,s3,s4,s5].forEach(sheet => {
        sheet.getRow(1).font = { bold: true };
        sheet.eachRow((row:any)=>{
          row.eachCell((cell:any)=>{
            cell.border = cellBorder;
          });
        });
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob(
        [buffer],
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
      );
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Cobranza_${ym}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);

      setMsg('📄 Archivo Excel exportado.');
    } catch (e) {
      console.error(e);
      setMsg('❌ No se pudo exportar a Excel.');
    } finally {
      setExporting(false);
    }
  }

  /* ========================= UI ========================= */

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Encabezado */}
      <h1 className="text-xl font-bold mb-4">Contabilidad y Finanzas</h1>

      {/* Mes + Export */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">Mes
          <input
            type="month"
            className="ml-2 border rounded px-2 py-1"
            value={ym}
            onChange={(e)=>setYm(e.target.value)}
          />
        </label>
        <span className="text-xs text-gray-500">
          Rango: {parseYMDLocal(`${ym}-01`).toLocaleDateString('es-MX', {
            month: 'long',
            year: 'numeric',
          })}
        </span>
        <button
          onClick={exportToExcel}
          disabled={exporting}
          className={`ml-auto px-4 py-2 rounded ${exporting ? 'bg-gray-400' : 'bg-emerald-600 hover:bg-emerald-700'} text-white`}
          title="Exportar todo a Excel"
        >
          {exporting ? 'Exportando…' : 'Exportar a Excel'}
        </button>
      </div>

      <h2 className="text-lg font-semibold mb-4">
        Contabilidad y Finanzas — Cobranza mensual
      </h2>

      {/* Resumen superior (facturas, cobros, depósitos, vales) */}
      <div className="grid md:grid-cols-4 gap-3 mb-6">
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Total facturas del mes</div>
          <div className="text-lg font-semibold">{mxn(totals.invTotal)}</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Pagos de clientes (con factura)</div>
          <div className="text-lg font-semibold">{mxn(totals.clientPayTotal)}</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Depósitos</div>
          <div className="text-lg font-semibold">{mxn(totals.depTotal)}</div>
          <div className="text-xs text-gray-500 mt-1">
            Tarjetas {mxn(totals.depTar)} · Efectivo {mxn(totals.depEfe)} · Anticipos {mxn(totals.depAnt)} · <span className="font-medium">Otros {mxn(totals.depOtr)}</span>
          </div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Vales</div>
          <div className="text-lg font-semibold">{mxn(totals.vouchersTotal)}</div>
        </div>
      </div>

      {/* Planeación proveedores / caja */}
      <section className="mb-6">
        <div className="text-sm font-medium mb-2">
          Planeación de caja (factores vs pagos reales)
        </div>
        <div className="grid md:grid-cols-5 gap-3">
          <div className="border rounded p-3">
            <div className="text-xs text-gray-500">Total depositado</div>
            <div className="text-lg font-semibold">{mxn(proveedoresCalc.totalDepositado)}</div>
            <div className="text-[11px] text-gray-500 mt-1">
              = Depósitos + Pagos de clientes
            </div>
          </div>

          <div className="border rounded p-3">
            <div className="text-xs text-gray-500">Liquidez después de vales</div>
            <div className="text-lg font-semibold">{mxn(proveedoresCalc.liquidezPostVales)}</div>
            <div className="text-[11px] text-gray-500 mt-1">
              Resta vales al dinero en bancos
            </div>
          </div>

          <div className="border rounded p-3">
            <div className="text-xs text-gray-500">Requerido proveedores (estimado)</div>
            <div className="text-lg font-semibold">
              {mxn(proveedoresCalc.provTotalEstimado)}
            </div>
            <div className="text-[11px] text-gray-500 mt-1">
              Cart {mxn(proveedoresCalc.provCart)} · Com {mxn(proveedoresCalc.provCom)} · Imp {mxn(proveedoresCalc.provImp)}
            </div>
          </div>

          <div className="border rounded p-3">
            <div className="text-xs text-gray-500">Pagado a proveedores (mes)</div>
            <div className="text-lg font-semibold">
              {mxn(proveedoresCalc.pagadoProveedoresReal)}
            </div>
            <div className="text-[11px] text-gray-500 mt-1">
              Prov {mxn(provSum.pagado)} · Tsc {mxn(tecnosSum.pagado)} · Dec {mxn(decamSum.pagado)}
            </div>
          </div>

          <div className="border rounded p-3">
            <div className="text-xs text-gray-500">Faltante estimado proveedores</div>
            <div className="text-lg font-semibold">{mxn(proveedoresCalc.faltanteEstimado)}</div>
          </div>
        </div>
      </section>

      {/* Gasto operativo vs disponibilidad */}
      <section className="mb-6">
        <div className="text-sm font-medium mb-2">
          Gasto operativo vs disponibilidad
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          <div className="border rounded p-3">
            <div className="text-xs text-gray-500">Disponible para GO (mes)</div>
            <div className="text-lg font-semibold">{mxn(operativa.goDisponible)}</div>
            <div className="text-[11px] text-gray-500 mt-1">
              Suma de GO_del_día de cada corte diario. Esto es el presupuesto operativo que generó la venta (ya descuenta proveedores diarios, vales y comisiones tarjeta).
            </div>
          </div>

          <div className="border rounded p-3">
            <div className="text-xs text-gray-500">Gastos operativos pagado (mes)</div>
            <div className="text-lg font-semibold">{mxn(operativa.goPagado)}</div>
            <div className="text-[11px] text-gray-500 mt-1">
              finance_expenses solamente (sin proveedores / TECNOS / DECAM).
            </div>
          </div>

          <div
            className={`border rounded p-3 ${
              operativa.diffGO < 0 ? 'bg-red-50' : 'bg-emerald-50'
            }`}
          >
            <div className="text-xs text-gray-500">
              Resultado GO (Disponible - GO pagado)
            </div>
            <div
              className={`text-lg font-semibold ${
                operativa.diffGO < 0
                  ? 'text-red-700'
                  : 'text-emerald-700'
              }`}
            >
              {mxn(operativa.diffGO)}
            </div>
            <div className="text-[11px] mt-1">
              {operativa.diffGO < 0
                ? 'Gastamos más GO del que generamos.'
                : 'Gasto operativo cubierto con el GO disponible.'}
            </div>
          </div>
        </div>
      </section>

      {/* Detalle de pagos / secciones */}
      <section className="mb-6">
        <div className="text-sm font-medium mb-2">
          Detalle de pagos / secciones
        </div>
        <div className="grid md:grid-cols-4 gap-3">
          <div className="border rounded p-3">
            <div className="text-xs text-gray-500">Gastos operativos (mes)</div>
            <div className="text-lg font-semibold">{mxn(gastosSum.facturado)}</div>
            <div className="text-[11px] text-gray-500 mt-1">
              Pag: {mxn(gastosSum.pagado)} · Pend: {mxn(gastosSum.pendiente)}
            </div>
          </div>

          <div className="border rounded p-3">
            <div className="text-xs text-gray-500">Proveedores (mes)</div>
            <div className="text-lg font-semibold">{mxn(provSum.facturado)}</div>
            <div className="text-[11px] text-gray-500 mt-1">
              Pag: {mxn(provSum.pagado)} · Pend: {mxn(provSum.pendiente)}
            </div>
          </div>

          <div className="border rounded p-3">
            <div className="text-xs text-gray-500">TECNOS (mes)</div>
            <div className="text-lg font-semibold">{mxn(tecnosSum.facturado)}</div>
            <div className="text-[11px] text-gray-500 mt-1">
              Pag: {mxn(tecnosSum.pagado)} · Pend: {mxn(tecnosSum.pendiente)}
            </div>
          </div>

          <div className="border rounded p-3">
            <div className="text-xs text-gray-500">DECAM (mes)</div>
            <div className="text-lg font-semibold">{mxn(decamSum.facturado)}</div>
            <div className="text-[11px] text-gray-500 mt-1">
              Pag: {mxn(decamSum.pagado)} · Pend: {mxn(decamSum.pendiente)}
            </div>
          </div>
        </div>
      </section>

      {/* Pendientes y Neto */}
      <div className="grid md:grid-cols-2 gap-3 mb-6">
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Pendientes de clientes</div>
          <div className="text-lg font-semibold">{mxn(totals.pendientes)}</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Neto después de pendientes</div>
          <div className="text-lg font-semibold">
            {mxn(totals.invTotal - totals.pendientes)}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            (Total facturas – Pendientes)
          </div>
        </div>
      </div>

      {/* CUADRITO */}
      <section className="mb-8">
        <div className="text-sm font-medium mb-2">
          “Cuadrito” (ventas por familia)
        </div>
        <div className="flex flex-wrap items-end gap-2 mb-2">
          <label className="text-sm">Fecha
            <input
              type="date"
              className="ml-2 border rounded px-2 py-1"
              value={invDate}
              onChange={(e)=>setInvDate(e.target.value)}
            />
          </label>
          <label className="text-sm">Cartuchos
            <input
              className="ml-2 w-28 border rounded px-2 py-1 text-right"
              value={cart}
              onChange={(e)=>setCart(parseNumFlexible(e.target.value))}
            />
          </label>
          <label className="text-sm">Comerciales
            <input
              className="ml-2 w-28 border rounded px-2 py-1 text-right"
              value={com}
              onChange={(e)=>setCom(parseNumFlexible(e.target.value))}
            />
          </label>
          <label className="text-sm">Importación
            <input
              className="ml-2 w-28 border rounded px-2 py-1 text-right"
              value={imp}
              onChange={(e)=>setImp(parseNumFlexible(e.target.value))}
            />
          </label>
          <button
            onClick={saveInvDaily}
            className="px-4 py-2 rounded bg-black text-white"
          >
            {editingInvId ? 'Guardar cambios' : 'Agregar'}
          </button>
          {editingInvId && (
            <button
              onClick={()=>{ setEditingInvId(null); setMsg(''); }}
              className="px-3 py-2 rounded border"
            >
              Cancelar
            </button>
          )}
        </div>

        <div className="border rounded overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2">Fecha</th>
                <th className="text-right p-2">Cartuchos</th>
                <th className="text-right p-2">Comerciales</th>
                <th className="text-right p-2">Importación</th>
                <th className="text-right p-2">Total</th>
                <th className="p-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 && (
                <tr>
                  <td className="p-3 text-center text-gray-500" colSpan={6}>
                    Sin registros en este mes
                  </td>
                </tr>
              )}
              {invoices.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{fmtDateLocal(r.date)}</td>
                  <td className="p-2 text-right">{mxn(r.cartuchos)}</td>
                  <td className="p-2 text-right">{mxn(r.comerciales)}</td>
                  <td className="p-2 text-right">{mxn(r.importados)}</td>
                  <td className="p-2 text-right">{mxn(r.total)}</td>
                  <td className="p-2 text-right">
                    <button
                      className="text-blue-600 mr-3"
                      onClick={()=>editInvRow(r)}
                    >
                      Editar
                    </button>
                    <button
                      className="text-red-600"
                      onClick={()=>deleteInvRow(r.id)}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* DEPÓSITOS */}
      <section className="mb-8">
        <div className="text-sm font-medium mb-2">
          Depósitos (tarjetas, efectivo, anticipos sin factura)
        </div>
        <div className="flex flex-wrap items-end gap-2 mb-2">
          <label className="text-sm">Fecha
            <input
              type="date"
              className="ml-2 border rounded px-2 py-1"
              value={depDate}
              onChange={(e)=>setDepDate(e.target.value)}
            />
          </label>
          <label className="text-sm">Banco
            <select
              className="ml-2 border rounded px-2 py-1"
              value={depBank}
              onChange={(e)=>setDepBank(e.target.value as any)}
            >
              <option value="BBVA">BBVA</option>
              <option value="BANAMEX">BANAMEX</option>
            </select>
          </label>
          <label className="text-sm">Concepto
            <select
              className="ml-2 border rounded px-2 py-1"
              value={depConceptChoice}
              onChange={(e)=>setDepConceptChoice(e.target.value as any)}
            >
              <option value="TARJETAS">TARJETAS</option>
              <option value="EFECTIVO">EFECTIVO</option>
              <option value="ANTICIPO">ANTICIPO</option>
              <option value="OTRO">OTRO</option>
            </select>
          </label>
          {depConceptChoice === 'OTRO' && (
            <input
              placeholder="Especifica concepto"
              className="w-48 border rounded px-2 py-1"
              value={depConceptOther}
              onChange={(e)=>setDepConceptOther(e.target.value)}
            />
          )}
          <label className="text-sm">Importe
            <input
              className="ml-2 w-28 border rounded px-2 py-1 text-right"
              value={depAmount}
              onChange={(e)=>setDepAmount(parseNumFlexible(e.target.value))}
            />
          </label>
          <label className="text-sm">Notas
            <input
              className="ml-2 w-64 border rounded px-2 py-1"
              value={depNotes}
              onChange={(e)=>setDepNotes(e.target.value)}
            />
          </label>
          <button
            onClick={addDeposit}
            className="px-4 py-2 rounded bg-black text-white"
          >
            Agregar depósito
          </button>
        </div>

        <div className="border rounded overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2">Fecha</th>
                <th className="p-2">Banco</th>
                <th className="p-2">Concepto</th>
                <th className="text-right p-2">Importe</th>
                <th className="p-2">Notas</th>
                <th className="p-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {deposits.length === 0 && (
                <tr>
                  <td className="p-3 text-center text-gray-500" colSpan={6}>
                    Sin depósitos
                  </td>
                </tr>
              )}
              {deposits.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{fmtDateLocal(r.date)}</td>
                  <td className="p-2">{r.bank}</td>
                  <td className="p-2">{r.concept}</td>
                  <td className="p-2 text-right">{mxn(r.amount)}</td>
                  <td className="p-2">{r.notes}</td>
                  <td className="p-2 text-right">
                    <button
                      className="text-red-600"
                      onClick={()=>deleteDeposit(r.id)}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* PAGOS DE CLIENTE */}
      <section className="mb-8">
        <div className="text-sm font-medium mb-2">
          Pagos de clientes en bancos (con factura)
        </div>
        <div className="flex flex-wrap items-end gap-2 mb-2">
          <label className="text-sm">Fecha
            <input
              type="date"
              className="ml-2 border rounded px-2 py-1"
              value={cpDate}
              onChange={(e)=>setCpDate(e.target.value)}
            />
          </label>
          <label className="text-sm">Banco
            <select
              className="ml-2 border rounded px-2 py-1"
              value={cpBank}
              onChange={(e)=>setCpBank(e.target.value as any)}
            >
              <option value="BBVA">BBVA</option>
              <option value="BANAMEX">BANAMEX</option>
            </select>
          </label>
          <label className="text-sm">Cliente
            <input
              className="ml-2 w-40 border rounded px-2 py-1"
              value={cpClient}
              onChange={(e)=>setCpClient(e.target.value)}
            />
          </label>
          <label className="text-sm">Factura (opcional)
            <input
              className="ml-2 w-32 border rounded px-2 py-1"
              value={cpInvoice}
              onChange={(e)=>setCpInvoice(e.target.value)}
            />
          </label>
          <label className="text-sm">Importe
            <input
              className="ml-2 w-28 border rounded px-2 py-1 text-right"
              value={cpAmount}
              onChange={(e)=>setCpAmount(parseNumFlexible(e.target.value))}
            />
          </label>
          <label className="text-sm">Notas
            <input
              className="ml-2 w-64 border rounded px-2 py-1"
              value={cpNotes}
              onChange={(e)=>setCpNotes(e.target.value)}
            />
          </label>
          <button
            onClick={addClientPay}
            className="px-4 py-2 rounded bg-black text-white"
          >
            Agregar pago de cliente
          </button>
        </div>

        <div className="border rounded overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2">Fecha</th>
                <th className="p-2">Banco</th>
                <th className="p-2">Cliente</th>
                <th className="p-2">Factura</th>
                <th className="text-right p-2">Importe</th>
                <th className="p-2">Notas</th>
                <th className="p-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {clientPays.length === 0 && (
                <tr>
                  <td className="p-3 text-center text-gray-500" colSpan={7}>
                    Sin pagos de clientes
                  </td>
                </tr>
              )}
              {clientPays.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{fmtDateLocal(r.date)}</td>
                  <td className="p-2">{r.bank}</td>
                  <td className="p-2">{r.client}</td>
                  <td className="p-2">{r.invoice_ref ?? '—'}</td>
                  <td className="p-2 text-right">{mxn(r.amount)}</td>
                  <td className="p-2">{r.notes}</td>
                  <td className="p-2 text-right">
                    <button
                      className="text-red-600"
                      onClick={()=>deleteClientPay(r.id)}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* PENDIENTES */}
      <section className="mb-8">
        <div className="text-sm font-medium mb-2">
          Pagos pendientes de clientes (se restan del total de facturas)
        </div>
        <div className="flex flex-wrap items-end gap-2 mb-2">
          <label className="text-sm">Fecha
            <input
              type="date"
              className="ml-2 border rounded px-2 py-1"
              value={pdDate}
              onChange={(e)=>setPdDate(e.target.value)}
            />
          </label>
          <label className="text-sm">Cliente
            <input
              className="ml-2 w-48 border rounded px-2 py-1"
              value={pdClient}
              onChange={(e)=>setPdClient(e.target.value)}
            />
          </label>
          <label className="text-sm">Importe
            <input
              className="ml-2 w-28 border rounded px-2 py-1 text-right"
              value={pdAmount}
              onChange={(e)=>setPdAmount(parseNumFlexible(e.target.value))}
            />
          </label>
          <label className="text-sm">Notas
            <input
              className="ml-2 w-64 border rounded px-2 py-1"
              value={pdNotes}
              onChange={(e)=>setPdNotes(e.target.value)}
            />
          </label>
          <button
            onClick={addPending}
            className="px-4 py-2 rounded bg-black text-white"
          >
            Agregar pendiente
          </button>
        </div>

        <div className="border rounded overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2">Fecha</th>
                <th className="p-2">Cliente</th>
                <th className="text-right p-2">Importe</th>
                <th className="p-2">Notas</th>
                <th className="p-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pendings.length === 0 && (
                <tr>
                  <td className="p-3 text-center text-gray-500" colSpan={5}>
                    Sin pendientes
                  </td>
                </tr>
              )}
              {pendings.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{fmtDateLocal(r.date)}</td>
                  <td className="p-2">{r.client ?? '—'}</td>
                  <td className="p-2 text-right">{mxn(r.amount)}</td>
                  <td className="p-2">{r.notes}</td>
                  <td className="p-2 text-right">
                    <button
                      className="text-red-600"
                      onClick={()=>deletePending(r.id)}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* VALES */}
      <section className="mb-8">
        <div className="text-sm font-medium mb-2">Vales</div>
        <div className="flex flex-wrap items-end gap-2 mb-2">
          <label className="text-sm">Fecha
            <input
              type="date"
              className="ml-2 border rounded px-2 py-1"
              value={vcDate}
              onChange={(e)=>setVcDate(e.target.value)}
            />
          </label>
          <label className="text-sm">Concepto
            <input
              className="ml-2 w-56 border rounded px-2 py-1"
              value={vcConcept}
              onChange={(e)=>setVcConcept(e.target.value)}
            />
          </label>
          <label className="text-sm">Importe
            <input
              className="ml-2 w-28 border rounded px-2 py-1 text-right"
              value={vcAmount}
              onChange={(e)=>setVcAmount(parseNumFlexible(e.target.value))}
            />
          </label>
          <label className="text-sm">Notas
            <input
              className="ml-2 w-64 border rounded px-2 py-1"
              value={vcNotes}
              onChange={(e)=>setVcNotes(e.target.value)}
            />
          </label>
          <button
            onClick={addVoucher}
            className="px-4 py-2 rounded bg-black text-white"
          >
            Agregar vale
          </button>
        </div>

        <div className="border rounded overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2">Fecha</th>
                <th className="p-2">Concepto</th>
                <th className="text-right p-2">Importe</th>
                <th className="p-2">Notas</th>
                <th className="p-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {vouchers.length === 0 && (
                <tr>
                  <td className="p-3 text-center text-gray-500" colSpan={5}>
                    Sin vales
                  </td>
                </tr>
              )}
              {vouchers.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{fmtDateLocal(r.date)}</td>
                  <td className="p-2">{r.concept}</td>
                  <td className="p-2 text-right">{mxn(r.amount)}</td>
                  <td className="p-2">{r.notes}</td>
                  <td className="p-2 text-right">
                    <button
                      className="text-red-600"
                      onClick={()=>deleteVoucher(r.id)}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {msg && <div className="mt-2 text-sm">{msg}</div>}
    </div>
  );
}
