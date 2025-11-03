import Link from 'next/link';

export const metadata = {
  title: 'Contabilidad y Finanzas — ALCAMPO CUERNAVACA',
};

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  // Nota: este layout vive DENTRO del layout raíz. El NavBar general ya NO aparece en /finance/*
  return (
    <section>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">Contabilidad y Finanzas</h1>
        <Link href="/" className="text-sm underline">← Volver al inicio</Link>
      </div>
      {children}
    </section>
  );
}
