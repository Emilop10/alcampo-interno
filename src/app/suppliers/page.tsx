'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

type Supplier = {
  id: string;
  name: string;
  credit_days: number | null;
  factor: number | null;
  notes: string | null;
};

export default function SuppliersPage() {
  // lista
  const [rows, setRows] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  // alta
  const [name, setName] = useState('');
  const [creditDays, setCreditDays] = useState<string>('30');
  const [factor, setFactor] = useState<string>('1.70');
  const [notes, setNotes] = useState('');

  // edición
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ name: string; credit_days: string; factor: string; notes: string }>({
    name: '',
    credit_days: '30',
    factor: '1.70',
    notes: '',
  });

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('id,name,credit_days,factor,notes')
        .order('name', { ascending: true });
      if (error) {
        setMsg('❌ Error cargando proveedores: ' + error.message);
      } else {
        setRows((data || []) as Supplier[]);
      }
      setLoading(false);
    })();
  }, []);

  // ---- Alta ----
  const onAdd = useCallback(async () => {
    setMsg('');
    const nm = name.trim();
    if (!nm) { setMsg('Pon un nombre.'); return; }
    const cd = Number(creditDays) || 0;
    const fx = Number(factor);
    const payload = { name: nm, credit_days: cd, factor: isNaN(fx) ? null : fx, notes: notes.trim() || null };

    const { data, error } = await supabase
      .from('suppliers')
      .insert(payload)
      .select('id,name,credit_days,factor,notes')
      .single();

    if (error) { setMsg('❌ No se pudo agregar: ' + error.message); return; }

    setRows(prev => [...prev, data as Supplier].sort((a,b)=>a.name.localeCompare(b.name)));
    setName(''); setCreditDays('30'); setFactor('1.70'); setNotes('');
    setMsg('✅ Proveedor agregado.');
  }, [name, creditDays, factor, notes]);

  // ---- Edición ----
  const startEdit = (r: Supplier) => {
    setEditId(r.id);
    setEdit({
      name: r.name || '',
      credit_days: String(r.credit_days ?? 30),
      factor: r.factor != null ? String(r.factor) : '1.70',
      notes: r.notes ?? '',
    });
    setMsg('');
  };
  const cancelEdit = () => setEditId(null);

  const saveEdit = useCallback(async () => {
    if (!editId) return;
    const payload = {
      name: edit.name.trim(),
      credit_days: Number(edit.credit_days) || 0,
      factor: Number(edit.factor),
      notes: edit.notes.trim() || null,
    };

    const { error } = await supabase.from('suppliers').update(payload).eq('id', editId);
    if (error) { setMsg('❌ No se pudo actualizar: ' + error.message); return; }

    setRows(prev =>
      prev.map(r => r.id === editId ? { ...r, ...payload } as Supplier : r)
         .sort((a,b)=>a.name.localeCompare(b.name))
    );
    setEditId(null);
    setMsg('✅ Proveedor actualizado.');
  }, [editId, edit]);

  // ---- Borrar ----
  const onDelete = useCallback(async (id: string) => {
    if (!confirm('¿Eliminar este proveedor?')) return;
    const prev = rows;
    setRows(p => p.filter(r => r.id !== id)); // optimista
    const { error } = await supabase.from('suppliers').delete().eq('id', id);
    if (error) {
      setRows(prev); // rollback
      setMsg('❌ No se pudo eliminar: ' + error.message);
    } else {
      setMsg('🗑️ Proveedor eliminado.');
    }
  }, [rows]);

  return (
    <div className="max-w-6xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4">Proveedores</h2>

      {/* Alta */}
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <div>
          <label className="block text-sm mb-1">Nombre</label>
          <input className="border rounded px-2 py-2 w-60" value={name} onChange={e=>setName(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm mb-1">Días crédito</label>
          <input type="number" min={0} className="border rounded px-2 py-2 w-32 text-right"
                 value={creditDays} onChange={e=>setCreditDays(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm mb-1">Factor utilidad (ej. 1.70)</label>
          <input type="number" step="0.01" className="border rounded px-2 py-2 w-40 text-right"
                 value={factor} onChange={e=>setFactor(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm mb-1">Notas</label>
          <input className="border rounded px-2 py-2 w-72" value={notes} onChange={e=>setNotes(e.target.value)} />
        </div>
        <div>
          <button className="px-4 py-2 rounded text-white bg-black hover:bg-gray-800" onClick={onAdd}>Agregar</button>
        </div>
      </div>

      {msg && <div className="mb-3 text-sm">{msg}</div>}

      {/* Tabla */}
      <div className="border rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2">Proveedor</th>
              <th className="text-left p-2">Días crédito</th>
              <th className="text-left p-2">Factor</th>
              <th className="text-left p-2">Notas</th>
              <th className="text-left p-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="p-3 text-gray-500">Cargando…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="p-3 text-gray-500">Sin proveedores.</td></tr>
            ) : rows.map(r => {
              const editing = editId === r.id;
              if (!editing) {
                return (
                  <tr key={r.id} className="border-t">
                    <td className="p-2">{r.name}</td>
                    <td className="p-2">{r.credit_days ?? '—'}</td>
                    <td className="p-2">{r.factor != null ? Number(r.factor).toFixed(2) : '—'}</td>
                    <td className="p-2">{r.notes || '—'}</td>
                    <td className="p-2 space-x-3">
                      <button className="text-blue-600 hover:underline" onClick={()=>startEdit(r)}>Editar</button>
                      <button className="text-red-600 hover:underline" onClick={()=>onDelete(r.id)}>Eliminar</button>
                    </td>
                  </tr>
                );
              }
              // fila en modo edición
              return (
                <tr key={r.id} className="border-t bg-yellow-50">
                  <td className="p-2">
                    <input className="border rounded px-2 py-1 w-60"
                           value={edit.name}
                           onChange={e=>setEdit(prev=>({ ...prev, name: e.target.value }))}/>
                  </td>
                  <td className="p-2">
                    <input type="number" min={0} className="border rounded px-2 py-1 w-28 text-right"
                           value={edit.credit_days}
                           onChange={e=>setEdit(prev=>({ ...prev, credit_days: e.target.value }))}/>
                  </td>
                  <td className="p-2">
                    <input type="number" step="0.01" className="border rounded px-2 py-1 w-28 text-right"
                           value={edit.factor}
                           onChange={e=>setEdit(prev=>({ ...prev, factor: e.target.value }))}/>
                  </td>
                  <td className="p-2">
                    <input className="border rounded px-2 py-1 w-72"
                           value={edit.notes}
                           onChange={e=>setEdit(prev=>({ ...prev, notes: e.target.value }))}/>
                  </td>
                  <td className="p-2 space-x-3">
                    <button className="text-green-700 hover:underline" onClick={saveEdit}>Guardar</button>
                    <button className="text-gray-700 hover:underline" onClick={cancelEdit}>Cancelar</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
