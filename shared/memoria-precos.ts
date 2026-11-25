/** Textos de partida editáveis; não pressupõem fontes, datas ou diligências que não estejam registradas. */
const introducao = "Para formar o preço estimado de cada item, são considerados exclusivamente os valores classificados para uso no cálculo no quadro comparativo da pesquisa. Os preços marcados como somente referência e os preços descartados permanecem registrados, mas não integram o cálculo.";
const fechamento = "O valor total de cada item resulta da multiplicação do preço unitário estimado pela quantidade prevista. O valor estimado da contratação corresponde à soma dos totais dos itens. Esta memória deve ser lida em conjunto com o quadro comparativo e os comprovantes das fontes consultadas, inclusive quanto às datas de referência e de acesso.";

const criterios: Record<string, string> = {
  media: "Adota-se a média aritmética dos preços considerados para cada item, calculada pela soma desses valores dividida pelo número de preços utilizados. A escolha busca representar o conjunto das referências de mercado aproveitadas na pesquisa, atribuindo o mesmo peso a cada preço incluído no cálculo.",
  mediana: "Adota-se a mediana dos preços considerados para cada item. Os valores são ordenados do menor para o maior; quando a quantidade é ímpar, utiliza-se o valor central e, quando é par, a média aritmética dos dois valores centrais. A escolha busca representar a posição central dos preços pesquisados, reduzindo a influência dos valores situados nas extremidades do conjunto.",
  menor: "Adota-se o menor preço entre os valores considerados para cada item. Após a classificação das cotações, seleciona-se o menor valor unitário incluído no cálculo. A escolha busca utilizar a referência mais econômica dentre os preços aproveitados, cabendo conferir sua compatibilidade com as especificações, a unidade de fornecimento, as quantidades e as condições da contratação.",
  outro: "Adota-se o seguinte método de cálculo: [[INFORMAR O MÉTODO ADOTADO]]. O procedimento e a fórmula de apuração do preço unitário de cada item são: [[DESCREVER O PROCEDIMENTO E A FÓRMULA]]. A escolha desse método se justifica por: [[JUSTIFICAR A ADEQUAÇÃO DO MÉTODO À PESQUISA]]. Quando houver critérios diferentes entre os itens, identificar o critério aplicado a cada um no quadro comparativo.",
};

export function memoriaBaseDoMetodo(metodo: unknown): string {
  return typeof metodo === "string" && Object.hasOwn(criterios, metodo)
    ? [introducao, criterios[metodo], fechamento].join("\n\n") : "";
}
