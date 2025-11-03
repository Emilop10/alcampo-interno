'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

const TABLE = 'finance_supplier_bills';

type Bill = {
  id: string;
  supplier: string;
  mp: string | null;
  payment_code: string | null;
  check_no: string | null;
  bank: 'BBVA' | 'BANAMEX' | null;
  invoice_date: string;        // yyyy-mm-dd
  invoice_no: string | null;
  amount: number;
  paid_amount: number;
  paid_date: string | null;    // yyyy-mm-dd
  notes: string | null;
  drive_uploaded: boolean;
  created_at: string;
};

const mxn = (n: number) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const toMonthInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function r2(n: any) { const v = Number(n); return Number.isFinite(v) ? +v.toFixed(2) : 0; }

/** Acepta 123.45, 12,345.67, 12345, 12 345.67 y 123,45 (coma decimal) */
function parseMoneyInput(raw: string): number {
  if (raw == null) return 0;
  let s = String(raw).trim().replace(/\s+/g, '');
  const hasDot = s.includes('.'); const hasComma = s.includes(',');
  if (hasComma && !hasDot) s = s.replace(',', '.');      // coma decimal
  else if (hasComma && hasDot) s = s.replace(/,/g, '');  // comas como miles
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

// Evita el desfase de 1 día al formatear
const parseYMDLocal = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};
const fmtDateLocal = (ymd: string | null) =>
  (ymd ? parseYMDLocal(ymd).toLocaleDateString('es-MX') : '—');

export default function SuppliersPage() {
  // ------- mes -------
  const [ym, setYm] = useState<string>(toMonthInput(new Date()));
  const { start, end } = useMemo(() => monthRange(ym), [ym]);

  // ------- datos (por mes de factura y por mes de pago) -------
  const [invMonthBills, setInvMonthBills] = useState<Bill[]>([]);
  const [paidMonthBills, setPaidMonthBills] = useState<Bill[]>([]);
  const [msg, setMsg] = useState('');
  const [exporting, setExporting] = useState(false);

  async function reload() {
    setMsg('');
    const [qInv, qPaid] = await Promise.all([
      supabase.from(TABLE).select('*').gte('invoice_date', start).lt('invoice_date', end).order('invoice_date', { ascending: true }),
      supabase.from(TABLE).select('*').gte('paid_date', start).lt('paid_date', end).order('paid_date', { ascending: true }),
    ]);
    if (qInv.error) { console.error(qInv.error); setMsg('❌ Error cargando facturas del mes: ' + qInv.error.message); }
    else { setInvMonthBills((qInv.data || []) as Bill[]); }
    if (qPaid.error) { console.error(qPaid.error); setMsg(m => (m ? m + ' · ' : '') + '❌ Error cargando pagados del mes: ' + (qPaid.error?.message || '')); }
    else { setPaidMonthBills((qPaid.data || []) as Bill[]); }
  }
  useEffect(() => { reload(); /* eslint-disable-line */ }, [start, end]);

  // ------- totales -------
  const totals = useMemo(() => {
    const importe = invMonthBills.reduce((s, r) => s + (Number(r.amount) || 0), 0);           // por fecha de factura
    const pagado  = paidMonthBills.reduce((s, r) => s + (Number(r.paid_amount) || 0), 0);     // por fecha de pago
    const pendiente = invMonthBills.reduce((s, r) => s + Math.max((Number(r.amount)||0)-(Number(r.paid_amount)||0), 0), 0);
    return { importe, pagado, pendiente };
  }, [invMonthBills, paidMonthBills]);

  const pendientes = useMemo(() => invMonthBills.filter(b => (b.amount || 0) > (b.paid_amount || 0)), [invMonthBills]);
  const pagados = useMemo(() => paidMonthBills.filter(b => (b.paid_amount || 0) > 0), [paidMonthBills]);

  // ------- captura -------
  const [f, setF] = useState({
    invoice_date: toISO(new Date()),
    supplier: '',
    mp: 'PPD',
    payment_code: '',
    check_no: '',
    bank: '' as '' | 'BBVA' | 'BANAMEX',
    invoice_no: '',
    amount: 0,
    amountText: '',
    notes: '',
    drive_uploaded: false,
    // pago al registrar
    markPaid: false,
    paid_date: '' as string | '',
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  function resetForm() {
    setF({
      invoice_date: toISO(new Date()),
      supplier: '',
      mp: 'PPD',
      payment_code: '',
      check_no: '',
      bank: '',
      invoice_no: '',
      amount: 0,
      amountText: '',
      notes: '',
      drive_uploaded: false,
      markPaid: false,
      paid_date: '',
    });
    setEditingId(null);
  }

  async function saveBill() {
    try {
      setMsg('');
      if (!f.supplier.trim()) throw new Error('Falta el proveedor');
      if (!f.invoice_date) throw new Error('Falta la fecha de factura');

      const amountParsed = r2(f.amountText !== '' ? parseMoneyInput(f.amountText) : f.amount);
      const isPaid = !!f.markPaid;
      const chosenPaidDate = isPaid ? (f.paid_date || toISO(new Date())) : null;

      const payload = {
        supplier: f.supplier.trim(),
        mp: f.mp?.trim() || null,
        payment_code: f.payment_code?.trim() || null,
        check_no: f.check_no?.trim() || null,
        bank: f.bank || null,
        invoice_date: f.invoice_date,
        invoice_no: f.invoice_no?.trim() || null,
        amount: amountParsed,
        notes: f.notes?.trim() || null,
        drive_uploaded: !!f.drive_uploaded,
        paid_amount: isPaid ? amountParsed : 0,
        paid_date: chosenPaidDate,
      };

      if (editingId) {
        const { error } = await supabase.from(TABLE).update(payload).eq('id', editingId);
        if (error) throw error;
        setMsg('✅ Registro actualizado.');
      } else {
        const { error } = await supabase.from(TABLE).insert(payload);
        if (error) throw error;
        setMsg('✅ Registro agregado.');
      }
      resetForm(); await reload();
    } catch (e: any) {
      console.error(e);
      setMsg('❌ No se pudo guardar: ' + (e?.message ?? e));
    }
  }

  function editRow(b: Bill) {
    setEditingId(b.id);
    const alreadyPaid = (b.paid_amount || 0) >= (b.amount || 0);
    setF({
      invoice_date: b.invoice_date,
      supplier: b.supplier,
      mp: b.mp || '',
      payment_code: b.payment_code || '',
      check_no: b.check_no || '',
      bank: (b.bank || '') as any,
      invoice_no: b.invoice_no || '',
      amount: b.amount || 0,
      amountText: (b.amount ?? 0).toFixed(2),
      notes: b.notes || '',
      drive_uploaded: !!b.drive_uploaded,
      markPaid: alreadyPaid,
      paid_date: b.paid_date || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function delRow(id: string) {
    if (!confirm('¿Eliminar registro?')) return;
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

  async function toggleDrive(b: Bill) {
    try {
      const { error } = await supabase.from(TABLE).update({ drive_uploaded: !b.drive_uploaded }).eq('id', b.id);
      if (error) throw error;
      await reload();
    } catch (e: any) {
      console.error(e);
      setMsg('❌ No se pudo actualizar “Subido a Drive”.');
    }
  }

  // ======== Pagos inline ========
  const [payDateMap, setPayDateMap] = useState<Record<string, string>>({});
  const [paidDateMap, setPaidDateMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const today = toISO(new Date());
    const newPay: Record<string, string> = { ...payDateMap };
    const newPaid: Record<string, string> = { ...paidDateMap };
    pendientes.forEach(b => { if (!newPay[b.id]) newPay[b.id] = today; });
    pagados.forEach(b => { if (!newPaid[b.id]) newPaid[b.id] = b.paid_date || today; });
    setPayDateMap(newPay);
    setPaidDateMap(newPaid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invMonthBills, paidMonthBills]);

  const setRowPayDate  = (id: string, v: string) => setPayDateMap(m => ({ ...m, [id]: v }));
  const setRowPaidDate = (id: string, v: string) => setPaidDateMap(m => ({ ...m, [id]: v }));

  async function markPaid(b: Bill) {
    try {
      const date = payDateMap[b.id] || toISO(new Date());
      const { error } = await supabase
        .from(TABLE)
        .update({ paid_amount: r2(b.amount), paid_date: date })
        .eq('id', b.id);
      if (error) throw error;
      setMsg('✅ Pago registrado.');
      await reload();
    } catch (e: any) {
      console.error(e);
      setMsg('❌ No se pudo registrar el pago.');
    }
  }

  async function updatePaidDate(b: Bill) {
    try {
      const date = paidDateMap[b.id] || b.paid_date || toISO(new Date());
      const { error } = await supabase
        .from(TABLE)
        .update({ paid_date: date })
        .eq('id', b.id);
      if (error) throw error;
      setMsg('✅ Fecha de pago actualizada.');
      await reload();
    } catch (e: any) {
      console.error(e);
      setMsg('❌ No se pudo actualizar la fecha de pago.');
    }
  }

  async function unsetPaid(b: Bill) {
    try {
      const { error } = await supabase
        .from(TABLE)
        .update({ paid_amount: 0, paid_date: null })
        .eq('id', b.id);
      if (error) throw error;
      setMsg('↩️ Pago quitado (vuelto a pendiente).');
      await reload();
    } catch (e: any) {
      console.error(e);
      setMsg('❌ No se pudo quitar el pago.');
    }
  }

  // ------- exportar -------
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
      const currencyFmt = '$#,##0.00';
      const dateFmt = 'dd/mm/yyyy';

      // Resumen
      const ws0 = wb.addWorksheet('Resumen');
      ws0.columns = [{ header: 'Concepto', key: 'k', width: 32 }, { header: 'Monto', key: 'v', width: 18 }];
      ws0.getRow(1).eachCell(c => Object.assign(c, headerStyle));
      ws0.addRow({ k: 'Facturado en el mes (por fecha fac)', v: totals.importe });
      ws0.addRow({ k: 'Pagado en el mes (por fecha pago)', v: totals.pagado });
      ws0.addRow({ k: 'Pendiente del mes (no liquidado)', v: totals.pendiente });
      ws0.getColumn('v').numFmt = currencyFmt;

      // Pendientes (fecha de factura)
      const ws1 = wb.addWorksheet('Pendientes (factura)');
      ws1.columns = [
        { header: 'Fecha fac', key: 'invoice_date', width: 12 },
        { header: 'Proveedor', key: 'supplier', width: 36 },
        { header: 'MP', key: 'mp', width: 10 },
        { header: 'Factura', key: 'invoice_no', width: 14 },
        { header: 'Importe', key: 'amount', width: 14 },
        { header: 'Pagado', key: 'paid_amount', width: 14 },
        { header: 'Saldo', key: 'saldo', width: 14 },
        { header: 'C/pago', key: 'payment_code', width: 12 },
        { header: 'Cheque', key: 'check_no', width: 14 },
        { header: 'Banco', key: 'bank', width: 12 },
        { header: 'Drive', key: 'drive_uploaded', width: 10 },
        { header: 'Notas', key: 'notes', width: 24 },
      ];
      ws1.getRow(1).eachCell(c => Object.assign(c, headerStyle));
      pendientes.forEach(b => {
        const saldo = (b.amount || 0) - (b.paid_amount || 0);
        ws1.addRow({
          invoice_date: parseYMDLocal(b.invoice_date),
          supplier: b.supplier, mp: b.mp || '', invoice_no: b.invoice_no || '',
          amount: b.amount, paid_amount: b.paid_amount || 0, saldo,
          payment_code: b.payment_code || '', check_no: b.check_no || '', bank: b.bank || '',
          drive_uploaded: b.drive_uploaded ? 'Sí' : 'No', notes: b.notes || '',
        });
      });
      ws1.getColumn('invoice_date').numFmt = dateFmt;
      ['amount','paid_amount','saldo'].forEach(k => (ws1.getColumn(k).numFmt = currencyFmt));

      // Pagados (fecha de pago)
      const ws2 = wb.addWorksheet('Pagados (pago)');
      ws2.columns = [
        { header: 'Fecha fac', key: 'invoice_date', width: 12 },
        { header: 'Proveedor', key: 'supplier', width: 36 },
        { header: 'MP', key: 'mp', width: 10 },
        { header: 'Factura', key: 'invoice_no', width: 14 },
        { header: 'Importe', key: 'amount', width: 14 },
        { header: 'Pagado', key: 'paid_amount', width: 14 },
        { header: 'Fecha pago', key: 'paid_date', width: 12 },
        { header: 'C/pago', key: 'payment_code', width: 12 },
        { header: 'Cheque', key: 'check_no', width: 14 },
        { header: 'Banco', key: 'bank', width: 12 },
        { header: 'Drive', key: 'drive_uploaded', width: 10 },
        { header: 'Notas', key: 'notes', width: 24 },
      ];
      ws2.getRow(1).eachCell(c => Object.assign(c, headerStyle));
      pagados.forEach(b => {
        ws2.addRow({
          invoice_date: parseYMDLocal(b.invoice_date),
          supplier: b.supplier, mp: b.mp || '', invoice_no: b.invoice_no || '',
          amount: b.amount, paid_amount: b.paid_amount || 0,
          paid_date: b.paid_date ? parseYMDLocal(b.paid_date) : '',
          payment_code: b.payment_code || '', check_no: b.check_no || '', bank: b.bank || '',
          drive_uploaded: b.drive_uploaded ? 'Sí' : 'No', notes: b.notes || '',
        });
      });
      ws2.getColumn('invoice_date').numFmt = dateFmt;
      ws2.getColumn('paid_date').numFmt = dateFmt;
      ['amount','paid_amount'].forEach(k => (ws2.getColumn(k).numFmt = currencyFmt));

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Proveedores_${ym}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
      setMsg('📄 Excel exportado.');
    } catch (e) {
      console.error(e);
      setMsg('❌ No se pudo exportar.');
    } finally {
      setExporting(false);
    }
  }

  // ================== UI ==================
  return (
    <div className="max-w-7xl mx-auto p-6">
      <h1 className="text-xl font-bold mb-4">Finanzas — Proveedores</h1>

      {/* Mes + Resumen + Export */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Mes
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
            <div className="font-semibold">{mxn(totals.importe)}</div>
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
            title="Exportar a Excel"
          >
            {exporting ? 'Exportando…' : 'Exportar a Excel'}
          </button>
        </div>
      </div>

      {/* Sección 1: Captura / Edición */}
      <section className="mb-8">
        <div className="text-sm font-medium mb-2">Captura / Edición</div>
        <div className="grid grid-cols-1 lg:grid-cols-6 gap-2 items-end">
          <label className="text-sm">Fecha fac
            <input type="date" className="mt-1 w-full border rounded px-2 py-1" value={f.invoice_date} onChange={e=>setF({...f, invoice_date: e.target.value})} />
          </label>
          <label className="text-sm lg:col-span-2">Proveedor
            <input className="mt-1 w-full border rounded px-2 py-1" value={f.supplier} onChange={e=>setF({...f, supplier: e.target.value})} />
          </label>
          <label className="text-sm">MP
            <input className="mt-1 w-full border rounded px-2 py-1" value={f.mp} onChange={e=>setF({...f, mp: e.target.value})} />
          </label>
          <label className="text-sm">Factura
            <input className="mt-1 w-full border rounded px-2 py-1" value={f.invoice_no || ''} onChange={e=>setF({...f, invoice_no: e.target.value})} />
          </label>

          <label className="text-sm">Importe
            <input
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[.,]?[0-9]*"
              className="mt-1 w-full border rounded px-2 py-1 text-right"
              value={f.amountText}
              onChange={(e)=>setF({...f, amountText: e.target.value})}
              onBlur={(e)=>setF({...f, amount: r2(parseMoneyInput(e.target.value))})}
              placeholder="0.00"
            />
          </label>
          <label className="text-sm">C/pago
            <input className="mt-1 w-full border rounded px-2 py-1" value={f.payment_code || ''} onChange={e=>setF({...f, payment_code: e.target.value})} />
          </label>
          <label className="text-sm">Cheque
            <input className="mt-1 w-full border rounded px-2 py-1" value={f.check_no || ''} onChange={e=>setF({...f, check_no: e.target.value})} />
          </label>
          <label className="text-sm">Banco
            <select className="mt-1 w-full border rounded px-2 py-1" value={f.bank} onChange={e=>setF({...f, bank: e.target.value as any})}>
              <option value="">—</option>
              <option value="BBVA">BBVA</option>
              <option value="BANAMEX">BANAMEX</option>
            </select>
          </label>

          {/* Pago al registrar */}
          <label className="text-sm flex items-center gap-2">
            <span>Pagado</span>
            <input
              type="checkbox"
              className="mt-1 h-5 w-5"
              checked={f.markPaid}
              onChange={(e)=>{
                const v = e.target.checked;
                setF(s=>({
                  ...s,
                  markPaid: v,
                  paid_date: v ? (s.paid_date || toISO(new Date())) : ''
                }));
              }}
              title="Marcar como pagado al guardar"
            />
          </label>
          <label className="text-sm">Fecha pago
            <input
              type="date"
              disabled={!f.markPaid}
              className="mt-1 w-full border rounded px-2 py-1"
              value={f.paid_date || ''}
              onChange={(e)=>setF({...f, paid_date: e.target.value})}
            />
          </label>

          <label className="text-sm lg:col-span-2">Notas
            <input className="mt-1 w-full border rounded px-2 py-1" value={f.notes || ''} onChange={e=>setF({...f, notes: e.target.value})} />
          </label>

          <label className="text-sm flex items-center gap-2">
            <span>Subido a Drive</span>
            <input
              type="checkbox"
              className="mt-1 h-5 w-5"
              checked={f.drive_uploaded}
              onChange={(e)=>setF({...f, drive_uploaded: e.target.checked})}
              title="Marca si el archivo ya fue subido a Drive"
            />
          </label>

          <div className="lg:col-span-6 flex gap-2">
            <button onClick={saveBill} className="px-4 py-2 rounded bg-black text-white">
              {editingId ? 'Guardar cambios' : 'Agregar'}
            </button>
            {editingId && (
              <button onClick={resetForm} className="px-3 py-2 rounded border">Cancelar</button>
            )}
            <button onClick={resetForm} className="px-3 py-2 rounded border">Borrar</button>
          </div>
        </div>
      </section>

      {/* Sección 2: Pendientes (por fecha de factura) */}
      <section className="mb-8">
        <div className="text-sm font-medium mb-2">Pendientes del mes</div>
        <div className="border rounded overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 text-left">Fecha fac</th>
                <th className="p-2 text-left">Proveedor</th>
                <th className="p-2">MP</th>
                <th className="p-2 text-left">Factura</th>
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
                <tr>
                  <td className="p-3 text-center text-gray-500" colSpan={13}>Sin pendientes</td>
                </tr>
              )}
              {pendientes.map(b => {
                const saldo = (b.amount || 0) - (b.paid_amount || 0);
                return (
                  <tr key={b.id} className="border-t">
                    <td className="p-2">{fmtDateLocal(b.invoice_date)}</td>
                    <td className="p-2">{b.supplier}</td>
                    <td className="p-2 text-center">{b.mp || '—'}</td>
                    <td className="p-2">{b.invoice_no || '—'}</td>
                    <td className="p-2 text-right">{mxn(b.amount)}</td>
                    <td className="p-2 text-right">{mxn(b.paid_amount || 0)}</td>
                    <td className="p-2 text-right">{mxn(saldo)}</td>
                    <td className="p-2">{b.payment_code || '—'}</td>
                    <td className="p-2">{b.check_no || '—'}</td>
                    <td className="p-2">{b.bank || '—'}</td>
                    <td className="p-2">
                      <input
                        type="date"
                        className="border rounded px-2 py-1"
                        value={payDateMap[b.id] || toISO(new Date())}
                        onChange={(e)=>setRowPayDate(b.id, e.target.value)}
                      />
                    </td>
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={!!b.drive_uploaded}
                        onChange={()=>toggleDrive(b)}
                        title="Alternar 'Subido a Drive'"
                      />
                    </td>
                    <td className="p-2 text-right whitespace-nowrap">
                      <button className="text-emerald-700 mr-3" onClick={()=>markPaid(b)}>Pagar</button>
                      <button className="text-blue-600 mr-3" onClick={()=>editRow(b)}>Editar</button>
                      <button className="text-red-600" onClick={()=>delRow(b.id)}>Eliminar</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Sección 3: Pagados (por fecha de pago) */}
      <section className="mb-8">
        <div className="text-sm font-medium mb-2">Pagados del mes</div>
        <div className="border rounded overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 text-left">Fecha fac</th>
                <th className="p-2 text-left">Proveedor</th>
                <th className="p-2">MP</th>
                <th className="p-2 text-left">Factura</th>
                <th className="p-2 text-right">Importe</th>
                <th className="p-2 text-right">Pagado</th>
                <th className="p-2 text-left">Fecha pago</th>
                <th className="p-2">C/pago</th>
                <th className="p-2">Cheque</th>
                <th className="p-2">Banco</th>
                <th className="p-2">Drive</th>
                <th className="p-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pagados.length === 0 && (
                <tr>
                  <td className="p-3 text-center text-gray-500" colSpan={12}>Sin pagados</td>
                </tr>
              )}
              {pagados.map(b => (
                <tr key={b.id} className="border-t">
                  <td className="p-2">{fmtDateLocal(b.invoice_date)}</td>
                  <td className="p-2">{b.supplier}</td>
                  <td className="p-2 text-center">{b.mp || '—'}</td>
                  <td className="p-2">{b.invoice_no || '—'}</td>
                  <td className="p-2 text-right">{mxn(b.amount)}</td>
                  <td className="p-2 text-right">{mxn(b.paid_amount || 0)}</td>
                  <td className="p-2">
                    <input
                      type="date"
                      className="border rounded px-2 py-1"
                      value={paidDateMap[b.id] || b.paid_date || ''}
                      onChange={(e)=>setRowPaidDate(b.id, e.target.value)}
                    />
                  </td>
                  <td className="p-2">{b.payment_code || '—'}</td>
                  <td className="p-2">{b.check_no || '—'}</td>
                  <td className="p-2">{b.bank || '—'}</td>
                  <td className="p-2 text-center">
                    <input
                      type="checkbox"
                      checked={!!b.drive_uploaded}
                      onChange={()=>toggleDrive(b)}
                      title="Alternar 'Subido a Drive'"
                    />
                  </td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <button className="text-emerald-700 mr-3" onClick={()=>updatePaidDate(b)}>Actualizar</button>
                    <button className="text-amber-700 mr-3" onClick={()=>unsetPaid(b)}>Quitar pago</button>
                    <button className="text-blue-600 mr-3" onClick={()=>editRow(b)}>Editar</button>
                    <button className="text-red-600" onClick={()=>delRow(b.id)}>Eliminar</button>
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
