"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type MonthSummary = { ym: string; label: string; total: number };

function monthLabel(yy: number, mm: number) {
  return new Date(yy, mm - 1, 1).toLocaleDateString("es-MX", {
    month: "long",
    year: "numeric",
  });
}
const mxn = (n: number) =>
  n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

export default function SalesYearPage() {
  const params = useParams<{ year: string }>();
  const router = useRouter();

  const yStr = params?.year ?? "";
  const year = Number(yStr);

  useEffect(() => {
    if (!year || Number.isNaN(year)) router.push("/sales");
  }, [year, router]);

  // límites como strings SIN timezone
  const startStr = useMemo(() => `${year}-01-01`, [year]);
  const endStr = useMemo(() => `${year + 1}-01-01`, [year]);

  const [months, setMonths] = useState<MonthSummary[]>([]);

  useEffect(() => {
    if (!year) return;
    (async () => {
      const { data } = await supabase
        .from("sales")
        .select("date,amount")
        .gte("date", startStr)
        .lt("date", endStr);

      // Agrupa por "YYYY-MM" usando el TEXTO de la fecha (sin Date())
      const map = new Map<string, number>();
      (data || []).forEach((r: any) => {
        const ym = String(r.date).slice(0, 7); // seguro contra TZ
        map.set(ym, (map.get(ym) || 0) + Number(r.amount || 0));
      });

      const list: MonthSummary[] = [];
      for (let m = 1; m <= 12; m++) {
        const ym = `${year}-${String(m).padStart(2, "0")}`;
        list.push({ ym, label: monthLabel(year, m), total: map.get(ym) || 0 });
      }
      setMonths(list.reverse()); // más recientes arriba
    })();
  }, [year, startStr, endStr]);

  if (!year) return null;

  return (
    <div className="max-w-5xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4">Ventas · {year}</h2>

      <div className="grid md:grid-cols-2 gap-4">
        {months.map((m) => (
          <Link
            key={m.ym}
            href={`/sales/m/${m.ym}`}
            className="block border rounded p-3 hover:bg-gray-50"
          >
            <div className="text-xs text-gray-500">{m.ym}</div>
            <div className="font-semibold capitalize">{m.label}</div>
            <div className="text-sm mt-1">
              Total del mes: <b>{mxn(m.total)}</b>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
