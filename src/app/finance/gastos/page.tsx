// src/app/finance/gastos/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

// ===== Tabla de gastos =====
const TABLE = 'finance_expenses';

// ===== Áreas/Categorías de gastos =====
const CATEGORIES = [
  { key: 'FIJOS_IVA',        label: 'GASTOS FIJOS CON IVA' },
  { key: 'VISA_IVA',         label: 'GASTOS CON IVA DE COMPRAS REALIZADAS CON LA TARJETA VISA NEGOCIOS' },
  { key: 'VAR_IVA',          label: 'GASTOS VARIABLES CON IVA' },
  { key: 'IMPORTACION',      label: 'GASTOS DE IMPORTACIÓN' },
  { key: 'VAR_SIN_IVA',      label: 'GASTOS VARIABLES SIN IVA' },
  { key: 'SIN_IVA',          label: 'COSAS SIN IVA' },
  { key: 'IMPUESTOS',        label: 'PAGO DE IMPUESTOS' },
  { key: 'IMPUESTOS_SIMPLE', label: 'IMPUESTOS' }, // ← NUEVA SECCIÓN SOLICITADA
  { key: 'IMSS_INFONAVIT',   label: 'PAGO DE IMSS / INFONAVIT' },
  { key: 'JALC',             label: 'JALC' },

  // ✅ NUEVA OPCIÓN SOLICITADA
  { key: 'ABONO_FONDO_BBVA_CREDITO', label: 'ABONO AL FONDO BBVA PARA CRÉDITO BBVA' },
] as const;

type CategoryKey = typeof CATEGORIES[number]['key'];

type Expense = {
  id: string;
  category: CategoryKey;
  exp_date: string;            // yyyy-mm-dd
  name: string;
  description: string | null;
  invoice_no: string | null;
  amount: number;
  paid_amount: number;
  paid_date: string | null;    // yyyy-mm-dd
  payment_code: string | null; // C/pago
  check_no: string | null;     // Cheque
  bank: 'BBVA' | 'BANAMEX' | null;
  drive_uploaded: boolean;
  notes: string | null;
  created_at: string;
};

const mxn = (n: number) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const toMonthInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function r2(n: any) { const v = Number(n); return Number.isFinite(v) ? +v.toFixed(2) : 0; }

/** Acepta 12.345,67 / 12,345.67 / 12345 / 123,45, etc. */
function parseMoneyInput(raw: string): number {
  if (raw == null) return 0;
  let s = String(raw).trim().replace(/\s+/g, '');
  const hasDot = s.includes('.'); const hasComma = s.includes(',');
  if (hasComma && !hasDot) s = s.replace(',', '.');
  else if (hasComma && hasDot) s = s.replace(/,/g, '');
  s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function monthRange(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1); // exclusivo
  return { start: toISO(start), end: toISO(end) };
}

// Evitar desfases por zona horaria al renderizar yyyy-mm-dd
const parseYMDLocal = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};
const fmtDateLocal = (ymd: string | null) =>
  (ymd ? parseYMDLocal(ymd).toLocaleDateString('es-MX') : '—');

export default function ExpensesPage() {
  // ===== Mes =====
  const [ym, setYm] = useState<string>(toMonthInput(new Date()));
  const { start, end } = useMemo(() => monthRange(ym), [ym]);

  // ===== Datos =====
  const [expMonth, setExpMonth]   = useState<Expense[]>([]);
  const [paidMonth, setPaidMonth] = useState<Expense[]>([]);
  const [msg, setMsg] = useState('');
  const [exporting, setExporting] = useState(false);

  async function reload() {
    setMsg('');
    const [qExp, qPaid] = await Promise.all([
      supabase.from(TABLE).select('*')
        .gte('exp_date', start).lt('exp_date', end)
        .order('exp_date', { ascending: true }),
      supabase.from(TABLE).select('*')
        .gte('paid_date', start).lt('paid_date', end)
        .order('paid_date', { ascending: true }),
    ]);
    if (qExp.error) {
      console.error(qExp.error);
      setMsg('❌ Error cargando gastos del mes: ' + qExp.error.message);
    } else {
      setExpMonth((qExp.data || []) as Expense[]);
    }
    if (qPaid.error) {
      console.error(qPaid.error);
      setMsg(m => (m ? m + ' · ' : '') + '❌ Error cargando pagados: ' + (qPaid.error?.message || ''));
    } else {
      setPaidMonth((qPaid.data || []) as Expense[]);
    }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [start, end]);

  // ===== Totales header (mes) =====
  const totals = useMemo(() => {
    const facturado = expMonth.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const pagado    = paidMonth.reduce((s, r) => s + (Number(r.paid_amount) || 0), 0);
    const pendiente = expMonth.reduce(
      (s, r) => s + Math.max((Number(r.amount)||0)-(Number(r.paid_amount)||0), 0),
      0
    );
    return { facturado, pagado, pendiente };
  }, [expMonth, paidMonth]);

  // ===== Agrupadores por categoría =====
  const byCat_pend = useMemo(() => {
    const map: Record<CategoryKey, Expense[]> = Object.create(null);
    CATEGORIES.forEach(c => (map[c.key as CategoryKey] = []));
    expMonth.forEach(e => {
      if ((e.amount||0) > (e.paid_amount||0)) map[e.category]?.push(e);
    });
    return map;
  }, [expMonth]);

  const byCat_paid = useMemo(() => {
    const map: Record<CategoryKey, Expense[]> = Object.create(null);
    CATEGORIES.forEach(c => (map[c.key as CategoryKey] = []));
    paidMonth.forEach(e => {
      if ((e.paid_amount||0) > 0) map[e.category]?.push(e);
    });
    return map;
  }, [paidMonth]);

  // ===== Formulario =====
  const [f, setF] = useState({
    category: 'FIJOS_IVA' as CategoryKey,
    exp_date: toISO(new Date()),
    name: '',
    description: '',
    invoice_no: '',
    amount: 0,
    amountText: '',
    payment_code: '',
    check_no: '',
    bank: '' as '' | 'BBVA' | 'BANAMEX',
    notes: '',
    drive_uploaded: false,
    markPaid: false,
    paid_date: '' as string | '',
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  function resetForm() {
    setF({
      category: 'FIJOS_IVA',
      exp_date: toISO(new Date()),
      name: '',
      description: '',
      invoice_no: '',
      amount: 0,
      amountText: '',
      payment_code: '',
      check_no: '',
      bank: '',
      notes: '',
      drive_uploaded: false,
      markPaid: false,
      paid_date: '',
    });
    setEditingId(null);
  }

  async function saveExpense() {
    try {
      setMsg('');
      if (!f.name.trim()) throw new Error('Falta el nombre/proveedor');
      if (!f.exp_date) throw new Error('Falta la fecha del gasto');

      const amountParsed = r2(f.amountText !== '' ? parseMoneyInput(f.amountText) : f.amount);
      const isPaid = !!f.markPaid;
      const chosenPaidDate = isPaid ? (f.paid_date || toISO(new Date())) : null;

      const payload = {
        category: f.category,
        exp_date: f.exp_date,
        name: f.name.trim(),
        description: f.description?.trim() || null,
        invoice_no: f.invoice_no?.trim() || null,
        amount: amountParsed,
        paid_amount: isPaid ? amountParsed : 0,
        paid_date: chosenPaidDate,
        payment_code: f.payment_code?.trim() || null,
        check_no: f.check_no?.trim() || null,
        bank: f.bank || null,
        notes: f.notes?.trim() || null,
        drive_uploaded: !!f.drive_uploaded,
      };

      if (editingId) {
        const { error } = await supabase.from(TABLE).update(payload).eq('id', editingId);
        if (error) throw error;
        setMsg('✅ Gasto actualizado.');
      } else {
        const { error } = await supabase.from(TABLE).insert(payload);
        if (error) throw error;
        setMsg('✅ Gasto agregado.');
      }
      resetForm();
      await reload();
    } catch (e: any) {
      console.error(e);
      setMsg('❌ No se pudo guardar: ' + (e?.message ?? e));
    }
  }

  function editRow(e: Expense) {
    setEditingId(e.id);
    const alreadyPaid = (e.paid_amount || 0) >= (e.amount || 0);
    setF({
      category: e.category,
      exp_date: e.exp_date,
      name: e.name,
      description: e.description || '',
      invoice_no: e.invoice_no || '',
      amount: e.amount || 0,
      amountText: (e.amount ?? 0).toFixed(2),
      payment_code: e.payment_code || '',
      check_no: e.check_no || '',
      bank: (e.bank || '') as any,
      notes: e.notes || '',
      drive_uploaded: !!e.drive_uploaded,
      markPaid: alreadyPaid,
      paid_date: e.paid_date || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function delRow(id: string) {
    if (!confirm('¿Eliminar gasto?')) return;
    try {
      const { error } = await supabase.from(TABLE).delete().eq('id', id);
      if (error) throw error;
      setMsg('🗑️ Eliminado.');
      await reload();
    } catch (e: any) {
      console.error(e);
      setMsg('❌ No se pudo eliminar: ' + (e?.message ?? e));
    }
  }

  async function toggleDrive(e: Expense) {
    try {
      const { error } = await supabase.from(TABLE).update({ drive_uploaded: !e.drive_uploaded }).eq('id', e.id);
      if (error) throw error;
      await reload();
    } catch (err) {
      console.error(err);
      setMsg('❌ No se pudo actualizar “Subido a Drive”.');
    }
  }

  // ===== Pagos inline =====
  const [payDateMap, setPayDateMap] = useState<Record<string, string>>({});
  const [paidDateMap, setPaidDateMap] = useState<Record<string, string>>({});
  useEffect(() => {
    const today = toISO(new Date());
    const np = { ...payDateMap }, nd = { ...paidDateMap };
    Object.values(byCat_pend).flat().forEach(e => { if (!np[e.id]) np[e.id] = today; });
    Object.values(byCat_paid).flat().forEach(e => { if (!nd[e.id]) nd[e.id] = e.paid_date || today; });
    setPayDateMap(np); setPaidDateMap(nd);
  }, [expMonth, paidMonth]); // eslint-disable-line

  const setRowPayDate  = (id: string, v: string) => setPayDateMap(m => ({ ...m, [id]: v }));
  const setRowPaidDate = (id: string, v: string) => setPaidDateMap(m => ({ ...m, [id]: v }));

  async function markPaid(e: Expense) {
    try {
      const date = payDateMap[e.id] || toISO(new Date());
      const { error } = await supabase.from(TABLE).update({ paid_amount: r2(e.amount), paid_date: date }).eq('id', e.id);
      if (error) throw error;
      setMsg('✅ Pago registrado.');
      await reload();
    } catch (err) { console.error(err); setMsg('❌ No se pudo registrar el pago.'); }
  }

  async function updatePaidDate(e: Expense) {
    try {
      const date = paidDateMap[e.id] || e.paid_date || toISO(new Date());
      const { error } = await supabase.from(TABLE).update({ paid_date: date }).eq('id', e.id);
      if (error) throw error;
      setMsg('✅ Fecha de pago actualizada.');
      await reload();
    } catch (err) { console.error(err); setMsg('❌ No se pudo actualizar la fecha de pago.'); }
  }

  async function unsetPaid(e: Expense) {
    try {
      const { error } = await supabase.from(TABLE).update({ paid_amount: 0, paid_date: null }).eq('id', e.id);
      if (error) throw error;
      setMsg('↩️ Pago quitado.');
      await reload();
    } catch (err) { console.error(err); setMsg('❌ No se pudo quitar el pago.'); }
  }

  // ===== Exportar =====
  async function exportToExcel() {
    try {
      setExporting(true);
      const ExcelJS = await import('exceljs');
      const wb = new ExcelJS.Workbook();

      const headerStyle = {
        font: { bold: true, size: 11 },
        alignment: { vertical: 'middle' as const, horizontal: 'center' as const },
        fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFEFEFF0' } },
        border: { top: { style: 'thin' as const }, left: { style: 'thin' as const }, bottom: { style: 'thin' as const }, right: { style: 'thin' as const } }
      };
      const currencyFmt = '$#,##0.00'; const dateFmt = 'dd/mm/yyyy';

      // Resumen general
      const ws0 = wb.addWorksheet('Resumen');
      ws0.columns = [{ header: 'Concepto', key: 'k', width: 40 }, { header: 'Monto', key: 'v', width: 18 }];
      ws0.getRow(1).eachCell(c => Object.assign(c, headerStyle));
      ws0.addRow({ k: 'Facturado en el mes (por fecha del gasto)', v: totals.facturado });
      ws0.addRow({ k: 'Pagado en el mes (por fecha de pago)', v: totals.pagado });
      ws0.addRow({ k: 'Pendiente en el mes', v: totals.pendiente });
      ws0.getColumn('v').numFmt = currencyFmt;

      // Una hoja por categoría (pendientes y pagados)
      for (const cat of CATEGORIES) {
        const pend = byCat_pend[cat.key as CategoryKey] || [];
        const pagos = byCat_paid[cat.key as CategoryKey] || [];

        const wsPend = wb.addWorksheet(`${cat.label.substring(0, 28)} (Pend.)`);
        wsPend.columns = [
          { header: 'Fecha gasto', key: 'exp_date', width: 12 },
          { header: 'Nombre', key: 'name', width: 36 },
          { header: 'Descripción', key: 'description', width: 28 },
          { header: 'Factura', key: 'invoice_no', width: 14 },
          { header: 'Importe', key: 'amount', width: 14 },
          { header: 'Pagado', key: 'paid_amount', width: 14 },
          { header: 'Saldo', key: 'saldo', width: 14 },
          { header: 'C/pago', key: 'payment_code', width: 12 },
          { header: 'Cheque', key: 'check_no', width: 14 },
          { header: 'Banco', key: 'bank', width: 12 },
          { header: 'Drive', key: 'drive', width: 8 },
          { header: 'Notas', key: 'notes', width: 24 },
        ];
        wsPend.getRow(1).eachCell(c => Object.assign(c, headerStyle));
        pend.forEach(e => {
          const saldo = (e.amount||0) - (e.paid_amount||0);
          wsPend.addRow({
            exp_date: parseYMDLocal(e.exp_date),
            name: e.name,
            description: e.description || '',
            invoice_no: e.invoice_no || '',
            amount: e.amount,
            paid_amount: e.paid_amount || 0,
            saldo,
            payment_code: e.payment_code || '',
            check_no: e.check_no || '',
            bank: e.bank || '',
            drive: e.drive_uploaded ? 'Sí' : 'No',
            notes: e.notes || '',
          });
        });
        wsPend.getColumn('exp_date').numFmt = dateFmt;
        ['amount','paid_amount','saldo'].forEach(k => (wsPend.getColumn(k as any).numFmt = currencyFmt));

        const wsPaid = wb.addWorksheet(`${cat.label.substring(0, 28)} (Pag.)`);
        wsPaid.columns = [
          { header: 'Fecha gasto', key: 'exp_date', width: 12 },
          { header: 'Nombre', key: 'name', width: 36 },
          { header: 'Descripción', key: 'description', width: 28 },
          { header: 'Factura', key: 'invoice_no', width: 14 },
          { header: 'Importe', key: 'amount', width: 14 },
          { header: 'Pagado', key: 'paid_amount', width: 14 },
          { header: 'Fecha pago', key: 'paid_date', width: 12 },
          { header: 'C/pago', key: 'payment_code', width: 12 },
          { header: 'Cheque', key: 'check_no', width: 14 },
          { header: 'Banco', key: 'bank', width: 12 },
          { header: 'Drive', key: 'drive', width: 8 },
          { header: 'Notas', key: 'notes', width: 24 },
        ];
        wsPaid.getRow(1).eachCell(c => Object.assign(c, headerStyle));
        pagos.forEach(e => {
          wsPaid.addRow({
            exp_date: parseYMDLocal(e.exp_date),
            name: e.name, description: e.description || '', invoice_no: e.invoice_no || '',
            amount: e.amount, paid_amount: e.paid_amount || 0,
            paid_date: e.paid_date ? parseYMDLocal(e.paid_date) : '',
            payment_code: e.payment_code || '', check_no: e.check_no || '', bank: e.bank || '',
            drive: e.drive_uploaded ? 'Sí' : 'No', notes: e.notes || '',
          });
        });
        wsPaid.getColumn('exp_date').numFmt = dateFmt;
        wsPaid.getColumn('paid_date').numFmt = dateFmt;
        ['amount','paid_amount'].forEach(k => (wsPaid.getColumn(k as any).numFmt = currencyFmt));
      }

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Gastos_${ym}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      setMsg('📄 Excel exportado.');
    } catch (e) {
      console.error(e);
      setMsg('❌ No se pudo exportar.');
    } finally { setExporting(false); }
  }

  // ====== Render helpers: sección por categoría ======
  function CategorySection({ cat }: { cat: typeof CATEGORIES[number] }) {
    const pendientes = byCat_pend[cat.key as CategoryKey] || [];
    const pagados    = byCat_paid[cat.key as CategoryKey] || [];

    const totalPend = pendientes.reduce((s, e) => s + Math.max((e.amount||0)-(e.paid_amount||0), 0), 0);
    const totalPag  = pagados.reduce((s, e) => s + (e.paid_amount||0), 0);

    return (
      <section className="mb-10">
        <div className="mb-2 flex items-end gap-3">
          <h2 className="text-sm font-semibold">{cat.label}</h2>
          <div className="ml-auto flex gap-2 text-sm">
            <div className="border rounded p-2">
              <div className="text-xs text-gray-500">Pagado (mes)</div>
              <div className="font-medium">{mxn(totalPag)}</div>
            </div>
            <div className="border rounded p-2">
              <div className="text-xs text-gray-500">Pendiente (mes)</div>
              <div className="font-medium">{mxn(totalPend)}</div>
            </div>
          </div>
        </div>

        {/* PENDIENTES */}
        <div className="border rounded mb-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 text-left">Fecha</th>
                <th className="p-2 text-left">Nombre</th>
                <th className="p-2 text-left">Descripción</th>
                <th className="p-2">Factura</th>
                <th className="p-2 text-right">Importe</th>
                <th className="p-2 text-right">Pagado</th>
                <th className="p-2 text-right">Saldo</th>
                <th className="p-2">C/pago</th>
                <th className="p-2">Cheque</th>
                <th className="p-2">Banco</th>
                <th className="p-2">Fecha pago</th>
                <th className="p-2">Drive</th>
                <th className="p-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pendientes.length === 0 && (
                <tr><td className="p-3 text-center text-gray-500" colSpan={13}>Sin pendientes</td></tr>
              )}
              {pendientes.map(e => {
                const saldo = (e.amount||0) - (e.paid_amount||0);
                return (
                  <tr key={e.id} className="border-t">
                    <td className="p-2">{fmtDateLocal(e.exp_date)}</td>
                    <td className="p-2">{e.name}</td>
                    <td className="p-2">{e.description || '—'}</td>
                    <td className="p-2 text-center">{e.invoice_no || '—'}</td>
                    <td className="p-2 text-right">{mxn(e.amount)}</td>
                    <td className="p-2 text-right">{mxn(e.paid_amount || 0)}</td>
                    <td className="p-2 text-right">{mxn(saldo)}</td>
                    <td className="p-2">{e.payment_code || '—'}</td>
                    <td className="p-2">{e.check_no || '—'}</td>
                    <td className="p-2">{e.bank || '—'}</td>
                    <td className="p-2">
                      <input
                        type="date"
                        className="border rounded px-2 py-1"
                        value={payDateMap[e.id] || toISO(new Date())}
                        onChange={(ev)=>setRowPayDate(e.id, ev.target.value)}
                      />
                    </td>
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={!!e.drive_uploaded}
                        onChange={()=>toggleDrive(e)}
                      />
                    </td>
                    <td className="p-2 text-right whitespace-nowrap">
                      <button className="text-emerald-700 mr-3" onClick={()=>markPaid(e)}>Pagar</button>
                      <button className="text-blue-600 mr-3" onClick={()=>editRow(e)}>Editar</button>
                      <button className="text-red-600" onClick={()=>delRow(e.id)}>Eliminar</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* PAGADOS */}
        <div className="border rounded overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 text-left">Fecha</th>
                <th className="p-2 text-left">Nombre</th>
                <th className="p-2 text-left">Descripción</th>
                <th className="p-2">Factura</th>
                <th className="p-2 text-right">Importe</th>
                <th className="p-2 text-right">Pagado</th>
                <th className="p-2">Fecha pago</th>
                <th className="p-2">C/pago</th>
                <th className="p-2">Cheque</th>
                <th className="p-2">Banco</th>
                <th className="p-2">Drive</th>
                <th className="p-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pagados.length === 0 && (
                <tr><td className="p-3 text-center text-gray-500" colSpan={12}>Sin pagados</td></tr>
              )}
              {pagados.map(e => (
                <tr key={e.id} className="border-t">
                  <td className="p-2">{fmtDateLocal(e.exp_date)}</td>
                  <td className="p-2">{e.name}</td>
                  <td className="p-2">{e.description || '—'}</td>
                  <td className="p-2 text-center">{e.invoice_no || '—'}</td>
                  <td className="p-2 text-right">{mxn(e.amount)}</td>
                  <td className="p-2 text-right">{mxn(e.paid_amount || 0)}</td>
                  <td className="p-2">
                    <input
                      type="date"
                      className="border rounded px-2 py-1"
                      value={paidDateMap[e.id] || e.paid_date || ''}
                      onChange={(ev)=>setRowPaidDate(e.id, ev.target.value)}
                    />
                  </td>
                  <td className="p-2">{e.payment_code || '—'}</td>
                  <td className="p-2">{e.check_no || '—'}</td>
                  <td className="p-2">{e.bank || '—'}</td>
                  <td className="p-2 text-center">
                    <input
                      type="checkbox"
                      checked={!!e.drive_uploaded}
                      onChange={()=>toggleDrive(e)}
                    />
                  </td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <button className="text-emerald-700 mr-3" onClick={()=>updatePaidDate(e)}>Actualizar</button>
                    <button className="text-amber-700 mr-3" onClick={()=>unsetPaid(e)}>Quitar pago</button>
                    <button className="text-blue-600 mr-3" onClick={()=>editRow(e)}>Editar</button>
                    <button className="text-red-600" onClick={()=>delRow(e.id)}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  // ================== UI ==================
  return (
    <div className="max-w-7xl mx-auto p-6">
      <h1 className="text-xl font-bold mb-4">Finanzas — Gastos</h1>

      {/* Mes + Resumen + Export */}
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <label className="text-sm">Mes
          <input
            type="month"
            className="ml-2 border rounded px-2 py-1"
            value={ym}
            onChange={(e)=>setYm(e.target.value)}
          />
        </label>
        <span className="text-xs text-gray-500">
          Rango: {new Date(start).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}
        </span>
        <div className="ml-auto flex gap-2">
          <div className="border rounded p-2 text-sm">
            <div className="text-xs text-gray-500">Facturado (mes)</div>
            <div className="font-semibold">{mxn(totals.facturado)}</div>
          </div>
          <div className="border rounded p-2 text-sm">
            <div className="text-xs text-gray-500">Pagado (mes)</div>
            <div className="font-semibold">{mxn(totals.pagado)}</div>
          </div>
          <div className="border rounded p-2 text-sm">
            <div className="text-xs text-gray-500">Pendiente (mes)</div>
            <div className="font-semibold">{mxn(totals.pendiente)}</div>
          </div>
          <button
            onClick={exportToExcel}
            disabled={exporting}
            className={`px-4 py-2 rounded ${exporting ? 'bg-gray-400' : 'bg-emerald-600 hover:bg-emerald-700'} text-white`}
          >
            {exporting ? 'Exportando…' : 'Exportar a Excel'}
          </button>
        </div>
      </div>

      {/* Captura / edición */}
      <section className="mb-10">
        <div className="text-sm font-medium mb-2">Captura / Edición</div>
        <div className="grid grid-cols-1 lg:grid-cols-6 gap-2 items-end">
          <label className="text-sm">Área / Categoría
            <select
              className="mt-1 w-full border rounded px-2 py-1"
              value={f.category}
              onChange={e=>setF({...f, category: e.target.value as CategoryKey})}
            >
              {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <label className="text-sm">Fecha gasto
            <input
              type="date"
              className="mt-1 w-full border rounded px-2 py-1"
              value={f.exp_date}
              onChange={e=>setF({...f, exp_date: e.target.value})}
            />
          </label>
          <label className="text-sm lg:col-span-2">Nombre (proveedor)
            <input
              className="mt-1 w-full border rounded px-2 py-1"
              value={f.name}
              onChange={e=>setF({...f, name: e.target.value})}
            />
          </label>
          <label className="text-sm lg:col-span-2">Descripción
            <input
              className="mt-1 w-full border rounded px-2 py-1"
              value={f.description}
              onChange={e=>setF({...f, description: e.target.value})}
            />
          </label>
          <label className="text-sm">Factura
            <input
              className="mt-1 w-full border rounded px-2 py-1"
              value={f.invoice_no}
              onChange={e=>setF({...f, invoice_no: e.target.value})}
            />
          </label>
          <label className="text-sm">Importe
            <input
              type="text" inputMode="decimal" pattern="[0-9]*[.,]?[0-9]*"
              className="mt-1 w-full border rounded px-2 py-1 text-right"
              value={f.amountText}
              onChange={(e)=>setF({...f, amountText: e.target.value})}
              onBlur={(e)=>setF({...f, amount: r2(parseMoneyInput(e.target.value))})}
              placeholder="0.00"
            />
          </label>
          <label className="text-sm">C/pago
            <input
              className="mt-1 w-full border rounded px-2 py-1"
              value={f.payment_code}
              onChange={e=>setF({...f, payment_code: e.target.value})}
            />
          </label>
          <label className="text-sm">Cheque
            <input
              className="mt-1 w-full border rounded px-2 py-1"
              value={f.check_no}
              onChange={e=>setF({...f, check_no: e.target.value})}
            />
          </label>
          <label className="text-sm">Banco
            <select
              className="mt-1 w-full border rounded px-2 py-1"
              value={f.bank}
              onChange={e=>setF({...f, bank: e.target.value as any})}
            >
              <option value="">—</option>
              <option value="BBVA">BBVA</option>
              <option value="BANAMEX">BANAMEX</option>
            </select>
          </label>
          {/* Pago al registrar */}
          <label className="text-sm flex items-center gap-2">
            <span>Pagado</span>
            <input
              type="checkbox" className="mt-1 h-5 w-5" checked={f.markPaid}
              onChange={(e)=>{
                const v = e.target.checked;
                setF(s=>({ ...s, markPaid: v, paid_date: v ? (s.paid_date || toISO(new Date())) : '' }));
              }}
            />
          </label>
          <label className="text-sm">Fecha pago
            <input type="date" disabled={!f.markPaid}
              className="mt-1 w-full border rounded px-2 py-1"
              value={f.paid_date} onChange={(e)=>setF({...f, paid_date: e.target.value})} />
          </label>
          <label className="text-sm lg:col-span-2">Notas
            <input className="mt-1 w-full border rounded px-2 py-1"
              value={f.notes} onChange={e=>setF({...f, notes: e.target.value})} />
          </label>
          <label className="text-sm flex items-center gap-2">
            <span>Subido a Drive</span>
            <input type="checkbox" className="mt-1 h-5 w-5"
              checked={f.drive_uploaded} onChange={(e)=>setF({...f, drive_uploaded: e.target.checked})} />
          </label>
          <div className="lg:col-span-6 flex gap-2">
            <button onClick={saveExpense} className="px-4 py-2 rounded bg-black text-white">
              {editingId ? 'Guardar cambios' : 'Agregar'}
            </button>
            {editingId && (
              <button onClick={resetForm} className="px-3 py-2 rounded border">Cancelar</button>
            )}
            <button onClick={resetForm} className="px-3 py-2 rounded border">Borrar</button>
          </div>
        </div>
      </section>

      {/* Secciones por categoría */}
      {CATEGORIES.map(cat => (
        <CategorySection key={cat.key} cat={cat} />
      ))}

      {msg && <div className="mt-2 text-sm">{msg}</div>}
    </div>
  );
}
