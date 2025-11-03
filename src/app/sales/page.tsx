import Link from "next/link";

const years = [2025, 2026];

export default function SalesYearsPage() {
  return (
    <div className="max-w-5xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4">Ventas · Años</h2>

      <div className="grid md:grid-cols-2 gap-4">
        {years.map((y) => (
          <div key={y} className="border rounded p-3">
            <div className="text-xs text-gray-500">{y}</div>
            <div className="font-semibold text-lg">{y}</div>
            <Link
              href={`/sales/${y}`}
              className="inline-block mt-2 text-sm underline"
            >
              Ver meses →
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
