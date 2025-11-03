'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';

export default function Home() {
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Pantalla de login
  if (!session) {
    return (
      <div className="max-w-md mx-auto p-6">
        <h2 className="text-xl font-semibold mb-4">Accede a ALCAMPO CUERNAVACA</h2>
        <Auth supabaseClient={supabase} appearance={{ theme: ThemeSupa }} providers={[]} />
      </div>
    );
  }

  // Landing con dos módulos
  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Elige un módulo</h1>

      <div className="grid gap-6 sm:grid-cols-2">
        {/* Proveedores (todo lo ya construido) */}
        <Link
          href="/dashboard"
          className="group block rounded-2xl border bg-white p-6 shadow-sm hover:shadow-md transition"
          aria-label="Ir al módulo de Proveedores"
        >
          <div className="flex items-start gap-4">
            <div className="rounded-xl border p-3"><span className="text-2xl">🏪</span></div>
            <div>
              <h2 className="text-lg font-semibold group-hover:underline">Proveedores</h2>
              <p className="mt-1 text-sm text-gray-600">
                Entra al módulo operativo: Dashboard, Ventas, Compras, Pagos, Planeador,
                Proyecciones, Factores y Parámetros.
              </p>
            </div>
          </div>
        </Link>

        {/* Contabilidad y Finanzas (independiente, vacío por ahora) */}
        <Link
          href="/finance"
          className="group block rounded-2xl border bg-white p-6 shadow-sm hover:shadow-md transition"
          aria-label="Ir al módulo de Contabilidad y Finanzas"
        >
          <div className="flex items-start gap-4">
            <div className="rounded-xl border p-3"><span className="text-2xl">📊</span></div>
            <div>
              <h2 className="text-lg font-semibold group-hover:underline">Contabilidad y Finanzas</h2>
              <p className="mt-1 text-sm text-gray-600">
                Módulo independiente. Por ahora está vacío; aquí agregaremos reportes y herramientas financieras.
              </p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
