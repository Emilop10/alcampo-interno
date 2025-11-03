'use client';
import { supabase } from '@/lib/supabase';
import { useEffect, useState } from 'react';

type Param = { key:string; value_num:number|null; value_text:string|null; value_date:string|null; };

const keys = [
  { key:'credit_days_default', label:'Días crédito default' },
  { key:'ma_horizon_months', label:'Horizonte MA (meses)' },
  { key:'safety_margin_pct', label:'Margen seguridad (0.10 = 10%)' },
  { key:'demand_adjust_factor', label:'Ajuste demanda (1.0 = neutro)' },
  { key:'green_threshold', label:'Umbral verde (0.90 = 90%)' },
  { key:'factor_utilidad_default', label:'Factor utilidad default' },
];

export default function SettingsPage() {
  const [rows, setRows] = useState<Param[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data } = await supabase.from('app_params').select('*');
    setRows((data as any[])||[]);
  };
  useEffect(()=>{load();},[]);

  const getVal = (k:string) => rows.find(r=>r.key===k)?.value_num ?? '';
  const setVal = (k:string, v:string) => {
    setRows(prev => prev.map(r=> r.key===k ? {...r, value_num: v===''? null : Number(v)} : r ));
  };

  const save = async () => {
    setSaving(true);
    for (const r of rows) {
      await supabase.from('app_params').upsert({ key:r.key, value_num: r.value_num, value_text: r.value_text, value_date: r.value_date });
    }
    setSaving(false);
  };

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Parámetros</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {keys.map(k=>(
          <div key={k.key} className="border rounded p-3 bg-white">
            <div className="text-sm">{k.label}</div>
            <input
              className="border p-2 rounded w-full mt-2"
              value={String(getVal(k.key))}
              onChange={e=>setVal(k.key, e.target.value)}
              placeholder="numérico"
            />
          </div>
        ))}
      </div>
      <button onClick={save} className="mt-4 px-4 py-2 rounded bg-black text-white" disabled={saving}>
        {saving ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  );
}
