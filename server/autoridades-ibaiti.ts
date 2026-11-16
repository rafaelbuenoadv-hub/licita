// Secretários e responsáveis do Município de Ibaiti/PR, conforme a página de secretarias da Prefeitura
// e as portarias de nomeação publicadas no Diário Oficial Eletrônico (consulta em 16/11/2026).
// Não inclui RG nem CPF: o cadastro guarda só o que vai nas peças do processo.
const DOC = "https://www.ibaiti.pr.gov.br/diario-oficial-eletronico/download-busca/";
export interface AutoridadePadrao {
  unidade: string; sigla: string; titular: string; cargo: string; ato: string; publicacao: string; link: string;
  email: string; telefone: string; obs: string;
}
const a = (unidade: string, sigla: string, titular: string, cargo: string, ato: string, edicao: string, doc: number, email: string, telefone: string, obs = ""): AutoridadePadrao =>
  ({ unidade, sigla, titular, cargo, ato, publicacao: `Diário Oficial Eletrônico do Município, edição nº ${edicao}`, link: `${DOC}${doc}/`, email, telefone, obs });

export const AUTORIDADES_IBAITI: AutoridadePadrao[] = [
  a("Secretaria Municipal de Administração", "", "Claudio Girolimetto", "Secretário Municipal de Administração", "Portaria nº 564, de 26/05/2026", "3121, de 26/05/2026", 5387, "administracao@ibaiti.pr.gov.br", "(43) 3546-7450"),
  a("Secretaria Municipal de Agricultura, Pecuária, Meio Ambiente e Turismo", "", "Fernando de Oliveira", "Secretário Municipal de Agricultura, Pecuária, Meio Ambiente e Turismo", "Portaria nº 609, de 01/07/2026", "3145, de 01/07/2026", 5691, "agricultura@ibaiti.pr.gov.br", ""),
  a("Secretaria Municipal de Assistência Social, da Mulher, da Pessoa Idosa, da Pessoa com Deficiência e da Igualdade Racial", "SASMIDIR", "Andréa Carlos Dias", "Secretária Municipal de Assistência Social, da Mulher, da Pessoa Idosa, da Pessoa com Deficiência e da Igualdade Racial", "Portaria nº 237, de 11/06/2025", "2891, de 11/06/2025", 2653, "assistencia@ibaiti.pr.gov.br", "(43) 3546-7495",
    "Denominação do cargo ajustada pela Portaria nº 307, de 20/08/2025 (Lei Municipal nº 1268/2025), que manteve a numeração da Portaria nº 237/2025."),
  a("Secretaria Municipal de Assuntos Institucionais", "SEMAI", "Valdirene Bento", "Secretária Municipal de Assuntos Institucionais", "Portaria nº 004, de 02/01/2025", "2786, de 02/01/2025", 1283, "atendimento@ibaiti.pr.gov.br", "(43) 3546-7450"),
  a("Secretaria Municipal de Educação", "SEDUC", "Denise da Silva Lima", "Secretária Municipal de Educação", "Portaria nº 008, de 03/01/2025", "2787, de 03/01/2025", 1292, "secretaria.educacao@ibaiti.pr.gov.br", "(43) 3546-7460"),
  a("Secretaria Municipal de Finanças", "SEFI", "Luis Carlos Bernardi Gelinski", "Secretário Municipal de Finanças", "Portaria nº 003, de 02/01/2025", "2786, de 02/01/2025", 1282, "financas@ibaiti.pr.gov.br", "(43) 3546-7450"),
  a("Secretaria Municipal de Gestão", "", "Lais Delmonico Barreto", "Secretária Municipal de Gestão", "Portaria nº 576, de 02/06/2026", "3126, de 02/06/2026", 5456, "gestao@ibaiti.pr.gov.br", "(43) 3546-7497"),
  a("Secretaria Municipal de Governo", "", "Elaine de Oliveira Serial", "Secretária Municipal de Governo", "Portaria nº 063, de 21/01/2025", "2798, de 21/01/2025", 1434, "sec.governo@ibaiti.pr.gov.br", "(43) 3546-7450",
    "Efeitos da nomeação retroativos a 02/01/2025."),
  a("Secretaria Municipal de Obras, Viação e Serviços Urbanos", "", "Antonio Vincenzi", "Secretário Municipal de Obras, Viação e Serviços Urbanos", "Portaria nº 570, de 02/06/2026", "3126, de 02/06/2026", 5450, "engenharia@ibaiti.pr.gov.br", "(43) 3546-7497",
    "Nomeado em substituição à titular afastada por licença-maternidade (Portaria nº 555, de 13/05/2026)."),
  a("Secretaria Municipal de Planejamento e Orçamento", "SEMPO", "Rafael Augusto Bueno de Oliveira", "Secretário Municipal de Planejamento e Orçamento", "Portaria nº 353, de 03/11/2025", "2990, de 03/11/2025", 3719, "convenios@ibaiti.pr.gov.br", "(43) 3546-7450"),
  a("Secretaria Municipal de Saúde", "SESA", "Amabily da Silva Laverde", "Secretária Municipal de Saúde", "Portaria nº 009, de 03/01/2025", "2787, de 03/01/2025", 1296, "semusa@ibaiti.pr.gov.br", "(43) 3546-7481"),
  a("Secretaria Municipal de Trabalho e Emprego", "SMTE", "Alexandre Sousa Nunes", "Secretário Municipal de Trabalho e Emprego", "Portaria nº 007, de 03/01/2025", "2787, de 03/01/2025", 1291, "emprego@ibaiti.pr.gov.br", "(43) 3546-1000"),
  a("Procuradoria Geral do Município", "PGM", "Vagner Batista Alves", "Procurador Geral do Município", "Portaria nº 001, de 02/01/2025", "2786, de 02/01/2025", 1280, "procuradoria@ibaiti.pr.gov.br", "(43) 3546-7450"),
  a("Coordenadoria do Sistema de Controle Interno", "", "Elaine Aparecida de Freitas", "Coordenadora do Sistema de Controle Interno", "Portaria nº 202, de 14/05/2025", "2871, de 14/05/2025", 2397, "controleinterno@ibaiti.pr.gov.br", "(43) 3546-7450"),
  a("IBAITIPREVI - Instituto de Previdência dos Servidores Públicos de Ibaiti", "IBAITIPREVI", "Everton Luiz Nóbile", "Diretor Presidente do IBAITIPREVI", "Portaria nº 030, de 08/01/2025", "3022, de 19/12/2025", 4102, "ibaitiprevi@ibaiti.pr.gov.br", "(43) 3546-7450",
    "Numeração da Portaria nº 030/2025 mantida pela Portaria nº 397, de 19/12/2025, cujo texto é o do link."),
];
