'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function NavBar() {
  const pathname = usePathname();
  // Mostrar nav SOLO en el módulo de Proveedores
  const show =
    pathname !== '/' &&
    !pathname.startsWith('/finance');

  if (!show) return null;

  return (
    <nav className="flex gap-4 text-sm overflow-x-auto whitespace-nowrap">
      <Link href="/dashboard" className="hover:underline">Dashboard</Link>
      <Link href="/suppliers" className="hover:underline">Proveedores</Link>
      <Link href="/sales" className="hover:underline">Ventas</Link>
      <Link href="/purchases" className="hover:underline">Compras</Link>
      <Link href="/payments" className="hover:underline">Pagos</Link>
      <Link href="/planner" className="hover:underline">Planeador</Link>
      <Link href="/projections" className="hover:underline">Proyecciones</Link>
      <Link href="/factors" className="hover:underline">Factores</Link>
      <Link href="/settings" className="hover:underline">Parámetros</Link>
    </nav>
  );
}
