'use client';

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { supabase } from '@/lib/supabase';

type Family = { key: 'CARTUCHOS' | 'COMERCIALES' | 'IMPORTADOS'; name: string; factor: number };
type Line = { family_key: Family['key']; sales: number; factor: number; providers: number; go_base: number };

function toISODateLocal(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 170 -> 1.70 ; 1.7 -> 1.70 ; guarda normalizado
function fixFactor(x: number) {
  const v = Number(x || 0);
  if (!isFinite(v) || v <= 0) return 1.7;
  return v > 10 ? v / 100 : v;
}

const mxn = (n: number) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

/**
 * Permite que el usuario escriba decimales sin que React “se coma” el punto.
 * - Acepta "1.", "1.7", "1,7"
 * - Solo convierte a número para cálculos/guardar
 */
function parseFactorInput(text: string) {
  const t = (text ?? '').trim().replace(',', '.');
  // Si está vacío o es solo ".", devolvemos NaN para no romper el tecleo
  if (!t || t === '.') return NaN;
  return Number(t);
}

/**
 * Normaliza el texto del factor al salir del campo:
 * - Si puso 170 -> lo deja como "1.7000"
 * - Si puso 1.7 -> "1.7000"
 * - Si está inválido -> "1.7000"
 */
function normalizeFactorText(text: string) {
  const n = parseFactorInput(text);
  const fixed = fixFactor(isFinite(n) ? n : 1.7);
  return fixed.toFixed(4);
}

/**
 * Sanea el texto mientras escribe:
 * - permite dígitos
 * - permite un solo punto decimal
 * - convierte coma a punto
 * - NO aplica fixFactor aquí (para no romper el tecleo)
 */
function sanitizeFactorText(text: string) {
  let t = (text ?? '').replace(',', '.').replace(/[^\d.]/g, '');
  const firstDot = t.indexOf('.');
  if (firstDot !== -1) {
    t = t.slice(0, firstDot + 1) + t.slice(firstDot + 1).replace(/\./g, '');
  }
  return t;
}

function selectAllOnFocus(e: React.FocusEvent<HTMLInputElement>) {
  // Selecciona todo al enfocar, así es más fácil reemplazar rápido
  requestAnimationFrame(() => e.target.select());
}

export default function FinanceDailyPage() {
  // Fecha del corte (default: hoy local)
  const [day, setDay] = useState<string>(toISODateLocal(new Date()));

  // Control de existencia del corte actual
  const [dayId, setDayId] = useState<string | null>(null);

  // Familias (para inicializar factores desde DB; módulo independiente)
  const [families, setFamilies] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  // Entradas y ajustes del día
  const [cash, setCash] = useState<number>(0);            // efectivo -> BBVA
  const [cardsDay, setCardsDay] = useState<number>(0);    // tarjetas del día (ventas con tarjeta)
  const [cards, setCards] = useState<number>(0);          // tarjetas depositadas HOY -> Banamex
  const [clientDeps, setClientDeps] = useState<number>(0);// transferencias de clientes -> BBVA
  const [vouchers, setVouchers] = useState<number>(0);    // vales (restan a GO)
  const [cardFees, setCardFees] = useState<number>(0);    // comisiones tarjetas (restan a GO)
  const [notes, setNotes] = useState<string>('');

  // Ventas por familia
  const [salesC, setSalesC] = useState<number>(0);
  const [salesCom, setSalesCom] = useState<number>(0);
  const [salesImp, setSalesImp] = useState<number>(0);

  // ✅ Factores editables como TEXTO
  const [fCInput, setFCInput] = useState<string>('1.7000');
  const [fComInput, setFComInput] = useState<string>('1.8200');
  const [fImpInput, setFImpInput] = useState<string>('1.5300');

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg('');
      const { data, error } = await supabase
        .from('finance_families')
        .select('key,name,factor')
        .order('name', { ascending: true });

      if (error) {
        console.error(error);
        setFamilies([]);
      } else {
        const fams = (data || []) as Family[];
        setFamilies(fams);
        const map = new Map(fams.map(f => [f.key, f.factor]));

        if (map.has('CARTUCHOS')) setFCInput(fixFactor(Number(map.get('CARTUCHOS'))).toFixed(4));
        if (map.has('COMERCIALES')) setFComInput(fixFactor(Number(map.get('COMERCIALES'))).toFixed(4));
        if (map.has('IMPORTADOS')) setFImpInput(fixFactor(Number(map.get('IMPORTADOS'))).toFixed(4));
      }
      setLoading(false);
    })();
  }, []);

  // Cálculos por familia
  const lines: Line[] = useMemo(() => {
    // Importante: para cálculos convertimos texto -> número; si está incompleto ("1.") parseFactorInput devuelve 1 (ok)
    // y si está vacío o "." devuelve NaN, ahí usamos 1 para no romper división.
    const rawFC = parseFactorInput(fCInput);
    const rawFCom = parseFactorInput(fComInput);
    const rawFImp = parseFactorInput(fImpInput);

    const fCNum = fixFactor(isFinite(rawFC) ? rawFC : 1.7);
    const fComNum = fixFactor(isFinite(rawFCom) ? rawFCom : 1.7);
    const fImpNum = fixFactor(isFinite(rawFImp) ? rawFImp : 1.7);

    const L: Line[] = [
      { family_key: 'CARTUCHOS',   sales: salesC,   factor: fCNum,   providers: 0, go_base: 0 },
      { family_key: 'COMERCIALES', sales: salesCom, factor: fComNum, providers: 0, go_base: 0 },
      { family_key: 'IMPORTADOS',  sales: salesImp, factor: fImpNum, providers: 0, go_base: 0 },
    ].map(l => {
      const providers = (Number(l.sales || 0)) / (l.factor || 1);
      return { ...l, providers, go_base: Number(l.sales || 0) - providers };
    });

    return L;
  }, [salesC, salesCom, salesImp, fCInput, fComInput, fImpInput]);

  const totals = useMemo(() => {
    const providersTotal = lines.reduce((s, r) => s + r.providers, 0);
    const goBase = lines.reduce((s, r) => s + r.go_base, 0);

    // Meta de abono diario (revolvente Banamex) = Cartuchos ÷ factor_cartuchos
    const metaAbono = lines.find(l => l.family_key === 'CARTUCHOS')?.providers || 0;

    // Faltante / sobrante vs tarjetas depositadas HOY (Banamex)
    const faltante = Math.max(0, metaAbono - Number(cards || 0));
    const sobrante = Math.max(0, Number(cards || 0) - metaAbono);

    // Pendiente de tarjetas (cuando lo cobrado con tarjeta > depositado hoy)
    const pendienteTarjetas = Math.max(0, Number(cardsDay || 0) - Number(cards || 0));

    // ✅ Gastos operativos del día (según tu Excel): SIN restar faltante
    const goDelDia = goBase - Number(vouchers || 0) - Number(cardFees || 0);

    // Recomendación de transferencia inmediata
    const recommendation =
      faltante > 0
        ? { direction: 'BBVA → Banamex', amount: faltante }
        : (sobrante > 0 ? { direction: 'Banamex → BBVA', amount: sobrante } : { direction: '—', amount: 0 });

    return {
      providersTotal,
      goBase,
      metaAbono,
      faltante,
      sobrante,
      pendienteTarjetas,
      goDelDia,
      recommendation,
    };
  }, [lines, cardsDay, cards, vouchers, cardFees]);

  function resetDayForm() {
    setCash(0); setCardsDay(0); setCards(0); setClientDeps(0);
    setVouchers(0); setCardFees(0); setNotes('');
    setSalesC(0); setSalesCom(0); setSalesImp(0);
  }

  async function loadDayData(d: string) {
    try {
      setMsg('');
      const { data: dayRow, error } = await supabase
        .from('finance_days')
        .select('*')
        .eq('day', d)
        .single();

      if (error || !dayRow) {
        setDayId(null);
        resetDayForm();
        return;
      }

      setDayId(dayRow.id);

      setCash(Number(dayRow.cash_mxn || 0));
      setCards(Number(dayRow.cards_mxn || 0));
      setClientDeps(Number(dayRow.client_deposits_mxn || 0));
      setVouchers(Number(dayRow.vouchers_mxn || 0));
      setCardFees(Number(dayRow.card_fees_mxn || 0));
      setNotes(dayRow.notes || '');
      const t = dayRow.totals || {};
      setCardsDay(Number(t.cards_day || 0));

      const { data: lineRows } = await supabase
        .from('finance_day_lines')
        .select('family_key,sales_mxn,factor')
        .eq('day_id', dayRow.id);

      const byKey = new Map((lineRows || []).map((r: any) => [r.family_key, r]));
      const lc = byKey.get('CARTUCHOS');
      const lcom = byKey.get('COMERCIALES');
      const lim = byKey.get('IMPORTADOS');

      setSalesC(Number(lc?.sales_mxn || 0));
      setSalesCom(Number(lcom?.sales_mxn || 0));
      setSalesImp(Number(lim?.sales_mxn || 0));

      if (lc?.factor != null) setFCInput(fixFactor(Number(lc.factor)).toFixed(4));
      if (lcom?.factor != null) setFComInput(fixFactor(Number(lcom.factor)).toFixed(4));
      if (lim?.factor != null) setFImpInput(fixFactor(Number(lim.factor)).toFixed(4));
    } catch (e) {
      console.error('loadDayData error', e);
      setMsg('No se pudo cargar el corte de ese día.');
    }
  }

  useEffect(() => { if (day) loadDayData(day); }, [day]);

  const [saving, setSaving] = useState(false);
  async function saveDay() {
    try {
      setSaving(true);
      setMsg('');

      const dayRow = {
        day,
        cash_mxn: Number(cash || 0),
        cards_mxn: Number(cards || 0),
        client_deposits_mxn: Number(clientDeps || 0),
        vouchers_mxn: Number(vouchers || 0),
        card_fees_mxn: Number(cardFees || 0),
        notes,
        totals: {
          providers_total: +totals.providersTotal.toFixed(2),
          go_base: +totals.goBase.toFixed(2),
          meta_abono: +totals.metaAbono.toFixed(2),
          faltante: +totals.faltante.toFixed(2),
          sobrante: +totals.sobrante.toFixed(2),
          cards_day: +Number(cardsDay || 0).toFixed(2),
          cards_pending_to_banamex: +totals.pendienteTarjetas.toFixed(2),
          go_del_dia: +totals.goDelDia.toFixed(2),
          recommendation: totals.recommendation,
        },
      };

      const { data: up, error: e1 } = await supabase
        .from('finance_days')
        .upsert(dayRow, { onConflict: 'day' })
        .select('id')
        .single();
      if (e1) throw e1;

      const newId = up!.id as string;
      setDayId(newId);

      // ✅ Factor a guardar: viene del INPUT (texto) -> number -> fixFactor -> toFixed(4)
      const fcNum = fixFactor(isFinite(parseFactorInput(fCInput)) ? parseFactorInput(fCInput) : 1.7);
      const fcomNum = fixFactor(isFinite(parseFactorInput(fComInput)) ? parseFactorInput(fComInput) : 1.7);
      const fimpNum = fixFactor(isFinite(parseFactorInput(fImpInput)) ? parseFactorInput(fImpInput) : 1.7);

      const lineRows = lines.map(l => {
        let factorToSave = l.factor;
        if (l.family_key === 'CARTUCHOS') factorToSave = fcNum;
        if (l.family_key === 'COMERCIALES') factorToSave = fcomNum;
        if (l.family_key === 'IMPORTADOS') factorToSave = fimpNum;

        return {
          day_id: newId,
          family_key: l.family_key,
          sales_mxn: +Number(l.sales || 0).toFixed(2),
          factor: +fixFactor(factorToSave).toFixed(4),
          providers_mxn: +l.providers.toFixed(2),
          go_base_mxn: +l.go_base.toFixed(2),
        };
      });

      await supabase.from('finance_day_lines').delete().eq('day_id', newId);
      const { error: e2 } = await supabase.from('finance_day_lines').insert(lineRows);
      if (e2) throw e2;

      await loadDayData(day);

      setMsg('✅ Corte guardado.');
    } catch (err: any) {
      console.error(err);
      setMsg('❌ No se pudo guardar: ' + (err?.message ?? err));
    } finally {
      setSaving(false);
    }
  }

  const [deleting, setDeleting] = useState(false);
  async function deleteDay() {
    if (!dayId) return;
    const ok = window.confirm(`¿Eliminar el corte del ${day}? Esta acción no se puede deshacer.`);
    if (!ok) return;

    try {
      setDeleting(true);
      setMsg('');
      const { error } = await supabase
        .from('finance_days')
        .delete()
        .eq('id', dayId);
      if (error) throw error;

      setDayId(null);
      resetDayForm();
      setMsg('🗑️ Corte eliminado.');
    } catch (err: any) {
      console.error(err);
      setMsg('❌ No se pudo eliminar: ' + (err?.message ?? err));
    } finally {
      setDeleting(false);
    }
  }

  const setNum = (fn: (n: number)=>void) => (e: ChangeEvent<HTMLInputElement>) =>
    fn(Number((e.target.value ?? '').replace(',', '.')) || 0);

  return (
    <div className="max-w-6xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4">Corte del día (Finanzas)</h2>

      {/* Fecha */}
      <div className="flex items-end gap-3 mb-4">
        <div>
          <label className="block text-sm mb-1">Fecha</label>
          <input type="date" className="border rounded px-2 py-2" value={day} onChange={(e)=>setDay(e.target.value)} />
        </div>
      </div>

      {/* Entradas y ajustes */}
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <div className="border rounded p-3">
          <div className="text-sm font-medium mb-2">Entradas del día</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">Efectivo (BBVA)
              <input className="mt-1 w-full border rounded px-2 py-1 text-right" value={cash} onChange={setNum(setCash)} />
            </label>
            <label className="text-sm">Tarjetas del día (ventas con tarjeta)
              <input className="mt-1 w-full border rounded px-2 py-1 text-right" value={cardsDay} onChange={setNum(setCardsDay)} />
            </label>
            <label className="text-sm">Tarjetas depositadas HOY (Banamex)
              <input className="mt-1 w-full border rounded px-2 py-1 text-right" value={cards} onChange={setNum(setCards)} />
            </label>
            <label className="text-sm">Depósitos de clientes (BBVA)
              <input className="mt-1 w-full border rounded px-2 py-1 text-right" value={clientDeps} onChange={setNum(setClientDeps)} />
            </label>
          </div>
        </div>

        <div className="border rounded p-3">
          <div className="text-sm font-medium mb-2">Ajustes de gastos operativos</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">Vales del día
              <input className="mt-1 w-full border rounded px-2 py-1 text-right" value={vouchers} onChange={setNum(setVouchers)} />
            </label>
            <label className="text-sm">Comisiones tarjetas
              <input className="mt-1 w-full border rounded px-2 py-1 text-right" value={cardFees} onChange={setNum(setCardFees)} />
            </label>
          </div>
        </div>
      </div>

      {/* Ventas por familia y factores */}
      <div className="border rounded overflow-x-auto mb-4">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2">Familia</th>
              <th className="text-right p-2">Ventas del día</th>
              <th className="text-right p-2">Factor</th>
              <th className="text-right p-2">Proveedores (ventas ÷ factor)</th>
              <th className="text-right p-2">Gastos operativos base</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t">
              <td className="p-2">Cartuchos</td>
              <td className="p-2 text-right">
                <input className="w-32 border rounded px-2 py-1 text-right" value={salesC} onChange={setNum(setSalesC)} />
              </td>

              {/* ✅ FIX: factor editable sin romper el tecleo */}
              <td className="p-2 text-right">
                <input
                  className="w-24 border rounded px-2 py-1 text-right"
                  inputMode="decimal"
                  value={fCInput}
                  onFocus={selectAllOnFocus}
                  onChange={(e) => setFCInput(sanitizeFactorText(e.target.value))}
                  onBlur={() => setFCInput(normalizeFactorText(fCInput))}
                />
              </td>

              <td className="p-2 text-right">{mxn(lines[0]?.providers || 0)}</td>
              <td className="p-2 text-right">{mxn(lines[0]?.go_base || 0)}</td>
            </tr>

            <tr className="border-t">
              <td className="p-2">Comerciales</td>
              <td className="p-2 text-right">
                <input className="w-32 border rounded px-2 py-1 text-right" value={salesCom} onChange={setNum(setSalesCom)} />
              </td>

              <td className="p-2 text-right">
                <input
                  className="w-24 border rounded px-2 py-1 text-right"
                  inputMode="decimal"
                  value={fComInput}
                  onFocus={selectAllOnFocus}
                  onChange={(e) => setFComInput(sanitizeFactorText(e.target.value))}
                  onBlur={() => setFComInput(normalizeFactorText(fComInput))}
                />
              </td>

              <td className="p-2 text-right">{mxn(lines[1]?.providers || 0)}</td>
              <td className="p-2 text-right">{mxn(lines[1]?.go_base || 0)}</td>
            </tr>

            <tr className="border-t">
              <td className="p-2">Importados</td>
              <td className="p-2 text-right">
                <input className="w-32 border rounded px-2 py-1 text-right" value={salesImp} onChange={setNum(setSalesImp)} />
              </td>

              <td className="p-2 text-right">
                <input
                  className="w-24 border rounded px-2 py-1 text-right"
                  inputMode="decimal"
                  value={fImpInput}
                  onFocus={selectAllOnFocus}
                  onChange={(e) => setFImpInput(sanitizeFactorText(e.target.value))}
                  onBlur={() => setFImpInput(normalizeFactorText(fImpInput))}
                />
              </td>

              <td className="p-2 text-right">{mxn(lines[2]?.providers || 0)}</td>
              <td className="p-2 text-right">{mxn(lines[2]?.go_base || 0)}</td>
            </tr>

            <tr className="border-t bg-gray-50 font-semibold">
              <td className="p-2">Totales</td>
              <td className="p-2 text-right">{mxn(Number(salesC)+Number(salesCom)+Number(salesImp))}</td>
              <td className="p-2 text-right">—</td>
              <td className="p-2 text-right">{mxn(totals.providersTotal)}</td>
              <td className="p-2 text-right">{mxn(totals.goBase)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Resultados y recomendaciones */}
      <div className="grid md:grid-cols-4 gap-3 mb-3">
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Meta abono (Cartuchos ÷ factor)</div>
          <div className="text-lg font-semibold">{mxn(totals.metaAbono)}</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Tarjetas del día</div>
          <div className="text-lg font-semibold">{mxn(cardsDay)}</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Tarjetas depositadas HOY</div>
          <div className="text-lg font-semibold">{mxn(cards)}</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500">Faltante / Sobrante hoy</div>
          <div className="text-lg font-semibold">
            {totals.faltante > 0 ? `Faltan ${mxn(totals.faltante)}` : totals.sobrante > 0 ? `Sobran ${mxn(totals.sobrante)}` : '—'}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3 mb-3">
        <div className="border rounded p-3">
          <div className="text-sm">Recomendación de transferencia (hoy)</div>
          <div className="text-lg font-semibold">
            {totals.recommendation.direction} {totals.recommendation.amount ? `· ${mxn(totals.recommendation.amount)}` : ''}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Objetivo: en Banamex dejar solo la meta de abono diario; resto en BBVA para Comerciales/Importados y gastos.
          </p>
        </div>

        <div className="border rounded p-3">
          <div className="text-sm">Pendiente tarjetas Banamex (cuando caiga, enviar a BBVA)</div>
          <div className="text-lg font-semibold">{mxn(totals.pendienteTarjetas)}</div>
          <p className="text-xs text-gray-500 mt-1">
            Diferencia entre tarjetas del día y lo depositado HOY en Banamex.
          </p>
        </div>
      </div>

      <div className="border rounded p-3 mb-3">
        <div className="text-sm">Gastos operativos del día</div>
        <div className="text-lg font-semibold">{mxn(totals.goDelDia)}</div>
        <p className="text-xs text-gray-500 mt-1">
          GO_del_día = GO_base − Vales − Comisiones_tarjeta.
        </p>
      </div>

      {/* Notas y acciones */}
      <div className="flex items-end gap-3 mb-2">
        <label className="flex-1 text-sm">Notas
          <textarea className="mt-1 w-full border rounded px-2 py-2" value={notes} onChange={(e)=>setNotes(e.target.value)} />
        </label>

        <div className="flex items-center gap-2">
          <button
            onClick={saveDay}
            disabled={saving || deleting}
            className={`px-4 py-2 rounded text-white ${saving ? 'bg-gray-400' : 'bg-black hover:bg-gray-800'}`}
          >
            {saving ? 'Guardando…' : 'Guardar corte'}
          </button>

          <button
            onClick={deleteDay}
            disabled={!dayId || saving || deleting}
            className={`px-4 py-2 rounded border ${
              !dayId || saving || deleting
                ? 'text-gray-400 border-gray-300 cursor-not-allowed'
                : 'text-red-600 border-red-600 hover:bg-red-50'
            }`}
            title={dayId ? 'Eliminar corte de este día' : 'No hay corte guardado para este día'}
          >
            {deleting ? 'Eliminando…' : 'Eliminar corte'}
          </button>
        </div>

        {msg && <span className="text-sm">{msg}</span>}
      </div>
    </div>
  );
}
