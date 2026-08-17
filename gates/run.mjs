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

import { gatesAtivos, raizDoRepo } from './lib/policy.mjs';
import { validarIsencoes } from './lib/isencoes.mjs';
import { ehEntradaDireta } from './lib/entrada.mjs';

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

export async function executarTodos({
  raiz,
  carregar = carregarPadrao,
  valvulas = {},
  isencoes = [],
} = {}) {
  const ativos = await gatesAtivos();

  // Arquivo de isencoes malformado NAO significa "nenhuma isencao". Ele pode estar tentando
  // isentar alguma coisa e falhando por erro de digitacao — e aceitar isso em silencio faz
  // o usuario achar que isentou quando nao isentou, ou o contrario. A execucao inteira para.
  // Os OBJETOS do catalogo, e nao os identificadores: e `isencoes.honra` que liga a trava 6.
  const problemas = validarIsencoes(isencoes, ativos);
  if (problemas.length > 0) {
    const resultados = ativos.map((g) => ({
      id: g.id,
      numero: g.numero,
      titulo: g.titulo,
      estado: 'erro',
      achados: [],
      aviso: 'execucao abortada: arquivo de isencoes invalido',
    }));
    return { ...agregar(resultados), resultados, problemasDeIsencao: problemas };
  }

  const resultados = await Promise.all(
    ativos.map(async (g) => {
      const base = { id: g.id, numero: g.numero, titulo: g.titulo };
      try {
        const modulo = await carregar(g.id);
        const bruto = await modulo.rodar(raiz, { valvula: valvulas[g.id], isencoes });

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

export function formatar({ veredito, resultados, verificados, pulados, reprovados, total, problemasDeIsencao }) {
  const linhas = [];

  if (problemasDeIsencao?.length) {
    linhas.push('ARQUIVO DE ISENCOES INVALIDO — nenhum gate rodou:');
    for (const p of problemasDeIsencao) linhas.push(`  - ${p}`);
    linhas.push('');
  }

  for (const r of [...resultados].sort((a, b) => a.numero - b.numero)) {
    linhas.push(`${SIMBOLO[r.estado] ?? '[?]'} ${r.numero}. ${r.titulo}`);

    for (const a of r.achados ?? []) {
      const onde = [a.arquivo, a.linha].filter(Boolean).join(':');
      linhas.push(`         ${onde ? `${onde} — ` : ''}${a.motivo ?? ''}`);
    }
    if (r.aviso) linhas.push(`         ${r.aviso}`);

    // Trava 5 das isencoes: o que deixou de ser olhado APARECE. Isencao muda em tempo de
    // execucao e indistinguivel de gate desligado — foi o que sobrou do conserto do v5.
    for (const c of r.isentos ?? []) linhas.push(`         isento: ${c}`);
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

/**
 * Le `.sdd/gates-ignore.json`.
 *
 * Ausente e o normal. PRESENTE e ilegivel nao pode virar "nenhuma isencao": o arquivo
 * existe porque alguem quis isentar algo, e falhar em silencio esconde exatamente isso.
 */
export async function lerIsencoes(raiz) {
  const bruto = await readFile(join(raiz, '.sdd', 'gates-ignore.json'), 'utf8').catch(() => null);
  if (bruto === null) return [];
  try {
    return JSON.parse(bruto).isencoes ?? [];
  } catch (erro) {
    return [{ _invalido: `gates-ignore.json com JSON invalido: ${erro.message}` }];
  }
}

export async function lerValvulas(raiz) {
  const lidas = {};
  for (const [gate, arquivo] of Object.entries(VALVULAS)) {
    const valor = (await readFile(join(raiz, '.sdd', arquivo), 'utf8').catch(() => '')).trim();
    if (valor) lidas[gate] = valor;
  }
  return lidas;
}

// ------------------------------------------------------------------ entrada

if (ehEntradaDireta(import.meta.url, process.argv[1])) {
  const raiz = process.argv[2] ?? process.cwd();
  const valvulas = await lerValvulas(raiz);
  const isencoes = await lerIsencoes(raiz);
  const relatorio = await executarTodos({ raiz, valvulas, isencoes });

  console.log(formatar(relatorio));
  process.exit(codigoDeSaida(relatorio.veredito));
}

// Reexportado: a funcao mora em lib/entrada.mjs desde que o guard precisou dela, e quem ja
// importava daqui continua importando daqui.
export { raizDoRepo, ehEntradaDireta };
