"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Supplier = { id: string; name: string };
type SaleRow = {
  id: string;
  date: string;
  amount: number;
  supplier_id: string;
  supplier_name: string;
};

function parseYm(ym: string) {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const yy = Number(m[1]), mm = Number(m[2]) - 1;
  return new Date(yy, mm, 1);
}
function toISODate(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function monthEndExclusive(d: Date) { const x = new Date(d); x.setMonth(x.getMonth() + 1, 1); return x; }
function monthLabel(d: Date) { return d.toLocaleDateString("es-MX", { month: "long", year: "numeric" }); }
const mxn = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

export default function SalesMonthPage() {
  const params = useParams<{ ym: string }>();
  const router = useRouter();

  const ym = params?.ym || "";
  const monthStart = useMemo(() => parseYm(ym), [ym]);
  const monthEnd   = useMemo(() => (monthStart ? monthEndExclusive(monthStart) : null), [monthStart]);

  useEffect(() => { if (!monthStart) router.push("/sales"); }, [monthStart, router]);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [day, setDay] = useState<string>("");
  const [amount, setAmount] = useState<string>("0.00");
  const [msg, setMsg] = useState("");

  // edición
  const [editId, setEditId] = useState<string|null>(null);
  const [edit, setEdit] = useState<{supplier_id: string; date: string; amount: string}>({
    supplier_id: "", date: "", amount: "0.00"
  });

  const amountNumber = useMemo(() => Number(String(amount).replace(/,/g, "")), [amount]);
  const isValid = !!supplierId && !!day && amountNumber > 0;

  useEffect(() => {
    if (!monthStart || !monthEnd) return;
    (async () => {
      const [{ data: s }, { data: sales }] = await Promise.all([
        supabase.from("suppliers").select("id,name").order("name"),
        supabase
          .from("sales")
          .select("id,date,amount,supplier_id, suppliers(name)")
          .gte("date", toISODate(monthStart!))
          .lt("date", toISODate(monthEnd!))
          .order("date", { ascending: true }),
      ]);

      setSuppliers((s || []) as Supplier[]);
      setRows(
        (sales || []).map((r: any) => ({
          id: r.id,
          date: r.date,
          amount: Number(r.amount || 0),
          supplier_id: r.supplier_id,
          supplier_name: r.suppliers?.name || "—",
        }))
      );

      const today = new Date();
      const defaultDate = today >= monthStart! && today < monthEnd! ? today : monthStart!;
      setDay(toISODate(defaultDate));
    })();
  }, [monthStart, monthEnd]);

  const totalMes = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);
  const totalesPorDia = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => m.set(r.date, (m.get(r.date) || 0) + r.amount));
    return Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [rows]);

  async function onSave() {
    if (!isValid || !monthStart || !monthEnd) return;
    setMsg("");

    const d = new Date(day + "T00:00:00");
    if (d < monthStart! || d >= monthEnd!) {
      setMsg("⚠️ La fecha debe estar dentro del mes seleccionado.");
      return;
    }

    const payload = {
      supplier_id: supplierId,
      date: toISODate(d),
      month: toISODate(monthStart!),
      amount: Number(amountNumber),
    };

    const { error } = await supabase.from("sales").insert(payload);
    if (error) { setMsg("❌ Error: " + error.message); return; }

    setMsg("✅ Venta registrada.");
    setAmount("0.00");

    const { data: sales } = await supabase
      .from("sales")
      .select("id,date,amount,supplier_id, suppliers(name)")
      .gte("date", toISODate(monthStart!))
      .lt("date", toISODate(monthEnd!))
      .order("date", { ascending: true });

    setRows(
      (sales || []).map((r: any) => ({
        id: r.id,
        date: r.date,
        amount: Number(r.amount || 0),
        supplier_id: r.supplier_id,
        supplier_name: r.suppliers?.name || "—",
      }))
    );
  }

  async function onDelete(id: string) {
    await supabase.from("sales").delete().eq("id", id);
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  // ---- EDICIÓN ----
  function startEdit(r: SaleRow) {
    setEditId(r.id);
    setEdit({
      supplier_id: r.supplier_id,
      date: r.date,
      amount: r.amount.toFixed(2),
    });
    setMsg("");
  }

  function cancelEdit() {
    setEditId(null);
  }

  async function saveEdit() {
    if (!editId || !monthStart || !monthEnd) return;
    const d = new Date(edit.date + "T00:00:00");
    if (d < monthStart! || d >= monthEnd!) {
      setMsg("⚠️ La fecha debe estar dentro del mes.");
      return;
    }
    const payload = {
      supplier_id: edit.supplier_id,
      date: toISODate(d),
      month: toISODate(monthStart!),
      amount: Number(edit.amount),
    };
    const { error } = await supabase.from("sales").update(payload).eq("id", editId);
    if (error) { setMsg("❌ Error al actualizar: " + error.message); return; }

    setRows(prev => prev.map(r =>
      r.id === editId
        ? {
            ...r,
            date: payload.date,
            amount: payload.amount,
            supplier_id: payload.supplier_id,
            supplier_name: suppliers.find(s => s.id === payload.supplier_id)?.name || r.supplier_name
          }
        : r
    ));
    setEditId(null);
    setMsg("✅ Venta actualizada.");
  }
  // ------------------

  if (!monthStart || !monthEnd) return null;

  return (
    <div className="max-w-5xl mx-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold capitalize">Ventas · {monthLabel(monthStart!)}</h2>
        <Link href={`/sales/${monthStart!.getFullYear()}`} className="text-sm underline">
          ◀︎ Volver a meses
        </Link>
      </div>

      <div className="mb-4 border rounded p-3">
        <div className="text-sm text-gray-600">
          Mes: <b>{toISODate(monthStart!)}</b> a <b>{toISODate(addDays(monthEnd!, -1))}</b>
        </div>
        <div className="mt-1">Total del mes: <b>{mxn(totalMes)}</b></div>
      </div>

      {/* Form alta */}
      <div className="grid md:grid-cols-5 gap-3 items-end mb-4">
        <div className="md:col-span-2">
          <label className="block text-sm mb-1">Proveedor…</label>
          <select className="w-full border rounded px-2 py-2" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Selecciona…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm mb-1">Día</label>
          <input
            type="date"
            className="w-full border rounded px-2 py-2"
            min={toISODate(monthStart!)}
            max={toISODate(addDays(monthEnd!, -1))}
            value={day}
            onChange={(e) => setDay(e.target.value)}
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
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div>
          <button
            className={`w-full px-4 py-2 rounded text-white ${isValid ? "bg-black hover:bg-gray-800" : "bg-gray-400 cursor-not-allowed"}`}
            onClick={onSave}
            disabled={!isValid}
          >
            Guardar
          </button>
        </div>
      </div>

      {msg && <div className="mb-4 text-sm">{msg}</div>}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Totales por día */}
        <div>
          <h3 className="font-semibold mb-2">Totales por día del mes</h3>
          <div className="border rounded">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-2">Fecha</th>
                  <th className="text-right p-2">Total del día</th>
                </tr>
              </thead>
              <tbody>
                {totalesPorDia.length === 0 ? (
                  <tr><td colSpan={2} className="p-3 text-gray-500">Sin ventas aún…</td></tr>
                ) : (
                  totalesPorDia.map(([d, total]) => (
                    <tr key={d} className="border-t">
                      <td className="p-2">
                        <button className="underline" onClick={() => setDay(d)} title="Ir a ese día para capturar">
                          {d}
                        </button>
                      </td>
                      <td className="p-2 text-right">{mxn(total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detalle con edición */}
        <div>
          <h3 className="font-semibold mb-2">Ventas del mes (detalle)</h3>
          <div className="border rounded">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-2">Fecha</th>
                  <th className="text-left p-2">Proveedor</th>
                  <th className="text-right p-2">Monto</th>
                  <th className="text-left p-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={4} className="p-3 text-gray-500">Sin registros…</td></tr>
                ) : (
                  rows.map((r) => {
                    const isEditing = editId === r.id;
                    if (!isEditing) {
                      return (
                        <tr key={r.id} className="border-t">
                          <td className="p-2">{r.date}</td>
                          <td className="p-2">{r.supplier_name}</td>
                          <td className="p-2 text-right">{mxn(r.amount)}</td>
                          <td className="p-2 space-x-3">
                            <button className="text-blue-600 hover:underline" onClick={() => startEdit(r)}>Editar</button>
                            <button className="text-red-600 hover:underline"  onClick={() => onDelete(r.id)}>Eliminar</button>
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
                            min={toISODate(monthStart!)}
                            max={toISODate(addDays(monthEnd!, -1))}
                            value={edit.date}
                            onChange={(e)=>setEdit(prev=>({...prev, date: e.target.value}))}
                          />
                        </td>
                        <td className="p-2">
                          <select
                            className="border rounded px-2 py-1"
                            value={edit.supplier_id}
                            onChange={(e)=>setEdit(prev=>({...prev, supplier_id: e.target.value}))}
                          >
                            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </td>
                        <td className="p-2 text-right">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="border rounded px-2 py-1 text-right w-32"
                            value={edit.amount}
                            onChange={(e)=>setEdit(prev=>({...prev, amount: e.target.value}))}
                          />
                        </td>
                        <td className="p-2 space-x-3">
                          <button className="text-green-700 hover:underline" onClick={saveEdit}>Guardar</button>
                          <button className="text-gray-600 hover:underline" onClick={cancelEdit}>Cancelar</button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Consejo: da clic en una fecha del recuadro “Totales por día” para preseleccionarla en el formulario.
          </p>
        </div>
      </div>
    </div>
  );
}
