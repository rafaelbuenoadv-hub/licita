-- Esquema do sistema. Todas as tabelas de dados levam orgao_id (direta ou indiretamente):
-- cada órgão só enxerga o que é seu.

create table if not exists orgaos (
  id serial primary key,
  nome text not null,
  cnpj text,
  municipio text,
  uf text,
  normas text not null default '',           -- regulamentos locais que a IA deve citar
  criado_em timestamptz not null default now()
);

create table if not exists normas_federais (
  tipo text not null check (tipo in ('Decreto', 'Lei')),
  numero int not null,
  ano int not null,
  assunto text not null,
  fonte text not null,
  primary key (tipo, numero, ano)
);

insert into normas_federais (tipo, numero, ano, assunto, fonte) values
  ('Lei', 14133, 2021, 'Lei de Licitações e Contratos Administrativos.',
    'https://www2.camara.leg.br/legin/fed/lei/2021/lei-14133-1-abril-2021-791222-normaatualizada-pl.pdf')
on conflict (tipo, numero, ano) do nothing;

create table if not exists normas_municipais (
  cnpj text not null,
  tipo text not null check (tipo in ('Decreto', 'Lei')),
  numero int not null,
  ano int not null,
  assunto text not null,
  fonte text not null,
  primary key (cnpj, tipo, numero, ano)
);

insert into normas_municipais (cnpj, tipo, numero, ano, assunto, fonte) values
  ('77008068000141', 'Decreto', 2532, 2024, 'Aplicação da Lei Federal nº 14.133/2021 às contratações diretas municipais.',
    'https://ibaiti.pr.gov.br/legislacao/detalhe/348/-decreto-n-2532-2024-aplicabilidade-lei-1433-2021-contratacoes-diretas/'),
  ('77008068000141', 'Decreto', 2533, 2024, 'Aplicação geral da Lei Federal nº 14.133/2021 às contratações municipais.',
    'https://www.ibaiti.pr.gov.br/legislacao/detalhe/347/-decreto-n-2533-2024-aplicabilidade-da-lei-14133-2021-contratacoes-gerais/'),
  ('77008068000141', 'Decreto', 2548, 2024, 'Regulamentação das licitações nas modalidades pregão e concorrência.',
    'https://ibaiti.pr.gov.br/legislacao/detalhe/20500/pdecreto-n-2548-2024-regulamenta-modalidade-licitacao-pregao-e-concorrencia-publicap/'),
  ('77008068000141', 'Decreto', 2549, 2024, 'Regulamentação da dispensa de licitação no Município.',
    'https://ibaiti.pr.gov.br/legislacao/detalhe/20501/pdecreto-n-2549-2024-regulamenta-nbspdispensa-licitacaop/'),
  ('77008068000141', 'Decreto', 2476, 2023, 'Retenção do Imposto de Renda nos pagamentos municipais a fornecedores e prestadores.',
    'https://www.ibaiti.pr.gov.br/public/admin/globalarq/legislacao/arquivo/909c4ea2881a241af0eab8c3539e673e.pdf'),
  ('77008068000141', 'Lei', 373, 2004, 'Processo administrativo no âmbito da Administração Pública Municipal de Ibaiti.',
    'https://ibaiti.pr.gov.br/legislacao/detalhe/17151/lei-n-373-2004-regulamento-o-processo-administrativo-no-ambito-da-administracao-publica-municipal-de-ibaiti/'),
  ('77008068000141', 'Lei', 892, 2018, 'Organização do Sistema Único de Assistência Social (SUAS) de Ibaiti.',
    'https://camaraibaiti.pr.gov.br/uploads/legislacao/33474/LoQVJpqynUC2e3A2IoS3RScUiTHD4Tzg.pdf'),
  ('77008068000141', 'Lei', 1316, 2026, 'Tratamento favorecido nas contratações municipais para ME, EPP, MEI, agricultores familiares, produtores rurais pessoas físicas e cooperativas de consumo.',
    'https://www.ibaiti.pr.gov.br/public/admin/globalarq/diario-eletronico/diario/ax2TAAcsR223ZA3w.pdf')
on conflict (cnpj, tipo, numero, ano) do nothing;

create table if not exists secretarios (
  id serial primary key,
  orgao_id int not null references orgaos(id) on delete cascade,
  codigo_portal text,
  secretaria text not null,
  nome text not null,
  email text not null default '',
  telefone text not null default '',
  fonte text not null default '',
  unique (orgao_id, codigo_portal)
);
create unique index if not exists secretarios_orgao_secretaria on secretarios(orgao_id, lower(secretaria));

create table if not exists usuarios (
  id serial primary key,
  orgao_id int not null references orgaos(id) on delete cascade,
  nome text not null,
  email text not null unique,
  cargo text not null default '',
  senha_hash text not null,
  papeis text[] not null default '{}',
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists sessoes (
  token text primary key,
  usuario_id int not null references usuarios(id) on delete cascade,
  expira_em timestamptz not null
);

-- Limite de dispensa por valor (art. 75, I e II), atualizado por decreto a cada ano.
create table if not exists limites_dispensa (
  orgao_id int not null default 0,            -- 0 = valor nacional padrão; >0 = definido pelo órgão
  ano int not null,
  inciso text not null check (inciso in ('I','II')),
  valor numeric(14,2) not null,
  fonte text not null default '',
  primary key (orgao_id, ano, inciso)
);

create table if not exists pca_itens (
  id serial primary key,
  orgao_id int not null references orgaos(id) on delete cascade,
  ano int not null,
  descricao text not null,
  classe text not null default '',            -- natureza / ramo de atividade (art. 75, § 1º, II)
  tipo text not null default 'bens',
  valor_estimado numeric(14,2) not null default 0,
  trimestre int,
  requisitante text not null default '',
  criado_em timestamptz not null default now()
);

-- Itens oficiais do PCA 2026 de Ibaiti, publicados em 10/06/2026.
alter table pca_itens alter column valor_estimado drop not null;
alter table pca_itens add column if not exists ordem_oficial int;
alter table pca_itens add column if not exists pagina_oficial int;
alter table pca_itens add column if not exists periodo_oficial text;
alter table pca_itens add column if not exists tipo_oficial text;
create unique index if not exists pca_ordem_oficial on pca_itens(orgao_id, ano, ordem_oficial);

insert into pca_itens (orgao_id, ano, ordem_oficial, pagina_oficial, periodo_oficial, descricao, requisitante, tipo_oficial, tipo, valor_estimado)
select o.id, 2026, dados.ordem, dados.pagina, dados.periodo, dados.objeto, dados.entidades, dados.tipo,
       case when dados.tipo = 'Material' then 'bens' else 'servicos' end, null
from orgaos o cross join (values
(1, 6, 'Janeiro / Fevereiro', 'Contratação de consultoria para melhorar a eficiência na edição de atos previdenciários e soluções legais.', 'IBAITIPREVI', 'Serviço'),
  (2, 6, 'Janeiro / Fevereiro', 'Contratação de empresa para a prestação de serviços de Transporte Escolar (Ano Letivo 2026).', 'PMI', 'Serviço'),
  (3, 6, 'Janeiro / Fevereiro', 'Elaboração da Avaliação Atuarial para RPPS.', 'IBAITIPREVI', 'Serviço'),
  (4, 6, 'Janeiro / Fevereiro', 'Prestação de serviços de limpeza de fossa séptica, desentupimento de canos, serviços de hidrojato e limpeza de caixa de resíduos.', 'PMI', 'Serviço'),
  (5, 6, 'Janeiro / Fevereiro', 'Registro de Preços (SRP) - Aquisição de gêneros alimentícios destinados ao consumo das Secretarias e Departamentos Municipais', 'PMI', 'Material'),
  (6, 6, 'Janeiro / Fevereiro', 'Registro de Preços (SRP) - Aquisição de materiais e sorvetes destinados ao projeto "Rua do Lazer".', 'PMI', 'Material'),
  (7, 6, 'Janeiro / Fevereiro', 'Registro de Preços (SRP) - Aquisição de Recargas de Gás Liquefeito de Petróleo.', 'PMI', 'Material'),
  (8, 6, 'Fevereiro / Março', 'Aquisição de Ar-Condicionado instalado', 'FHSMI, IBAITIPREVI, PMI', 'Material'),
  (9, 6, 'Fevereiro / Março', 'Aquisição de chocolates diversos para festividades de Páscoa destinados à distribuição aos alunos da rede municipal de ensino.', 'PMI', 'Material'),
  (10, 7, 'Fevereiro / Março', 'Aquisição de Sistema Web RHID (Plataforma Web/Controle de frequência).', 'PMI', 'Material'),
  (11, 7, 'Fevereiro / Março', 'Locação de imóvel para a Unidade Básica de Saúde São Judas Tadeu.', 'PMI', 'Serviço'),
  (12, 7, 'Fevereiro / Março', 'Registro de Preços (SRP) - Aquisição de equipamentos laboratoriais, hospitalares e material permanente Secretaria Municipal e Hospital municipal', 'PMI, FHSMI', 'Material'),
  (13, 7, 'Fevereiro / Março', 'Registro de Preços (SRP) - Aquisição de pneus destinados à frota municipal.', 'PMI', 'Material'),
  (14, 7, 'Fevereiro / Março', 'Registro de Preços (SRP) - Serviços de poda e corte de árvores de pequeno, médio e grande porte, incluindo destinação de resíduos.', 'PMI', 'Serviço'),
  (15, 7, 'Março / Abril', 'Administração/integração de estágios para estudantes na administração pública municipal.', 'PMI', 'Serviço'),
  (16, 7, 'Março / Abril', 'Prestação de serviços de manutenção preventiva e corretiva de computadores e suporte técnico de TI.', 'FHSMI', 'Serviço'),
  (17, 7, 'Março / Abril', 'Registro de Preços (SRP) - Aquisição de kits de higiene bucal para escolas municipais.', 'PMI', 'Material'),
  (18, 7, 'Março / Abril', 'Registro de Preços (SRP) - Aquisição de toner, cartuchos e demais itens para impressoras.', 'PMI', 'Material'),
  (19, 7, 'Março / Abril', 'Registro de Preços (SRP) - Lavagens e polimentos de veículos automotores.', 'PMI, FHSMI', 'Serviço'),
  (20, 8, 'Abril / Maio', 'Contratação de empresa Médica Especializada em Perícia e Avaliações Médicas jurídicas para realizarem perícias e avaliações médicas previdenciárias.', 'PMI', 'Serviço'),
  (21, 8, 'Abril / Maio', 'Contratação de empresa para prestação de serviços técnicos em radiologia (segunda a sexta-feira) na Secretaria Municipal de Saúde.', 'PMI', 'Serviço'),
  (22, 8, 'Abril / Maio', 'Fornecimento e assinatura de ferramenta de pesquisa e comparação de preços.', 'PMI', 'Serviço'),
  (23, 8, 'Abril / Maio', 'Licenciamento de Software de Gestão Hospitalar, Controle de Estoque da Farmácia e Faturamento SUS.', 'FHSMI', 'Serviço'),
  (24, 8, 'Abril / Maio', 'Registro de Preços (SRP) - Aquisição de combustíveis, com abastecimento diário na sede do futuro contratado', 'PMI, FHSMI', 'Material'),
  (25, 8, 'Abril / Maio', 'Registro de Preços (SRP) - Aquisição de material elétrico para imóveis públicos e iluminação pública', 'PMI', 'Material'),
  (26, 8, 'Abril / Maio', 'Registro de Preços (SRP) - contratação de empresa especializada para realização de exames de diagnóstico por imagem', 'PMI, FHSMI', 'Serviço'),
  (27, 8, 'Abril / Maio', 'Serviços de desenvolvimento e hospedagem de página web, emails, Diário Oficial, etc.', 'PMI', 'Serviço'),
  (28, 8, 'Maio / Junho', 'Aquisição de Enxoval Hospitalar (Cobertores e Edredons), para atender as necessidades da Fundação Hospitalar.', 'FHSMI', 'Material'),
  (29, 8, 'Maio / Junho', 'Aquisição de Medicamentos - Ordem Judicial e Indicação Social', 'PMI', 'Material'),
  (30, 9, 'Maio / Junho', 'Aquisição de Medicamentos Hospitalares a serem adquiridos pela Fundação Hospitalar de Saúde Municipal de Ibaiti', 'FHSMI', 'Material'),
  (31, 9, 'Maio / Junho', 'Aquisições de Passagens Intermunicipais', 'PMI', 'Material'),
  (32, 9, 'Maio / Junho', 'Credenciamento de empresa especializada com vistas à prestação de serviços de coleta, realização e distribuição de exames de análises clínicas.', 'FHSMI', 'Serviço'),
  (33, 9, 'Maio / Junho', 'Locação de Software para Gerenciamento do Laboratório Municipal.', 'FHSMI', 'Serviço'),
  (34, 9, 'Junho / Julho', 'Contratação de empresa de telemedicina para prestação de serviço de telemedicina cardiológica.', 'PMI', 'Serviço'),
  (35, 9, 'Junho / Julho', 'Contratação de empresa especializada em prestação de serviços de coleta e transporte dos resíduos sólidos domiciliares.', 'PMI', 'Serviço'),
  (36, 9, 'Junho / Julho', 'Contratação de empresa especializada na Divulgação de Campanhas Institucionais por meio de Painel de LED.', 'PMI', 'Serviço'),
  (37, 9, 'Junho / Julho', 'Contratação de empresa especializada na prestação de serviço de limpeza de caixa de água, dedetização e desratização dos prédios públicos.', 'PMI, FHSMI', 'Serviço'),
  (38, 9, 'Junho / Julho', 'Contratação de empresa especializada para a prestação de serviços de apoio técnico jurídico / administrativo em desenvolvimento institucional para Administração Municipal', 'PMI', 'Serviço'),
  (39, 10, 'Junho / Julho', 'Contratação de empresa especializada para prestação de serviços de manutenção preventiva, corretiva e limpeza de aparelhos de ar-condicionado.', 'PMI, FHSMI', 'Serviço'),
  (40, 10, 'Junho / Julho', 'Contratação de empresa prestadora de serviços de manutenção preventiva e corretiva para veículos e equipamentos pesados da frota municipal.', 'PMI', 'Serviço'),
  (41, 10, 'Junho / Julho', 'Contratação de Instituição de acolhimento em definitivo especializada no atendimento de pessoas com deficiências múltiplas.', 'PMI', 'Serviço'),
  (42, 10, 'Junho / Julho', 'Contratação de Instituição de acolhimento especializada em Transtorno de Espectro Autista associado à deficiência mental.', 'PMI', 'Serviço'),
  (43, 10, 'Junho / Julho', 'Contratação de Instituição de acolhimento para prestação de serviços em saúde sob o regime de tratamento e acolhimento institucional com acompanhamento especializado.', 'PMI', 'Serviço'),
  (44, 10, 'Junho / Julho', 'Contratação dos serviços de Consultoria de Valores Mobiliários, no âmbito de investimentos, voltados aos Regimes Próprios de Previdência Social.', 'IBAITIPREVI', 'Serviço'),
  (45, 10, 'Junho / Julho', 'Locação de imóvel para instalação do Posto Central de Saúde.', 'PMI', 'Serviço'),
  (46, 10, 'Junho / Julho', 'Marmitas para os pacientes da dialise, na cidade de Santo Antônio da Platina', 'PMI', 'Material'),
  (47, 10, 'Junho / Julho', 'Reforma de Pontes, ou aquisição de pranchões para o Departamento Municipal de Obras', 'PMI', 'Compra / Serviço'),
  (48, 11, 'Junho / Julho', 'Registro de Preços (SRP) - Aquisição de materiais de consumo hospitalar.', 'PMI, FHSMI', 'Material'),
  (49, 11, 'Junho / Julho', 'Registro de Preços (SRP) - Aquisição de materiais didáticos e de expediente', 'PMI, FHSMI', 'Material'),
  (50, 11, 'Junho / Julho', 'Registro de Preços (SRP) - Aquisição de materiais e insumos odontológicos para prestação de serviços de saúde bucal.', 'PMI', 'Material'),
  (51, 11, 'Junho / Julho', 'Registro de Preços (SRP) - Aquisição de Mobiliário geral itens similares', 'FHSMI, IBAITIPREVI, PMI', 'Material'),
  (52, 11, 'Junho / Julho', 'Registro de Preços (SRP) - Aquisição de mobiliário para ambientes escolares', 'PMI', 'Material'),
  (53, 11, 'Junho / Julho', 'Registro de Preços (SRP) - Aquisição de produtos de higiene e limpeza destinados para atendimento de diversas secretarias e departamentos municipais.', 'PMI, FHSMI', 'Material'),
  (54, 11, 'Junho / Julho', 'Registro de Preços (SRP) - Aquisição de refeições self-service e marmitex.', 'PMI', 'Material'),
  (55, 11, 'Junho / Julho', 'Técnicos em Segurança e Saúde do Trabalho (SESMT) para a Fundação Hospitalar.', 'FHSMI', 'Serviço'),
  (56, 11, 'Julho / Agosto', 'Contratação de empresa especializada na confecção e fornecimento de materiais gráficos', 'FHSMI, IBAITIPREVI, PMI', 'Material'),
  (57, 11, 'Julho / Agosto', 'Credenciamento de "Casas de Apoio" na cidade de Londrina para usuários do SUS.', 'PMI', 'Serviço'),
  (58, 12, 'Julho / Agosto', 'Credenciamento de Clínica Veterinária/Hospital para procedimentos de esterilização e microchipagem em cães e gatos.', 'PMI', 'Serviço'),
  (59, 12, 'Julho / Agosto', 'Locação de imóvel não residencial localizado na Av. Gov. Paulo Cruz Pimentel.', 'PMI', 'Serviço'),
  (60, 12, 'Julho / Agosto', 'Locação de tendas, palcos, sistema de som, palco e iluminação para festividades de aniversário da cidade e final de ano', 'PMI', 'Serviço'),
  (61, 12, 'Julho / Agosto', 'montagem de Kit enxoval maternidade de bebê a ser distribuído para as gestantes de Ibaiti', 'PMI, FHSMI', 'Material'),
  (62, 12, 'Julho / Agosto', 'Prestação de serviços de licenciamento de software de contabilidade pública e gestão integrada municipal.', 'PMI', 'Serviço'),
  (63, 12, 'Julho / Agosto', 'Registro de preços - Fornecimento de combustível 24 horas (diesel s10 e gasolina) para abastecimento exclusivo de veículos pertencentes a frota municipal, em viagens de ida/volta à Curitiba-PR e região metropolitana', 'PMI, FHSMI', 'Material'),
  (64, 12, 'Julho / Agosto', 'Registro de Preços (SRP) - Aquisição de Equipamentos de Informática - Computadores', 'FHSMI, IBAITIPREVI, PMI', 'Material'),
  (65, 12, 'Julho / Agosto', 'Registro de Preços (SRP) - Aquisição de Equipamentos de Informática - Impressoras e Scanners', 'FHSMI, IBAITIPREVI, PMI', 'Material'),
  (66, 12, 'Julho / Agosto', 'Registro de Preços (SRP) - Aquisição de Equipamentos de Informática - Peças Diversas', 'FHSMI, IBAITIPREVI, PMI', 'Material'),
  (67, 13, 'Julho / Agosto', 'Registro de Preços (SRP) - Aquisição de Equipamentos de Informática - Suprimentos de Informática', 'FHSMI, IBAITIPREVI, PMI', 'Material'),
  (68, 13, 'Julho / Agosto', 'Registro de Preços para aquisição de eletrodomésticos e eletroeletrônicos para diversas secretarias.', 'PMI', 'Material'),
  (69, 13, 'Julho / Agosto', 'Registro de preços para aquisição de leites com fórmulas especiais e suplementos alimentares.', 'PMI, FHSMI', 'Material'),
  (70, 13, 'Agosto / Setembro', 'Aquisição de mochilas para distribuição aos alunos das escolas municipais e centros de educação infantil (CMEIS) da rede pública de ensino', 'PMI', 'Material'),
  (71, 13, 'Agosto / Setembro', 'Aquisição de rouparia hospitalar, incluindo itens de cama, banho e confecções', 'FHSMI', 'Material'),
  (72, 13, 'Agosto / Setembro', 'Aquisição de tênis para distribuição aos alunos das escolas municipais e centros de educação infantil (CMEIS) da rede pública de ensino', 'PMI', 'Material'),
  (73, 13, 'Agosto / Setembro', 'Aquisição de uniformes para o Hospital Municipal', 'FHSMI', 'Material'),
  (74, 13, 'Agosto / Setembro', 'Chamada Pública para aquisição de produtos da agricultura familiar (Programa Nacional da Alimentação Escolar).', 'PMI', 'Material'),
  (75, 13, 'Agosto / Setembro', 'Contratação de cooperativa, formada por pessoas físicas de baixa renda, reconhecidas pelo poder público como catadores de materiais recicláveis', 'PMI', 'Serviço'),
  (76, 13, 'Agosto / Setembro', 'Contratação de Empresa para Execução de Serviços de Manutenção Corretiva e Preventiva Predial.', 'PMI', 'Serviço'),
  (77, 14, 'Agosto / Setembro', 'Credenciamento de empresas para prestação de serviços médicos para o programa Estratégia de Saúde da Família (ESF)', 'PMI', 'Serviço'),
  (78, 14, 'Agosto / Setembro', 'Registro de Preço para aquisição de serviço de arbitragem para jogos das modalidades esportivas municipais.', 'PMI', 'Serviço'),
  (79, 14, 'Agosto / Setembro', 'Registro de preço para o fornecimento de tubo de concreto. (Praticamente não solicitado)', 'PMI', 'Material'),
  (80, 14, 'Agosto / Setembro', 'Registro de preços para aquisição de materiais elétricos diversos destinados à manutenção da FHSMI', 'FHSMI', 'Material'),
  (81, 14, 'Agosto / Setembro', 'Registro de preços para aquisição de materiais, EPIs, equipamentos de consumo e uso hospitalar.', 'PMI', 'Material'),
  (82, 14, 'Agosto / Setembro', 'Registro de Preços para aquisição de medicamentos (injetáveis e para curativos) para as UBS.', 'PMI', 'Material'),
  (83, 14, 'Agosto / Setembro', 'Registro de preços para fornecimento de produtos de embalagens e utensílios.', 'PMI', 'Material'),
  (84, 14, 'Agosto / Setembro', 'Registro de preços para futura e eventual aquisição parcelada de pedra brita, pedrisco, pó de pedra, e outros.', 'PMI', 'Material'),
  (85, 14, 'Agosto / Setembro', 'Sacaria de Polietileno - Com Logo da Coleta Seletiva de Ibaiti', 'PMI', 'Material'),
  (86, 14, 'Agosto / Setembro', 'Serviço de Ativação e manutenção mensal dos elevadores verticais localizados no prédio do Hospital Municipal.', 'FHSMI', 'Serviço'),
  (87, 14, 'Agosto / Setembro', 'Serviços de hospedagem, alimentação e transporte aos pacientes encaminhados para Curitiba (TFD)', 'PMI', 'Serviço'),
  (88, 15, 'Agosto / Setembro', 'Serviços de manutenção preventiva e corretiva para os equipamentos da lavanderia hospitalar da FHSMI.', 'FHSMI', 'Serviço'),
  (89, 15, 'Agosto / Setembro', 'Uniformes, itens de segurança (EPIs), material e equipamentos para Agentes de Endemias e Agentes Comunitários de Saúde', 'PMI', 'Material'),
  (90, 15, 'Setembro / Outubro', 'Aquisição de produtos especializados para limpeza, higienização e desinfecção hospitalar.', 'FHSMI', 'Material'),
  (91, 15, 'Setembro / Outubro', 'Aquisição de saneantes para lavanderia hospitalar e produtos de limpeza hospitalar.', 'FHSMI', 'Material'),
  (92, 15, 'Setembro / Outubro', 'Aquisição de uniformes escolares para distribuição aos alunos das escolas municipais e centros de educação infantil (CMEIS) da rede pública de ensino', 'PMI', 'Material'),
  (93, 15, 'Setembro / Outubro', 'Contratação de serviços especializados em telerradiologia para interpretação e laudos de raio-x.', 'FHSMI', 'Serviço'),
  (94, 15, 'Setembro / Outubro', 'Festividades de fim de ano - Aquisição/Contratação de iluminação decorativa natalina', 'FHSMI, IBAITIPREVI, PMI', 'Compra / Serviço'),
  (95, 15, 'Setembro / Outubro', 'Festividades de fim de ano - Aquisição/contratação de itens voltados a decoração natalina', 'FHSMI, IBAITIPREVI, PMI', 'Compra / Serviço'),
  (96, 15, 'Setembro / Outubro', 'Festividades de fim de ano - Contratação de Serviços', 'FHSMI, IBAITIPREVI, PMI', 'Compra / Serviço'),
  (97, 15, 'Setembro / Outubro', 'Implantação e manutenção de Plataforma Multifuncional para gestão do ISSQN.', 'PMI', 'Serviço'),
  (98, 16, 'Setembro / Outubro', 'Registro de Preços para aquisição de tintas e materiais para realização de pintura viária.', 'PMI', 'Material'),
  (99, 16, 'Setembro / Outubro', 'Registro de Preços para aquisição, conforme demanda, de materiais de construção.', 'PMI', 'Material'),
  (100, 16, 'Outubro / Novembro', 'Aquisição de livros e materiais didáticos (Educação Infantil e BNCC).', 'PMI', 'Material'),
  (101, 16, 'Outubro / Novembro', 'Aquisição de Uniformes, Materiais e Equipamentos Esportivos', 'PMI', 'Material'),
  (102, 16, 'Outubro / Novembro', 'Contratação de empresa para coleta e destinação de lixo hospitalar (Grupos A, B e E), em Atendimentos às necessidades da Secretaria Municipal de Saúde, Fundação Hospitalar e Laboratório Municipal', 'PMI', 'Serviço'),
  (103, 16, 'Outubro / Novembro', 'Manutenção preventiva e corretiva de computadores, servidores, roteadores, redes e suporte técnico.', 'PMI', 'Serviço'),
  (104, 16, 'Outubro / Novembro', 'Manutenção preventiva e corretiva do sistema de iluminação pública municipal.', 'PMI', 'Serviço'),
  (105, 16, 'Outubro / Novembro', 'Prestação de serviços complementares de limpeza urbana (capina, roçada).', 'PMI', 'Serviço'),
  (106, 16, 'Outubro / Novembro', 'Prestação de serviços de dosimetria de radiação e uso de porta dosímetros.', 'FHSMI', 'Serviço'),
  (107, 16, 'Outubro / Novembro', 'Registro de Preços (SRP) - Aquisição de conjunto de mesas e cadeiras para Educação.', 'PMI', 'Material'),
  (108, 17, 'Outubro / Novembro', 'Registro de Preços (SRP) - Aquisição de equipamentos auxiliares de mobilidade e uso pessoal', 'PMI', 'Material'),
  (109, 17, 'Outubro / Novembro', 'Registro de Preços para aquisição de bandejas térmicas, refis e embalagens descartáveis.', 'FHSMI', 'Material'),
  (110, 17, 'Outubro / Novembro', 'Registro de Preços para aquisição de reagentes e insumos laboratoriais.', 'FHSMI', 'Material'),
  (111, 17, 'Novembro / Dezembro', 'Credenciamento de empresas especializadas na prestação de serviços médicos em diversas especialidades.', 'PMI', 'Serviço'),
  (112, 17, 'Novembro / Dezembro', 'Credenciamento de pessoa jurídica para prestação de Serviços Médicos, em regime de plantão presencial e sobreaviso, no Pronto-Socorro e nas Enfermarias da Fundação Hospitalar de Saúde Municipal de Ibaiti', 'FHSMI', 'Serviço'),
  (113, 17, 'Novembro / Dezembro', 'Credenciamento de prestadores de serviços funerários para benefícios eventuais por morte.', 'PMI', 'Serviço'),
  (114, 17, 'Novembro / Dezembro', 'Fornecimento, implantação e configuração de serviços de integração telefônica (PABX IP).', 'PMI', 'Serviço'),
  (115, 17, 'Novembro / Dezembro', 'Locação de imóvel não residencial para o Posto Avançado da Vara de Trabalho.', 'PMI', 'Serviço'),
  (116, 17, 'Novembro / Dezembro', 'Registro de Preços para aquisição de recarga de oxigênio medicinal e disponibilização de cilindros.', 'PMI', 'Material'),
  (117, 17, 'Novembro / Dezembro', 'Serviços de Engenharia, Segurança e Medicina do Trabalho (PCMSO, PGR, LTCAT, etc.).', 'PMI', 'Serviço'),
  (118, 18, 'Dezembro / Janeiro', 'Credenciamento de prestação de serviços de Visitador Social, Orientador Social, Educador Social e Oficineiros.', 'PMI', 'Serviço'),
  (119, 18, 'Dezembro / Janeiro', 'Manutenção dos equipamentos e maquinários da panificadora municipal', 'PMI', 'Serviço'),
  (120, 18, 'Dezembro / Janeiro', 'Manutenção preventiva trimestral no grupo gerador Perkins 1104 de 125 KVA.', 'FHSMI', 'Serviço')
) as dados(ordem, pagina, periodo, objeto, entidades, tipo)
where regexp_replace(coalesce(o.cnpj, ''), '[^0-9]', '', 'g') = '77008068000141'
   or (regexp_replace(coalesce(o.cnpj, ''), '[^0-9]', '', 'g') = ''
       and lower(btrim(o.nome)) ~ '^((município|municipio|prefeitura( municipal)?) de )?ibaiti([[:space:]]*[-/][[:space:]]*pr)?$')
on conflict (orgao_id, ano, ordem_oficial) do nothing;

create table if not exists processos (
  id serial primary key,
  orgao_id int not null references orgaos(id) on delete cascade,
  numero text not null default '',
  procedimento text not null default '',
  requisitante text not null default '',
  objeto text not null,
  tipo text not null check (tipo in ('bens','servicos','obra')),
  via text not null check (via in ('licitacao','dispensa','inexigibilidade')),
  valor_estimado numeric(14,2),
  classe text not null default '',
  ano int not null default extract(year from now())::int,
  pca_item_id int references pca_itens(id) on delete set null,
  normas text not null default '',
  obs text not null default '',
  situacao text not null default 'preparacao' check (situacao in ('preparacao','publicado','contratado','cancelado')),
  criado_por int references usuarios(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists processos_orgao on processos(orgao_id, ano);

alter table processos add column if not exists areas_adicionais text[] not null default '{}';

create table if not exists solicitacoes_processo (
  id serial primary key,
  processo_id int not null references processos(id) on delete cascade,
  chave_envio uuid not null,
  secretaria text not null,
  referencia text not null default '',
  descricao text not null,
  nome_arquivo text,
  arquivo bytea,
  texto_arquivo text not null default '',
  usuario_id int references usuarios(id),
  criado_em timestamptz not null default now(),
  unique (processo_id, chave_envio)
);
create index if not exists solicitacoes_processo_processo on solicitacoes_processo(processo_id, id);

-- Protocolo: identificador único do processo desde a abertura, no formato ANO/0001, sequencial por órgão e ano.
-- O nº do processo administrativo e o do procedimento (colunas numero e procedimento) só são gravados ao final.
alter table processos add column if not exists protocolo text not null default '';
create table if not exists sequencias (
  orgao_id int not null references orgaos(id) on delete cascade,
  ano int not null,
  chave text not null,
  ultimo int not null default 0,
  primary key (orgao_id, ano, chave)
);
-- Processos abertos antes da criação do protocolo recebem o seu, na ordem em que foram abertos.
with n as (
  select p.id, p.orgao_id, p.ano,
         row_number() over (partition by p.orgao_id, p.ano order by p.id)
           + coalesce((select s.ultimo from sequencias s where s.orgao_id = p.orgao_id and s.ano = p.ano and s.chave = 'protocolo'), 0) as k
    from processos p where p.protocolo = ''
), u as (
  update processos p set protocolo = n.ano || '/' || lpad(n.k::text, 4, '0') from n where n.id = p.id
  returning p.orgao_id, p.ano, n.k
)
insert into sequencias (orgao_id, ano, chave, ultimo)
select orgao_id, ano, 'protocolo', max(k) from u group by orgao_id, ano
on conflict (orgao_id, ano, chave) do update set ultimo = excluded.ultimo;
create unique index if not exists processos_protocolo on processos(orgao_id, protocolo) where protocolo <> '';

-- Conferência de cada item: quem marcou e quando.
create table if not exists checagens (
  processo_id int not null references processos(id) on delete cascade,
  item text not null,
  usuario_id int references usuarios(id),
  em timestamptz not null default now(),
  primary key (processo_id, item)
);

-- Minutas versionadas: a versão mais alta de cada etapa é a vigente.
create table if not exists minutas (
  id serial primary key,
  processo_id int not null references processos(id) on delete cascade,
  etapa text not null,
  versao int not null,
  texto text not null,
  origem text not null default 'manual' check (origem in ('manual','ia','importado','pendencias')),
  usuario_id int references usuarios(id),
  criado_em timestamptz not null default now(),
  unique (processo_id, etapa, versao)
);

-- Modelo de documento de cada etapa, personalizado por órgão.
create table if not exists modelos (
  orgao_id int not null references orgaos(id) on delete cascade,
  etapa text not null,
  texto text not null,
  atualizado_em timestamptz not null default now(),
  primary key (orgao_id, etapa)
);

-- Documentos de apoio do processo (memorandos, planilhas): guarda o texto extraído.
create table if not exists anexos (
  id serial primary key,
  processo_id int not null references processos(id) on delete cascade,
  nome text not null,
  texto text not null,
  usuario_id int references usuarios(id),
  criado_em timestamptz not null default now()
);

create table if not exists contratos (
  id serial primary key,
  orgao_id int not null references orgaos(id) on delete cascade,
  processo_id int references processos(id) on delete set null,
  numero text not null,
  objeto text not null,
  contratada text not null,
  cnpj text not null default '',
  tipo_objeto text not null default 'servico' check (tipo_objeto in ('obra','servico','compra','reforma')),
  valor_inicial numeric(14,2) not null,
  inicio date not null,
  fim date not null,
  gestor text not null default '',
  fiscal text not null default '',
  fiscal_substituto text not null default '',
  situacao text not null default 'vigente' check (situacao in ('vigente','encerrado','rescindido')),
  criado_em timestamptz not null default now()
);

create table if not exists aditivos (
  id serial primary key,
  contrato_id int not null references contratos(id) on delete cascade,
  numero text not null,
  tipo text not null check (tipo in ('prazo','acrescimo','supressao','qualitativo','reajuste')),
  valor numeric(14,2) not null default 0,
  nova_fim date,
  justificativa text not null default '',
  data date not null default current_date
);

create table if not exists medicoes (
  id serial primary key,
  contrato_id int not null references contratos(id) on delete cascade,
  referencia text not null,
  data date not null default current_date,
  valor numeric(14,2) not null,
  situacao text not null default 'medida' check (situacao in ('medida','atestada','paga')),
  observacao text not null default ''
);

create table if not exists ocorrencias (
  id serial primary key,
  contrato_id int not null references contratos(id) on delete cascade,
  data date not null default current_date,
  descricao text not null,
  providencia text not null default '',
  usuario_id int references usuarios(id),
  criado_em timestamptz not null default now()
);

create table if not exists auditoria (
  id bigserial primary key,
  orgao_id int not null references orgaos(id) on delete cascade,
  usuario_id int references usuarios(id),
  processo_id int references processos(id) on delete cascade,
  contrato_id int references contratos(id) on delete cascade,
  acao text not null,
  detalhe jsonb not null default '{}',
  em timestamptz not null default now()
);
create index if not exists auditoria_proc on auditoria(processo_id, em desc);

-- Orçamentos (cotações) recebidos para o processo: guarda o arquivo original e, quando dá para ler, o texto.
create table if not exists orcamentos (
  id serial primary key,
  processo_id int not null references processos(id) on delete cascade,
  fornecedor text not null,
  valor numeric(14,2),
  nome text not null,
  arquivo bytea not null,
  texto text not null default '',
  usuario_id int references usuarios(id),
  criado_em timestamptz not null default now()
);
create index if not exists orcamentos_proc on orcamentos(processo_id);

-- Caixa de mensagens entre usuários do mesmo órgão: uma linha por destinatário.
create table if not exists mensagens (
  id bigserial primary key,
  orgao_id int not null references orgaos(id) on delete cascade,
  de_id int not null references usuarios(id) on delete cascade,
  para_id int not null references usuarios(id) on delete cascade,
  processo_id int references processos(id) on delete set null,
  assunto text not null,
  texto text not null,
  criado_em timestamptz not null default now(),
  lida_em timestamptz
);
create index if not exists mensagens_para on mensagens(para_id, criado_em desc);
create index if not exists mensagens_de on mensagens(de_id, criado_em desc);

-- Valor de 2026 do art. 75, I, conforme os autos do PA 367/2026 (Decreto Federal nº 12.807/2025).
-- O inciso II e os anos seguintes são cadastrados pelo administrador em Configurações.
insert into limites_dispensa (orgao_id, ano, inciso, valor, fonte)
values (0, 2026, 'I', 130984.20, 'Decreto Federal nº 12.807/2025')
on conflict do nothing;
