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
