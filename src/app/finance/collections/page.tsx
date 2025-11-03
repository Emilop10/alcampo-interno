'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Deposit = { id: string; date: string; bank: 'BBVA' | 'BANAMEX'; concept: string; amount: number; notes: string | null; created_at: string };
type ClientPay = { id: string; date: string; bank: 'BBVA' | 'BANAMEX'; client: string; invoice_ref: string | null; amount: number; notes: string | null; created_at: string };
type Voucher = { id: string; date: string; concept: string; amount: number; notes: string | null; created_at: string };
type InvDaily = { id: string; date: string; cartuchos: number; comerciales: number; importados: number; total: number; created_at: string };
type PendingPay = { id: string; date: string; client: string | null; amount: number; notes: string | null; created_at: string };
type Undeposited = { id: string; date: string; amount: number; notes: string | null; created_at: string }; // NUEVO

const mxn = (n: number) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const toMonthInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Acepta "17683", "17,683", "17 683", "17683.50"
const parseNum = (v: any) => {
  const s = String(v ?? '').replace(/\s+/g, '').replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (x: any) => +parseNum(x).toFixed(2);

// Fecha local segura
const parseYMDLocal = (ymd: string) => {
  if (!ymd) return new Date();
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};
const fmtDateLocal = (ymd: string) => parseYMDLocal(ymd).toLocaleDateString('es-MX');

function monthRange(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1); // exclusivo
  return { start: toISO(start), end: toISO(end) };
}

// ===== Branding Excel
const BRAND = {
  primary: 'FF065F46',
  primaryDark: 'FF054C38',
  light: 'FFE6F4EF',
  textOnPrimary: 'FFFFFFFF'
};

// Cargar imagen (logo) como base64 para ExcelJS (desde /public/alcampo-logo.png)
async function fetchAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as any);
  }
  return btoa(binary);
}

export default function FinanceCollectionsPage() {
  // ------- mes seleccionado -------
  const [ym, setYm] = useState<string>(toMonthInput(new Date()));
  const { start, end } = useMemo(() => monthRange(ym), [ym]);

  // ------- datos -------
  const [invoices, setInvoices] = useState<InvDaily[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [clientPays, setClientPays] = useState<ClientPay[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [pendings, setPendings] = useState<PendingPay[]>([]);
  const [undep, setUndep] = useState<Undeposited[]>([]); // NUEVO
  const [msg, setMsg] = useState('');
  const [exporting, setExporting] = useState(false);

  // ------- form: cuadrito -------
  const [invDate, setInvDate] = useState<string>(toISO(new Date()));
  const [cart, setCart] = useState<number>(0);
  const [com, setCom] = useState<number>(0);
  const [imp, setImp] = useState<number>(0);
  const [editingInvId, setEditingInvId] = useState<string | null>(null);

  // ------- form: depósito -------
  const [depDate, setDepDate] = useState<string>(toISO(new Date()));
  const [depBank, setDepBank] = useState<'BBVA' | 'BANAMEX'>('BANAMEX');
  const [depConceptChoice, setDepConceptChoice] = useState<'TARJETAS' | 'EFECTIVO' | 'ANTICIPO' | 'OTRO'>('TARJETAS');
  const [depConceptOther, setDepConceptOther] = useState<string>('');
  const [depAmount, setDepAmount] = useState<number>(0);
  const [depNotes, setDepNotes] = useState<string>('');

  // ------- form: pago de cliente -------
  const [cpDate, setCpDate] = useState<string>(toISO(new Date()));
  const [cpBank, setCpBank] = useState<'BBVA' | 'BANAMEX'>('BBVA');
  const [cpClient, setCpClient] = useState<string>('');
  const [cpInvoice, setCpInvoice] = useState<string>('');
  const [cpAmount, setCpAmount] = useState<number>(0);
  const [cpNotes, setCpNotes] = useState<string>('');

  // ------- form: vale -------
  const [vcDate, setVcDate] = useState<string>(toISO(new Date()));
  const [vcConcept, setVcConcept] = useState<string>('REPOSICIÓN DE GASTOS');
  const [vcAmount, setVcAmount] = useState<number>(0);
  const [vcNotes, setVcNotes] = useState<string>('');

  // ------- form: pendientes -------
  const [pdDate, setPdDate] = useState<string>(toISO(new Date()));
  const [pdClient, setPdClient] = useState<string>('');
  const [pdAmount, setPdAmount] = useState<number>(0);
  const [pdNotes, setPdNotes] = useState<string>('');

  // ------- form: pendiente de depositar (efectivo) -------
  const [udDate, setUdDate] = useState<string>(toISO(new Date()));
  const [udAmount, setUdAmount] = useState<number>(0);
  const [udNotes, setUdNotes] = useState<string>('');

  // ------- cargar todo del mes -------
  async function reloadMonth() {
    setMsg('');
    const [i1, i2, i3, i4, i5, i6] = await Promise.all([
      supabase.from('finance_invoices_daily').select('*').gte('date', start).lt('date', end).order('date', { ascending: true }),
      supabase.from('finance_deposits').select('*').gte('date', start).lt('date', end).order('date', { ascending: true }),
      supabase.from('finance_client_bank_payments').select('*').gte('date', start).lt('date', end).order('date', { ascending: true }),
      supabase.from('finance_vouchers').select('*').gte('date', start).lt('date', end).order('date', { ascending: true }),
      supabase.from('finance_pending_payments').select('*').gte('date', start).lt('date', end).order('date', { ascending: true }),
      supabase.from('finance_cash_undeposited').select('*').gte('date', start).lt('date', end).order('date', { ascending: true }), // NUEVO
    ]);

    setInvoices((i1.data || []) as InvDaily[]);
    setDeposits((i2.data || []) as Deposit[]);
    setClientPays((i3.data || []) as ClientPay[]);
    setVouchers((i4.data || []) as Voucher[]);
    setPendings((i5.data || []) as PendingPay[]);
    setUndep((i6.data || []) as Undeposited[]); // NUEVO
  }
  useEffect(() => { reloadMonth(); /* eslint-disable-next-line */ }, [start, end]);

  // ------- totales -------
  const totals = useMemo(() => {
    const invTotal = invoices.reduce((s, r) => s + (Number(r.total) || 0), 0);
    const clientPayTotal = clientPays.reduce((s, r) => s + (Number(r.amount) || 0), 0);

    const depTotal = deposits.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const depTar = deposits.filter(d => d.concept?.toUpperCase() === 'TARJETAS').reduce((s, r) => s + Number(r.amount || 0), 0);
    const depEfe = deposits.filter(d => d.concept?.toUpperCase() === 'EFECTIVO').reduce((s, r) => s + Number(r.amount || 0), 0);
    const depAnt = deposits.filter(d => d.concept?.toUpperCase() === 'ANTICIPO').reduce((s, r) => s + Number(r.amount || 0), 0);
    const depOtr = deposits
      .filter(d => !['TARJETAS','EFECTIVO','ANTICIPO'].includes((d.concept || '').toUpperCase()))
      .reduce((s, r) => s + Number(r.amount || 0), 0);

    const vouchersTotal = vouchers.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const pendientes = pendings.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const netoDespuesPendientes = invTotal - pendientes;

    const undepTotal = undep.reduce((s, r) => s + (Number(r.amount) || 0), 0); // SOLO informativo

    return { invTotal, clientPayTotal, depTotal, depTar, depEfe, depAnt, depOtr, vouchersTotal, pendientes, netoDespuesPendientes, undepTotal };
  }, [invoices, deposits, clientPays, vouchers, pendings, undep]);

  // ==================== handlers ====================

  // Cuadrito
  async function saveInvDaily() {
    try {
      setMsg('');
      if (!invDate) throw new Error('Falta la fecha');
      const values = { cartuchos: r2(cart), comerciales: r2(com), importados: r2(imp) };

      if (editingInvId) {
        const { error } = await supabase.from('finance_invoices_daily').update(values).eq('id', editingInvId);
        if (error) throw error;
      } else {
        const { data: existing, error: exErr } = await supabase.from('finance_invoices_daily').select('id').eq('date', invDate).maybeSingle();
        if (exErr && exErr.code !== 'PGRST116') throw exErr;
        if (existing?.id) {
          const { error } = await supabase.from('finance_invoices_daily').update(values).eq('id', existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('finance_invoices_daily').insert({ date: invDate, ...values });
          if (error) throw error;
        }
      }
      await reloadMonth();
      setEditingInvId(null);
      setMsg('✅ Ventas del día guardadas.');
    } catch (e: any) {
      console.error('saveInvDaily error ->', e, JSON.stringify(e, null, 2));
      setMsg('❌ No se pudo guardar el cuadrito: ' + (e?.message ?? e));
    }
  }

  function editInvRow(row: InvDaily) {
    setInvDate(row.date);
    setCart(row.cartuchos || 0);
    setCom(row.comerciales || 0);
    setImp(row.importados || 0);
    setEditingInvId(row.id);
  }
  async function deleteInvRow(id: string) {
    try { await supabase.from('finance_invoices_daily').delete().eq('id', id); await reloadMonth(); } catch (e) { console.error(e); }
  }

  // Depósitos
  async function addDeposit() {
    try {
      const concept = depConceptChoice === 'OTRO' ? (depConceptOther.trim() || 'OTRO') : depConceptChoice;
      const payload = { date: depDate, bank: depBank, concept, amount: r2(depAmount), notes: depNotes?.trim() || null };
      const { error } = await supabase.from('finance_deposits').insert(payload).select().single();
      if (error) throw error;
      await reloadMonth();
      setMsg('✅ Depósito agregado.');
    } catch (e: any) {
      console.error(e);
      setMsg('❌ No se pudo agregar el depósito: ' + (e?.message ?? e));
    }
  }
  async function deleteDeposit(id: string) {
    try { await supabase.from('finance_deposits').delete().eq('id', id); await reloadMonth(); } catch (e) { console.error(e); }
  }

  // Pago cliente
  async function addClientPay() {
    try {
      const payload = { date: cpDate, bank: cpBank, client: cpClient.trim(), invoice_ref: cpInvoice.trim() || null, amount: r2(cpAmount), notes: cpNotes?.trim() || null };
      const { error } = await supabase.from('finance_client_bank_payments').insert(payload).select().single();
      if (error) throw error;
      await reloadMonth();
      setMsg('✅ Pago de cliente agregado.');
    } catch (e: any) {
      console.error(e);
      setMsg('❌ No se pudo agregar el pago de cliente: ' + (e?.message ?? e));
    }
  }
  async function deleteClientPay(id: string) {
    try { await supabase.from('finance_client_bank_payments').delete().eq('id', id); await reloadMonth(); } catch (e) { console.error(e); }
  }

  // Vales
  async function addVoucher() {
    try {
      const payload = { date: vcDate, concept: vcConcept.trim(), amount: r2(vcAmount), notes: vcNotes?.trim() || null };
      const { error } = await supabase.from('finance_vouchers').insert(payload).select().single();
      if (error) throw error;
      await reloadMonth();
      setMsg('✅ Vale agregado.');
    } catch (e: any) {
      console.error(e);
      setMsg('❌ No se pudo agregar el vale: ' + (e?.message ?? e));
    }
  }
  async function deleteVoucher(id: string) {
    try { await supabase.from('finance_vouchers').delete().eq('id', id); await reloadMonth(); } catch (e) { console.error(e); }
  }

  // Pendientes (se restan del total)
  async function addPending() {
    try {
      const payload = { date: pdDate, client: pdClient.trim() || null, amount: r2(pdAmount), notes: r2(pdNotes) ? String(pdNotes) : (pdNotes?.trim() || null) };
      const { error } = await supabase.from('finance_pending_payments').insert(payload).select().single();
      if (error) throw error;
      await reloadMonth();
      setMsg('✅ Pendiente agregado (se resta del total).');
    } catch (e: any) {
      console.error(e);
      setMsg('❌ No se pudo agregar el pendiente: ' + (e?.message ?? e));
    }
  }
  async function deletePending(id: string) {
    try { await supabase.from('finance_pending_payments').delete().eq('id', id); await reloadMonth(); } catch (e) { console.error(e); }
  }

  // Pendiente de depositar (efectivo)
  async function addUndep() {
    try {
      const payload = { date: udDate, amount: r2(udAmount), notes: udNotes?.trim() || null };
      const { error } = await supabase.from('finance_cash_undeposited').insert(payload).select().single();
      if (error) throw error;
      await reloadMonth();
      setMsg('✅ Registrado “pendiente de depositar”.');
    } catch (e: any) {
      console.error(e);
      setMsg('❌ No se pudo registrar el pendiente de depositar: ' + (e?.message ?? e));
    }
  }
  async function deleteUndep(id: string) {
    try { await supabase.from('finance_cash_undeposited').delete().eq('id', id); await reloadMonth(); } catch (e) { console.error(e); }
  }

  // ==================== EXPORTAR A EXCEL ====================
  async function exportToExcel() {
    try {
      setExporting(true);
      const ExcelJS = await import('exceljs');
      const wb = new ExcelJS.Workbook();

      wb.creator = 'ALCAMPO CUERNAVACA';
      wb.created = new Date();
      wb.title = `Cobranza ${ym}`;

      const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.light } } as const;
      const headerStyle = {
        font: { bold: true, size: 11, color: { argb: 'FF000000' } },
        alignment: { vertical: 'middle' as const, horizontal: 'center' as const },
        fill: headerFill,
        border: {
          top: { style: 'thin' as const }, left: { style: 'thin' as const },
          bottom: { style: 'thin' as const }, right: { style: 'thin' as const }
        }
      };
      const cellBorder = { top: { style: 'thin' as const }, left: { style: 'thin' as const }, bottom: { style: 'thin' as const }, right: { style: 'thin' as const } };
      const currencyFmt = '$#,##0.00';
      const dateFmt = 'dd/mm/yyyy';

      // ---------- hoja Resumen ----------
      const resumen = wb.addWorksheet('Resumen', { properties: { defaultRowHeight: 20 } });
      resumen.columns = [{ width: 28 }, { width: 20 }, { width: 12 }, { width: 18 }, { width: 20 }];

      resumen.mergeCells('A1', 'E1');
      const title = resumen.getCell('A1');
      title.value = 'ALCAMPO CUERNAVACA — Reporte de cobranza mensual';
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.primary } };
      title.font = { size: 14, bold: true, color: { argb: BRAND.textOnPrimary } };
      title.alignment = { vertical: 'middle', horizontal: 'center' };
      resumen.getRow(1).height = 28;

      try {
        const logoBase64 = await fetchAsBase64('/alcampo-logo.png');
        const logoId = wb.addImage({ base64: logoBase64, extension: 'png' });
        resumen.addImage(logoId, { tl: { col: 0.1, row: 0.15 }, ext: { width: 110, height: 110 } });
      } catch {}

      resumen.getCell('A3').value = 'Mes:'; resumen.getCell('A3').font = { bold: true };
      resumen.getCell('B3').value = new Date(parseYMDLocal(`${ym}-01`)); resumen.getCell('B3').numFmt = 'mmmm yyyy';
      resumen.getCell('D3').value = 'Generado:'; resumen.getCell('D3').font = { bold: true };
      resumen.getCell('E3').value = new Date(); resumen.getCell('E3').numFmt = 'dd/mm/yyyy hh:mm';

      const kpiStartRow = 5;
      const kpis: Array<[string, number]> = [
        ['Total facturas del mes', totals.invTotal],
        ['Pagos de clientes (con factura)', totals.clientPayTotal],
        ['Depósitos — Total', totals.depTotal],
        ['• Tarjetas', totals.depTar],
        ['• Efectivo', totals.depEfe],
        ['• Anticipos', totals.depAnt],
        ['• Otros', totals.depOtr],
        ['Vales', totals.vouchersTotal],
        ['Pendientes', totals.pendientes],
        ['Neto después de pendientes', totals.netoDespuesPendientes],
        ['Pendiente de depositar (efectivo)', totals.undepTotal], // informativo
      ];

      resumen.getCell(`A${kpiStartRow}`).value = 'Concepto';
      resumen.getCell(`B${kpiStartRow}`).value = 'Monto';
      [resumen.getCell(`A${kpiStartRow}`), resumen.getCell(`B${kpiStartRow}`)].forEach(c => Object.assign(c, headerStyle));

      kpis.forEach((kv, i) => {
        const r = kpiStartRow + 1 + i;
        resumen.getCell(`A${r}`).value = kv[0];
        resumen.getCell(`B${r}`).value = kv[1];
        resumen.getCell(`B${r}`).numFmt = currencyFmt;
        resumen.getCell(`A${r}`).border = cellBorder;
        resumen.getCell(`B${r}`).border = cellBorder;
        resumen.getCell(`A${r}`).fill = headerFill;
        resumen.getCell(`B${r}`).font = { bold: true, size: 12 };
      });

      const bandRow = kpiStartRow + kpis.length + 3;
      resumen.mergeCells(`A${bandRow}:E${bandRow}`);
      const bandCell = resumen.getCell(`A${bandRow}`);
      bandCell.value = 'ALCAMPO CUERNAVACA';
      bandCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.primaryDark } };
      bandCell.font = { bold: true, color: { argb: BRAND.textOnPrimary } };
      bandCell.alignment = { vertical: 'middle', horizontal: 'center' };
      resumen.getRow(bandRow).height = 18;

      const addSheet = (name: string, columns: any[], rows: any[], formatters?: (ws: any) => void) => {
        const ws = wb.addWorksheet(name);
        ws.columns = columns;
        ws.getRow(1).eachCell((c: any) => Object.assign(c, headerStyle));
        rows.forEach(r => ws.addRow(r));
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        ws.eachRow((row: any, rowNumber: number) => {
          row.eachCell((cell: any) => { cell.border = cellBorder; });
          if (rowNumber === 1) row.eachCell((cell: any) => Object.assign(cell, headerStyle));
        });
        if (formatters) formatters(ws);
      };

      // Cuadrito
      addSheet(
        'Cuadrito',
        [
          { header: 'Fecha', key: 'date', width: 12 },
          { header: 'Cartuchos', key: 'cartuchos', width: 14 },
          { header: 'Comerciales', key: 'comerciales', width: 14 },
          { header: 'Importación', key: 'importados', width: 14 },
          { header: 'Total', key: 'total', width: 14 },
        ],
        invoices.map(r => ({
          date: parseYMDLocal(r.date),
          cartuchos: r.cartuchos,
          comerciales: r.comerciales,
          importados: r.importados,
          total: r.total,
        })),
        (ws) => {
          ws.getColumn('date').numFmt = dateFmt;
          ['cartuchos','comerciales','importados','total'].forEach(k => (ws.getColumn(k).numFmt = currencyFmt));
        }
      );

      // Depósitos
      addSheet(
        'Depósitos',
        [
          { header: 'Fecha', key: 'date', width: 12 },
          { header: 'Banco', key: 'bank', width: 12 },
          { header: 'Concepto', key: 'concept', width: 22 },
          { header: 'Importe', key: 'amount', width: 14 },
          { header: 'Notas', key: 'notes', width: 34 },
        ],
        deposits.map(r => ({
          date: parseYMDLocal(r.date), bank: r.bank, concept: r.concept, amount: r.amount, notes: r.notes || ''
        })),
        (ws) => { ws.getColumn('date').numFmt = dateFmt; ws.getColumn('amount').numFmt = currencyFmt; }
      );

      // Pagos clientes
      addSheet(
        'Pagos clientes',
        [
          { header: 'Fecha', key: 'date', width: 12 },
          { header: 'Banco', key: 'bank', width: 12 },
          { header: 'Cliente', key: 'client', width: 28 },
          { header: 'Factura', key: 'invoice_ref', width: 14 },
          { header: 'Importe', key: 'amount', width: 14 },
          { header: 'Notas', key: 'notes', width: 34 },
        ],
        clientPays.map(r => ({
          date: parseYMDLocal(r.date), bank: r.bank, client: r.client, invoice_ref: r.invoice_ref || '—',
          amount: r.amount, notes: r.notes || ''
        })),
        (ws) => { ws.getColumn('date').numFmt = dateFmt; ws.getColumn('amount').numFmt = currencyFmt; }
      );

      // Pendientes
      addSheet(
        'Pendientes',
        [
          { header: 'Fecha', key: 'date', width: 12 },
          { header: 'Cliente', key: 'client', width: 28 },
          { header: 'Importe', key: 'amount', width: 14 },
          { header: 'Notas', key: 'notes', width: 34 },
        ],
        pendings.map(r => ({
          date: parseYMDLocal(r.date), client: r.client || '—', amount: r.amount, notes: r.notes || ''
        })),
        (ws) => { ws.getColumn('date').numFmt = dateFmt; ws.getColumn('amount').numFmt = currencyFmt; }
      );

      // Pendiente de depositar
      addSheet(
        'Pendiente de depositar',
        [
          { header: 'Fecha', key: 'date', width: 12 },
          { header: 'Importe', key: 'amount', width: 14 },
          { header: 'Notas', key: 'notes', width: 34 },
        ],
        undep.map(r => ({
          date: parseYMDLocal(r.date), amount: r.amount, notes: r.notes || ''
        })),
        (ws) => { ws.getColumn('date').numFmt = dateFmt; ws.getColumn('amount').numFmt = currencyFmt; }
      );

      // Vales
      addSheet(
        'Vales',
        [
          { header: 'Fecha', key: 'date', width: 12 },
          { header: 'Concepto', key: 'concept', width: 34 },
          { header: 'Importe', key: 'amount', width: 14 },
          { header: 'Notas', key: 'notes', width: 34 },
        ],
        vouchers.map(r => ({
          date: parseYMDLocal(r.date), concept: r.concept, amount: r.amount, notes: r.notes || ''
        })),
        (ws) => { ws.getColumn('date').numFmt = dateFmt; ws.getColumn('amount').numFmt = currencyFmt; }
      );

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Cobranza_${ym}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);

      setMsg('📄 Archivo Excel exportado con plantilla corporativa.');
    } catch (e) {
      console.error(e);
      setMsg('❌ No se pudo exportar a Excel.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-xl font-bold mb-4">Contabilidad y Finanzas — Cobranza mensual</h1>

      {/* Mes + Exportar */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">Mes
          <input type="month" className="ml-2 border rounded px-2 py-1" value={ym} onChange={(e)=>setYm(e.target.value)} />
        </label>
        <span className="text-xs text-gray-500">
          Rango: {new Date(start).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}
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

      {/* Resumen superior (con el NUEVO recuadro) */}
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

      {/* Línea 2 de KPIs */}
      <div className="grid md:grid-cols-3 gap-3 mb-6">
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Pendientes</div>
          <div className="text-lg font-semibold">{mxn(totals.pendientes)}</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Neto después de pendientes</div>
          <div className="text-lg font-semibold">{mxn(totals.netoDespuesPendientes)}</div>
          <div className="text-xs text-gray-500 mt-1">(Total facturas – Pendientes)</div>
        </div>
        {/* NUEVO: recuadro independiente */}
        <div className="border rounded p-3 bg-amber-50">
          <div className="text-xs text-gray-600">Pendiente de depositar (efectivo)</div>
          <div className="text-lg font-semibold">{mxn(totals.undepTotal)}</div>
        </div>
      </div>

      {/* CUADRITO */}
      <section className="mb-8">
        <div className="text-sm font-medium mb-2">“Cuadrito” (ventas por familia)</div>
        <div className="flex flex-wrap items-end gap-2 mb-2">
          <label className="text-sm">Fecha
            <input type="date" className="ml-2 border rounded px-2 py-1" value={invDate} onChange={(e)=>setInvDate(e.target.value)} />
          </label>
          <label className="text-sm">Cartuchos
            <input className="ml-2 w-28 border rounded px-2 py-1 text-right" value={cart} onChange={(e)=>setCart(parseNum(e.target.value))} />
          </label>
          <label className="text-sm">Comerciales
            <input className="ml-2 w-28 border rounded px-2 py-1 text-right" value={com} onChange={(e)=>setCom(parseNum(e.target.value))} />
          </label>
          <label className="text-sm">Importación
            <input className="ml-2 w-28 border rounded px-2 py-1 text-right" value={imp} onChange={(e)=>setImp(parseNum(e.target.value))} />
          </label>
          <button onClick={saveInvDaily} className="px-4 py-2 rounded bg-black text-white">
            {editingInvId ? 'Guardar cambios' : 'Agregar'}
          </button>
          {editingInvId && (
            <button onClick={()=>{ setEditingInvId(null); setMsg(''); }} className="px-3 py-2 rounded border">
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
                <tr><td className="p-3 text-center text-gray-500" colSpan={6}>Sin registros en este mes</td></tr>
              )}
              {invoices.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{fmtDateLocal(r.date)}</td>
                  <td className="p-2 text-right">{mxn(r.cartuchos)}</td>
                  <td className="p-2 text-right">{mxn(r.comerciales)}</td>
                  <td className="p-2 text-right">{mxn(r.importados)}</td>
                  <td className="p-2 text-right">{mxn(r.total)}</td>
                  <td className="p-2 text-right">
                    <button className="text-blue-600 mr-3" onClick={()=>editInvRow(r)}>Editar</button>
                    <button className="text-red-600" onClick={()=>deleteInvRow(r.id)}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* DEPÓSITOS */}
      <section className="mb-8">
        <div className="text-sm font-medium mb-2">Depósitos (tarjetas, efectivo, anticipos sin factura)</div>
        <div className="flex flex-wrap items-end gap-2 mb-2">
          <label className="text-sm">Fecha
            <input type="date" className="ml-2 border rounded px-2 py-1" value={depDate} onChange={(e)=>setDepDate(e.target.value)} />
          </label>
          <label className="text-sm">Banco
            <select className="ml-2 border rounded px-2 py-1" value={depBank} onChange={(e)=>setDepBank(e.target.value as any)}>
              <option value="BBVA">BBVA</option>
              <option value="BANAMEX">BANAMEX</option>
            </select>
          </label>
          <label className="text-sm">Concepto
            <select className="ml-2 border rounded px-2 py-1" value={depConceptChoice} onChange={(e)=>setDepConceptChoice(e.target.value as any)}>
              <option value="TARJETAS">TARJETAS</option>
              <option value="EFECTIVO">EFECTIVO</option>
              <option value="ANTICIPO">ANTICIPO</option>
              <option value="OTRO">OTRO</option>
            </select>
          </label>
          {depConceptChoice === 'OTRO' && (
            <input placeholder="Especifica concepto" className="w-48 border rounded px-2 py-1" value={depConceptOther} onChange={(e)=>setDepConceptOther(e.target.value)} />
          )}
          <label className="text-sm">Importe
            <input className="ml-2 w-28 border rounded px-2 py-1 text-right" value={depAmount} onChange={(e)=>setDepAmount(parseNum(e.target.value))} />
          </label>
          <label className="text-sm">Notas
            <input className="ml-2 w-64 border rounded px-2 py-1" value={depNotes} onChange={(e)=>setDepNotes(e.target.value)} />
          </label>
          <button onClick={addDeposit} className="px-4 py-2 rounded bg-black text-white">Agregar depósito</button>
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
              {deposits.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={6}>Sin depósitos</td></tr>}
              {deposits.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{fmtDateLocal(r.date)}</td>
                  <td className="p-2">{r.bank}</td>
                  <td className="p-2">{r.concept}</td>
                  <td className="p-2 text-right">{mxn(r.amount)}</td>
                  <td className="p-2">{r.notes}</td>
                  <td className="p-2 text-right"><button className="text-red-600" onClick={()=>deleteDeposit(r.id)}>Eliminar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* PAGOS CLIENTE */}
      <section className="mb-8">
        <div className="text-sm font-medium mb-2">Pagos de clientes en bancos (con factura)</div>
        <div className="flex flex-wrap items-end gap-2 mb-2">
          <label className="text-sm">Fecha
            <input type="date" className="ml-2 border rounded px-2 py-1" value={cpDate} onChange={(e)=>setCpDate(e.target.value)} />
          </label>
          <label className="text-sm">Banco
            <select className="ml-2 border rounded px-2 py-1" value={cpBank} onChange={(e)=>setCpBank(e.target.value as any)}>
              <option value="BBVA">BBVA</option>
              <option value="BANAMEX">BANAMEX</option>
            </select>
          </label>
          <label className="text-sm">Cliente
            <input className="ml-2 w-40 border rounded px-2 py-1" value={cpClient} onChange={(e)=>setCpClient(e.target.value)} />
          </label>
          <label className="text-sm">Factura (opcional)
            <input className="ml-2 w-32 border rounded px-2 py-1" value={cpInvoice} onChange={(e)=>setCpInvoice(e.target.value)} />
          </label>
          <label className="text-sm">Importe
            <input className="ml-2 w-28 border rounded px-2 py-1 text-right" value={cpAmount} onChange={(e)=>setCpAmount(parseNum(e.target.value))} />
          </label>
          <label className="text-sm">Notas
            <input className="ml-2 w-64 border rounded px-2 py-1" value={cpNotes} onChange={(e)=>setCpNotes(e.target.value)} />
          </label>
          <button onClick={addClientPay} className="px-4 py-2 rounded bg-black text-white">Agregar pago de cliente</button>
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
              {clientPays.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={7}>Sin pagos de clientes</td></tr>}
              {clientPays.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{fmtDateLocal(r.date)}</td>
                  <td className="p-2">{r.bank}</td>
                  <td className="p-2">{r.client}</td>
                  <td className="p-2">{r.invoice_ref ?? '—'}</td>
                  <td className="p-2 text-right">{mxn(r.amount)}</td>
                  <td className="p-2">{r.notes}</td>
                  <td className="p-2 text-right"><button className="text-red-600" onClick={()=>deleteClientPay(r.id)}>Eliminar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* PENDIENTES */}
      <section className="mb-8">
        <div className="text-sm font-medium mb-2">Pagos pendientes (se restan del total)</div>
        <div className="flex flex-wrap items-end gap-2 mb-2">
          <label className="text-sm">Fecha
            <input type="date" className="ml-2 border rounded px-2 py-1" value={pdDate} onChange={(e)=>setPdDate(e.target.value)} />
          </label>
          <label className="text-sm">Cliente
            <input className="ml-2 w-48 border rounded px-2 py-1" value={pdClient} onChange={(e)=>setPdClient(e.target.value)} />
          </label>
          <label className="text-sm">Importe
            <input className="ml-2 w-28 border rounded px-2 py-1 text-right" value={pdAmount} onChange={(e)=>setPdAmount(parseNum(e.target.value))} />
          </label>
          <label className="text-sm">Notas
            <input className="ml-2 w-64 border rounded px-2 py-1" value={pdNotes} onChange={(e)=>setPdNotes(e.target.value)} />
          </label>
          <button onClick={addPending} className="px-4 py-2 rounded bg-black text-white">Agregar pendiente</button>
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
              {pendings.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={5}>Sin pendientes</td></tr>}
              {pendings.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{fmtDateLocal(r.date)}</td>
                  <td className="p-2">{r.client ?? '—'}</td>
                  <td className="p-2 text-right">{mxn(r.amount)}</td>
                  <td className="p-2">{r.notes}</td>
                  <td className="p-2 text-right"><button className="text-red-600" onClick={()=>deletePending(r.id)}>Eliminar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* PENDIENTE DE DEPOSITAR (EFECTIVO) — NUEVO */}
      <section className="mb-8">
        <div className="text-sm font-medium mb-2">Pendiente de depositar (efectivo en caja)</div>
        <div className="flex flex-wrap items-end gap-2 mb-2">
          <label className="text-sm">Fecha
            <input type="date" className="ml-2 border rounded px-2 py-1" value={udDate} onChange={(e)=>setUdDate(e.target.value)} />
          </label>
          <label className="text-sm">Importe
            <input className="ml-2 w-28 border rounded px-2 py-1 text-right" value={udAmount} onChange={(e)=>setUdAmount(parseNum(e.target.value))} />
          </label>
          <label className="text-sm">Notas
            <input className="ml-2 w-64 border rounded px-2 py-1" value={udNotes} onChange={(e)=>setUdNotes(e.target.value)} />
          </label>
          <button onClick={addUndep} className="px-4 py-2 rounded bg-black text-white">Agregar</button>
        </div>

        <div className="border rounded overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2">Fecha</th>
                <th className="text-right p-2">Importe</th>
                <th className="p-2">Notas</th>
                <th className="p-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {undep.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={4}>Sin registros</td></tr>}
              {undep.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{fmtDateLocal(r.date)}</td>
                  <td className="p-2 text-right">{mxn(r.amount)}</td>
                  <td className="p-2">{r.notes}</td>
                  <td className="p-2 text-right"><button className="text-red-600" onClick={()=>deleteUndep(r.id)}>Eliminar</button></td>
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
            <input type="date" className="ml-2 border rounded px-2 py-1" value={vcDate} onChange={(e)=>setVcDate(e.target.value)} />
          </label>
          <label className="text-sm">Concepto
            <input className="ml-2 w-56 border rounded px-2 py-1" value={vcConcept} onChange={(e)=>setVcConcept(e.target.value)} />
          </label>
          <label className="text-sm">Importe
            <input className="ml-2 w-28 border rounded px-2 py-1 text-right" value={vcAmount} onChange={(e)=>setVcAmount(parseNum(e.target.value))} />
          </label>
          <label className="text-sm">Notas
            <input className="ml-2 w-64 border rounded px-2 py-1" value={vcNotes} onChange={(e)=>setVcNotes(e.target.value)} />
          </label>
          <button onClick={addVoucher} className="px-4 py-2 rounded bg-black text-white">Agregar vale</button>
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
              {vouchers.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={5}>Sin vales</td></tr>}
              {vouchers.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{fmtDateLocal(r.date)}</td>
                  <td className="p-2">{r.concept}</td>
                  <td className="p-2 text-right">{mxn(r.amount)}</td>
                  <td className="p-2">{r.notes}</td>
                  <td className="p-2 text-right"><button className="text-red-600" onClick={()=>deleteVoucher(r.id)}>Eliminar</button></td>
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
