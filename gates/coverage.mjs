// Gate `coverage` — cobertura MEDIDA, nunca declarada.
//
// Este gate existe porque "cobertura >= 80%" viveu tres versoes do v5 dentro de um checklist
// de Definition of Done. Item de checklist nao mede nada: quem escreve o codigo marca o [x].
//
// Duas decisoes carregam o peso:
//
//   SOMA TUDO     o parser de lcov acumula todos os registros. Ler so o primeiro da 100%
//                 num projeto que esta em 60% — a versao ingenua passa com folga justamente
//                 no projeto mal coberto (item 212).
//   ANTI-SILENCIO relatorio ilegivel e "ha suite e nao ha relatorio" FALHAM. Aprovar ali e
//                 como um gate de disciplina morre: ele para de medir e ninguem percebe.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { gate } from './lib/policy.mjs';

// O padrao vem do catalogo (I-01). No v5 o gate lia a valvula e outros quatro lugares
// fixavam "80%" em prosa — num projeto adotado que registrou 40, o checklist reprovava o
// que o gate aprovava.
export const minimoPadrao = (await gate('coverage')).minimoPadrao;

// ------------------------------------------------------------------ parsers

/** lcov.info — LF (lines found) e LH (lines hit), somados sobre TODOS os registros. */
export function lerLcov(texto) {
  let total = 0;
  let cobertas = 0;
  let viu = false;

  for (const linha of String(texto).split(/\r?\n/)) {
    const lf = linha.match(/^LF:(\d+)\s*$/);
    const lh = linha.match(/^LH:(\d+)\s*$/);
    if (lf) {
      total += Number(lf[1]);
      viu = true;
    }
    if (lh) {
      cobertas += Number(lh[1]);
      viu = true;
    }
  }

  return viu ? { total, cobertas } : null;
}

/** coverage-summary.json do istanbul (jest, vitest, nyc). */
export function lerSummary(texto) {
  let dados;
  try {
    dados = JSON.parse(texto);
  } catch {
    return null;
  }
  const linhas = dados?.total?.lines;
  if (!linhas || typeof linhas.total !== 'number' || typeof linhas.covered !== 'number') {
    return null;
  }
  return { total: linhas.total, cobertas: linhas.covered };
}

/** cobertura XML (pytest-cov, coverage.py, jacoco no formato cobertura). */
export function lerCobertura(texto) {
  const valid = String(texto).match(/lines-valid="(\d+)"/);
  const covered = String(texto).match(/lines-covered="(\d+)"/);
  if (valid && covered) {
    return { total: Number(valid[1]), cobertas: Number(covered[1]) };
  }

  // Sem os atributos absolutos, `line-rate` e o unico dado disponivel. Ele e uma FRACAO,
  // nao uma contagem: normalizamos para base 100 e dizemos isso no nome do campo.
  const taxa = String(texto).match(/\bline-rate="([\d.]+)"/);
  if (taxa) {
    return { total: 100, cobertas: Math.round(Number(taxa[1]) * 100) };
  }

  return null;
}

const LEITORES = [
  [/coverage-summary\.json$/i, lerSummary, 'coverage-summary.json'],
  [/lcov\.info$/i, lerLcov, 'lcov.info'],
  [/(cobertura|coverage)\.xml$/i, lerCobertura, 'cobertura.xml'],
];

// ------------------------------------------------------------------ analise

export function analisar({ relatorios = [], minimo = minimoPadrao, temSuite = false } = {}) {
  const pular = (aviso) => ({ estado: 'pulado', achados: [], aviso, percentual: null, minimo: null, fonte: null });
  const falhar = (motivo, extra = {}) => ({
    estado: 'falha',
    achados: [{ motivo }],
    aviso: null,
    percentual: null,
    minimo: null,
    fonte: null,
    ...extra,
  });

  if (minimo === 'none') {
    return pular('gate desligado por declaracao explicita na valvula (minimo = none)');
  }

  const n = Number(minimo);
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    // Cair no padrao seria o defeito da baseline fantasma: a valvula deixa de valer e
    // ninguem fica sabendo. Pior, o usuario ACHA que baixou a regua e nao baixou.
    return falhar(
      `valvula de cobertura invalida ("${minimo}") — use um inteiro de 1 a 100 ou a palavra "none"`,
    );
  }

  if (relatorios.length === 0) {
    if (temSuite) {
      // O ponto exato onde este gate morre se aprovar.
      return falhar(
        'ha suite de teste e nenhum relatorio de cobertura — a cobertura NAO foi medida',
      );
    }
    return pular('projeto sem suite de teste e sem relatorio de cobertura — nada foi medido');
  }

  // Ordem de preferencia dos formatos, e o resultado diz qual foi usado: um numero sem
  // procedencia e um numero que ninguem confere (regra de evidencia, item 275).
  for (const [padrao, leitor, nome] of LEITORES) {
    const alvo = relatorios.find((r) => padrao.test(r.caminho));
    if (!alvo) continue;

    const medida = leitor(alvo.conteudo);
    if (!medida) {
      return falhar(`relatorio "${alvo.caminho}" ilegivel no formato ${nome} — nada foi medido`);
    }
    if (medida.total === 0) {
      return falhar(
        `relatorio "${alvo.caminho}" declara nenhuma linha — a instrumentacao nao rodou`,
      );
    }

    const percentual = Math.round((medida.cobertas / medida.total) * 100);
    const base = { percentual, minimo: n, fonte: nome };

    return percentual >= n
      ? { estado: 'ok', achados: [], aviso: null, ...base }
      : {
          estado: 'falha',
          achados: [{ motivo: `cobertura de ${percentual}% abaixo do minimo de ${n}%` }],
          aviso: null,
          ...base,
        };
  }

  return falhar(
    `formato de relatorio nao reconhecido em: ${relatorios.map((r) => r.caminho).join(', ')}`,
  );
}

// ------------------------------------------------------------------ varredura

const DIR_RELATORIO = ['coverage', '.coverage', 'htmlcov', 'reports'];
const TESTE = /(\.(test|spec)\.[jt]sx?$|(^|\/)(tests?|__tests__)\/)/i;

export async function rodar(raizProjeto, opcoes = {}) {
  const relatorios = [];
  for (const dir of DIR_RELATORIO) {
    for await (const rel of caminhar(join(raizProjeto, dir), dir)) {
      const conteudo = await readFile(join(raizProjeto, rel), 'utf8').catch(() => '');
      relatorios.push({ caminho: rel, conteudo });
    }
  }
  for (const nome of ['lcov.info', 'coverage.xml', 'cobertura.xml']) {
    const conteudo = await readFile(join(raizProjeto, nome), 'utf8').catch(() => null);
    if (conteudo !== null) relatorios.push({ caminho: nome, conteudo });
  }

  const temSuite = await procuraSuite(raizProjeto);

  const bruto = String(opcoes.valvula ?? '').trim();
  const minimo = bruto === '' ? minimoPadrao : bruto === 'none' ? 'none' : Number(bruto);

  return analisar({ relatorios, minimo, temSuite });
}

async function* caminhar(absoluto, prefixo) {
  const entradas = await readdir(absoluto, { withFileTypes: true }).catch(() => []);
  for (const e of entradas) {
    const rel = `${prefixo}/${e.name}`;
    if (e.isDirectory()) yield* caminhar(join(absoluto, e.name), rel);
    else if (/\.(info|json|xml)$/i.test(e.name)) yield rel;
  }
}

async function procuraSuite(raizProjeto, prefixo = '', profundidade = 0) {
  if (profundidade > 6) return false;
  const entradas = await readdir(join(raizProjeto, prefixo), { withFileTypes: true }).catch(() => []);
  for (const e of entradas) {
    if (['node_modules', '.git', 'dist', 'build', '.next', 'coverage'].includes(e.name)) continue;
    const rel = prefixo ? `${prefixo}/${e.name}` : e.name;
    if (TESTE.test(rel)) return true;
    if (e.isDirectory() && (await procuraSuite(raizProjeto, rel, profundidade + 1))) return true;
  }
  return false;
}
