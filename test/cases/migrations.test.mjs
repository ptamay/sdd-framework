// Casos do gate `migrations`.
//
// Escritos ANTES da implementacao (M-08). E o gate com mais defeitos medidos no v5 — cinco,
// dos quais DOIS eram falso verde. Cada um deles tem caso proprio aqui, nomeado.
//
// A lei que governa este arquivo e o anti-silencio (M-01): um gate que nao sabe o que esta
// olhando nunca diz que esta certo. "Nada para conferir" e "conferi e esta certo" sao
// resultados diferentes, e confundi-los foi como o v5 deu o ✅ mais facil de acreditar do
// conjunto — "0 migrations com DOWN pareado", no dialeto default da propria stack.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { corpoVazio, detectar, analisar } from '../../gates/migrations.mjs';

const arq = (caminho, conteudo = '') => ({ caminho, conteudo });

// --------------------------------------------------------------- corpo vazio (item 200)

test('corpo do down vazio em arquivo de UMA linha (item 200)', () => {
  // O awk do v5 procurava a primeira `{` da linha — que num arquivo de uma linha e a do
  // OBJETO externo. O corpo do `up` contava como corpo do `down`, e o stub vazio passava
  // como rollback implementado. O corte tem de comecar no token `down`.
  const umaLinha = 'module.exports = { async up(db) { await db.create("x"); }, async down(db) {} };';
  assert.equal(corpoVazio(umaLinha, 'down'), true);
});

test('corpo do down com implementacao real nao e acusado', () => {
  const ok = 'module.exports = { async up(db) { await db.create("x"); }, async down(db) { await db.drop("x"); } };';
  assert.equal(corpoVazio(ok, 'down'), false);
});

test('down vazio nas formas que os geradores emitem', () => {
  // `migrate-mongo create` gera `async down() {}` por template: o arquivo "tem down" sem
  // ter rollback nenhum.
  assert.equal(corpoVazio('async down() {}', 'down'), true);
  assert.equal(corpoVazio('exports.down = async () => {};', 'down'), true);
  assert.equal(corpoVazio('export async function down() {\n\n}', 'down'), true);
});

test('down apenas com comentario ou TODO continua vazio', () => {
  assert.equal(corpoVazio('async down() {\n  // TODO: implementar\n}', 'down'), true);
  assert.equal(corpoVazio('async down() {\n  /* nada ainda */\n}', 'down'), true);
});

test('downgrade do Alembic: `pass` e vazio, corpo real nao', () => {
  assert.equal(corpoVazio('def downgrade():\n    pass\n', 'downgrade'), true);
  assert.equal(corpoVazio('def downgrade():\n    op.drop_table("clientes")\n', 'downgrade'), false);
});

test('ausencia da funcao nao e "corpo vazio" — sao coisas diferentes', () => {
  // Distincao que o v5 errou no drizzle (item 199): reprovava com a mensagem errada,
  // "down declarado e vazio", quando o caso era "nao ha down nenhum".
  assert.equal(corpoVazio('export async function up() { criar(); }', 'down'), null);
});

// --------------------------------------------------------------- deteccao de dialeto

test('cada dialeto e reconhecido pelo seu indicio', () => {
  const casos = [
    ['prisma', [arq('prisma/schema.prisma'), arq('prisma/migrations/001_init/migration.sql')]],
    ['alembic', [arq('alembic.ini'), arq('alembic/versions/a1_init.py')]],
    ['mongo', [arq('migrate-mongo-config.js'), arq('migrations/001-init.js')]],
    ['jsmig', [arq('knexfile.js'), arq('migrations/001_init.js')]],
    ['drizzle', [arq('drizzle.config.ts'), arq('drizzle/0001_init.sql')]],
    ['pair', [arq('supabase/migrations/001_init.sql'), arq('db/migrations/001_init.down.sql')]],
  ];
  for (const [esperado, arquivos] of casos) {
    assert.equal(detectar({ arquivos }).dialeto, esperado, `nao detectou ${esperado}`);
  }
});

test('a valvula declarada vence a deteccao', () => {
  const arquivos = [arq('knexfile.js'), arq('migrations/001_init.js')];
  assert.equal(detectar({ arquivos, valvula: 'alembic' }).dialeto, 'alembic');
});

test('valvula "none" desliga o gate, e isso fica visivel', () => {
  const r = detectar({ arquivos: [arq('knexfile.js')], valvula: 'none' });
  assert.equal(r.dialeto, 'none');
});

test('indicio de banco SEM dialeto reconhecido FALHA pedindo a valvula (item 181)', () => {
  // O coracao do anti-silencio deste gate. O v5 imprimia "nenhuma migration encontrada" e
  // PASSAVA em Prisma, Alembic, migrate-mongo, Rails e Drizzle — todo layout que nao fosse
  // a convencao do Supabase, que ele codificava como se fosse a regra.
  const r = detectar({
    arquivos: [arq('src/db.ts')],
    manifesto: { dependencies: { pg: '^8.0.0' } },
  });
  assert.equal(r.dialeto, 'desconhecido');
  assert.match(r.motivo, /valvula|válvula/i);
});

test('projeto sem nenhum indicio de banco pula — nao falha', () => {
  // Gate que reprova quem esta certo e gate que alguem desliga (M-02). Projeto sem banco
  // nao tem migration para conferir, e isso nao e defeito dele.
  assert.equal(detectar({ arquivos: [arq('src/app.tsx')], manifesto: {} }).dialeto, 'sem-banco');
});

// --------------------------------------------------------------- analise por dialeto

test('anti-silencio: dialeto detectado e diretorio VAZIO pula com aviso (item 254)', () => {
  // Era "✅ 0 migration(s) com DOWN pareado" — o ✅ mais facil de acreditar do conjunto,
  // dado por nao ter olhado nada, no dialeto default do framework. Todos os outros dialetos
  // ja distinguiam; o anti-silencio da v5.9.3 foi aplicado aos dialetos NOVOS e nao ao que
  // ja existia.
  const r = analisar({ dialeto: 'pair', arquivos: [arq('supabase/migrations/.gitkeep')] });
  assert.equal(r.estado, 'pulado');
  assert.ok(r.aviso?.length > 0, 'pulou sem dizer por que');
  assert.equal(r.achados.length, 0);
});

test('pair: UP sem DOWN pareado e acusado; com par, passa', () => {
  const semPar = analisar({
    dialeto: 'pair',
    arquivos: [arq('supabase/migrations/001_init.sql', 'create table x();')],
  });
  assert.equal(semPar.estado, 'falha');
  assert.match(semPar.achados[0].motivo, /sem rollback|sem DOWN|sem par/i);

  const comPar = analisar({
    dialeto: 'pair',
    arquivos: [
      arq('supabase/migrations/001_init.sql', 'create table x();'),
      arq('db/migrations/001_init.down.sql', 'drop table x;'),
    ],
  });
  assert.equal(comPar.estado, 'ok');
});

test('drizzle exige o irmao .down.sql, com a mensagem certa (item 199)', () => {
  // Como variante de jsmig, o v5 procurava uma funcao down() DENTRO de um .sql — nunca
  // acha, e TODO projeto drizzle era reprovado com a mensagem errada.
  const r = analisar({
    dialeto: 'drizzle',
    arquivos: [arq('drizzle/0001_init.sql', 'CREATE TABLE x();')],
  });
  assert.equal(r.estado, 'falha');
  assert.match(r.achados[0].motivo, /nao ha|não há|ausente/i);
  assert.doesNotMatch(r.achados[0].motivo, /vazio/i, 'mensagem de "vazio" para caso de ausencia');
});

test('mongo: down declarado e vazio e acusado como VAZIO, nao como ausente', () => {
  const r = analisar({
    dialeto: 'mongo',
    arquivos: [arq('migrations/001-init.js', 'module.exports = { async up(db) { await db.c(); }, async down(db) {} };')],
  });
  assert.equal(r.estado, 'falha');
  assert.match(r.achados[0].motivo, /vazio/i);
});

test('alembic: downgrade com pass falha; com corpo passa', () => {
  const ruim = analisar({
    dialeto: 'alembic',
    arquivos: [arq('alembic/versions/a1.py', 'def upgrade():\n    op.create_table("x")\n\ndef downgrade():\n    pass\n')],
  });
  assert.equal(ruim.estado, 'falha');

  const bom = analisar({
    dialeto: 'alembic',
    arquivos: [arq('alembic/versions/a1.py', 'def upgrade():\n    op.create_table("x")\n\ndef downgrade():\n    op.drop_table("x")\n')],
  });
  assert.equal(bom.estado, 'ok');
});

test('nome de arquivo com ESPACO e visto (item 198)', () => {
  // Tres bugs historicos do v5 foram de word-splitting, e este e o cenario em que
  // apareceram. Em Node o risco muda de forma, mas o caso fica: e barato e ancora a lição.
  const r = analisar({
    dialeto: 'mongo',
    arquivos: [arq('migrations/001 criar usuarios.js', 'module.exports = { async up(db) { await db.c(); }, async down(db) {} };')],
  });
  assert.equal(r.estado, 'falha', 'migration com espaco no nome sumiu da varredura');
});

test('dialeto desconhecido NUNCA retorna ok', () => {
  const r = analisar({ dialeto: 'desconhecido', arquivos: [] });
  assert.equal(r.estado, 'falha');
});

test('dialeto "none" e "sem-banco" pulam, cada um com seu motivo', () => {
  for (const d of ['none', 'sem-banco']) {
    const r = analisar({ dialeto: d, arquivos: [] });
    assert.equal(r.estado, 'pulado', d);
    assert.ok(r.aviso?.length > 0, `${d} pulou sem dizer por que`);
  }
});
