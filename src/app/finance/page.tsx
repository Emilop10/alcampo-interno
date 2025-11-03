// src/app/finance/page.tsx
import Link from 'next/link';

export default function FinanceHome() {
  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Contabilidad y Finanzas</h1>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {/* Corte del día */}
        <Link
          href="/finance/daily"
          className="group block rounded-2xl border bg-white p-6 shadow-sm hover:shadow-md transition"
        >
          <h3 className="text-lg font-semibold group-hover:underline">Corte del día</h3>
          <p className="mt-1 text-sm text-gray-600">
            Captura ventas por familia y entradas del día; calcula abono al revolvente,
            faltante/sobrante y gastos operativos del día.
          </p>
        </Link>

        {/* Depósitos y cobros */}
        <Link
          href="/finance/collections"
          className="group block rounded-2xl border bg-white p-6 shadow-sm hover:shadow-md transition"
        >
          <h3 className="text-lg font-semibold group-hover:underline">Depósitos y cobros</h3>
          <p className="mt-1 text-sm text-gray-600">
            Registra tarjetas, efectivo y anticipos sin factura; pagos de clientes con
            factura en banco y vales. Incluye resumen mensual.
          </p>
        </Link>

        {/* Cobranza / resumen mensual */}
        <Link
          href="/finance/cobranza"
          className="group block rounded-2xl border bg-white p-6 shadow-sm hover:shadow-md transition"
        >
          <h3 className="text-lg font-semibold group-hover:underline">Cobranza y resumen mensual</h3>
          <p className="mt-1 text-sm text-gray-600">
            Depósitos (por tipo), vales, metas por familia (cartuchos/comerciales/importados),
            requerido para proveedores y disponible para gasto operativo.
          </p>
        </Link>

        {/* Proveedores */}
        <Link
          href="/finance/proveedores"
          className="group block rounded-2xl border bg-white p-6 shadow-sm hover:shadow-md transition"
        >
          <h3 className="text-lg font-semibold group-hover:underline">Proveedores</h3>
          <p className="mt-1 text-sm text-gray-600">
            Captura facturas de proveedores, seguimiento de pagos (pendiente/pagado)
            y exportación a Excel.
          </p>
        </Link>

        {/* Tecnos / Decam */}
        <Link
          href="/finance/tecnos-decam"
          className="group block rounded-2xl border bg-white p-6 shadow-sm hover:shadow-md transition"
        >
          <h3 className="text-lg font-semibold group-hover:underline">Tecnos y Decam</h3>
          <p className="mt-1 text-sm text-gray-600">
            Módulo gemelo de Proveedores para Tecnos/Decam: registro de facturas, control de pagos,
            palomita de Drive y exportación independiente.
          </p>
        </Link>

        {/* Gastos */}
        <Link
          href="/finance/gastos"
          className="group block rounded-2xl border bg-white p-6 shadow-sm hover:shadow-md transition"
        >
          <h3 className="text-lg font-semibold group-hover:underline">Gastos</h3>
          <p className="mt-1 text-sm text-gray-600">
            Estructura para gastos fijos y variables; se conecta con GO y reportes.
          </p>
        </Link>

        {/* Control de facturas */}
        <Link
          href="/finance/facturas-control"
          className="group block rounded-2xl border bg-white p-6 shadow-sm hover:shadow-md transition"
        >
          <h3 className="text-lg font-semibold group-hover:underline">Control de facturas</h3>
          <p className="mt-1 text-sm text-gray-600">
            Lleva el folio inicial / final diario por serie (CAR/TK/IMP),
            registra canceladas o no timbradas y exporta al Excel con el formato físico.
          </p>
        </Link>

        {/* 🗓️ Calendario de pagos */}
        <Link
          href="/finance/payments-calendar"
          className="group block rounded-2xl border bg-white p-6 shadow-sm hover:shadow-md transition"
        >
          <h3 className="text-lg font-semibold group-hover:underline">Calendario de pagos</h3>
          <p className="mt-1 text-sm text-gray-600">
            Programa pagos por día (proveedores, operativos, impuestos, nómina y bancos),
            marca como pagado, usa recurrentes y exporta a Excel.
          </p>
        </Link>
      </div>
    </div>
  );
}
