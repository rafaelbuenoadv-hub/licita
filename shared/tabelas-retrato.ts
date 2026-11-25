/** Limita quadros muito largos a continuações em retrato, preservando identificadores e totais. */
export function partesDaTabela(linhas: string[][], alinhamentos: (string|undefined)[] = []) {
  const quantidade=Math.max(0,...linhas.map((l)=>l.length));
  if(quantidade<=11) return [{linhas,alinhamentos}];
  const cotacoes=Array.from({length:quantidade},(_,i)=>i).filter((i)=>/^Cotação \d+(?:\s|$)/.test(linhas[0][i]??""));
  const usarCotacoes=cotacoes.length>0 && quantidade-cotacoes.length<11;
  const fixas=usarCotacoes ? Array.from({length:quantidade},(_,i)=>i).filter((i)=>!cotacoes.includes(i)) : [0];
  const variaveis=usarCotacoes ? cotacoes : Array.from({length:quantidade-1},(_,i)=>i+1);
  const porParte=Math.max(1,11-fixas.length);
  const partes=[];
  for(let inicio=0;inicio<variaveis.length;inicio+=porParte){
    const indices=[...fixas,...variaveis.slice(inicio,inicio+porParte)].sort((a,b)=>a-b);
    partes.push({linhas:linhas.map((l)=>indices.map((i)=>l[i]??"")),alinhamentos:indices.map((i)=>alinhamentos[i])});
  }
  return partes;
}
