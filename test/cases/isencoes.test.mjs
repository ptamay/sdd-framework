// Casos das isencoes de gate.
//
// Escritos ANTES da implementacao (M-08).
//
// Isencao e a coisa mais perigosa deste framework: e a lista do que os gates DEIXAM de
// olhar. Alargada, o relatorio fica verde e a varredura some — sem quebrar teste nenhum.
// Foi exatamente o que o v5 teve de tratar na allowlist do scanner de segredo, e por isso
// aquele arquivo entrou na zona protegida: allowlist e superficie de ataque, nao conforto.
//
// Cinco travas, e cada uma tem caso proprio:
//   1. ancorada       o caminho precisa de ^ e $ — sem eles, `vendor/x.test.mjs.bak` entra
//                     de carona (o furo real que o v5 fechou com dois casos)
//   2. estreita       nenhum padrao pode casar caminho de codigo comum (canarios)
//   3. por gate       nao existe isencao global; ela vale para UM gate nomeado
//   4. justificada    sem motivo escrito, ninguem reabre a decisao depois
//   5. visivel        o gate REPORTA o que isentou — isencao silenciosa e gate desligado

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validarIsencoes, compilarIsencoes, CANARIOS } from '../../gates/lib/isencoes.mjs';

const ok = (extra = {}) => ({
  gate: 'secrets',
  caminho: '^test/cases/secrets\\.test\\.mjs$',
  porque: 'hospeda credenciais falsas de proposito — um sk_live_ que nao case o padrao nao testa nada',
  ...extra,
});

const problemas = (lista) => validarIsencoes(lista, ['secrets', 'imports']);

// --------------------------------------------------------------------- aceita

test('isencao bem formada passa', () => {
  assert.deepEqual(problemas([ok()]), []);
});

test('lista vazia e o normal — nao e problema', () => {
  assert.deepEqual(problemas([]), []);
});

// --------------------------------------------------------------------- trava 1: ancorada

test('caminho sem ancora e recusado', () => {
  // Sem `^` e `$`, `test/cases/secrets\.test\.mjs` tambem casa
  // `vendor/test/cases/secrets.test.mjs.bak`. E o furo que o v5 fechou com caso proprio.
  for (const caminho of [
    'test/cases/secrets\\.test\\.mjs',
    '^test/cases/secrets\\.test\\.mjs',
    'test/cases/secrets\\.test\\.mjs$',
  ]) {
    assert.notEqual(problemas([ok({ caminho })]).length, 0, `aceitou sem ancora: ${caminho}`);
  }
});

// --------------------------------------------------------------------- trava 2: estreita

test('padrao que casa codigo comum e recusado', () => {
  // Melhor que proibir `.*` por nome: qualquer padrao que alcance um canario e largo
  // demais, tenha a forma que tiver. Proibir a string `.*` so ensina a escrever `[^]*`.
  for (const caminho of ['^.*$', '^.+$', '^src/.*$', '^[\\s\\S]*$', '^(.*)$']) {
    assert.notEqual(problemas([ok({ caminho })]).length, 0, `aceitou padrao largo: ${caminho}`);
  }
});

test('os canarios cobrem as familias de codigo que importam', () => {
  // Se esta lista encolher, a trava 2 afrouxa em silencio.
  for (const esperado of ['src/', '.env', 'migrations', 'pages/', 'app/']) {
    assert.ok(
      CANARIOS.some((c) => c.includes(esperado)),
      `nenhum canario cobre "${esperado}"`,
    );
  }
});

// --------------------------------------------------------------------- trava 3: por gate

test('isencao sem gate, ou para gate inexistente, e recusada', () => {
  assert.notEqual(problemas([ok({ gate: undefined })]).length, 0);
  assert.notEqual(problemas([ok({ gate: 'todos' })]).length, 0);
  assert.notEqual(problemas([ok({ gate: '*' })]).length, 0);
  assert.notEqual(problemas([ok({ gate: 'gate-que-nao-existe' })]).length, 0);
});

// --------------------------------------------------------------------- trava 4: justificada

test('isencao sem motivo escrito e recusada', () => {
  // Isencao sem motivo e isencao que ninguem reabre: daqui a seis meses ninguem sabe se
  // ainda vale, e remover parece arriscado. O motivo e o que torna a decisao revisavel.
  assert.notEqual(problemas([ok({ porque: undefined })]).length, 0);
  assert.notEqual(problemas([ok({ porque: '' })]).length, 0);
  assert.notEqual(problemas([ok({ porque: 'x' })]).length, 0);
});

// --------------------------------------------------------------------- aplicacao

test('a isencao vale so para o gate nomeado', () => {
  const { isento } = compilarIsencoes([ok()], 'secrets');
  assert.equal(isento('test/cases/secrets.test.mjs'), true);

  const outro = compilarIsencoes([ok()], 'imports');
  assert.equal(outro.isento('test/cases/secrets.test.mjs'), false, 'vazou para outro gate');
});

test('a isencao nao alcanca vizinhos do arquivo isento', () => {
  const { isento } = compilarIsencoes([ok()], 'secrets');
  for (const c of [
    'vendor/test/cases/secrets.test.mjs',
    'test/cases/secrets.test.mjs.bak',
    'test/cases/imports.test.mjs',
    'src/secrets.ts',
  ]) {
    assert.equal(isento(c), false, `isentou vizinho: ${c}`);
  }
});

test('compilar REGISTRA o que foi isentado — isencao silenciosa e gate desligado', () => {
  // Trava 5. O v5 fechou o furo da allowlist mas ela seguia MUDA em tempo de execucao:
  // ninguem via, na saida, que um arquivo tinha deixado de ser varrido.
  const c = compilarIsencoes([ok()], 'secrets');
  c.isento('test/cases/secrets.test.mjs');
  c.isento('src/app.ts');
  assert.deepEqual(c.aplicadas(), ['test/cases/secrets.test.mjs']);
});
