import { brl } from "../api";
import type { ResultadoPncp } from "../../../shared/pncp";

export const pncpProcedure = (result: ResultadoPncp) =>
  result.modality && result.procurementNumber
    ? `${result.modality} nº ${result.procurementNumber}`
    : result.procurementNumber
      ? `Contratação nº ${result.procurementNumber}`
      : `Contratação PNCP nº ${result.control}`;

export const pncpDate = (value?: string) => {
  if (!value) return "";
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + "T12:00:00" : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR");
};

export async function createPncpEvidence(result: ResultadoPncp, consultedAt: string) {
  const width = 1500;
  const horizontalPadding = 90;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("O navegador não conseguiu gerar o comprovante do PNCP.");

  const wrap = (value: string, maxWidth: number, font: string) => {
    context.font = font;
    const words = value.split(/\s+/).filter(Boolean).flatMap((word) => {
      if (context.measureText(word).width <= maxWidth) return [word];
      const parts: string[] = [];
      let part = "";
      for (const character of word) {
        if (context.measureText(part + character).width <= maxWidth) part += character;
        else { if (part) parts.push(part); part = character; }
      }
      if (part) parts.push(part);
      return parts;
    });
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const attempt = current ? `${current} ${word}` : word;
      if (context.measureText(attempt).width <= maxWidth || !current) current = attempt;
      else { lines.push(current); current = word; }
    }
    if (current) lines.push(current);
    return lines.length ? lines : ["—"];
  };

  const rows = [
    ["Contratação", pncpProcedure(result)],
    ["Processo administrativo", result.processNumber ? `nº ${result.processNumber}` : "Não informado pelo órgão"],
    ["Órgão", result.organization || "Não informado"],
    ["Localidade", result.municipality ? `${result.municipality}/${result.state || "—"}` : result.state || "Não informada"],
    ["Situação", result.statusName || "Não informada"],
    ["Item", `${result.itemNumber || "—"} — ${result.description}`],
    ["Quantidade e unidade", `${result.quantity || "—"} ${result.unit || "unidade não informada"}`],
    ["Valor unitário estimado", brl(result.unitValue)],
    ["Publicação no PNCP", pncpDate(result.publicationDate) || "Não informada"],
    ["Abertura das propostas", pncpDate(result.proposalOpeningDate) || "Não informada"],
    ["Número de controle PNCP", result.control],
    ["Endereço oficial", result.sourceUrl],
  ];
  const rowLayouts = rows.map(([label, value]) => ({ label, lines: wrap(value, width - 560, "28px Arial") }));
  const bodyHeight = rowLayouts.reduce((sum, row) => sum + Math.max(74, row.lines.length * 38 + 26), 0);
  canvas.width = width;
  canvas.height = 250 + bodyHeight + 160;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#14382e";
  context.fillRect(0, 0, canvas.width, 190);
  context.fillStyle = "#ffffff";
  context.font = "bold 44px Arial";
  context.fillText("COMPROVANTE DE CONSULTA AO PNCP", horizontalPadding, 78);
  context.font = "26px Arial";
  context.fillText("Pesquisa de preços — Licita", horizontalPadding, 126);
  context.fillStyle = "#d8a93e";
  context.fillRect(horizontalPadding, 153, 390, 7);

  let y = 225;
  rowLayouts.forEach((row, index) => {
    const height = Math.max(74, row.lines.length * 38 + 26);
    context.fillStyle = index % 2 ? "#f7f9f8" : "#eef4f1";
    context.fillRect(horizontalPadding, y, width - horizontalPadding * 2, height - 6);
    context.fillStyle = "#37534b";
    context.font = "bold 25px Arial";
    context.fillText(row.label, horizontalPadding + 24, y + 43);
    context.fillStyle = "#172b25";
    context.font = "28px Arial";
    row.lines.forEach((line, lineIndex) => context.fillText(line, 480, y + 41 + lineIndex * 38));
    y += height;
  });

  context.fillStyle = "#52665f";
  context.font = "23px Arial";
  context.fillText(`Consulta registrada em ${pncpDate(`${consultedAt}T12:00:00`) || new Date().toLocaleDateString("pt-BR")}.`, horizontalPadding, y + 45);
  context.font = "20px Arial";
  wrap("Este comprovante reproduz os dados retornados pela consulta oficial ao PNCP. A conferência integral pode ser realizada pelo endereço registrado acima.", width - horizontalPadding * 2, "20px Arial").forEach((line, index) => context.fillText(line, horizontalPadding, y + 83 + index * 29));

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 1));
  if (!blob) throw new Error("Não foi possível montar o arquivo de comprovação do PNCP.");
  const safeProcedure = pncpProcedure(result).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 90);
  return new File([blob], `Comprovante-PNCP-${safeProcedure}-item-${result.itemNumber || "sem-numero"}.png`, { type: "image/png" });
}
