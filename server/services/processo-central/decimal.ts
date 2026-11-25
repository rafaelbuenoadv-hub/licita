/** Decimal positivo em escala fixa; rejeita precisão excedente e entradas ambíguas. */
export function escala(v: unknown, casas: number): bigint | null {
  if (typeof v !== "number" && typeof v !== "string") return null;
  if (typeof v === "number" && !Number.isFinite(v)) return null;
  const s=String(v).trim();
  if (!/^\d+(\.\d+)?$/.test(s) || s.length>40) return null;
  const [a,b=""]=s.split(".");
  if (b.length>casas) return null;
  const n=BigInt(a+b.padEnd(casas,"0"));
  return n>0n?n:null;
}
export function arredondar(n:bigint,d:bigint):bigint {
  if(n<0n||d<=0n) throw new RangeError("Decimal inválido");
  return (n*2n+d)/(d*2n);
}
export function formatar(n:bigint,casas:number):string {
  const s=n.toString().padStart(casas+1,"0");
  return casas?s.slice(0,-casas)+"."+s.slice(-casas):s;
}
