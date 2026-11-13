export interface ItemConsultaPca {
  id: number;
  descricao: string;
  tipo: string;
  tipo_oficial: string | null;
  ordem_oficial: number | null;
  pagina_oficial: number | null;
}

const genericos = new Set("registro preco aquisicao contratacao empresa especializada prestacao servico fornecimento para pelo pelos pela das dos com uma municipal municipio ibaiti atender atendimento demanda destinados destinado".split(" "));
function termos(texto: string) {
  return new Set(texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .match(/[a-z0-9]{3,}/g)?.map((x) => x.replace(/s$/, "")).filter((x) => !genericos.has(x)) ?? []);
}

export function consultarPca(objeto: string, tipo: string, itens: ItemConsultaPca[]) {
  const pedido = termos(objeto);
  const resultados = itens.filter((i) => i.tipo === tipo || (i.tipo_oficial === "Compra / Serviço" && tipo === "bens"))
    .map((item) => {
      const descricao = termos(item.descricao);
      const comuns = [...descricao].filter((t) => pedido.has(t)).length;
      return { item, comuns, cobertura: descricao.size ? comuns / descricao.size : 0, total: descricao.size };
    })
    .filter((x) => x.comuns >= 2 && x.cobertura >= 0.45)
    .sort((a, b) => b.cobertura - a.cobertura || b.comuns - a.comuns);
  const [melhor, segundo] = resultados;
  const claro = melhor && melhor.cobertura === 1 && (melhor.total === pedido.size || melhor.comuns >= 5)
    && (!segundo || segundo.cobertura < 0.8);
  return { vinculo: claro ? melhor.item : null, candidatos: resultados.slice(0, 3).map((x) => x.item) };
}
