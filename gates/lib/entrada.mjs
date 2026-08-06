// "Este modulo foi invocado diretamente?" — fonte unica da resposta.
//
// Morava dentro de gates/run.mjs. Saiu de la quando o guard do harness apareceu com uma
// segunda implementacao, escrita a mao e ERRADA — a licao estava registrada em vinte linhas
// de comentario e mesmo assim nao atravessou para o arquivo vizinho. Fato que precisa valer
// em dois lugares nao pode ser reescrito no segundo (I-01).
//
// Modulo proprio, sem dependencia de policy nem do runner, porque quem mais precisa disto e
// um hook de PreToolUse: ele sobe a CADA chamada de ferramenta, e puxar o runner inteiro
// junto sairia caro no caminho mais quente que o framework tem.

import { pathToFileURL } from 'node:url';

/**
 * Comparar `import.meta.url` com `file://` + argv[1] NAO funciona: a URL do modulo tem tres
 * barras e percent-encoding, e o argv traz o caminho nativo. Num diretorio com espaco, ou em
 * Windows, a comparacao simplesmente nunca casa — e o CLI sai com codigo 0 sem imprimir uma
 * linha, que e a leitura de "tudo certo". Foi o primeiro resultado da primeira execucao real
 * do runner.
 *
 * Comparar o BASENAME e pior ainda, e foi o que o guard fazia: `endsWith` sem separador faz
 * um modulo chamado `d.mjs` casar com `guard.mjs`. O corpo do hook entao executa no import,
 * consome o stdin e chama `process.exit` — e o programa que importou morre antes de rodar a
 * primeira linha, com codigo 0 e saida vazia.
 *
 * `pathToFileURL` e a unica forma correta.
 */
export function ehEntradaDireta(metaUrl, argv1) {
  if (!argv1) return false;
  try {
    return metaUrl === pathToFileURL(argv1).href;
  } catch {
    return false;
  }
}
