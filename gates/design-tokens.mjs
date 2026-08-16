// Gate `design-tokens` — a tela consome o sistema visual, ou inventa o proprio.
//
// Executor de U-03. Saiu de candidato com evidencia de projeto real, que e a regua deste
// repositorio: um projeto sob os sete gates, com 898 testes e 92% de cobertura, chegou a
// sprint 4 com 2 de 11 superficies alcancadas pelos tokens — sete telas administrativas e a
// de entrar sem ligar folha de estilo nenhuma. A regra que mandava a task de tela passar
// pela rota de design existia; o unico caso que a defendia conferia que a FRASE existia.
//
// DOIS EIXOS, e eles medem coisas diferentes:
//
//   superficie-sem-sistema   arquivo que renderiza HTML e nao liga folha de estilo nenhuma.
//                            E a tela que nasceu sem passar pelo design — o defeito que
//                            produziu os 2-de-11 e que nenhum gate olhava.
//
//   valor-fora-do-token      literal de cor em declaracao fora do bloco de tokens. E o valor
//                            ganhando segunda casa, que e I-01 na camada visual. O projeto
//                            de origem escreveu esta guarda A MAO por ela nao existir aqui.
//
// O QUE ESTE GATE NAO FAZ, e esta declarado em vez de omitido: nao calcula contraste (U-01)
// nem gamut (U-02). As duas exigem parsear valor de cor em todos os espacos que o CSS aceita
// e um minimo declarado pelo projeto, e nenhuma das duas foi medida em projeto real ainda.
// Entram quando houver evidencia, pela mesma regra de admissao que trouxe este eixo.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { compilarIsencoes } from './lib/isencoes.mjs';

const FOLHA = /\.css$/i;

// Marcador de superficie: o documento inteiro. Fragmento, componente e parcial nao sao
// cobrados — quem liga a folha e o documento, e cobrar o fragmento acusaria quem esta certo.
const RENDERIZA_DOCUMENTO = /<html[\s>]/i;
const LIGA_FOLHA = /<link[^>]+rel\s*=\s*["']?stylesheet/i;

// Bloco de tokens: onde o valor PODE ser literal, porque e a casa unica dele.
const SELETOR_DE_TOKENS = /(^|[\s,])(:root|:host)\b/;

const COR_CRUA = [
  // Hexadecimal com contagem de digitos valida. `#faceb0` como SELETOR nunca chega aqui:
  // so olhamos o lado direito de uma declaracao.
  /#[0-9a-f]{3,4}\b|#[0-9a-f]{6}\b|#[0-9a-f]{8}\b/i,
  /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/i,
];

const semComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Quebra a folha em blocos, com o seletor de cada um.
 *
 * Passagem unica com pilha, e nao regex, porque `@media` aninha e o corpo de um bloco
 * aninhado precisa herdar a resposta de "estou dentro de :root?" do bloco de fora.
 */
function blocos(css) {
  const saida = [];
  const pilha = [];
  let buffer = '';
  let linha = 1;

  for (const ch of css) {
    if (ch === '\n') linha += 1;

    if (ch === '{') {
      pilha.push({ seletor: buffer.trim(), linha });
      buffer = '';
    } else if (ch === '}') {
      const aberto = pilha.pop();
      if (aberto) saida.push({ ...aberto, corpo: buffer, fim: linha });
      buffer = '';
    } else {
      buffer += ch;
    }

    // O corpo de um bloco que ainda esta aberto quando outro abre precisa ser preservado
    // como declaracao propria: `.a{color:red; .b{...}}` do CSS aninhado.
    if (ch === '{' && pilha.length > 1) {
      const pai = pilha[pilha.length - 2];
      pai.dentroDeTokens = pai.dentroDeTokens || SELETOR_DE_TOKENS.test(pai.seletor);
    }
  }

  return saida.map((b) => ({
    ...b,
    ehTokens: SELETOR_DE_TOKENS.test(b.seletor),
  }));
}

/** Só o lado direito de uma declaracao. Seletor e `url(#id)` nunca sao cor. */
function valoresCrus(corpo) {
  const achados = [];
  const declaracao = /(^|;)\s*([-\w]+)\s*:\s*([^;{}]+)/g;

  let m;
  while ((m = declaracao.exec(corpo)) !== null) {
    const [, , propriedade, valor] = m;
    const limpo = valor.replace(/url\([^)]*\)/gi, '');
    if (COR_CRUA.some((p) => p.test(limpo))) {
      achados.push({ propriedade, valor: valor.trim() });
    }
  }
  return achados;
}

export function analisar({ arquivos = [] } = {}) {
  const folhas = arquivos.filter((a) => FOLHA.test(a.caminho));
  const superficies = arquivos.filter((a) => RENDERIZA_DOCUMENTO.test(a.conteudo ?? ''));

  if (folhas.length === 0 && superficies.length === 0) {
    // Anti-silencio (M-01): projeto sem UI e o caso legitimo de pular. Projeto COM UI que
    // pula e o defeito que os 2-de-11 mostraram, e ele nao pode ter a mesma cara.
    return {
      estado: 'pulado',
      achados: [],
      aviso: 'nenhuma folha de estilo e nenhuma superficie de documento reconhecidas — nada foi conferido',
    };
  }

  const achados = [];

  for (const s of superficies) {
    if (LIGA_FOLHA.test(s.conteudo)) continue;
    achados.push({
      arquivo: s.caminho,
      linha: null,
      eixo: 'superficie-sem-sistema',
      motivo:
        'renderiza documento e nao liga folha de estilo nenhuma — a tela nasceu sem passar pelo sistema visual (U-03)',
    });
  }

  for (const f of folhas) {
    for (const b of blocos(semComentarios(f.conteudo ?? ''))) {
      if (b.ehTokens || b.dentroDeTokens) continue;
      for (const v of valoresCrus(b.corpo)) {
        achados.push({
          arquivo: f.caminho,
          linha: b.fim,
          eixo: 'valor-fora-do-token',
          motivo: `"${v.propriedade}: ${v.valor}" e valor cru fora do bloco de tokens — o valor ganhou segunda casa (U-03, I-01)`,
        });
      }
    }
  }

  const aviso =
    folhas.length === 0
      ? 'ha superficie de documento e NENHUMA folha de estilo no projeto — o eixo de tokens nao teve o que conferir'
      : superficies.length === 0
        ? 'ha folha de estilo e NENHUMA superficie de documento reconhecida — o eixo de superficie nao teve o que conferir'
        : null;

  return { estado: achados.length ? 'falha' : 'ok', achados, aviso };
}

// ------------------------------------------------------------------ varredura

// Lista de EXCLUSAO, nunca de inclusao — o desconhecido tem de ser varrido (item 208). O que
// entra aqui e SAIDA GERADA, e o criterio e esse: relatorio de teste, artefato de build e
// cache de framework nao sao superficie do projeto, e acusa-los ensina o time a ignorar o
// gate. `playwright-report/index.html` foi o primeiro falso positivo real deste gate, achado
// na primeira execucao contra o projeto que o originou.
const IGNORAR_DIR = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.astro',
  '.output', '.wrangler', 'coverage', 'playwright-report', 'test-results', 'storybook-static',
]);
const CANDIDATO = /\.(css|html?|astro|vue|svelte|[jt]sx?|erb|hbs|ejs|php|py|rb|go)$/i;

/**
 * O arquivo isento sai do CORPUS, e nao dos achados.
 *
 * Sai antes de `analisar()` porque os dois eixos leem a mesma lista: filtrar achado a achado
 * isentaria o eixo de superficie e deixaria o de token cobrando o mesmo arquivo, que e a
 * surpresa que ninguem le no diff. E o anti-silencio (M-01) passa a valer DEPOIS da isencao:
 * projeto cuja UI inteira foi isentada cai em `pulado`, nunca em `ok` — isentar tudo e receber
 * verde seria a valvula fabricando aprovacao, que e o oposto do que ela existe para fazer.
 */
export async function rodar(raizProjeto, opcoes = {}) {
  const isencao = compilarIsencoes(opcoes.isencoes ?? [], 'design-tokens');
  const arquivos = [];
  for await (const rel of caminhar(raizProjeto)) {
    if (isencao.isento(rel)) continue;
    const conteudo = await readFile(join(raizProjeto, rel), 'utf8').catch(() => '');
    arquivos.push({ caminho: rel, conteudo });
  }
  return { ...analisar({ arquivos }), isentos: isencao.aplicadas() };
}

async function* caminhar(raizProjeto, prefixo = '', profundidade = 0) {
  if (profundidade > 8) return;
  const entradas = await readdir(join(raizProjeto, prefixo), { withFileTypes: true }).catch(() => []);
  for (const e of entradas) {
    if (IGNORAR_DIR.has(e.name)) continue;
    const rel = prefixo ? `${prefixo}/${e.name}` : e.name;
    if (e.isDirectory()) yield* caminhar(raizProjeto, rel, profundidade + 1);
    else if (CANDIDATO.test(rel)) yield rel;
  }
}
