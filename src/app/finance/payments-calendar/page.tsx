'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

// ====== Tipos ======
type Planned = {
  id: string;
  month_tag: string;
  date: string;
  title: string;
  category: Category;
  amount: number;
  bank: Bank | null;
  status: 'PENDING' | 'PAID' | 'CANCELED';
  paid_at: string | null;
  notes: string | null;
};
type Recurrent = {
  id: string;
  title: string;
  category: Category;
  default_amount: number;
  bank: Bank | null;
  day_of_month: number;
  start_month: string; // "YYYY-MM"
  end_month: string | null;
  notes: string | null;
  is_active: boolean;
};

type Category = 'PROVEEDOR' | 'OPERATIVO' | 'IMPUESTOS' | 'NOMINA' | 'BANCO' | 'OTRO';
type Bank = 'BBVA' | 'BANAMEX' | 'EFECTIVO' | 'OTRO';

const CAT_COLORS: Record<Category, string> = {
  PROVEEDOR: 'bg-rose-100 text-rose-800 border-rose-300',
  OPERATIVO: 'bg-sky-100 text-sky-800 border-sky-300',
  IMPUESTOS: 'bg-amber-100 text-amber-900 border-amber-300',
  NOMINA: 'bg-violet-100 text-violet-800 border-violet-300',
  BANCO: 'bg-neutral-200 text-neutral-800 border-neutral-400',
  OTRO: 'bg-emerald-100 text-emerald-800 border-emerald-300',
};
const BRAND = {
  primary: 'FF065F46',
  primaryDark: 'FF054C38',
  light: 'FFE6F4EF',
  textOnPrimary: 'FFFFFFFF',
};

const mxn = (n: number) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const toMonthInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

const parseYMDLocal = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};
const fmtDateLocal = (ymd: string) =>
  parseYMDLocal(ymd).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
  });

function monthRange(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1); // exclusivo
  return { startISO: toISO(start), endISO: toISO(end) };
}

function daysInMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const total = new Date(y, m, 0).getDate();
  const res: string[] = [];
  for (let d = 1; d <= total; d++) res.push(toISO(new Date(y, m - 1, d)));
  return res;
}

function monthTagFromDate(iso: string) {
  return iso.slice(0, 7);
}

// Acepta "1,234.50" "1234" etc.
const parseNum = (v: any) => {
  const s = String(v ?? '').replace(/\s+/g, '').replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (x: any) => +parseNum(x).toFixed(2);

// Cargar logo como base64 para Excel
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

export default function PaymentsCalendarPage() {
  // ======= estado UI =======
  const [ym, setYm] = useState<string>(toMonthInput(new Date()));
  const { startISO, endISO } = useMemo(() => monthRange(ym), [ym]);
  const days = useMemo(() => daysInMonth(ym), [ym]);

  const [planned, setPlanned] = useState<Planned[]>([]);
  const [recurrent, setRecurrent] = useState<Recurrent[]>([]);
  const [msg, setMsg] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [exporting, setExporting] = useState<boolean>(false);

  // modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Planned | null>(null);

  // form
  const [fDate, setFDate] = useState<string>(toISO(new Date()));
  const [fTitle, setFTitle] = useState<string>('');
  const [fCat, setFCat] = useState<Category>('PROVEEDOR');
  const [fAmount, setFAmount] = useState<number>(0);
  const [fBank, setFBank] = useState<Bank | 'OTRO'>('BBVA');
  const [fNotes, setFNotes] = useState<string>('');

  // ======= cargar mes =======
  async function reload() {
    setLoading(true);
    setMsg('');
    const [p, r] = await Promise.all([
      supabase
        .from('finance_payments_planned')
        .select('*')
        .gte('date', startISO)
        .lt('date', endISO)
        .order('date', { ascending: true }),
      supabase
        .from('finance_payments_recurrent')
        .select('*')
        .eq('is_active', true)
        .order('day_of_month', { ascending: true }),
    ]);
    setPlanned((p.data || []) as Planned[]);
    setRecurrent((r.data || []) as Recurrent[]);
    setLoading(false);
  }
  useEffect(() => {
    reload();
    // eslint-disable-next-line
  }, [startISO, endISO]);

  // ======= métricas =======
  const totals = useMemo(() => {
    const sum = (arr: Planned[], pred: (x: Planned) => boolean) =>
      arr.filter(pred).reduce((s, r) => s + Number(r.amount || 0), 0);

    const byCat: Record<Category, number> = {
      PROVEEDOR: 0,
      OPERATIVO: 0,
      IMPUESTOS: 0,
      NOMINA: 0,
      BANCO: 0,
      OTRO: 0,
    };
    planned.forEach((p) => (byCat[p.category] += Number(p.amount || 0)));

    const totalPend = sum(planned, (x) => x.status === 'PENDING');
    const totalPaid = sum(planned, (x) => x.status === 'PAID');

    return { byCat, totalPend, totalPaid, totalAll: totalPend + totalPaid };
  }, [planned]);

  // ======= helpers modal =======
  function openNew(date?: string) {
    setEditing(null);
    setFDate(date || toISO(new Date()));
    setFTitle('');
    setFCat('PROVEEDOR');
    setFAmount(0);
    setFBank('BBVA');
    setFNotes('');
    setModalOpen(true);
  }
  function openEdit(item: Planned) {
    setEditing(item);
    setFDate(item.date);
    setFTitle(item.title);
    setFCat(item.category);
    setFAmount(item.amount);
    setFBank((item.bank as any) || 'OTRO');
    setFNotes(item.notes || '');
    setModalOpen(true);
  }
  function closeModal() {
    setModalOpen(false);
  }

  // ======= acciones =======
  async function savePlanned() {
    try {
      const payload = {
        month_tag: fDate.slice(0, 7),
        date: fDate,
        title: fTitle.trim(),
        category: fCat,
        amount: r2(fAmount),
        bank: fBank,
        notes: fNotes?.trim() || null,
      };

      if (editing) {
        const { error } = await supabase
          .from('finance_payments_planned')
          .update(payload)
          .eq('id', editing.id);
        if (error) throw error;
        setMsg('✅ Pago actualizado.');
      } else {
        const { error } = await supabase.from('finance_payments_planned').insert(payload);
        if (error) throw error;
        setMsg('✅ Pago agregado.');
      }
      closeModal();
      reload();
    } catch (e: any) {
      console.error(e);
      setMsg('❌ No se pudo guardar: ' + (e?.message ?? e));
    }
  }

  async function markPaid(item: Planned) {
    try {
      const { error } = await supabase
        .from('finance_payments_planned')
        .update({ status: 'PAID', paid_at: toISO(new Date()) })
        .eq('id', item.id);
      if (error) throw error;
      reload();
    } catch (e) {
      console.error(e);
    }
  }

  async function deletePlanned(id: string) {
    try {
      const { error } = await supabase.from('finance_payments_planned').delete().eq('id', id);
      if (error) throw error;
      reload();
    } catch (e) {
      console.error(e);
    }
  }

  // ======= materializar recurrentes al mes =======
  async function materializeFromRecurrent() {
    try {
      const [y, m] = ym.split('-').map(Number);
      const maxDay = new Date(y, m, 0).getDate();

      const rows = recurrent
        .filter((r) => {
          if (!r.is_active) return false;
          const inRange =
            r.start_month <= ym && (r.end_month == null || ym <= r.end_month);
          return inRange;
        })
        .map((r) => {
          const d = Math.min(r.day_of_month, maxDay);
          const dateISO = toISO(new Date(y, m - 1, d));
          return {
            month_tag: ym,
            date: dateISO,
            title: r.title,
            category: r.category,
            amount: r2(r.default_amount),
            bank: r.bank,
            status: 'PENDING' as const,
            notes: r.notes,
          };
        });

      if (rows.length === 0) {
        setMsg('ℹ️ No hay recurrentes activos aplicables a este mes.');
        return;
      }

      // Evitar duplicados exactos (mismo title+date+amount+category)
      const { data: existing } = await supabase
        .from('finance_payments_planned')
        .select('title, date, amount, category')
        .eq('month_tag', ym);

      const toInsert = rows.filter(
        (r) =>
          !existing?.some(
            (e) =>
              e.title === r.title &&
              e.date === r.date &&
              Number(e.amount) === Number(r.amount) &&
              e.category === r.category,
          ),
      );

      if (toInsert.length === 0) {
        setMsg('ℹ️ Ya están materializados los recurrentes de este mes.');
        return;
      }

      const { error } = await supabase.from('finance_payments_planned').insert(toInsert);
      if (error) throw error;
      setMsg(`✅ Recurrentes materializados: ${toInsert.length} pagos.`);
      reload();
    } catch (e: any) {
      console.error(e);
      setMsg('❌ No se pudieron materializar: ' + (e?.message ?? e));
    }
  }

  // ======= exportar a Excel =======
  async function exportExcel() {
    try {
      setExporting(true);
      const ExcelJS = await import('exceljs');
      const wb = new ExcelJS.Workbook();

      wb.creator = 'ALCAMPO CUERNAVACA';
      wb.created = new Date();
      wb.title = `Calendario de pagos ${ym}`;

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

      // Hoja Resumen
      const resumen = wb.addWorksheet('Resumen', { properties: { defaultRowHeight: 20 } });
      resumen.columns = [{ width: 28 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];

      resumen.mergeCells('A1:E1');
      const t = resumen.getCell('A1');
      t.value = 'ALCAMPO CUERNAVACA — Calendario de pagos';
      t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.primary } };
      t.font = { size: 14, bold: true, color: { argb: BRAND.textOnPrimary } };
      t.alignment = { vertical: 'middle', horizontal: 'center' };
      resumen.getRow(1).height = 28;

      try {
        const logoBase64 = await fetchAsBase64('/alcampo-logo.png');
        const logoId = wb.addImage({ base64: logoBase64, extension: 'png' });
        resumen.addImage(logoId, { tl: { col: 0.1, row: 0.15 }, ext: { width: 110, height: 110 } });
      } catch {}

      resumen.getCell('A3').value = 'Mes:'; resumen.getCell('A3').font = { bold: true };
      resumen.getCell('B3').value = new Date(parseYMDLocal(`${ym}-01`));
      resumen.getCell('B3').numFmt = 'mmmm yyyy';

      resumen.getCell('D3').value = 'Generado:'; resumen.getCell('D3').font = { bold: true };
      resumen.getCell('E3').value = new Date();
      resumen.getCell('E3').numFmt = 'dd/mm/yyyy hh:mm';

      const byCatRows = Object.entries(totals.byCat) as [Category, number][];
      resumen.getCell('A5').value = 'Categoría';
      resumen.getCell('B5').value = 'Total del mes';
      [resumen.getCell('A5'), resumen.getCell('B5')].forEach(c => Object.assign(c, headerStyle));

      byCatRows.forEach(([cat, val], i) => {
        const r = 6 + i;
        resumen.getCell(`A${r}`).value = cat;
        resumen.getCell(`B${r}`).value = val;
        resumen.getCell(`B${r}`).numFmt = currencyFmt;
        resumen.getCell(`A${r}`).border = cellBorder;
        resumen.getCell(`B${r}`).border = cellBorder;
      });

      const kRow = 7 + byCatRows.length;
      resumen.getCell(`D${kRow}`).value = 'Pendiente';
      resumen.getCell(`E${kRow}`).value = totals.totalPend; resumen.getCell(`E${kRow}`).numFmt = currencyFmt;
      Object.assign(resumen.getCell(`D${kRow}`), headerStyle);
      Object.assign(resumen.getCell(`E${kRow}`), headerStyle);

      resumen.getCell(`D${kRow+1}`).value = 'Pagado';
      resumen.getCell(`E${kRow+1}`).value = totals.totalPaid; resumen.getCell(`E${kRow+1}`).numFmt = currencyFmt;
      Object.assign(resumen.getCell(`D${kRow+1}`), headerStyle);
      Object.assign(resumen.getCell(`E${kRow+1}`), headerStyle);

      // Hoja Detalle
      const ws = wb.addWorksheet('Detalle');
      ws.columns = [
        { header: 'Fecha', key: 'date', width: 12 },
        { header: 'Título', key: 'title', width: 34 },
        { header: 'Categoría', key: 'category', width: 14 },
        { header: 'Banco', key: 'bank', width: 12 },
        { header: 'Estatus', key: 'status', width: 12 },
        { header: 'Monto', key: 'amount', width: 14 },
        { header: 'Notas', key: 'notes', width: 38 },
      ];
      ws.getRow(1).eachCell((c: any) => {
        Object.assign(c, headerStyle);
      });
      planned.forEach(p => ws.addRow({
        date: parseYMDLocal(p.date),
        title: p.title,
        category: p.category,
        bank: p.bank || '—',
        status: p.status,
        amount: p.amount,
        notes: p.notes || ''
      }));
      ws.getColumn('date').numFmt = dateFmt;
      ws.getColumn('amount').numFmt = currencyFmt;
      ws.eachRow((row: any, n: number) => {
        if (n === 1) return;
        row.eachCell((cell: any) => (cell.border = cellBorder));
      });

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `CalendarioPagos_${ym}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      setMsg('📄 Excel exportado.');
    } catch (e) {
      console.error(e);
      setMsg('❌ No se pudo exportar a Excel.');
    } finally {
      setExporting(false);
    }
  }

  // ======= render =======
  return (
    <div className="max-w-7xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">Calendario de pagos</h1>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Mes
          <input
            type="month"
            className="ml-2 border rounded px-2 py-1"
            value={ym}
            onChange={(e) => setYm(e.target.value)}
          />
        </label>

        <button
          onClick={() => openNew(`${ym}-01`)}
          className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          Agregar pago
        </button>

        <button
          onClick={materializeFromRecurrent}
          className="px-4 py-2 rounded border"
          title="Crea las instancias del mes a partir de las plantillas recurrentes activas"
        >
          Materializar recurrentes del mes
        </button>

        <button
          onClick={exportExcel}
          disabled={exporting}
          className={`ml-auto px-4 py-2 rounded ${
            exporting ? 'bg-gray-400' : 'bg-black hover:bg-gray-900'
          } text-white`}
        >
          {exporting ? 'Exportando…' : 'Exportar a Excel'}
        </button>
      </div>

      {/* Resumen */}
      <div className="grid md:grid-cols-4 gap-3 mb-6">
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Pendiente del mes</div>
          <div className="text-lg font-semibold">{mxn(totals.totalPend)}</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Pagado del mes</div>
          <div className="text-lg font-semibold">{mxn(totals.totalPaid)}</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Total programado</div>
          <div className="text-lg font-semibold">{mxn(totals.totalAll)}</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Categorías</div>
          <div className="text-sm mt-1 space-y-1">
            {Object.entries(totals.byCat).map(([cat, v]) => (
              <div key={cat} className="flex justify-between">
                <span className="text-gray-600">{cat}</span>
                <span className="font-medium">{mxn(v)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Calendario */}
      <div className="bg-white border rounded-xl overflow-hidden">
        {/* header de días */}
        <div className="grid grid-cols-7 border-b bg-gray-50 text-xs">
          {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map((d) => (
            <div key={d} className="p-2 text-center font-medium">{d}</div>
          ))}
        </div>

        {/* grilla */}
        <div className="grid grid-cols-7">
          {buildCalendarCells(ym, days).map((cell) => {
            const todays = planned.filter((p) => p.date === cell.iso);
            return (
              <div key={cell.key} className={`min-h-[130px] border p-2 ${cell.dim ? 'bg-gray-50' : ''}`}>
                <div className="flex items-center justify-between mb-1">
                  <div className={`text-xs ${cell.dim ? 'text-gray-400' : 'text-gray-700'} font-medium`}>
                    {cell.label}
                  </div>
                  <button
                    className="text-xs text-emerald-700 hover:underline"
                    onClick={() => openNew(cell.iso)}
                    title="Agregar pago en este día"
                  >
                    + pago
                  </button>
                </div>

                <div className="space-y-1">
                  {todays.map((p) => (
                    <div
                      key={p.id}
                      className={`text-[11px] border rounded px-2 py-1 cursor-pointer ${CAT_COLORS[p.category]} ${
                        p.status === 'PAID' ? 'opacity-60 line-through' : ''
                      }`}
                      onClick={() => openEdit(p)}
                      title={`${p.title} • ${p.category} • ${p.bank || '—'}`}
                    >
                      <div className="truncate">{p.title}</div>
                      <div className="flex justify-between">
                        <span>{p.category}</span>
                        <span className="font-semibold">{mxn(p.amount)}</span>
                      </div>
                      {p.status === 'PENDING' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            markPaid(p);
                          }}
                          className="mt-1 text-[10px] underline"
                        >
                          Marcar pagado
                        </button>
                      )}
                    </div>
                  ))}
                  {todays.length === 0 && <div className="text-[11px] text-gray-400">—</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Lista simple (debajo) */}
      <div className="mt-6 border rounded overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2">Fecha</th>
              <th className="text-left p-2">Título</th>
              <th className="p-2">Categoría</th>
              <th className="p-2">Banco</th>
              <th className="text-right p-2">Monto</th>
              <th className="p-2">Estatus</th>
              <th className="p-2">Notas</th>
              <th className="p-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {planned.length === 0 && (
              <tr><td colSpan={8} className="p-3 text-center text-gray-500">Sin pagos en el mes</td></tr>
            )}
            {planned.map(p => (
              <tr key={p.id} className="border-t">
                <td className="p-2">{fmtDateLocal(p.date)}</td>
                <td className="p-2">{p.title}</td>
                <td className="p-2">{p.category}</td>
                <td className="p-2">{p.bank || '—'}</td>
                <td className="p-2 text-right">{mxn(p.amount)}</td>
                <td className="p-2">{p.status}</td>
                <td className="p-2">{p.notes}</td>
                <td className="p-2">
                  <button className="text-blue-600 mr-3" onClick={()=>openEdit(p)}>Editar</button>
                  <button className="text-red-600" onClick={()=>deletePlanned(p.id)}>Eliminar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {msg && <div className="mt-3 text-sm">{msg}</div>}

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="w-[560px] max-w-[92vw] bg-white rounded-2xl border shadow-xl p-5">
            <div className="text-lg font-semibold mb-3">
              {editing ? 'Editar pago' : 'Nuevo pago'}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                Fecha
                <input type="date" className="w-full border rounded px-2 py-1 mt-1"
                  value={fDate} onChange={e=>setFDate(e.target.value)} />
              </label>

              <label className="text-sm">
                Título
                <input className="w-full border rounded px-2 py-1 mt-1"
                  placeholder="Renta local / TECNOS Factura 123"
                  value={fTitle} onChange={e=>setFTitle(e.target.value)} />
              </label>

              <label className="text-sm">
                Categoría
                <select className="w-full border rounded px-2 py-1 mt-1"
                  value={fCat} onChange={e=>setFCat(e.target.value as Category)}>
                  {(['PROVEEDOR','OPERATIVO','IMPUESTOS','NOMINA','BANCO','OTRO'] as Category[]).map(c=>(
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>

              <label className="text-sm">
                Banco
                <select className="w-full border rounded px-2 py-1 mt-1"
                  value={fBank} onChange={e=>setFBank(e.target.value as Bank)}>
                  {(['BBVA','BANAMEX','EFECTIVO','OTRO'] as Bank[]).map(b=>(
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </label>

              <label className="text-sm">
                Monto
                <input className="w-full border rounded px-2 py-1 mt-1 text-right"
                  value={fAmount} onChange={e=>setFAmount(parseNum(e.target.value))} />
              </label>

              <label className="col-span-2 text-sm">
                Notas
                <input className="w-full border rounded px-2 py-1 mt-1"
                  value={fNotes} onChange={e=>setFNotes(e.target.value)} />
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button className="px-3 py-2 rounded border" onClick={closeModal}>Cancelar</button>
              <button className="px-4 py-2 rounded bg-black text-white" onClick={savePlanned}>
                {editing ? 'Guardar cambios' : 'Agregar pago'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== calendario: completa con días “huecos” antes/después para cuadrar 6 filas x 7 columnas =====
function buildCalendarCells(ym: string, monthDaysISO: string[]) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  // JS: 0=Domingo... Queremos Lunes=0
  const jsWeekday = first.getDay();           // 0..6 (0=Dom)
  const lead = (jsWeekday + 6) % 7;           // 0..6 (0=Lun)

  const last = new Date(y, m, 0);
  const lastJsWeekday = last.getDay();
  const trail = (7 - ((lastJsWeekday + 6) % 7) - 1 + 7) % 7;

  const before: string[] = [];
  for (let i = lead; i > 0; i--) {
    before.push(toISO(new Date(y, m - 1, 1 - i)));
  }
  const after: string[] = [];
  for (let i = 1; i <= trail; i++) {
    after.push(toISO(new Date(y, m - 1, last.getDate() + i)));
  }
  const all = [...before, ...monthDaysISO, ...after];
  const cells = all.map((iso) => {
    const dt = parseYMDLocal(iso);
    const label = String(dt.getDate());
    const dim = iso.slice(0, 7) !== ym;
    return { key: iso, iso, label, dim };
  });

  // asegurar 6 filas (42 celdas)
  if (cells.length < 42) {
    const need = 42 - cells.length;
    for (let i = 1; i <= need; i++) {
      const d = parseYMDLocal(after.length ? after[after.length - 1] : monthDaysISO[monthDaysISO.length - 1]);
      d.setDate(d.getDate() + i);
      cells.push({ key: toISO(d), iso: toISO(d), label: String(d.getDate()), dim: true });
    }
  }
  return cells;
}
