// Casos do gate `tdd-order`.
//
// Escritos ANTES da implementacao (M-08). E o unico gate do conjunto que audita HISTORICO em
// vez de arvore, e a unica prova mecanica de que o teste nao foi escrito depois para
// acompanhar o codigo que ja passava.
//
// Duas propriedades verificadas em execucao real no v5 (§3.30) e que sao o coracao daqui:
//   - auditado POR TASK: uma task fora de ordem nao arrasta as corretas
//   - a ordem NAO se lava depois do fato: um commit de teste posterior nao conserta a
//     implementacao anterior

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

import {
  analisar,
  rodar,
  parseMensagem,
  normalizarTask,
  TIPOS_AUDITADOS,
} from '../../gates/tdd-order.mjs';

const c = (mensagem, hash = String(Math.random()).slice(2, 9)) => ({ hash, mensagem });

// --------------------------------------------------------------------- ordem

test('test antes de feat passa', () => {
  const r = analisar({
    commits: [c('test(TASK-001): agenda recusa horario ocupado'), c('feat(TASK-001): agenda')],
  });
  assert.equal(r.estado, 'ok');
});

test('refactor depois do par nao quebra nada', () => {
  const r = analisar({
    commits: [
      c('test(TASK-001): caso vermelho'),
      c('feat(TASK-001): minimo para verde'),
      c('refactor(TASK-001): extrai regra de conflito'),
    ],
  });
  assert.equal(r.estado, 'ok');
});

test('feat sem test anterior e acusado', () => {
  const r = analisar({ commits: [c('feat(TASK-001): agenda')] });
  assert.equal(r.estado, 'falha');
  assert.equal(r.achados[0].task, 'TASK-001');
});

test('a ordem NAO se lava depois do fato', () => {
  // Verificado em execucao real no v5: um `test` posterior tentando consertar a ordem
  // mantem a acusacao. Se lavasse, o gate viraria cerimonia — bastaria commitar o teste
  // depois para ficar verde, que e exatamente o habito que ele existe para impedir.
  const r = analisar({
    commits: [c('feat(TASK-001): agenda'), c('test(TASK-001): agenda recusa conflito')],
  });
  assert.equal(r.estado, 'falha');
});

test('task fora de ordem NAO arrasta a task correta', () => {
  // Auditado POR TASK. Reprovar a sprint inteira por causa de uma task ensina a ignorar o
  // gate, e a acusacao deixa de dizer onde esta o problema.
  const r = analisar({
    commits: [
      c('feat(TASK-001): sem teste antes'),
      c('test(TASK-002): caso vermelho'),
      c('feat(TASK-002): minimo para verde'),
    ],
  });
  assert.equal(r.estado, 'falha');
  assert.equal(r.achados.length, 1);
  assert.equal(r.achados[0].task, 'TASK-001');
});

test('TASK-7 e TASK-007 sao a mesma task', () => {
  // Verificado em execucao real no v5. Sem isso, o par correto e lido como duas tasks
  // distintas e as duas sao acusadas.
  const r = analisar({
    commits: [c('test(TASK-7): caso vermelho'), c('feat(TASK-007): minimo para verde')],
  });
  assert.equal(r.estado, 'ok');
});

test('TASK-42 nao casa dentro de TASK-420', () => {
  const r = analisar({
    commits: [c('test(TASK-420): caso vermelho'), c('feat(TASK-42): implementacao')],
  });
  assert.equal(r.estado, 'falha', 'TASK-42 aceitou o teste da TASK-420 como seu');
});

// --------------------------------------------------------------------- excecoes

test('a fundacao do repositorio nao e auditada', () => {
  // Item 277. A TASK-000 e excecao unica e nomeada: uma por projeto, tipo chore, sem regra
  // de negocio. Ela NAO "passa" no gate por omissao — nunca e auditada, porque nao ha
  // comportamento de usuario para falhar antes.
  const r = analisar({ commits: [c('chore(TASK-000): fundacao do repositorio')] });
  assert.equal(r.estado, 'pulado');
});

test('commit sem escopo de task e ignorado', () => {
  const r = analisar({
    commits: [c('docs: atualiza README'), c('chore: bump de dependencia'), c('ci: ajusta cache')],
  });
  assert.equal(r.estado, 'pulado');
});

test('SOMENTE `feat` e auditado — alargar isto abre a porta dos fundos', () => {
  // Caso de alarme, no espirito dos dois que o v5 deixou no item 277. A excecao da
  // TASK-000 fecha por tres travas simultaneas, e uma delas e MECANICA: o gate coleta
  // apenas `feat`. No dia em que alguem estender a lista para `chore` ou `refactor`, a
  // fundacao passa a ser auditada e toda regra de negocio ganha um tipo por onde escapar.
  assert.deepEqual(TIPOS_AUDITADOS, ['feat']);
});

// --------------------------------------------------------------------- valvula

test('a baseline ignora o historico anterior a ela', () => {
  // Projeto adotado: a historia pre-framework nao seguia o ciclo, e reprovar tudo desde o
  // primeiro commit deixa o gate vermelho para sempre — que e como um gate morre.
  const r = analisar({
    commits: [
      c('feat(TASK-001): legado sem teste', 'aaa1111'),
      c('feat(TASK-002): legado sem teste', 'bbb2222'),
      c('test(TASK-003): caso vermelho', 'ccc3333'),
      c('feat(TASK-003): minimo para verde', 'ddd4444'),
    ],
    baseline: 'bbb2222',
  });
  assert.equal(r.estado, 'ok');
});

test('baseline apontando para commit inexistente FALHA', () => {
  // Anti-silencio (M-01). Uma valvula que aponta para nada desliga o gate sem quebrar
  // teste nenhum — e o gate segue imprimindo que conferiu. E a mesma familia do manifesto
  // reescrito junto com o que ele mede.
  const r = analisar({
    commits: [c('feat(TASK-001): sem teste antes', 'aaa1111')],
    baseline: 'naoexiste',
  });
  assert.equal(r.estado, 'falha');
  assert.match(r.achados[0].motivo, /baseline/i);
});

// --------------------------------------------------------------------- anti-silencio

test('historico vazio pula com aviso, nao aprova', () => {
  const r = analisar({ commits: [] });
  assert.equal(r.estado, 'pulado');
  assert.ok(r.aviso?.length > 0, 'pulou sem dizer por que');
});

// --------------------------------------------------------------------- parser

test('parseMensagem separa tipo e task, e devolve null no resto', () => {
  assert.deepEqual(parseMensagem('feat(TASK-012): x'), { tipo: 'feat', task: 'TASK-012' });
  assert.deepEqual(parseMensagem('test(TASK-3): y'), { tipo: 'test', task: 'TASK-003' });
  assert.equal(parseMensagem('feat: sem escopo'), null);
  assert.equal(parseMensagem('mensagem solta'), null);
});

test('normalizarTask preenche zeros a esquerda', () => {
  assert.equal(normalizarTask('TASK-1'), 'TASK-001');
  assert.equal(normalizarTask('TASK-042'), 'TASK-042');
  assert.equal(normalizarTask('TASK-1234'), 'TASK-1234');
});

// --------------------------------------------------------------------- historico real

test('repositorio SEM COMMITS pula — nao e historico ilegivel', async () => {
  // Achado na primeira execucao do bootstrap, e e o item 207 do v5 se reproduzindo: o
  // produto do bootstrap nascia REPROVADO por um defeito que nenhuma fixture de gate via.
  // `git log` num repo recem-criado sai com erro, e ler isso como "ilegivel" reprovava todo
  // projeto novo. Historico vazio e estado legitimo; historico ilegivel e defeito.
  const raiz = await mkdtemp(join(tmpdir(), 'sdd-vazio-'));
  await exec('git', ['init', '-b', 'main'], { cwd: raiz });

  const r = await rodar(raiz);
  assert.equal(r.estado, 'pulado', `repo sem commits devolveu "${r.estado}"`);
  assert.match(r.aviso, /sem commits/i);
});

test('diretorio que nao e repositorio git pula com o motivo certo', async () => {
  const raiz = await mkdtemp(join(tmpdir(), 'sdd-sem-git-'));
  const r = await rodar(raiz);
  assert.equal(r.estado, 'pulado');
  assert.match(r.aviso, /nao e um repositorio git|não é um repositório git/i);
});
