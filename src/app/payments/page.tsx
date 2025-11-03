'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

// ---------- helpers ----------
const mxn = (n: number) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
}
function ymKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function parseYm(ym: string) {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1);
}
// YYYY-MM-DD (local)
function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
// YYYY-MM-DD -> ISO con hora 12:00 local (evita saltos por UTC)
function inputDateToIsoMidday(s: string): string | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  const local = new Date(y, m - 1, d, 12, 0, 0);
  return local.toISOString();
}

type SupplierOpt = { id: string; name: string };
type Row = {
  id: string;
  supplier_id: string;
  suppliers: { name: string } | null;
  amount: number;
  pay_date: string | null;   // vencimiento
  paid_at: string | null;    // fecha pagada real
};

const PAGE_SIZE = 20 as const;

export default function PaymentsPage() {
  // ------- filtros -------
  const today = new Date();
  const [status, setStatus] = useState<'paid' | 'pending'>('pending');
  const [supplier, setSupplier] = useState<string>('all');
  const [q, setQ] = useState('');

  // últimos 6 meses (incluye actual)
  const [fromYm, setFromYm] = useState(ymKey(addMonths(today, -5)));
  const [toYm, setToYm] = useState(ymKey(today));
  const fromISO = useMemo(() => toISODate(parseYm(fromYm) ?? addMonths(today, -5)), [fromYm, today]);
  const toISOExclusive = useMemo(
    () => toISODate(addMonths(parseYm(toYm) ?? today, 1)),
    [toYm, today]
  );

  // paginación
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [status, supplier, fromISO, toISOExclusive]);

  // catálogo proveedores
  const [suppliers, setSuppliers] = useState<SupplierOpt[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('suppliers').select('id,name').order('name');
      setSuppliers((data || []).map((x: any) => ({ id: String(x.id), name: x.name })));
    })();
  }, []);

  // datos
  const [rows, setRows] = useState<Row[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setErrMsg('');

    try {
      const selectCols = 'id,supplier_id,amount,pay_date,paid_at,suppliers(name)';
      let query = supabase.from('purchases').select(selectCols, { count: 'exact' });

      if (status === 'paid') {
        query = query
          .not('paid_at', 'is', null)
          .gte('paid_at', fromISO)
          .lt('paid_at', toISOExclusive)
          .order('paid_at', { ascending: false });
      } else {
        query = query
          .is('paid_at', null)
          .gte('pay_date', fromISO)
          .lt('pay_date', toISOExclusive)
          .order('pay_date', { ascending: false });
      }

      if (supplier !== 'all') query = query.eq('supplier_id', supplier);

      const fromIndex = (page - 1) * PAGE_SIZE;
      const toIndex = fromIndex + PAGE_SIZE - 1;
      const { data, error, count: c } = await query.range(fromIndex, toIndex);
      if (error) throw error;

      let list: Row[] = Array.isArray(data) ? (data as Row[]) : [];
      if (q.trim()) {
        const s = q.trim().toLowerCase();
        list = list.filter(r => (r.suppliers?.name || '').toLowerCase().includes(s));
      }

      setRows(list);
      setCount(c || list.length);
    } catch (e: any) {
      console.error('Payments load error:', e);
      setRows([]);
      setCount(0);
      setErrMsg(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [status, supplier, q, fromISO, toISOExclusive, page]);

  useEffect(() => { loadRows(); }, [loadRows, refreshKey]);

  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const totalPageAmount = useMemo(
    () => rows.reduce((s, r) => s + Number(r.amount || 0), 0),
    [rows]
  );

  const dateHeader = status === 'paid' ? 'Fecha de pago' : 'Fecha de vencimiento';

  // ------- edición de fecha de pago -------
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState<string>(''); // YYYY-MM-DD

  function beginEdit(r: Row) {
    setEditingId(r.id);
    const base = r.paid_at ? new Date(r.paid_at) : new Date();
    setEditDate(toISODate(base));
  }
  function cancelEdit() {
    setEditingId(null);
    setEditDate('');
  }
  async function saveEdit(r: Row) {
    try {
      const iso = inputDateToIsoMidday(editDate); // puede ser null si está vacío
      const { error } = await supabase
        .from('purchases')
        .update({ paid_at: iso })
        .eq('id', r.id);
      if (error) throw error;
      cancelEdit();
      setRefreshKey(k => k + 1);
    } catch (e: any) {
      alert('No se pudo guardar la fecha: ' + (e?.message || e));
    }
  }

  // Acción rápida para desmarcar
  async function clearPaid(r: Row) {
    try {
      const { error } = await supabase.from('purchases').update({ paid_at: null }).eq('id', r.id);
      if (error) throw error;
      setRefreshKey(k => k + 1);
    } catch (e: any) {
      alert('No se pudo desmarcar: ' + (e?.message || e));
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4">Pagos</h2>

      {/* Controles */}
      <div className="flex flex-wrap items-end gap-3 mb-3">
        {/* Estado */}
        <div className="flex gap-1 bg-gray-100 rounded p-1">
          <button
            className={`px-3 py-1 rounded ${status==='pending'?'bg-white shadow':'text-gray-600'}`}
            onClick={()=>setStatus('pending')}
          >
            Pendientes
          </button>
          <button
            className={`px-3 py-1 rounded ${status==='paid'?'bg-white shadow':'text-gray-600'}`}
            onClick={()=>setStatus('paid')}
          >
            Pagados
          </button>
        </div>

        {/* Proveedor */}
        <div>
          <label className="block text-sm mb-1">Proveedor</label>
          <select
            className="border rounded px-2 py-2 min-w-[220px]"
            value={supplier}
            onChange={(e)=>setSupplier(e.target.value)}
          >
            <option value="all">Todos</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Rango de meses */}
        <div>
          <label className="block text-sm mb-1">Desde</label>
          <input type="month" className="border rounded px-2 py-2" value={fromYm} onChange={(e)=>setFromYm(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm mb-1">Hasta</label>
          <input type="month" className="border rounded px-2 py-2" value={toYm} onChange={(e)=>setToYm(e.target.value)} />
        </div>

        {/* Búsqueda (por nombre proveedor) */}
        <div>
          <label className="block text-sm mb-1">Buscar</label>
          <input
            className="border rounded px-2 py-2 min-w-[260px]"
            placeholder="Proveedor…"
            value={q}
            onChange={(e)=>setQ(e.target.value)}
          />
        </div>

        {/* Resumen mini */}
        <div className="ml-auto border rounded p-2 text-sm">
          <div className="text-gray-500">En esta página</div>
          <div className="font-semibold">{rows.length} movs — {mxn(totalPageAmount)}</div>
          <div className="text-gray-500">Total resultados: {count}</div>
        </div>
      </div>

      {errMsg && (
        <div className="mb-3 text-sm text-red-600">
          Error al cargar: {errMsg}
        </div>
      )}

      {/* Tabla */}
      <div className="border rounded overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2">Proveedor</th>
              <th className="text-right p-2">Monto</th>
              <th className="text-right p-2">{dateHeader}</th>
              <th className="text-right p-2">Pagado en</th>
              <th className="text-right p-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="p-3 text-gray-500">Cargando…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="p-3 text-gray-500">Sin resultados con estos filtros.</td></tr>
            ) : (
              rows.map(r => {
                const isEditing = editingId === r.id;
                const paidAt = r.paid_at ? new Date(r.paid_at) : null;
                const payDate = r.pay_date ? new Date(r.pay_date) : null;
                const mainDate =
                  status === 'paid'
                    ? (isEditing
                        ? undefined
                        : (paidAt ? paidAt.toLocaleDateString('es-MX') : '—'))
                    : (payDate ? payDate.toLocaleDateString('es-MX') : '—');
                const paidCell =
                  status === 'paid'
                    ? (paidAt ? paidAt.toLocaleString('es-MX') : '—')
                    : 'Pendiente';

                return (
                  <tr key={r.id} className="border-t">
                    <td className="p-2">{r.suppliers?.name || '—'}</td>
                    <td className="p-2 text-right">{mxn(r.amount)}</td>

                    {/* Columna Fecha de pago / vencimiento */}
                    <td className="p-2 text-right">
                      {status === 'paid' && isEditing ? (
                        <input
                          type="date"
                          className="border rounded px-2 py-1"
                          value={editDate}
                          onChange={(e)=>setEditDate(e.target.value)}
                        />
                      ) : (
                        mainDate
                      )}
                    </td>

                    <td className="p-2 text-right">{paidCell}</td>

                    {/* Acciones */}
                    <td className="p-2 text-right">
                      {isEditing ? (
                        <div className="flex justify-end gap-2">
                          <button
                            className="px-2 py-1 border rounded hover:bg-gray-50"
                            onClick={() => saveEdit(r)}
                          >
                            Guardar
                          </button>
                          <button
                            className="px-2 py-1 border rounded hover:bg-gray-50"
                            onClick={cancelEdit}
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          {r.paid_at ? (
                            <>
                              <button
                                className="px-2 py-1 border rounded hover:bg-gray-50"
                                onClick={() => beginEdit(r)}
                                title="Editar fecha de pago"
                              >
                                Editar fecha
                              </button>
                              <button
                                className="px-2 py-1 border rounded hover:bg-gray-50"
                                onClick={() => clearPaid(r)}
                                title="Quitar fecha de pago"
                              >
                                Desmarcar
                              </button>
                            </>
                          ) : (
                            <button
                              className="px-2 py-1 border rounded hover:bg-gray-50"
                              onClick={() => beginEdit(r)}
                              title="Marcar como pagado y elegir fecha"
                            >
                              Marcar pagado
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      <div className="flex items-center justify-between mt-3">
        <div className="text-sm text-gray-600">
          Página {page} de {pageCount}
        </div>
        <div className="flex gap-2">
          <button
            className="px-3 py-1 border rounded disabled:opacity-40"
            disabled={page <= 1}
            onClick={()=>setPage(p => Math.max(1, p-1))}
          >
            ← Anterior
          </button>
          <button
            className="px-3 py-1 border rounded disabled:opacity-40"
            disabled={page >= pageCount}
            onClick={()=>setPage(p => Math.min(pageCount, p+1))}
          >
            Siguiente →
          </button>
        </div>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        En <b>Pendientes</b> se filtra por <code>pay_date</code> (vencimiento) y <code>paid_at IS NULL</code>.
        En <b>Pagados</b> por <code>paid_at</code>. Puedes editar la fecha de pago o desmarcar para volver a pendiente.
      </p>
    </div>
  );
}
