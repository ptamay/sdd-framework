// Gate `tdd-order` — o teste vem antes da implementacao, por task.
//
// Unico gate que audita HISTORICO em vez de arvore, e a unica prova mecanica de que o teste
// nao foi escrito depois para acompanhar o codigo que ja passava. Tudo o mais no ciclo TDD
// depende de disciplina; isto aqui e verificavel.
//
// Tres decisoes de desenho, todas verificadas em execucao real no v5 (§3.30):
//
//   POR TASK        uma task fora de ordem nao arrasta as corretas. Reprovar a sprint
//                   inteira por causa de uma ensina a ignorar o gate, e a acusacao deixa de
//                   dizer onde o problema esta.
//   NAO SE LAVA     um commit de teste POSTERIOR nao conserta a implementacao anterior. Se
//                   lavasse, bastaria commitar o teste depois para ficar verde — que e
//                   exatamente o habito que o gate existe para impedir.
//   SO `feat`       a lista de tipos auditados e a trava MECANICA da excecao da TASK-000
//                   (item 277). Alargar essa lista transforma a excecao em porta dos fundos,
//                   e ha um caso de alarme para o dia em que alguem tentar.

import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * Tipos de commit que o gate audita.
 *
 * NAO alargue sem ler o item 277. `chore` esta fora de proposito: e o tipo da TASK-000, a
 * fundacao do repositorio, que nao tem teste vermelho porque nao ha comportamento de
 * usuario para falhar. Incluir `chore` aqui auditaria a fundacao; incluir `refactor` daria
 * a toda regra de negocio um tipo por onde escapar do ciclo.
 */
export const TIPOS_AUDITADOS = ['feat'];

const TIPO_TESTE = 'test';
const TASK_FUNDACAO = 'TASK-000';

const CABECALHO = /^(\w+)\((TASK-\d+)\)(!)?:/i;

export function normalizarTask(id) {
  const n = id.match(/\d+/)[0];
  return `TASK-${n.padStart(3, '0')}`;
}

export function parseMensagem(mensagem) {
  const m = String(mensagem).trim().match(CABECALHO);
  if (!m) return null;
  return { tipo: m[1].toLowerCase(), task: normalizarTask(m[2]) };
}

export function analisar({ commits = [], baseline = null } = {}) {
  const pular = (aviso) => ({ estado: 'pulado', achados: [], aviso });
  const falhar = (achados) => ({ estado: 'falha', achados, aviso: null });

  if (commits.length === 0) {
    return pular('nenhum commit no historico — nada foi conferido');
  }

  let janela = commits;

  if (baseline) {
    const i = commits.findIndex((c) => c.hash.startsWith(baseline) || baseline.startsWith(c.hash));
    if (i === -1) {
      // Valvula apontando para nada desliga o gate sem quebrar teste nenhum, e ele segue
      // imprimindo que conferiu. Anti-silencio (M-01): isso e falha, nao aviso.
      return falhar([
        {
          task: null,
          motivo: `baseline "${baseline}" nao existe no historico — a valvula desligaria o gate em silencio`,
        },
      ]);
    }
    janela = commits.slice(i + 1);
  }

  // Primeira posicao de cada (tipo, task) na janela auditada.
  const primeiro = new Map();
  for (let i = 0; i < janela.length; i++) {
    const p = parseMensagem(janela[i].mensagem);
    if (!p) continue;
    const chave = `${p.tipo}:${p.task}`;
    if (!primeiro.has(chave)) primeiro.set(chave, i);
  }

  const tasks = [
    ...new Set(
      janela
        .map((c) => parseMensagem(c.mensagem))
        .filter((p) => p && TIPOS_AUDITADOS.includes(p.tipo))
        .map((p) => p.task),
    ),
  ].filter((t) => t !== TASK_FUNDACAO);

  if (tasks.length === 0) {
    return pular(
      'nenhum commit de implementacao com escopo de task na janela auditada — nada foi conferido',
    );
  }

  const achados = [];
  for (const task of tasks) {
    const iTeste = primeiro.get(`${TIPO_TESTE}:${task}`);
    const iImpl = Math.min(
      ...TIPOS_AUDITADOS.map((t) => primeiro.get(`${t}:${task}`)).filter((v) => v !== undefined),
    );

    if (iTeste === undefined) {
      achados.push({ task, motivo: `${task}: implementacao sem nenhum commit de teste` });
      continue;
    }
    if (iTeste > iImpl) {
      // Nao se lava depois do fato.
      achados.push({
        task,
        motivo: `${task}: o commit de teste vem DEPOIS da implementacao — a ordem nao se conserta a posteriori`,
      });
    }
  }

  return achados.length ? falhar(achados) : { estado: 'ok', achados: [], aviso: null };
}

// ------------------------------------------------------------------ historico real

export async function rodar(raizProjeto, opcoes = {}) {
  let saida;
  try {
    const { stdout } = await exec('git', ['log', '--reverse', '--format=%H%x1f%s'], {
      cwd: raizProjeto,
      maxBuffer: 32 * 1024 * 1024,
    });
    saida = stdout;
  } catch (erro) {
    // O historico nao pode ser lido. Isso NAO e "nenhuma violacao encontrada".
    return {
      estado: 'erro',
      achados: [],
      aviso: `historico do git ilegivel: ${erro.message}`,
    };
  }

  const commits = saida
    .split('\n')
    .filter(Boolean)
    .map((linha) => {
      const [hash, mensagem] = linha.split('\x1f');
      return { hash, mensagem };
    });

  const baseline = String(opcoes.valvula ?? '').trim() || null;

  return analisar({ commits, baseline });
}
