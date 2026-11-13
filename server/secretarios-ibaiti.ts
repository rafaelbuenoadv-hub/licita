// Dados institucionais consultados em 13/11/2026.
const portal = "https://www.ibaiti.pr.gov.br/prefeitura/departamento";
const diario = "https://www.ibaiti.pr.gov.br/diario-oficial-eletronico/ler/gerar-comprovante/3065/";

export const secretariosIbaiti = [
  { codigo: "administracao", secretaria: "Administração", nome: "Claudio Girolimetto", email: "administracao@ibaiti.pr.gov.br", telefone: "(43) 3546-7450" },
  { codigo: "agricultura", secretaria: "Agricultura, Pecuária, Meio Ambiente e Turismo", nome: "Fernando de Oliveira", email: "agricultura@ibaiti.pr.gov.br", telefone: "" },
  { codigo: "assistencia-social", secretaria: "Assistência Social", nome: "Andrea Carlos Dias", email: "assistencia@ibaiti.pr.gov.br", telefone: "(43) 3546-7495" },
  { codigo: "assuntos-institucionais", secretaria: "Assuntos Institucionais", nome: "Valdirene Bento", email: "atendimento@ibaiti.pr.gov.br", telefone: "(43) 3546-7450" },
  { codigo: "cultura-esporte-lazer", secretaria: "Cultura, Esporte e Lazer", nome: "Rogério Pereira da Rosa", email: "", telefone: "", fonte: diario },
  { codigo: "educacao", secretaria: "Educação", nome: "Denise da Silva Lima", email: "secretaria.educacao@ibaiti.pr.gov.br", telefone: "(43) 3546-7460" },
  { codigo: "financas", secretaria: "Finanças", nome: "Luiz Carlos Bernardi Gelinski", email: "financas@ibaiti.pr.gov.br", telefone: "(43) 3546-7450" },
  { codigo: "gestao", secretaria: "Gestão", nome: "Lais Delmonico Barreto", email: "gestao@ibaiti.pr.gov.br", telefone: "(43) 3546-7497" },
  { codigo: "governo", secretaria: "Governo", nome: "Elaine de Oliveira Serial", email: "sec.governo@ibaiti.pr.gov.br", telefone: "(43) 3546-7450" },
  { codigo: "obras", secretaria: "Obras, Viação e Serviços Urbanos", nome: "Antônio Vincenzi", email: "engenharia@ibaiti.pr.gov.br", telefone: "(43) 3546-7497" },
  { codigo: "planejamento-orcamento", secretaria: "Planejamento e Orçamento", nome: "Rafael Augusto Bueno de Oliveira", email: "convenios@ibaiti.pr.gov.br", telefone: "(43) 3546-7450" },
  { codigo: "saude", secretaria: "Saúde", nome: "Amabily da Silva Laverde", email: "semusa@ibaiti.pr.gov.br", telefone: "(43) 3546-7481 / 7480" },
  { codigo: "trabalho-emprego", secretaria: "Trabalho e Emprego", nome: "Alexandre Sousa Nunes", email: "emprego@ibaiti.pr.gov.br", telefone: "(43) 3546-1000" },
].map((s) => ({ ...s, fonte: s.fonte ?? portal }));

const atos: Record<string, [string, string]> = {
  administracao: ["564/2026", "https://www.ibaiti.pr.gov.br/legislacao/detalhe/22440/pspan-stylebackground-colorrgb255255255colorrgb515151portaria-n564-2026-nomear-claudio-girolimetto-secretario-de-administracaospanp"],
  agricultura: ["609/2026", "https://ibaiti.pr.gov.br/legislacao/detalhe/22499/pspan-stylebackground-colorrgb255255255colorrgb515151portaria-n609-2026-nomear-fernando-de-oliveira-secretario-de-agriculturaspanp/"],
  "assistencia-social": ["237/2025", "https://www.ibaiti.pr.gov.br/legislacao/lista/2025/categoria/9/portarias/page/6"],
  "assuntos-institucionais": ["004/2025", "https://www.ibaiti.pr.gov.br/public/admin/globalarq/diario-eletronico/diario/R2ZAw2Ac2xasT3A3.pdf"],
  "cultura-esporte-lazer": ["469/2026", diario],
  educacao: ["008/2025", "https://www.ibaiti.pr.gov.br/public/admin/globalarq/licitacao/arquivo/3d197a737c461df91f0597ba84f7bf95.pdf"],
  financas: ["003/2025", "https://www.ibaiti.pr.gov.br/legislacao/detalhe/20652/pportaria-n003-2025-nomear-luis-carlos-bernardi-gelinski-secretario-de-financasp/"],
  gestao: ["576/2026", "https://www.ibaiti.pr.gov.br/public/admin/globalarq/diario-eletronico/diario/aTcA2232ZRwAAxs3.pdf"],
  governo: ["063/2025", "https://www.ibaiti.pr.gov.br/legislacao/detalhe/20719/pspan-stylebackground-colorrgb255255255colorrgb515151portaria-n063-nomear-elaine-de-oliveira-serial-secretaria-de-governospanp/"],
  "planejamento-orcamento": ["353/2025", "https://www.ibaiti.pr.gov.br/public/admin/globalarq/diario-eletronico/diario/Z232T2AA3aAwxRsc.pdf"],
  saude: ["009/2025", "https://www.ibaiti.pr.gov.br/public/admin/globalarq/licitacao/arquivo/e0c3965b713253d8dc7070fbcacb5554.pdf"],
  "trabalho-emprego": ["007/2025", "https://www.ibaiti.pr.gov.br/admin/globalarq/diario-eletronico/diario/ZAwR3AcTA2xa223s.pdf"],
};

export const secretariosIbaitiComAtos = secretariosIbaiti.map((s) => ({
  ...s, portaria: atos[s.codigo]?.[0] ?? null, fonte_portaria: atos[s.codigo]?.[1] ?? "",
}));
