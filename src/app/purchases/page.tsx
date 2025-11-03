'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

type Supplier = { id: string; name: string };

type PurchaseRow = {
  id: string;
  purchase_date: string;
  amount: number;
  pay_date: string | null;
  credit_days: number | null;
  supplier_id: string;
  supplier_name: string;
};

type EditState = {
  supplier_id: string;
  purchase_date: string;
  amount: string;       // se edita como string en inputs
  credit_days: string;  // idem
  pay_date: string;     // opcional
  useBusiness: boolean;
};

const mxn = (n: number) =>
  n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const toISODate = (d: Date) => d.toISOString().slice(0, 10);

// ---------- helpers de fechas ----------
function addNaturalDays(start: Date, days: number) {
  const d = new Date(start);
  d.setDate(d.getDate() + days);
  return d;
}
function addBusinessDays(start: Date, days: number) {
  const d = new Date(start);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay(); // 0 dom, 6 sáb
    if (dow !== 0 && dow !== 6) left--;
  }
  return d;
}
function computePayDate(purchaseISO: string, creditDays: number, useBusiness: boolean) {
  const base = new Date(purchaseISO + 'T00:00:00');
  const d = useBusiness ? addBusinessDays(base, creditDays) : addNaturalDays(base, creditDays);
  return toISODate(d);
}

// “shaper” para tipar lo que entra/sale
function shapePurchase(r: any): PurchaseRow {
  return {
    id: String(r.id),
    purchase_date: String(r.purchase_date),
    amount: Number(r.amount || 0),
    pay_date: r.pay_date ?? null,
    credit_days: r.credit_days ?? null,
    supplier_id: String(r.supplier_id),
    supplier_name: r.suppliers?.name || '—',
  };
}

export default function PurchasesPage() {
  // catálogos
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  // lista
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [msg, setMsg] = useState('');

  // alta
  const [supplierId, setSupplierId] = useState('');
  const [purchaseDate, setPurchaseDate] = useState<string>('');
  const [amount, setAmount] = useState<string>('0.00');
  const [creditDays, setCreditDays] = useState<string>('30');
  const [payDate, setPayDate] = useState<string>(''); // opcional
  const [useBusinessDays, setUseBusinessDays] = useState<boolean>(false); // default: NATURALES

  // edición
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState>({
    supplier_id: '',
    purchase_date: '',
    amount: '0.00',
    credit_days: '30',
    pay_date: '',
    useBusiness: false,
  });

  const amountNumber = useMemo(() => Number(String(amount).replace(/,/g, '')), [amount]);
  const creditNumber = useMemo(() => Number(String(creditDays).replace(/,/g, '')) || 0, [creditDays]);
  const isValid = !!supplierId && !!purchaseDate && amountNumber > 0 && creditNumber >= 0;

  // carga inicial
  useEffect(() => {
    (async () => {
      const [{ data: s }, { data: p, error: perr }] = await Promise.all([
        supabase.from('suppliers').select('id,name').order('name'),
        supabase
          .from('purchases')
          .select('id,purchase_date,amount,pay_date,credit_days,supplier_id, suppliers(name)')
          .order('purchase_date', { ascending: false })
          .limit(20),
      ]);

      if (perr) setMsg('❌ Error cargando compras: ' + perr.message);

      setSuppliers((s || []) as Supplier[]);
      setRows(((p || []) as any[]).map(shapePurchase));

      // defaults del formulario
      setPurchaseDate(toISODate(new Date()));
    })();
  }, []);

  // alta
  const onSave = useCallback(async () => {
    setMsg('');
    if (!isValid) return;

    // si el usuario NO da pay_date, calcular
    const finalPayDate =
      payDate && payDate.trim()
        ? payDate
        : computePayDate(purchaseDate, creditNumber, useBusinessDays);

    const payload = {
      supplier_id: supplierId,
      purchase_date: purchaseDate, // 👈 FIX: mapear desde el state
      amount: amountNumber,
      credit_days: creditNumber,
      pay_date: finalPayDate,
      pay_month: toISODate(new Date(finalPayDate.slice(0, 7) + '-01')),
    };

    const { error, data } = await supabase
      .from('purchases')
      .insert(payload)
      .select('id,purchase_date,amount,pay_date,credit_days,supplier_id, suppliers(name)')
      .single();

    if (error) {
      setMsg('❌ Error: ' + error.message);
      return;
    }

    setRows(prev => [shapePurchase(data), ...prev]);
    setMsg('✅ Compra registrada.');
    setAmount('0.00');
    setPayDate('');
  }, [isValid, payDate, purchaseDate, creditNumber, useBusinessDays, supplierId, amountNumber]);

  // borrar
  const onDelete = useCallback(async (id: string) => {
    const prev = rows;
    setRows(p => p.filter(r => r.id !== id)); // optimista
    const { error } = await supabase.from('purchases').delete().eq('id', id);
    if (error) {
      setRows(prev); // rollback
      setMsg('❌ No se pudo eliminar: ' + error.message);
    }
  }, [rows]);

  // ---- EDICIÓN ----
  const startEdit = useCallback((r: PurchaseRow) => {
    setEditId(r.id);
    setEdit({
      supplier_id: r.supplier_id,
      purchase_date: r.purchase_date,
      amount: r.amount.toFixed(2),
      credit_days: String(r.credit_days ?? 30),
      pay_date: r.pay_date || '',
      useBusiness: false, // default NATURALES
    });
    setMsg('');
  }, []);

  const cancelEdit = useCallback(() => setEditId(null), []);

  const saveEdit = useCallback(async () => {
    if (!editId) return;

    const credit = Number(edit.credit_days) || 0;

    // si el usuario dejó vacío pay_date, recalcúlalo
    const finalPayDate =
      edit.pay_date && edit.pay_date.trim()
        ? edit.pay_date
        : computePayDate(edit.purchase_date, credit, edit.useBusiness);

    const payload = {
      supplier_id: edit.supplier_id,
      purchase_date: edit.purchase_date,
      amount: Number(edit.amount),
      credit_days: credit,
      pay_date: finalPayDate,
      pay_month: toISODate(new Date(finalPayDate.slice(0, 7) + '-01')),
    };

    const { error } = await supabase.from('purchases').update(payload).eq('id', editId);
    if (error) {
      setMsg('❌ Error al actualizar: ' + error.message);
      return;
    }

    setRows(prev =>
      prev.map(r =>
        r.id === editId
          ? {
              ...r,
              purchase_date: payload.purchase_date,
              amount: payload.amount,
              credit_days: payload.credit_days,
              pay_date: payload.pay_date,
              supplier_id: payload.supplier_id,
              supplier_name:
                suppliers.find(s => s.id === payload.supplier_id)?.name || r.supplier_name,
            }
          : r,
      ),
    );
    setEditId(null);
    setMsg('✅ Compra actualizada.');
  }, [editId, edit, suppliers]);
  // ------------------

  return (
    <div className="max-w-5xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4">Compras</h2>

      {/* Form alta */}
      <div className="grid md:grid-cols-6 gap-3 items-end mb-4">
        <div className="md:col-span-2">
          <label className="block text-sm mb-1">Proveedor…</label>
          <select
            className="w-full border rounded px-2 py-2"
            value={supplierId}
            onChange={e => setSupplierId(e.target.value)}
          >
            <option value="">Selecciona…</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm mb-1">Fecha factura</label>
          <input
            type="date"
            className="w-full border rounded px-2 py-2"
            value={purchaseDate}
            onChange={e => setPurchaseDate(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Monto $</label>
          <input
            type="number"
            step="0.01"
            min="0"
            className="w-full border rounded px-2 py-2 text-right"
            value={amount}
            onChange={e => setAmount(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Días crédito (opcional)</label>
          <input
            type="number"
            min="0"
            className="w-full border rounded px-2 py-2 text-right"
            value={creditDays}
            onChange={e => setCreditDays(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Fecha pago (opcional)</label>
          <input
            type="date"
            className="w-full border rounded px-2 py-2"
            value={payDate}
            onChange={e => setPayDate(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="habiles"
            type="checkbox"
            checked={useBusinessDays}
            onChange={e => setUseBusinessDays(e.target.checked)}
          />
          <label htmlFor="habiles" className="text-sm">
            Usar días <b>hábiles</b> (default: <b>naturales</b>)
          </label>
        </div>

        <div className="md:col-span-6">
          <button
            className={`px-4 py-2 rounded text-white ${
              isValid ? 'bg-black hover:bg-gray-800' : 'bg-gray-400 cursor-not-allowed'
            }`}
            onClick={onSave}
            disabled={!isValid}
          >
            Guardar
          </button>
        </div>
      </div>

      {msg && <div className="mb-3 text-sm">{msg}</div>}

      <div className="border rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2">Fecha factura</th>
              <th className="text-left p-2">Proveedor</th>
              <th className="text-right p-2">Monto</th>
              <th className="text-left p-2">Fecha pago</th>
              <th className="text-left p-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-3 text-gray-500">
                  Sin registros aún…
                </td>
              </tr>
            ) : (
              rows.map(r => {
                const editing = editId === r.id;

                if (!editing) {
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="p-2">{r.purchase_date}</td>
                      <td className="p-2">{r.supplier_name}</td>
                      <td className="p-2 text-right">{mxn(r.amount)}</td>
                      <td className="p-2">{r.pay_date || '—'}</td>
                      <td className="p-2 space-x-3">
                        <button className="text-blue-600 hover:underline" onClick={() => startEdit(r)}>
                          Editar
                        </button>
                        <button className="text-red-600 hover:underline" onClick={() => onDelete(r.id)}>
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  );
                }

                // fila en modo edición
                return (
                  <tr key={r.id} className="border-t bg-yellow-50">
                    <td className="p-2">
                      <input
                        type="date"
                        className="border rounded px-2 py-1"
                        value={edit.purchase_date}
                        onChange={e => setEdit(prev => ({ ...prev, purchase_date: e.target.value }))}
                      />
                    </td>
                    <td className="p-2">
                      <select
                        className="border rounded px-2 py-1"
                        value={edit.supplier_id}
                        onChange={e => setEdit(prev => ({ ...prev, supplier_id: e.target.value }))}
                      >
                        {suppliers.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2 text-right">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="border rounded px-2 py-1 text-right w-28"
                        value={edit.amount}
                        onChange={e => setEdit(prev => ({ ...prev, amount: e.target.value }))}
                      />
                    </td>
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="date"
                          className="border rounded px-2 py-1"
                          value={edit.pay_date}
                          onChange={e => setEdit(prev => ({ ...prev, pay_date: e.target.value }))}
                        />
                        <span className="text-xs text-gray-500">o</span>
                        <input
                          type="number"
                          min="0"
                          className="border rounded px-2 py-1 w-20 text-right"
                          value={edit.credit_days}
                          onChange={e => setEdit(prev => ({ ...prev, credit_days: e.target.value }))}
                          title="Días crédito (se usa si no pones Fecha pago)"
                        />
                        <label className="ml-2 text-xs flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={edit.useBusiness}
                            onChange={e => setEdit(prev => ({ ...prev, useBusiness: e.target.checked }))}
                          />
                          Usar hábiles
                        </label>
                      </div>
                    </td>
                    <td className="p-2 space-x-3">
                      <button className="text-green-700 hover:underline" onClick={saveEdit}>
                        Guardar
                      </button>
                      <button className="text-gray-600 hover:underline" onClick={cancelEdit}>
                        Cancelar
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500 mt-2">
        Si proporcionas <b>Fecha pago</b>, se respeta. Si no, se calcula con <b>días {useBusinessDays ? 'hábiles' : 'naturales'}</b> en alta
        y con el switch correspondiente en edición.
      </p>
    </div>
  );
}
