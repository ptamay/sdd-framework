// Registro de execucao — a evidencia que a proxima versao vai ler.
//
// O v5 produziu 27 achados numa unica execucao real, e todos foram anotados A MAO, depois do
// fato, por alguem que lembrou de anotar. O proprio registro dele diz a frase que motiva este
// arquivo: "todo achado veio de OPERAR, nenhum de ler".
//
// O que se perde sem isto nao e o achado espetacular — e o padrao. Um gate que pula sempre
// pelo mesmo motivo, um projeto que nunca chega a verificar nada, um estado `erro` que
// aparece so numa maquina. Nada disso e visivel numa execucao; so aparece na serie.
//
// Uma linha JSON por execucao. Formato de linha para poder crescer sem reescrever o arquivo,
// e para sobreviver a uma escrita interrompida sem corromper o que ja estava la.

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const exec = promisify(execFile);

export const ARQUIVO = '.sdd/execucoes.jsonl';

/**
 * Monta o registro. Puro o suficiente para ter caso proprio.
 *
 * O aviso e TRUNCADO: o registro precisa caber numa linha e ser lido em serie. Quem quiser o
 * texto inteiro roda de novo — quem quiser o padrao le a serie.
 */
export function montar(relatorio, contexto = {}) {
  return {
    quando: contexto.quando ?? new Date().toISOString(),
    versao: contexto.versao ?? null,
    branch: contexto.branch ?? null,
    head: contexto.head ?? null,
    veredito: relatorio.veredito,
    verificados: relatorio.verificados,
    pulados: relatorio.pulados,
    reprovados: relatorio.reprovados,
    gates: relatorio.resultados.map((r) => ({
      id: r.id,
      estado: r.estado,
      achados: r.achados?.length ?? 0,
      // O motivo do `pulado` e o dado mais valioso da serie: e ele que mostra um gate que
      // nunca teve o que conferir em projeto nenhum — isto e, um gate que nao existe na
      // pratica e ninguem percebeu.
      aviso: r.aviso ? String(r.aviso).slice(0, 160) : null,
      isentos: r.isentos?.length ?? 0,
    })),
  };
}

export async function registrar(raiz, relatorio, versao = null) {
  const contexto = { versao, ...(await contextoGit(raiz)) };
  const linha = JSON.stringify(montar(relatorio, contexto));

  try {
    await mkdir(join(raiz, '.sdd'), { recursive: true });
    await appendFile(join(raiz, ARQUIVO), `${linha}\n`);
  } catch {
    // Falha ao registrar NUNCA derruba a execucao dos gates. O registro e evidencia para
    // depois; o veredito e a resposta de agora, e trocar um pelo outro seria pior.
  }
}

export async function ler(raiz) {
  const bruto = await readFile(join(raiz, ARQUIVO), 'utf8').catch(() => '');
  return bruto
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function contextoGit(raiz) {
  const rodar = async (args) =>
    exec('git', args, { cwd: raiz }).then(({ stdout }) => stdout.trim(), () => null);

  // `rev-parse --abbrev-ref HEAD` FALHA num repositorio sem commits, e devolveria "(sem
  // git)" para um projeto que tem git — a mesma confusao entre "vazio" e "ausente" que
  // fazia todo projeto do bootstrap nascer reprovado. `branch --show-current` responde
  // certo nos dois casos.
  return {
    branch: await rodar(['branch', '--show-current']),
    head: await rodar(['rev-parse', '--short', 'HEAD']),
  };
}
