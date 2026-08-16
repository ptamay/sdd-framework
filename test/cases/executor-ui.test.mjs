// Casos da deteccao do executor de craft de UI.
//
// Escritos ANTES da implementacao (M-08).
//
// POR QUE ESTES CASOS EXISTEM, e a evidencia e datada: `skills/design/SKILL.md` manda, em
// titulo, "O executor e EXTERNO — detecte, nao presuma". O framework nao entregava deteccao
// nenhuma. `sdd-rota design` imprimia quando, estagio, esforco, entrega, regras e gates, e
// nao dizia uma palavra sobre o executor — entao a resposta vinha de o agente ler
// `known_marketplaces.json` a mao e ESCREVER o resultado em prosa no artefato.
//
// Medido (achado A7): um projeto real fechou a rota em 2026-08-15 afirmando "o plugin nao
// esta habilitado", e o plugin foi habilitado em 2026-08-16T07:24:15Z. O artefato continuou
// afirmando o contrario menos de 24h depois, e nada no framework percebeu.
//
// A PROPRIEDADE CENTRAL, e ela e a razao de a funcao ser pura: "nao consegui ver" NAO e
// "nao esta la". Um catalogo de plugins ilegivel que virasse `ausente` mandaria a rota
// construir a mao numa maquina onde o craft esta instalado — falha silenciosa, que e
// exatamente a categoria que esta rota manda listar primeiro. Mesma licao do achado A4.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

import { raizDoRepo } from '../../gates/lib/policy.mjs';
import { detectar, EXECUTOR } from '../../gates/lib/executor-ui.mjs';

const exec = promisify(execFile);
const RAIZ = raizDoRepo();

// O catalogo real do harness, na forma minima que importa aqui.
const instalado = (versao = '4.1.1') => ({
  version: 2,
  plugins: { [EXECUTOR.chave]: [{ version: versao, installPath: '/qualquer/lugar' }] },
});

// --------------------------------------------------------------------- presente

test('instalado E habilitado => presente, com a versao', () => {
  const r = detectar({
    instalados: instalado('4.1.1'),
    habilitados: [{ [EXECUTOR.chave]: true }],
  });

  assert.equal(r.estado, 'presente');
  assert.equal(r.versao, '4.1.1');
});

// --------------------------------------------------------------------- ausente, e o motivo importa

test('instalado e NAO habilitado => ausente, e o motivo distingue esse estado', () => {
  // Este e o estado exato em que o projeto de origem estava em 2026-08-15: o marketplace
  // adicionado, o repositorio em disco, e nenhum `enabledPlugins` em settings.json nenhum.
  // Se ele colapsar em "nao instalado", a saida manda instalar o que ja esta instalado.
  const r = detectar({ instalados: instalado(), habilitados: [{}] });

  assert.equal(r.estado, 'ausente');
  assert.match(r.motivo, /habilit/i, 'o motivo nao distingue instalado-e-desabilitado');
});

test('nao instalado => ausente, com o comando de instalacao na saida', () => {
  const r = detectar({ instalados: { version: 2, plugins: {} }, habilitados: [{}] });

  assert.equal(r.estado, 'ausente');
  assert.match(r.comando, /pbakaus\/impeccable/, 'a saida nao traz como instalar');
});

test('habilitado com valor false nao conta como habilitado', () => {
  const r = detectar({
    instalados: instalado(),
    habilitados: [{ [EXECUTOR.chave]: false }],
  });

  assert.equal(r.estado, 'ausente');
});

test('basta UM settings.json habilitar — projeto e usuario sao duas casas legitimas', () => {
  const r = detectar({
    instalados: instalado(),
    habilitados: [{}, { [EXECUTOR.chave]: true }],
  });

  assert.equal(r.estado, 'presente');
});

// --------------------------------------------------------------------- anti-silencio (M-01)

test('catalogo ilegivel => INDETERMINADO, nunca ausente', () => {
  // A regressao mais cara possivel aqui, e ela e silenciosa nos dois sentidos: `ausente`
  // manda construir a mao com o craft instalado; `presente` manda chamar um comando que nao
  // existe. O unico estado honesto e dizer que nao deu para ver.
  const r = detectar({ instalados: null, habilitados: [{}] });

  assert.equal(r.estado, 'indeterminado');
  assert.ok(r.motivo?.length > 10, 'indeterminado sem motivo escrito');
});

test('catalogo com forma inesperada => indeterminado, nao "plugins: undefined => ausente"', () => {
  const r = detectar({ instalados: { version: 2 }, habilitados: [{}] });

  assert.equal(r.estado, 'indeterminado');
});

// --------------------------------------------------------------------- a saida da rota

test('`sdd-rota design` IMPRIME o estado do executor', async () => {
  // O caso que fecha A7. Sem esta linha, "detecte, nao presuma" e slogan: a rota nao
  // oferece nenhum jeito de detectar, e a deteccao volta a ser leitura a mao virando prosa.
  const { stdout } = await exec(process.execPath, [join(RAIZ, 'bin', 'sdd-rota'), 'design']);

  assert.match(stdout, /Executor de craft/i, 'a rota de design nao imprime o estado do executor');
  assert.match(
    stdout,
    /presente|ausente|indeterminado/i,
    'a linha do executor nao traz um dos tres estados',
  );
});

test('a rota de design manda o artefato NAO afirmar o estado do executor', async () => {
  // O artefato envelheceu em menos de 24h porque escreveu um fato que muda sozinho. A regra
  // que impede a reincidencia mora no catalogo, junto com a que ja proibe copiar valor de
  // token — sao o mesmo defeito em duas roupas.
  const { rotas } = JSON.parse(
    await import('node:fs/promises').then((fs) => fs.readFile(join(RAIZ, 'policy', 'rotas.json'), 'utf8')),
  );
  const design = rotas.find((r) => r.id === 'design');
  const regras = design.regras.join(' ');

  assert.match(
    regras,
    /nao afirma|nunca afirma|nao registra o estado|aponta para o comando/i,
    'nada proibe o artefato de congelar o estado do executor em prosa',
  );
});

test('`sdd-rota sprint` NAO imprime o estado do executor — a linha e da rota de design', async () => {
  // Trava a generalizacao. Imprimir em toda rota transforma um sinal em ruido, e ruido lido
  // sete vezes por sprint deixa de ser lido.
  const { stdout } = await exec(process.execPath, [join(RAIZ, 'bin', 'sdd-rota'), 'sprint']);

  assert.doesNotMatch(stdout, /Executor de craft/i);
});
