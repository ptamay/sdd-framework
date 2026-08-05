// Casos do bootstrap.
//
// Escritos ANTES da implementacao (M-08).
//
// A regua deste arquivo e o item 207 do v5, e ela merece ser citada inteira:
//
//   "TODO projeto criado pelo framework nascia REPROVADO. O bit de execucao e propriedade do
//    indice do git, e o bootstrap criava um indice novo — em Windows tudo entrava 100644. O
//    conserto da versao anterior arrumou os hooks NO TEMPLATE e nunca propagou ao produto do
//    template. O defeito que aquela versao existiu para corrigir seguia 100% presente em
//    todo projeto gerado."
//
// A licao que fica: fixture de gate prova o gate; so RODAR o bootstrap prova o bootstrap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { raizDoRepo } from '../../gates/lib/policy.mjs';
import { executarTodos, lerValvulas, lerIsencoes } from '../../gates/run.mjs';

const exec = promisify(execFile);
const RAIZ = raizDoRepo();
const INIT = join(RAIZ, 'bin', 'sdd-init');

/** Repositorio novo, num caminho COM ESPACO. */
async function repoNovo() {
  const base = await mkdtemp(join(tmpdir(), 'sdd-init-'));
  const raiz = join(base, 'meu projeto novo');
  await mkdir(raiz, { recursive: true });
  await exec('git', ['init', '-b', 'main'], { cwd: raiz });
  return raiz;
}

const rodarInit = (raiz) => exec(process.execPath, [INIT, raiz], { cwd: raiz });
const existe = (c) => access(c).then(() => true, () => false);

// --------------------------------------------------------------------- o produto

test('o bootstrap cria o esqueleto e NAO copia o framework para dentro do projeto', async () => {
  // A diferenca central em relacao ao v5, e a razao de ~1.180 linhas terem desaparecido:
  // la o framework inteiro era copiado para cada projeto, e dali nasceram o selo, o
  // manifesto, os guards e a caca a copias orfas.
  const raiz = await repoNovo();
  await rodarInit(raiz);

  for (const c of [
    '.sdd/memory/LEIA.md',
    '.sdd/coverage-min',
    '.github/workflows/ci.yml',
    '.claude/settings.json',
  ]) {
    assert.ok(await existe(join(raiz, c)), `nao criou ${c}`);
  }

  for (const c of ['gates', 'policy', 'skills', 'agents', 'bin']) {
    assert.equal(await existe(join(raiz, c)), false, `copiou ${c}/ para dentro do projeto`);
  }
});

test('o projeto nasce SEM REPROVAR — item 207', async () => {
  // Nao exigimos "aprovado": um projeto recem-criado nao tem codigo, entao quase tudo pula
  // legitimamente e o veredito correto e "nada-verificado". O que nao pode acontecer e
  // REPROVAR, que foi o que o v5 entregou por tres versoes seguidas.
  const raiz = await repoNovo();
  await rodarInit(raiz);

  const r = await executarTodos({
    raiz,
    valvulas: await lerValvulas(raiz),
    isencoes: await lerIsencoes(raiz),
  });

  const reprovaram = r.resultados
    .filter((x) => x.estado === 'falha' || x.estado === 'erro')
    .map((x) => `${x.id}: ${x.aviso ?? x.achados.map((a) => a.motivo).join('; ')}`);

  assert.deepEqual(reprovaram, [], 'o bootstrap produziu um projeto reprovado');
  assert.notEqual(r.veredito, 'reprovado');
});

test('o bootstrap SAI COM ERRO se o produto dele reprovar', async () => {
  // O v5 tinha o defeito e nao tinha como saber. A verificacao so vale se ela decidir o
  // codigo de saida — imprimir o relatorio e sair 0 seria a mesma coisa que nao verificar.
  const fonte = await readFile(INIT, 'utf8');
  assert.match(fonte, /veredito === 'reprovado'/);
  assert.match(fonte, /process\.exit\(1\)/);
});

// --------------------------------------------------------------------- idempotencia

test('rodar duas vezes preserva o que ja existe', async () => {
  const raiz = await repoNovo();
  await rodarInit(raiz);

  const alvo = join(raiz, '.sdd', 'coverage-min');
  await writeFile(alvo, '45\n');

  const { stdout } = await rodarInit(raiz);

  assert.equal(await readFile(alvo, 'utf8'), '45\n', 'sobrescreveu a valvula do usuario');
  assert.match(stdout, /preservado/, 'nao reportou o que preservou');
});

// --------------------------------------------------------------------- derivado

test('o guia da memoria e DERIVADO do contrato, nao escrito a mao', async () => {
  // Escrito a mao, ele viraria a segunda fonte de verdade sobre a memoria — e ficaria velho
  // exatamente como as quatro copias divergentes da zona somente-leitura do v5.
  const raiz = await repoNovo();
  await rodarInit(raiz);

  const guia = await readFile(join(raiz, '.sdd', 'memory', 'LEIA.md'), 'utf8');
  const memoria = JSON.parse(await readFile(join(RAIZ, 'policy', 'memoria.json'), 'utf8'));

  for (const a of memoria.arquivos) {
    assert.match(guia, new RegExp(a.arquivo.replace('.', '\\.')), `guia nao cita ${a.arquivo}`);
  }
  for (const v of memoria.valvulas) {
    assert.ok(guia.includes(v.arquivo), `guia nao cita a valvula ${v.arquivo}`);
  }
});

// --------------------------------------------------------------------- CI

test('o job de CI invoca os gates a partir do framework CLONADO, nunca copiado', async () => {
  const raiz = await repoNovo();
  await rodarInit(raiz);

  const ci = await readFile(join(raiz, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /sdd-gates/, 'o CI nao roda os gates');
  assert.match(ci, /git clone/, 'o CI nao obtem o framework');
  assert.doesNotMatch(ci, /cp -r|copy-item/i, 'o CI copia o framework para dentro do projeto');
});

test('as permissoes ficam no projeto, porque o plugin nao pode carrega-las', async () => {
  // Limitacao real e declarada: o settings.json de um plugin so aceita as chaves de agente e
  // de status line. Permissao nao viaja com ele — entao ela tem de nascer aqui.
  const raiz = await repoNovo();
  await rodarInit(raiz);

  const s = JSON.parse(await readFile(join(raiz, '.claude', 'settings.json'), 'utf8'));
  assert.ok(Array.isArray(s.permissions?.deny) && s.permissions.deny.length > 0);
});

// --------------------------------------------------------------------- o passo manual

test('o bootstrap DECLARA o passo que nenhum gate cobre', async () => {
  // Lacuna declarada e divida que alguem pode pagar; lacuna omitida vira "achavamos que
  // estava protegido". O v5 escreveu isso no proprio CODEOWNERS, dizendo em voz alta que
  // nao havia bloqueio de servidor naquele repositorio.
  const raiz = await repoNovo();
  const { stdout } = await rodarInit(raiz);
  assert.match(stdout, /protecao de branch|proteção de branch/i);
  assert.match(stdout, /MANUAL/);
});

// --------------------------------------------------------------------- marcador e registro

test('o marcador do framework e EXPLICITO, nunca a mera existencia de .sdd/', async () => {
  // A versao anterior deste framework tambem usa `.sdd/`. Sem marcador proprio, abrir o
  // repositorio dela com este plugin carregado injetaria o processo errado na sessao — e
  // marcador ambiguo e pior que marcador nenhum: ele responde, e responde errado.
  const raiz = await repoNovo();
  await rodarInit(raiz);

  const m = JSON.parse(await readFile(join(raiz, '.sdd', 'framework.json'), 'utf8'));
  assert.equal(m.framework, 'sdd');
  assert.match(m.versao, /^\d+\.\d+\.\d+$/);

  const hook = await readFile(join(RAIZ, 'hooks', 'contexto.mjs'), 'utf8');
  assert.match(hook, /framework\.json/, 'o hook nao exige o marcador');
});

test('a execucao dos gates fica REGISTRADA, com o motivo de cada pulo', async () => {
  // O v5 produziu 27 achados numa execucao real, todos anotados a mao. O que se perde sem
  // registro nao e o achado espetacular — e o padrao: um gate que pula sempre pelo mesmo
  // motivo e um gate que nao existe na pratica, e isso so aparece na serie.
  const raiz = await repoNovo();
  await rodarInit(raiz);
  await exec(process.execPath, [join(RAIZ, 'bin', 'sdd-gates'), raiz], { cwd: raiz });

  const linhas = (await readFile(join(raiz, '.sdd', 'execucoes.jsonl'), 'utf8'))
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));

  assert.ok(linhas.length >= 1);
  const r = linhas.at(-1);
  assert.ok(['aprovado', 'nada-verificado', 'reprovado'].includes(r.veredito));
  assert.equal(r.branch, 'main', 'branch nao resolvida em repositorio sem commits');
  assert.ok(r.gates.every((g) => g.estado !== 'pulado' || g.aviso), 'pulo sem motivo registrado');
});
