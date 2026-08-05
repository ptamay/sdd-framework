// Runner — roda os gates ativos contra um projeto e decide o veredito agregado.
//
//   sdd-gates [caminho-do-projeto]
//
// Este arquivo e onde o anti-silencio pode ser reintroduzido NO NIVEL DE CIMA, e esse e o
// nivel onde ninguem procura. Os gates podem estar todos corretos e o relatorio somar tudo
// em "tudo certo", reproduzindo na agregacao o defeito que cada um foi desenhado para nao
// cometer. Tres regras impedem isso:
//
//   1. `erro` NAO colapsa em "nao-falhou". Gate que nao conseguiu rodar nao provou nada.
//   2. Execucao em que NADA foi verificado tem veredito proprio. Um projeto novo pula tudo
//      legitimamente — mas o relatorio nao pode ter a mesma cara de uma aprovacao.
//   3. Todo gate ativo aparece no relatorio, inclusive o que estourou. Gate que some deixa
//      a saida com menos linhas, e ninguem conta linhas (M-12).
//
// E o runner nao tem lista propria: a lista E o catalogo (I-01). Foi tendo lista propria em
// varios lugares que o v5 chegou a quatro versoes divergentes da mesma faixa de gates.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { gatesAtivos, raizDoRepo } from './lib/policy.mjs';

const ESTADOS_REPROVA = new Set(['falha', 'erro']);
const ESTADOS_VALIDOS = new Set(['ok', 'falha', 'erro', 'pulado']);

/**
 * Todo gate devolve a MESMA forma. Contrato sem verificacao nao e contrato (I-06).
 *
 * O primeiro gate escrito devolvia um array de achados em vez do objeto — e o runner
 * imprimia `[?]` no lugar do estado e contava aquilo como "nao reprovou". Um gate fora do
 * contrato precisa aparecer como erro, nunca como simbolo estranho numa linha que passa.
 */
export function validarResultado(bruto) {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    return `o gate devolveu ${Array.isArray(bruto) ? 'um array' : typeof bruto} em vez do objeto do contrato`;
  }
  if (!ESTADOS_VALIDOS.has(bruto.estado)) {
    return `estado invalido: ${JSON.stringify(bruto.estado)} (esperado: ${[...ESTADOS_VALIDOS].join(', ')})`;
  }
  if (!Array.isArray(bruto.achados)) {
    return 'o gate nao devolveu a lista "achados"';
  }
  return null;
}

export function agregar(resultados) {
  const verificados = resultados.filter((r) => r.estado === 'ok').length;
  const pulados = resultados.filter((r) => r.estado === 'pulado').length;
  const reprovados = resultados.filter((r) => ESTADOS_REPROVA.has(r.estado));

  let veredito;
  if (reprovados.length > 0) veredito = 'reprovado';
  else if (verificados === 0) veredito = 'nada-verificado';
  else veredito = 'aprovado';

  return { veredito, verificados, pulados, reprovados: reprovados.length, total: resultados.length };
}

export function codigoDeSaida(veredito) {
  return veredito === 'reprovado' ? 1 : 0;
}

async function carregarPadrao(id) {
  return import(new URL(`./${id}.mjs`, import.meta.url).href);
}

export async function executarTodos({ raiz, carregar = carregarPadrao, valvulas = {} } = {}) {
  const ativos = await gatesAtivos();

  const resultados = await Promise.all(
    ativos.map(async (g) => {
      const base = { id: g.id, numero: g.numero, titulo: g.titulo };
      try {
        const modulo = await carregar(g.id);
        const bruto = await modulo.rodar(raiz, valvulas[g.id]);

        const problema = validarResultado(bruto);
        if (problema) {
          return { ...base, estado: 'erro', achados: [], aviso: `contrato violado — ${problema}` };
        }
        return { ...base, ...bruto };
      } catch (erro) {
        // Excecao NUNCA vira omissao nem aprovacao. O gate entra no relatorio com o motivo.
        return {
          ...base,
          estado: 'erro',
          achados: [],
          aviso: `o gate estourou: ${erro?.message ?? erro}`,
        };
      }
    }),
  );

  return { ...agregar(resultados), resultados };
}

// ------------------------------------------------------------------ relatorio

const SIMBOLO = { ok: '[ok]  ', falha: '[FALHA]', erro: '[ERRO] ', pulado: '[pulou]' };

export function formatar({ veredito, resultados, verificados, pulados, reprovados, total }) {
  const linhas = [];

  for (const r of [...resultados].sort((a, b) => a.numero - b.numero)) {
    linhas.push(`${SIMBOLO[r.estado] ?? '[?]'} ${r.numero}. ${r.titulo}`);

    for (const a of r.achados ?? []) {
      const onde = [a.arquivo, a.linha].filter(Boolean).join(':');
      linhas.push(`         ${onde ? `${onde} — ` : ''}${a.motivo ?? ''}`);
    }
    if (r.aviso) linhas.push(`         ${r.aviso}`);
    if (r.saida) linhas.push(indentar(r.saida));
  }

  linhas.push('');
  linhas.push('-'.repeat(70));

  // A contagem e explicita nos tres eixos. "N de M verificados" e o que impede o relatorio
  // de parecer completo quando metade dos gates pulou.
  linhas.push(`${verificados} verificado(s) · ${pulados} pulado(s) · ${reprovados} reprovado(s) — de ${total}`);

  if (veredito === 'nada-verificado') {
    linhas.push('');
    linhas.push('NADA FOI VERIFICADO. Nenhum gate teve o que conferir neste projeto —');
    linhas.push('isto nao e uma aprovacao, e nada foi provado sobre o codigo.');
  }

  return linhas.join('\n');
}

function indentar(texto) {
  return String(texto)
    .split('\n')
    .map((l) => `         ${l}`)
    .join('\n');
}

// ------------------------------------------------------------------ valvulas

const VALVULAS = {
  migrations: 'migrations-layout',
  coverage: 'coverage-min',
  'tdd-order': 'tdd-baseline',
};

export async function lerValvulas(raiz) {
  const lidas = {};
  for (const [gate, arquivo] of Object.entries(VALVULAS)) {
    const valor = (await readFile(join(raiz, '.sdd', arquivo), 'utf8').catch(() => '')).trim();
    if (valor) lidas[gate] = valor;
  }
  return lidas;
}

// ------------------------------------------------------------------ entrada

/**
 * Este modulo foi invocado diretamente?
 *
 * Comparar `import.meta.url` com `file://` + argv[1] NAO funciona: a URL do modulo tem tres
 * barras e percent-encoding, e o argv traz o caminho nativo. Num diretorio com espaco, ou em
 * Windows, a comparacao simplesmente nunca casa — e o CLI sai com codigo 0 sem imprimir uma
 * linha, que e a leitura de "tudo certo". Foi o primeiro resultado da primeira execucao real
 * deste runner. `pathToFileURL` e a unica forma correta.
 */
export function ehEntradaDireta(metaUrl, argv1) {
  if (!argv1) return false;
  try {
    return metaUrl === pathToFileURL(argv1).href;
  } catch {
    return false;
  }
}

if (ehEntradaDireta(import.meta.url, process.argv[1])) {
  const raiz = process.argv[2] ?? process.cwd();
  const valvulas = await lerValvulas(raiz);
  const relatorio = await executarTodos({ raiz, valvulas });

  console.log(formatar(relatorio));
  process.exit(codigoDeSaida(relatorio.veredito));
}

export { raizDoRepo };
