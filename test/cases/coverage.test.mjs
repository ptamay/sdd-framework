// Casos do gate `coverage`.
//
// Escritos ANTES da implementacao (M-08).
//
// Este gate existe porque "cobertura >= 80%" viveu tres versoes do v5 dentro de um CHECKLIST
// de Definition of Done — camada de obediencia do modelo. Item de checklist nao mede nada: o
// agente marca [x] e segue. Era o buraco mais visivel do enforcement, e so apareceu quando
// alguem comparou o framework com o mercado.
//
// O anti-silencio aqui nao e detalhe de implementacao: e o que decide se o gate sobrevive.
// "Ha suite de teste e nao ha relatorio" tem de FALHAR — passar ali e exatamente como um
// gate de disciplina morre, porque ninguem percebe que ele parou de medir.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analisar, lerLcov, lerSummary, lerCobertura, minimoPadrao } from '../../gates/coverage.mjs';

const rel = (caminho, conteudo) => ({ caminho, conteudo });

const lcov = (registros) =>
  registros.map(([lf, lh], i) => `SF:/src/a${i}.js\nLF:${lf}\nLH:${lh}\nend_of_record`).join('\n');

// --------------------------------------------------------------------- item 212

test('lcov soma TODOS os registros, nunca so o primeiro (item 212)', () => {
  // O caso mais importante deste arquivo, e o unico que existe para pegar quem
  // "simplificar" o parser depois.
  //
  // Registro 1 em 10/10 e registro 2 em 50/90 dao 60% somando — e 100% lendo so o primeiro.
  // A versao ingenua passa com FOLGA justamente no projeto mal coberto, que e o oposto do
  // que o gate promete. Mesma familia do bug do awk no gate de migrations.
  const texto = lcov([[10, 10], [90, 50]]);
  assert.deepEqual(lerLcov(texto), { total: 100, cobertas: 60 });

  const r = analisar({ relatorios: [rel('coverage/lcov.info', texto)], minimo: 80 });
  assert.equal(r.estado, 'falha');
  assert.equal(r.percentual, 60);
});

// --------------------------------------------------------------------- formatos

test('os tres formatos sao lidos', () => {
  assert.deepEqual(lerLcov(lcov([[100, 85]])), { total: 100, cobertas: 85 });

  assert.deepEqual(
    lerSummary(JSON.stringify({ total: { lines: { total: 200, covered: 170, pct: 85 } } })),
    { total: 200, cobertas: 170 },
  );

  assert.deepEqual(
    lerCobertura('<coverage lines-valid="200" lines-covered="170" line-rate="0.85"></coverage>'),
    { total: 200, cobertas: 170 },
  );
});

test('formato desconhecido devolve null, e null nunca vira aprovacao', () => {
  assert.equal(lerLcov('nada disso'), null);
  assert.equal(lerSummary('{}'), null);
  assert.equal(lerCobertura('<html></html>'), null);

  const r = analisar({ relatorios: [rel('coverage/estranho.txt', 'nada disso')], minimo: 80, temSuite: true });
  assert.equal(r.estado, 'falha');
  assert.match(r.achados[0].motivo, /formato|ilegivel|ilegível/i);
});

// --------------------------------------------------------------------- limiar

test('acima e exatamente no minimo passam; abaixo falha', () => {
  const em = (lh) => analisar({ relatorios: [rel('coverage/lcov.info', lcov([[100, lh]]))], minimo: 80 });
  assert.equal(em(85).estado, 'ok');
  assert.equal(em(80).estado, 'ok', 'o limiar e >=, nao >');
  assert.equal(em(79).estado, 'falha');
});

test('o minimo padrao vem do catalogo, nao de um literal no gate', () => {
  // Invariante I-01. No v5 o Gate 10 lia o arquivo de valvula (default 80) enquanto o
  // Step 6, o review-agent, a politica de merge e o DoD fixavam "80%" em prosa — e num
  // projeto adotado que registrou 40, o step reprovava o que o gate aprovava.
  assert.equal(typeof minimoPadrao, 'number');
  assert.ok(minimoPadrao > 0 && minimoPadrao <= 100);
});

// --------------------------------------------------------------------- anti-silencio

test('ha suite de teste e nao ha relatorio => FALHA', () => {
  // O ponto exato onde um gate de disciplina morre. Se isto passar, o projeto para de
  // gerar relatorio e ninguem descobre — o gate segue verde sem medir nada.
  const r = analisar({ relatorios: [], minimo: 80, temSuite: true });
  assert.equal(r.estado, 'falha');
  assert.match(r.achados[0].motivo, /relatorio|relatório/i);
});

test('sem suite e sem relatorio => pulado com motivo', () => {
  // Projeto que ainda nao comecou a testar nao e projeto defeituoso (M-02).
  const r = analisar({ relatorios: [], minimo: 80, temSuite: false });
  assert.equal(r.estado, 'pulado');
  assert.ok(r.aviso?.length > 0);
});

test('relatorio que declara ZERO linhas nao e "0% de cobertura"', () => {
  // Um relatorio sem linhas significa que a instrumentacao nao rodou. Reportar 0% daria um
  // numero falso; aprovar seria pior. E falha, com o motivo certo.
  const r = analisar({ relatorios: [rel('coverage/lcov.info', lcov([[0, 0]]))], minimo: 80, temSuite: true });
  assert.equal(r.estado, 'falha');
  assert.match(r.achados[0].motivo, /nenhuma linha|instrumenta/i);
});

// --------------------------------------------------------------------- valvula

test('minimo "none" desliga o gate, e isso fica visivel', () => {
  const r = analisar({ relatorios: [rel('coverage/lcov.info', lcov([[100, 10]]))], minimo: 'none', temSuite: true });
  assert.equal(r.estado, 'pulado');
  assert.ok(r.aviso?.length > 0);
});

test('valvula com valor invalido FALHA — nao cai no padrao em silencio', () => {
  // Cair no padrao seria o mesmo defeito da baseline fantasma do gate de ordem TDD: a
  // valvula deixa de valer e ninguem fica sabendo. Pior: o usuario ACHA que baixou a regua.
  for (const v of ['oitenta', '-5', '150', '']) {
    const r = analisar({ relatorios: [rel('coverage/lcov.info', lcov([[100, 90]]))], minimo: v, temSuite: true });
    assert.equal(r.estado, 'falha', `aceitou minimo invalido: "${v}"`);
  }
});

// --------------------------------------------------------------------- forma

test('o resultado carrega o percentual e o minimo aplicado', () => {
  const r = analisar({ relatorios: [rel('coverage/lcov.info', lcov([[100, 72]]))], minimo: 80 });
  assert.equal(r.percentual, 72);
  assert.equal(r.minimo, 80);
  assert.match(r.achados[0].motivo, /72/);
});

test('prefere summary.json quando ha mais de um relatorio, e diz qual usou', () => {
  const r = analisar({
    relatorios: [
      rel('coverage/lcov.info', lcov([[100, 50]])),
      rel('coverage/coverage-summary.json', JSON.stringify({ total: { lines: { total: 100, covered: 90 } } })),
    ],
    minimo: 80,
  });
  assert.equal(r.estado, 'ok');
  assert.equal(r.percentual, 90);
  assert.match(r.fonte, /summary/);
});
