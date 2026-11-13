# Licita

Sistema web para conduzir contratações públicas pela Lei nº 14.133/2021, com IA:

- **Fase preparatória guiada**, da solicitação (DFD) à publicação do edital ou do aviso de contratação direta, em 9 etapas. A etapa seguinte só é liberada quando todos os itens obrigatórios da atual foram conferidos. Os itens mudam conforme o tipo de objeto (bens, serviços, obra) e a forma de contratação (licitação, dispensa, inexigibilidade).
- **Minutas no padrão do órgão**: a IA redige DFD, ETP, mapa de riscos, orçamento, Termo de Referência, edital, relatório de saneamento e extrato seguindo o modelo de cada órgão. As minutas são versionadas e exportadas para Word (.docx) com campos pendentes em amarelo.
- **Preenchimento com IA**: a IA lê memorandos e documentos anexados (.docx, .pdf, .txt) para abrir o processo e sugere o valor de cada campo pendente, indicando a fonte ou o setor que deve informar.
- **Assistente por etapa**: responde com os dados do processo, as minutas e os anexos, citando a lei.
- **Plano de contratações anual (PCA)** com controle de fracionamento: soma as dispensas por valor da mesma natureza no exercício e alerta quando passam do limite (art. 75, § 1º).
- **Gestão de contratos**: aditivos com bloqueio do limite do art. 125 (25%, ou 50% em reforma), medições (o fiscal atesta, o setor de contratações registra o pagamento), registro de ocorrências do fiscal e alertas de vencimento.
- **Vários órgãos** no mesmo sistema, com dados separados, usuários por perfil, histórico completo (quem fez o quê e quando) e segregação de funções.

## Perfis

| Perfil | Atua em |
|---|---|
| Administrador do órgão | Tudo, além de usuários, regulamentos locais, modelos e limites |
| Área requisitante | Solicitação, ETP, riscos, Termo de Referência; PCA |
| Agente de contratação / Licitações | Todas as etapas técnicas, edital, contratos, aditivos, pagamentos |
| Assessoria jurídica | Etapa do parecer jurídico |
| Autoridade competente | Dotação, autorização e publicação |
| Gestor ou fiscal de contrato | Medições (atesto) e ocorrências |

## Como rodar

### Com Docker (recomendado para servidor)

```bash
cp .env.example .env
```

No `.env`, defina `POSTGRES_PASSWORD` e `ANTHROPIC_API_KEY`. Depois:

```bash
docker compose up -d --build
```

Crie o primeiro órgão e o administrador:

```bash
docker compose exec app node dist/server/cli-orgao.js --nome "Município de Exemplo" --admin-nome "Nome do Administrador" --admin-email admin@exemplo.gov.br --senha "uma-senha-forte-aqui"
```

O sistema fica em `http://localhost:3000`. Em produção, coloque-o atrás de um proxy com HTTPS (Nginx, Caddy, balanceador da nuvem): com `NODE_ENV=production`, o cookie de sessão só trafega por HTTPS.

### Sem Docker (desenvolvimento)

Requer Node.js 22 e PostgreSQL 14 ou superior.

```bash
npm install
```

```bash
cp .env.example .env
```

Ajuste `DATABASE_URL` no `.env` e crie o banco. Para um órgão de demonstração com um usuário de cada perfil:

```bash
npm run seed -- --senha "demonstracao-2026"
```

Em dois terminais:

```bash
npm run dev:server
```

```bash
npm run dev:web
```

Abra `http://localhost:5173`. Para produção sem Docker: `npm run build` e `npm start`.

## IA

- Usa a API da Anthropic com o modelo **Claude Opus 5.5** (`claude-opus-5-5`); troque com `LICITA_MODELO`.
- O **respaldo do servidor** está ativado (`fallbacks: "default"`): se o modelo recusar um pedido por política de segurança, a própria API reexecuta em um modelo de respaldo. Para desligar, remova `fallbacks` e o beta em `server/ia.ts`.
- Sugestões de campos e extração de dados usam **saída estruturada** (JSON validado); minutas e assistente usam **streaming**.
- PDFs são lidos pela própria IA (inclusive digitalizados); .docx é lido localmente, com os quadros preservados.
- Sem `ANTHROPIC_API_KEY`, o sistema funciona normalmente sem as funções de IA.
- Custo: cada minuta redigida envia à IA o processo inteiro (peças e anexos). Processos com muitos anexos grandes custam mais por chamada.

A IA nunca deve inventar dados: o que não estiver nos documentos fica marcado como `[[PREENCHER: ...]]`. Mesmo assim, toda minuta precisa de revisão humana, e o sistema não substitui o parecer jurídico.

## Configuração do órgão (em Configurações)

1. **Regulamentos locais**: decretos e leis do ente que a IA deve citar.
2. **Modelos de documento**: a estrutura de seções de cada peça no padrão do órgão. A IA segue esse modelo ao redigir.
3. **Limites de dispensa**: o sistema traz o valor de 2026 do art. 75, I (R$ 130.984,20, Decreto Federal nº 12.807/2025). Cadastre o inciso II e os anos seguintes conforme o decreto federal vigente.
4. **Usuários e perfis**.

## Testes

Os testes usam um banco PostgreSQL vazio, que é apagado a cada execução. Nunca aponte para o banco de produção.

```bash
DATABASE_URL=postgres://usuario@localhost:5432/licita_test npm test
```

Cobrem: login e sessão, proteção contra requisição forjada, ordem das etapas, permissões por perfil, isolamento entre órgãos, versionamento de minutas, campos pendentes, exportação Word, leitura de .docx, fracionamento no PCA, limite do art. 125 e as chamadas à IA (contra uma API simulada).

## Estrutura

```
shared/etapas.ts      regras das 9 etapas, itens de conferência e base legal (servidor e interface)
server/schema.sql     banco de dados
server/routes/        API: processos, IA, PCA, contratos, painel, administração
server/ia.ts          integração com a IA
server/docx.ts        exportação para Word
web/src/              interface (React)
```

## Próximos passos sugeridos

- Fase externa da licitação (propostas, julgamento, habilitação, recursos, homologação).
- Integração com o PNCP para publicação e consulta de preços.
- Consulta de jurisprudência do TCU pela IA.
- Assinatura eletrônica das peças.
