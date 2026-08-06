// Leitor ESTRITO de frontmatter.
//
// Nao e um parser de YAML e nao quer ser. O framework nao tem dependencia por decisao
// (package.json), e escrever meio parser trocaria um defeito silencioso por outro.
//
// O que este leitor faz e mais estreito e mais util: ele RECUSA tudo que nao for
// inequivoco. A direcao da estritez e o ponto — tudo que ele aceita, o YAML tambem aceita.
// O contrario nao vale, e isso e de proposito: um campo que so um parser completo consegue
// desambiguar nao deveria estar no frontmatter de um agente cuja restricao de ferramenta
// depende dele ser lido.
//
// Devolve `{ campos }` ou `{ erro }`. Nunca lanca, e nunca devolve os dois — quem chama nao
// pode confundir "li e estava vazio" com "nao consegui ler" (M-01).

/** @returns {{campos: Record<string,string>} | {erro: string}} */
export function lerFrontmatter(fonte) {
  // CRLF e normalizado aqui de proposito. Quem guarda essa fronteira e o caso do blob do
  // git em plugin.test.mjs, que olha o que um clone recebe — a copia de trabalho em Windows
  // pode ter CRLF legitimamente, e reprovar por isso seria reprovar pelo motivo errado.
  const linhas = fonte.replace(/\r\n/g, '\n').split('\n');

  if (linhas[0] !== '---') {
    return { erro: 'nao abre com --- na primeira linha' };
  }

  const fim = linhas.indexOf('---', 1);
  if (fim === -1) {
    return { erro: 'o bloco abre e nao fecha' };
  }

  const campos = {};

  for (let i = 1; i < fim; i++) {
    const linha = linhas[i];
    if (linha.trim() === '') continue;

    const m = linha.match(/^([A-Za-z][A-Za-z0-9_-]*):(.*)$/);
    if (!m) {
      return { erro: `linha ${i + 1} nao tem a forma "chave: valor": ${linha}` };
    }

    const chave = m[1];
    let valor = m[2].trim();

    const citado = valor.match(/^"([^"]*)"$/) ?? valor.match(/^'([^']*)'$/);
    if (citado) {
      valor = citado[1];
    } else if (valor.includes(': ')) {
      // O defeito de 2026-08-05, em seis arquivos. Sem aspas, o YAML le "a: b: c" como
      // mapeamento aninhado, o parse do BLOCO INTEIRO cai, e o componente carrega com
      // metadata vazia — todos os campos descartados, sem uma linha de aviso.
      return {
        erro: `"${chave}" contem ": " sem aspas — o YAML le como mapeamento aninhado e derruba o bloco inteiro`,
      };
    }

    if (chave in campos) {
      return { erro: `chave repetida: ${chave}` };
    }
    campos[chave] = valor;
  }

  return { campos };
}
