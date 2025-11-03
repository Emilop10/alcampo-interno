// src/lib/forecast.ts
export type Method = 'avg6' | 'trend' | 'exp' | 'weighted';

export function normalize(ws: number[]) {
  const safe = ws.map(w => Math.max(0, Number(w) || 0));
  const s = safe.reduce((a,b)=>a+b, 0) || 1;
  return safe.map(w => w / s);
}

// --- métodos base ---
export function forecastAvg6m(series: number[], horizon: number) {
  const last6 = series.slice(-6);
  const mean = last6.length ? last6.reduce((a,b)=>a+b,0)/last6.length : 0;
  return Array(horizon).fill(mean);
}

export function forecastTrend(series: number[], horizon: number) {
  const n = series.length;
  if (n < 2) return forecastAvg6m(series, horizon);
  let sumT=0, sumY=0, sumTT=0, sumTY=0;
  for (let i=0;i<n;i++){
    const t=i+1, y=series[i];
    sumT+=t; sumY+=y; sumTT+=t*t; sumTY+=t*y;
  }
  const denom = n*sumTT - sumT*sumT || 1;
  const b = (n*sumTY - sumT*sumY)/denom;
  const a = (sumY - b*sumT)/n;

  const out:number[] = [];
  for (let k=1;k<=horizon;k++){
    const t = n+k;
    out.push(a + b*t);
  }
  return out;
}

export function forecastExp(series: number[], horizon: number, alpha=0.5) {
  if (!series.length) return Array(horizon).fill(0);
  let s = series[0];
  for (let i=1;i<series.length;i++) s = alpha*series[i] + (1-alpha)*s;
  return Array(horizon).fill(s);
}

// --- mezcla ponderada ---
export function forecastWeighted(series: number[], horizon: number, wAvg=0.2, wTrend=0.3, wExp=0.5) {
  const [p1,p2,p3] = normalize([wAvg,wTrend,wExp]);
  const a = forecastAvg6m(series, horizon);
  const b = forecastTrend(series, horizon);
  const c = forecastExp(series, horizon);
  return a.map((_,i)=> p1*a[i] + p2*b[i] + p3*c[i]);
}
