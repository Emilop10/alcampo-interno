// src/app/finance/facturas-control/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { supabase } from '@/lib/supabase';

/*
  === Tablas REALES en tu Supabase ===

  finance_invoice_series
    id uuid pk
    day date not null           -- '2025-10-01'
    month_tag text not null     -- '2025-10'
    car_start text
    car_end   text
    tk_start  text
    tk_end    text
    imp_start text
    imp_end   text
    created_at timestamptz

  finance_invoice_cancelled
    id uuid pk
    month_tag text not null     -- '2025-10'
    note_type text not null     -- 'Canceladas', 'Sin timbrar', etc
    folios text not null        -- "C74623 / A12756..."
    created_at timestamptz
*/

type DayRow = {
  id: string;
  day: string;        // '2025-10-01'
  month_tag: string;  // '2025-10'
  car_start: string | null;
  car_end:   string | null;
  tk_start:  string | null;
  tk_end:    string | null;
  imp_start: string | null;
  imp_end:   string | null;
  created_at: string | null;
};

type CancelRow = {
  id: string;
  month_tag: string;
  note_type: string;
  folios: string;
  created_at: string | null;
};

const toMonthInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// para hoja de Excel → "01-oct-25"
function fmtSheetDate(iso: string) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const monthNames = [
    'ene', 'feb', 'mar', 'abr', 'may', 'jun',
    'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
  ];
  const mi = Number(m || '1') - 1;
  const shortY = y?.slice(-2) ?? '';
  return `${d}-${monthNames[mi]}-${shortY}`;
}

// MM -> "OCTUBRE DE 2025"
function niceMonthTitle(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const monthNamesUpper = [
    'ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
    'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE',
  ];
  return `${monthNamesUpper[(m ?? 1) - 1]} DE ${y}`;
}

const borderThin = {
  top:    { style: 'thin' as const },
  left:   { style: 'thin' as const },
  bottom: { style: 'thin' as const },
  right:  { style: 'thin' as const },
};

export default function FacturasControlPage() {
  // Mes seleccionado tipo "2025-10"
  const [ym, setYm] = useState<string>(toMonthInput(new Date()));

  // Data de BD
  const [days, setDays] = useState<DayRow[]>([]);
  const [cancels, setCancels] = useState<CancelRow[]>([]);

  // Formularios
  const [formDay, setFormDay] = useState({
    day: '', // yyyy-mm-dd
    car_start: '',
    car_end: '',
    tk_start: '',
    tk_end: '',
    imp_start: '',
    imp_end: '',
  });

  const [formCancel, setFormCancel] = useState({
    note_type: '',
    folios: '',
  });

  const [msg, setMsg] = useState('');
  const [exporting, setExporting] = useState(false);

  // etiqueta bonita para el UI (mes largo)
  const niceRangeLabel = useMemo(() => niceMonthTitle(ym), [ym]);

  // cargar datos de ese mes_tag
  async function reloadMonth() {
    setMsg('');

    // A) series por día
    const dRes = await supabase
      .from('finance_invoice_series')
      .select('*')
      .eq('month_tag', ym)
      .order('day', { ascending: true });

    if (dRes.error) {
      console.error(dRes.error);
      setDays([]);
      setMsg('❌ Error cargando folios diarios');
    } else {
      setDays((dRes.data || []) as DayRow[]);
    }

    // B) canceladas/no timbradas
    const cRes = await supabase
      .from('finance_invoice_cancelled')
      .select('*')
      .eq('month_tag', ym)
      .order('created_at', { ascending: true });

    if (cRes.error) {
      console.error(cRes.error);
      setCancels([]);
      setMsg((m) => (m ? m + ' · ' : '') + '❌ Error cargando canceladas');
    } else {
      setCancels((cRes.data || []) as CancelRow[]);
    }
  }

  useEffect(() => {
    reloadMonth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ym]);

  // Guardar / actualizar fila diaria de folios
  async function saveDayRow() {
    try {
      setMsg('');
      if (!formDay.day) throw new Error('Falta la fecha');

      const payload = {
        day: formDay.day,
        month_tag: ym,
        car_start: formDay.car_start || null,
        car_end:   formDay.car_end   || null,
        tk_start:  formDay.tk_start  || null,
        tk_end:    formDay.tk_end    || null,
        imp_start: formDay.imp_start || null,
        imp_end:   formDay.imp_end   || null,
      };

      // No tenemos unique constraint declarado en SQL,
      // así que vamos a checar si ya existe un row para ese día + month_tag.
      const { data: existing, error: selErr } = await supabase
        .from('finance_invoice_series')
        .select('id')
        .eq('day', formDay.day)
        .eq('month_tag', ym)
        .limit(1);

      if (selErr) throw selErr;

      if (existing && existing.length > 0) {
        // update
        const { error: updErr } = await supabase
          .from('finance_invoice_series')
          .update(payload)
          .eq('id', existing[0].id);
        if (updErr) throw updErr;
      } else {
        // insert
        const { error: insErr } = await supabase
          .from('finance_invoice_series')
          .insert(payload);
        if (insErr) throw insErr;
      }

      setMsg('✅ Día guardado');
      setFormDay({
        day: '',
        car_start: '',
        car_end: '',
        tk_start: '',
        tk_end: '',
        imp_start: '',
        imp_end: '',
      });
      await reloadMonth();
    } catch (e: any) {
      console.error(e);
      setMsg('❌ No se pudo guardar el día: ' + (e?.message ?? e));
    }
  }

  // Guardar fila de canceladas
  async function saveCancelRow() {
    try {
      setMsg('');

      if (!formCancel.note_type.trim() && !formCancel.folios.trim()) {
        throw new Error('Falta información');
      }

      const payload = {
        month_tag: ym,
        note_type: formCancel.note_type.trim() || '',
        folios:    formCancel.folios.trim() || '',
      };

      const { error } = await supabase
        .from('finance_invoice_cancelled')
        .insert(payload);

      if (error) throw error;

      setMsg('✅ Nota agregada');
      setFormCancel({ note_type: '', folios: '' });
      await reloadMonth();
    } catch (e: any) {
      console.error(e);
      setMsg('❌ No se pudo guardar la nota: ' + (e?.message ?? e));
    }
  }

  // borrar fila diaria
  async function deleteDayRow(id: string) {
    try {
      await supabase.from('finance_invoice_series').delete().eq('id', id);
      await reloadMonth();
    } catch (e) {
      console.error(e);
      setMsg('❌ No se pudo borrar el día');
    }
  }

  // borrar fila cancelada
  async function deleteCancelRow(id: string) {
    try {
      await supabase.from('finance_invoice_cancelled').delete().eq('id', id);
      await reloadMonth();
    } catch (e) {
      console.error(e);
      setMsg('❌ No se pudo borrar la fila de canceladas');
    }
  }

  // Exportar Excel con layout físico
  async function exportExcel() {
    try {
      setExporting(true);

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('CONTROL', {
        properties: { defaultRowHeight: 18 },
      });

      // anchos
      ws.getColumn(1).width = 11; // FECHA
      ws.getColumn(2).width = 14; // CAR INICIA
      ws.getColumn(3).width = 14; // CAR TERMINA
      ws.getColumn(4).width = 14; // TK INICIA
      ws.getColumn(5).width = 14; // TK TERMINA
      ws.getColumn(6).width = 14; // IMP INICIA
      ws.getColumn(7).width = 14; // IMP TERMINA
      ws.getColumn(8).width = 14; // extra / blanco / margen

      // TITULARES
      ws.mergeCells('A1:H1');
      (ws.getCell('A1') as any).value =
        'DISTRIBUCIONES Y REP. RINA S.A. DE C.V.';
      (ws.getCell('A1') as any).font = { bold: true, size: 14 };
      (ws.getCell('A1') as any).alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };

      ws.mergeCells('A2:H2');
      (ws.getCell('A2') as any).value =
        'CONTROL DE NÚMERO DE FACTURAS ELECTRÓNICAS';
      (ws.getCell('A2') as any).font = { size: 12, bold: true };
      (ws.getCell('A2') as any).alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };

      ws.mergeCells('A3:H3');
      (ws.getCell('A3') as any).value = niceMonthTitle(ym);
      (ws.getCell('A3') as any).font = { bold: true, size: 12 };
      (ws.getCell('A3') as any).alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };

      // ENCABEZADO TABLA PRINCIPAL: filas 5-6
      ws.mergeCells('A5:A6'); // FECHA
      ws.mergeCells('B5:C5'); // SERIE CAR
      ws.mergeCells('D5:E5'); // SERIE TK
      ws.mergeCells('F5:G5'); // SERIE IMP
      ws.mergeCells('H5:H6'); // col extra

      (ws.getCell('A5') as any).value = 'FECHA';
      (ws.getCell('A5') as any).font = { bold: true, size: 10 };
      (ws.getCell('A5') as any).alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };

      (ws.getCell('B5') as any).value = 'SERIE CAR';
      (ws.getCell('B5') as any).font = { bold: true, size: 10 };
      (ws.getCell('B5') as any).alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };

      (ws.getCell('D5') as any).value = 'SERIE TK';
      (ws.getCell('D5') as any).font = { bold: true, size: 10 };
      (ws.getCell('D5') as any).alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };

      (ws.getCell('F5') as any).value = 'SERIE IMP';
      (ws.getCell('F5') as any).font = { bold: true, size: 10 };
      (ws.getCell('F5') as any).alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };

      (ws.getCell('B6') as any).value = 'INICIA';
      (ws.getCell('B6') as any).font = { size: 10 };
      (ws.getCell('B6') as any).alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };

      (ws.getCell('C6') as any).value = 'TERMINA';
      (ws.getCell('C6') as any).font = { size: 10 };
      (ws.getCell('C6') as any).alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };

      (ws.getCell('D6') as any).value = 'INICIA';
      (ws.getCell('D6') as any).font = { size: 10 };
      (ws.getCell('D6') as any).alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };

      (ws.getCell('E6') as any).value = 'TERMINA';
      (ws.getCell('E6') as any).font = { size: 10 };
      (ws.getCell('E6') as any).alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };

      (ws.getCell('F6') as any).value = 'INICIA';
      (ws.getCell('F6') as any).font = { size: 10 };
      (ws.getCell('F6') as any).alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };

      (ws.getCell('G6') as any).value = 'TERMINA';
      (ws.getCell('G6') as any).font = { size: 10 };
      (ws.getCell('G6') as any).alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };

      // bordes para A5..H6
      for (let r = 5; r <= 6; r++) {
        for (let c = 1; c <= 8; c++) {
          const cell = ws.getCell(r, c) as any;
          cell.border = borderThin;
          cell.alignment = cell.alignment || {
            vertical: 'middle',
            horizontal: 'center',
          };
        }
      }

      // FILAS DIARIAS
      let rowPtr = 7;
      days.forEach((d) => {
        ws.getCell(rowPtr, 1).value = fmtSheetDate(d.day);
        ws.getCell(rowPtr, 2).value = d.car_start || '';
        ws.getCell(rowPtr, 3).value = d.car_end   || '';
        ws.getCell(rowPtr, 4).value = d.tk_start  || '';
        ws.getCell(rowPtr, 5).value = d.tk_end    || '';
        ws.getCell(rowPtr, 6).value = d.imp_start || '';
        ws.getCell(rowPtr, 7).value = d.imp_end   || '';
        ws.getCell(rowPtr, 8).value = ''; // igual que en tu hoja física

        for (let c = 1; c <= 8; c++) {
          const cell = ws.getCell(rowPtr, c) as any;
          cell.border = borderThin;
          cell.font = { size: 10 };
          cell.alignment = {
            vertical: 'middle',
            horizontal: c === 1 ? 'left' : 'center',
          };
        }
        rowPtr++;
      });

      // separador (dos renglones vacíos)
      rowPtr += 2;

      // SECCIÓN "FACTURAS CANCELADAS O NO TIMBRADAS"
      ws.mergeCells(`A${rowPtr}:H${rowPtr}`);
      (ws.getCell(`A${rowPtr}`) as any).value =
        'FACTURAS CANCELADAS O NO TIMBRADAS';
      (ws.getCell(`A${rowPtr}`) as any).font = { bold: true, size: 10 };
      (ws.getCell(`A${rowPtr}`) as any).alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };

      for (let cc = 1; cc <= 8; cc++) {
        const cell = ws.getCell(rowPtr, cc) as any;
        cell.border = borderThin;
      }
      rowPtr++;

      cancels.forEach((line) => {
        // Col A: "FACTURA"
        (ws.getCell(`A${rowPtr}`) as any).value = 'FACTURA';
        (ws.getCell(`A${rowPtr}`) as any).font = { size: 10, bold: true };

        // B..H combinadas
        ws.mergeCells(`B${rowPtr}:H${rowPtr}`);
        const texto = `${line.note_type || ''} ${line.folios || ''}`.trim();
        (ws.getCell(`B${rowPtr}`) as any).value = texto;
        (ws.getCell(`B${rowPtr}`) as any).font = { size: 10 };

        for (let cc = 1; cc <= 8; cc++) {
          const ccell = ws.getCell(rowPtr, cc) as any;
          ccell.border = borderThin;
          ccell.alignment = {
            vertical: 'middle',
            horizontal: 'left',
          };
        }

        rowPtr++;
      });

      // generar archivo
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `CONTROL_FACTURAS_${ym}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);

      setMsg('📄 Excel exportado.');
    } catch (e) {
      console.error(e);
      setMsg('❌ No se pudo exportar el Excel.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-xl font-bold mb-4">ALCAMPO CUERNAVACA</h1>
      <h2 className="text-lg font-semibold mb-6">Contabilidad y Finanzas</h2>

      {/* HEADER / MES / EXPORT */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <label className="text-sm">
          Mes
          <input
            type="month"
            className="ml-2 border rounded px-2 py-1"
            value={ym}
            onChange={(e) => setYm(e.target.value)}
          />
        </label>

        <span className="text-xs text-gray-500">
          {niceRangeLabel}
        </span>

        <button
          onClick={exportExcel}
          disabled={exporting}
          className={`ml-auto px-4 py-2 rounded ${
            exporting
              ? 'bg-gray-400'
              : 'bg-emerald-600 hover:bg-emerald-700'
          } text-white`}
        >
          {exporting ? 'Exportando…' : 'Exportar a Excel'}
        </button>
      </div>

      {/* CAPTURA DIARIA */}
      <section className="mb-8 border rounded p-4">
        <div className="text-sm font-medium mb-3">
          Captura de folios diarios
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
          <label className="flex flex-col">
            <span>Fecha</span>
            <input
              type="date"
              className="border rounded px-2 py-1"
              value={formDay.day}
              onChange={(e) =>
                setFormDay((s) => ({ ...s, day: e.target.value }))
              }
            />
          </label>

          <label className="flex flex-col">
            <span>CAR inicia</span>
            <input
              className="border rounded px-2 py-1"
              value={formDay.car_start}
              onChange={(e) =>
                setFormDay((s) => ({ ...s, car_start: e.target.value }))
              }
            />
          </label>

          <label className="flex flex-col">
            <span>CAR termina</span>
            <input
              className="border rounded px-2 py-1"
              value={formDay.car_end}
              onChange={(e) =>
                setFormDay((s) => ({ ...s, car_end: e.target.value }))
              }
            />
          </label>

          <label className="flex flex-col">
            <span>TK inicia</span>
            <input
              className="border rounded px-2 py-1"
              value={formDay.tk_start}
              onChange={(e) =>
                setFormDay((s) => ({ ...s, tk_start: e.target.value }))
              }
            />
          </label>

          <label className="flex flex-col">
            <span>TK termina</span>
            <input
              className="border rounded px-2 py-1"
              value={formDay.tk_end}
              onChange={(e) =>
                setFormDay((s) => ({ ...s, tk_end: e.target.value }))
              }
            />
          </label>

          <label className="flex flex-col">
            <span>IMP inicia</span>
            <input
              className="border rounded px-2 py-1"
              value={formDay.imp_start}
              onChange={(e) =>
                setFormDay((s) => ({ ...s, imp_start: e.target.value }))
              }
            />
          </label>

          <label className="flex flex-col">
            <span>IMP termina</span>
            <input
              className="border rounded px-2 py-1"
              value={formDay.imp_end}
              onChange={(e) =>
                setFormDay((s) => ({ ...s, imp_end: e.target.value }))
              }
            />
          </label>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={saveDayRow}
            className="px-4 py-2 bg-black text-white rounded"
          >
            Guardar día
          </button>

          <button
            onClick={() =>
              setFormDay({
                day: '',
                car_start: '',
                car_end: '',
                tk_start: '',
                tk_end: '',
                imp_start: '',
                imp_end: '',
              })
            }
            className="px-3 py-2 border rounded"
          >
            Limpiar
          </button>
        </div>
      </section>

      {/* TABLA DIARIA */}
      <section className="mb-8 border rounded p-4 overflow-x-auto">
        <div className="text-sm font-medium mb-2">Registro diario</div>

        <table className="w-full text-xs min-w-[700px] border">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 border text-left">Fecha</th>
              <th className="p-2 border text-center">CAR ini</th>
              <th className="p-2 border text-center">CAR fin</th>
              <th className="p-2 border text-center">TK ini</th>
              <th className="p-2 border text-center">TK fin</th>
              <th className="p-2 border text-center">IMP ini</th>
              <th className="p-2 border text-center">IMP fin</th>
              <th className="p-2 border text-center">Acciones</th>
            </tr>
          </thead>

          <tbody>
            {days.length === 0 && (
              <tr>
                <td
                  className="p-3 text-center text-gray-500 border"
                  colSpan={8}
                >
                  Sin registros en este mes
                </td>
              </tr>
            )}

            {days.map((d) => (
              <tr key={d.id} className="border-t">
                <td className="p-2 border">
                  {new Date(d.day + 'T00:00:00').toLocaleDateString('es-MX', {
                    day: '2-digit',
                    month: '2-digit',
                    year: '2-digit',
                  })}
                </td>
                <td className="p-2 border text-center">
                  {d.car_start ?? '—'}
                </td>
                <td className="p-2 border text-center">{d.car_end ?? '—'}</td>
                <td className="p-2 border text-center">{d.tk_start ?? '—'}</td>
                <td className="p-2 border text-center">{d.tk_end ?? '—'}</td>
                <td className="p-2 border text-center">
                  {d.imp_start ?? '—'}
                </td>
                <td className="p-2 border text-center">{d.imp_end ?? '—'}</td>
                <td className="p-2 border text-center whitespace-nowrap">
                  <button
                    className="text-blue-600 mr-3"
                    onClick={() => {
                      setFormDay({
                        day: d.day,
                        car_start: d.car_start || '',
                        car_end: d.car_end || '',
                        tk_start: d.tk_start || '',
                        tk_end: d.tk_end || '',
                        imp_start: d.imp_start || '',
                        imp_end: d.imp_end || '',
                      });
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                  >
                    Editar
                  </button>

                  <button
                    className="text-red-600"
                    onClick={() => deleteDayRow(d.id)}
                  >
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* CAPTURA CANCELADAS */}
      <section className="mb-8 border rounded p-4">
        <div className="text-sm font-medium mb-3">
          Facturas canceladas o no timbradas ({ym})
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <label className="flex flex-col">
            <span>Tipo / Nota (ej. "Canceladas", "Sin timbrar")</span>
            <input
              className="border rounded px-2 py-1"
              value={formCancel.note_type}
              onChange={(e) =>
                setFormCancel((s) => ({ ...s, note_type: e.target.value }))
              }
            />
          </label>

          <label className="flex flex-col">
            <span>Folios / Detalle</span>
            <input
              className="border rounded px-2 py-1"
              value={formCancel.folios}
              onChange={(e) =>
                setFormCancel((s) => ({ ...s, folios: e.target.value }))
              }
            />
          </label>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={saveCancelRow}
            className="px-4 py-2 bg-black text-white rounded"
          >
            Agregar fila
          </button>

          <button
            onClick={() => setFormCancel({ note_type: '', folios: '' })}
            className="px-3 py-2 border rounded"
          >
            Limpiar
          </button>
        </div>
      </section>

      {/* TABLA CANCELADAS */}
      <section className="mb-8 border rounded p-4 overflow-x-auto">
        <div className="text-sm font-medium mb-2">
          Canceladas / no timbradas capturadas
        </div>

        <table className="w-full text-xs min-w-[600px] border">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 border text-left w-32">Etiqueta</th>
              <th className="p-2 border text-left">Folios / Comentario</th>
              <th className="p-2 border text-center w-24">Acciones</th>
            </tr>
          </thead>

          <tbody>
            {cancels.length === 0 && (
              <tr>
                <td
                  className="p-3 text-center text-gray-500 border"
                  colSpan={3}
                >
                  Sin filas
                </td>
              </tr>
            )}

            {cancels.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="p-2 border">{c.note_type || '—'}</td>
                <td className="p-2 border">{c.folios || '—'}</td>
                <td className="p-2 border text-center whitespace-nowrap">
                  <button
                    className="text-red-600"
                    onClick={() => deleteCancelRow(c.id)}
                  >
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {msg && <div className="mt-2 text-sm">{msg}</div>}
    </div>
  );
}
