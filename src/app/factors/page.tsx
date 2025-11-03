"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

// ---- helpers ----
const mxn = (n: number) =>
  Number(n || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

type SupplierRow = {
  id: string;
  name: string;
  factor: number | null; // almacenado como 1.7 (o 170 => se corrige)
};

export default function FactorsPage() {
  // -------- Calculadora rápida --------
  const [ventas, setVentas] = useState<string>("1000.00");
  const [factor, setFactor] = useState<string>("1.70");

  const ventasNum = useMemo(() => Number(ventas) || 0, [ventas]);
  const factorNum = useMemo(() => {
    const f = Number(factor) || 0;
    return f > 10 ? f / 100 : f; // corrige 170 -> 1.70
  }, [factor]);

  const costoCalc = useMemo(() => (factorNum > 0 ? ventasNum / factorNum : 0), [ventasNum, factorNum]);
  const margenCalc = useMemo(() => ventasNum - costoCalc, [ventasNum, costoCalc]);

  // -------- Proveedores (sólo nombre + factor) --------
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg("");
      const { data, error } = await supabase
        .from("suppliers")
        .select("id,name,factor")
        .order("name");

      if (error) {
        console.error(error);
        setMsg("❌ Error cargando proveedores: " + error.message);
        setRows([]);
        setLoading(false);
        return;
      }

      const shaped: SupplierRow[] = (data || []).map((r: any) => {
        const raw = r.factor as number | null;
        const fixed = raw != null ? (raw > 10 ? raw / 100 : raw) : null;
        return { id: r.id, name: r.name, factor: fixed };
      });

      setRows(shaped);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4">Factores</h2>

      {/* Calculadora rápida */}
      <div className="mb-6 border rounded p-4">
        <h3 className="font-semibold mb-3">Calculadora rápida</h3>
        <div className="grid md:grid-cols-5 gap-3 items-end">
          <div>
            <label className="block text-sm mb-1">Ventas $</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="w-full border rounded px-2 py-2 text-right"
              value={ventas}
              onChange={(e) => setVentas(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Factor</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              className="w-full border rounded px-2 py-2 text-right"
              value={factor}
              onChange={(e) => setFactor(e.target.value)}
            />
          </div>
          <div className="md:col-span-3 grid md:grid-cols-3 gap-3">
            <div>
              <div className="text-sm text-gray-500">Para proveedores</div>
              <div className="text-lg font-semibold">{mxn(costoCalc)}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Gastos operativos</div>
              <div className="text-lg font-semibold">{mxn(margenCalc)}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Chequeo</div>
              <div className="text-lg font-semibold">{mxn(costoCalc + margenCalc)}</div>
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Fórmula: costo = ventas ÷ factor; margen = ventas − costo.
        </p>
      </div>

      {/* Tabla por proveedor (sin pronósticos) */}
      <div className="text-sm text-gray-600 mb-3">
        Para cada proveedor se usa su <b>factor</b>; si no tiene, se usa el factor de la calculadora.
        La fila de <b>Totales</b> refleja los montos de la calculadora (no es la suma de las filas).
      </div>
      {msg && <div className="mb-3 text-sm">{msg}</div>}

      <div className="border rounded overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2">Proveedor</th>
              <th className="text-right p-2">Factor</th>
              <th className="text-right p-2">Para proveedores</th>
              <th className="text-right p-2">Gastos operativos</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="p-3 text-gray-500">Cargando…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-3 text-gray-500">Sin proveedores.</td>
              </tr>
            ) : (
              <>
                {rows.map((r) => {
                  const f = r.factor && r.factor > 0 ? r.factor : factorNum || 1.7;
                  const costo = f > 0 ? ventasNum / f : 0;
                  const op = ventasNum - costo;
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="p-2">{r.name}</td>
                      <td className="p-2 text-right">{f.toFixed(2)}</td>
                      <td className="p-2 text-right">{mxn(costo)}</td>
                      <td className="p-2 text-right">{mxn(op)}</td>
                    </tr>
                  );
                })}
                <tr className="border-t font-semibold bg-gray-50">
                  <td className="p-2">Totales</td>
                  <td className="p-2 text-right">—</td>
                  <td className="p-2 text-right">{mxn(costoCalc)}</td>
                  <td className="p-2 text-right">{mxn(margenCalc)}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
