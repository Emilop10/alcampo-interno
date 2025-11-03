// src/lib/finance.ts
export const FACTORS = {
  cartuchos: 1.70,
  comerciales: 1.82,
  importados: 1.53,
} as const;

export type FamilySums = {
  cartuchos: number;
  comerciales: number;
  importados: number;
  total: number;
};

export function sumByFamily(
  invoices: Array<{ cartuchos: number; comerciales: number; importados: number }>
): FamilySums {
  const sums = invoices.reduce(
    (acc, r) => {
      acc.cartuchos += Number(r.cartuchos) || 0;
      acc.comerciales += Number(r.comerciales) || 0;
      acc.importados += Number(r.importados) || 0;
      return acc;
    },
    { cartuchos: 0, comerciales: 0, importados: 0 }
  );
  return { ...sums, total: sums.cartuchos + sums.comerciales + sums.importados };
}

export function requirementFromSales(
  sums: FamilySums,
  factors = FACTORS
) {
  const req = {
    cartuchos: sums.cartuchos / factors.cartuchos,
    comerciales: sums.comerciales / factors.comerciales,
    importados: sums.importados / factors.importados,
  };
  return { ...req, total: req.cartuchos + req.comerciales + req.importados };
}

export function planningNumbers(opts: {
  depositsTotal: number;
  clientPayTotal: number;
  vouchersTotal: number;
  invoices: Array<{ cartuchos: number; comerciales: number; importados: number }>;
  factors?: typeof FACTORS;
}) {
  const sums = sumByFamily(opts.invoices);
  const req = requirementFromSales(sums, opts.factors);
  const depositado = (Number(opts.depositsTotal) || 0) + (Number(opts.clientPayTotal) || 0);

  // Lo disponible antes de familias (ya descontando vales del mes)
  const disponibleAntes = depositado - (Number(opts.vouchersTotal) || 0);

  // GO final = disponibleAntes - requeridoFamilias
  const goRaw = disponibleAntes - req.total;

  const faltanteFamilias = Math.max(-goRaw, 0);
  const disponibleGO = Math.max(goRaw, 0);

  return { sums, req, depositado, disponibleAntes, disponibleGO, faltanteFamilias };
}
