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
