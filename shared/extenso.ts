// Valor em reais por extenso, para os documentos (ex.: R$ 1.250,50 → "mil, duzentos e cinquenta reais e cinquenta centavos").
const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function ate999(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100), r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (r) partes.push(r < 20 ? UNIDADES[r] : [DEZENAS[Math.floor(r / 10)], UNIDADES[r % 10]].filter(Boolean).join(" e "));
  return partes.join(" e ");
}

const ESCALAS: [string, string][] = [["", ""], ["mil", "mil"], ["milhão", "milhões"], ["bilhão", "bilhões"]];

function inteiroPorExtenso(n: number): string {
  if (n === 0) return "zero";
  const grupos: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 1000)) grupos.push(x % 1000);
  const partes: string[] = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (!g) continue;
    const nome = i === 1 && g === 1 ? "mil" : [ate999(g), g === 1 ? ESCALAS[i][0] : ESCALAS[i][1]].filter(Boolean).join(" ");
    partes.push(nome);
  }
  // "e" antes do último grupo quando ele é menor que 100 ou é centena redonda (ex.: "mil e cinquenta", "dois mil e trezentos").
  const ultimo = grupos.find((g) => g > 0) ?? 0;
  if (partes.length > 1 && (ultimo < 100 || ultimo % 100 === 0)) return `${partes.slice(0, -1).join(", ")} e ${partes.at(-1)}`;
  return partes.join(", ");
}

export function reaisPorExtenso(valor: number) {
  const centavosTotais = Math.round(valor * 100);
  const reais = Math.floor(centavosTotais / 100), centavos = centavosTotais % 100;
  const r = reais ? `${inteiroPorExtenso(reais)}${reais >= 1_000_000 && reais % 1_000_000 === 0 ? " de" : ""} ${reais === 1 ? "real" : "reais"}` : "";
  const c = centavos ? `${inteiroPorExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}` : "";
  return [r, c].filter(Boolean).join(" e ") || "zero real";
}
