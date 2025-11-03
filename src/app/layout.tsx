// src/app/layout.tsx
import './globals.css';
import Link from 'next/link';
import NavBar from '@/components/NavBar';

export const metadata = {
  title: 'ALCAMPO CUERNAVACA',
  description: 'Compras por flujo y utilidad',
  themeColor: '#ffffff', // fuerza barras del sistema en claro
} as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      // ✅ Fuerza modo claro a nivel navegador y anula el @media dark del CSS
      style={
        {
          colorScheme: 'light',
          // Sobrescribe variables para toda la app (heredan a children)
          ['--background' as any]: '#ffffff',
          ['--foreground' as any]: '#171717',
        } as React.CSSProperties
      }
    >
      <head>
        {/* ✅ Asegura UI nativa (inputs/scrollbars) en claro */}
        <meta name="color-scheme" content="light" />
      </head>
      <body className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-6xl p-6">
          <header className="mb-6 flex items-center justify-between gap-4">
            {/* Logo: landing de módulos */}
            <Link href="/" className="flex items-center gap-3 shrink-0">
              <img
                src="/alcampo-logo.png"
                alt="ALCAMPO CUERNAVACA"
                className="h-18 md:h-22 w-auto"
              />
              <span className="text-xl md:text-2xl font-bold tracking-wide">
                ALCAMPO CUERNAVACA
              </span>
            </Link>

            {/* Nav SOLO en módulo Proveedores (NavBar ya lo oculta en / y /finance/*) */}
            <NavBar />
          </header>

          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
