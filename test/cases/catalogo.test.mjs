// Casos do catálogo de gates.
//
// Escritos ANTES da implementação (invariante M-08). Nascem vermelhos: `gates/lib/policy.mjs`
// ainda não existe. Cada caso aqui existe por um defeito medido no v5 — a referência está na
// própria asserção, para que ninguém os "simplifique" sem saber o que está desligando.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';

import { carregarCatalogo, gatesAtivos, raizDoRepo } from '../../gates/lib/policy.mjs';

const RAIZ = raizDoRepo();

test('o catálogo carrega e todo gate traz os campos obrigatórios', async () => {
  const catalogo = await carregarCatalogo();
  assert.ok(catalogo.gates.length > 0, 'catálogo vazio');

  for (const g of catalogo.gates) {
    assert.match(g.id, /^[a-z][a-z0-9-]*$/, `id inválido: ${g.id}`);
    assert.ok(['ativo', 'candidato'].includes(g.status), `status inválido em ${g.id}`);
    assert.ok(g.titulo?.length > 0, `${g.id} sem título`);
    assert.ok(g.prova?.length > 0, `${g.id} sem prova`);
    assert.ok(g.porque?.length > 0, `${g.id} sem porquê`);
    assert.equal(typeof g.bloqueia, 'boolean', `${g.id} não declara se bloqueia`);
  }
});

test('todo gate cita ao menos um invariante da tabela', async () => {
  // Rastreabilidade: gate sem invariante é gate que ninguém sabe por que existe — e é o
  // primeiro a ser removido por alguém tentando "simplificar".
  const { gates } = await carregarCatalogo();
  for (const g of gates) {
    assert.ok(
      Array.isArray(g.invariantes) && g.invariantes.length > 0,
      `${g.id} não cita nenhum invariante`,
    );
    for (const inv of g.invariantes) {
      assert.match(inv, /^[MIPSU]-\d{2}$/, `invariante mal formado em ${g.id}: ${inv}`);
    }
  }
});

test('todo gate DECLARA sua posição sobre anti-silêncio', async () => {
  // Invariante M-01. A chave tem de estar presente mesmo quando o valor é null: é uma
  // forçante de desenho, não documentação. O v5 aplicou o anti-silêncio aos dialetos NOVOS
  // do Gate 2 e esqueceu o que já existia — o resultado foi "✅ 0 migrations com DOWN
  // pareado", o ✅ mais fácil de acreditar do conjunto, dado por não ter olhado nada.
  const { gates } = await carregarCatalogo();
  for (const g of gates) {
    assert.ok(
      Object.hasOwn(g, 'antiSilencio'),
      `${g.id} não declara antiSilencio (use null se de fato não se aplica)`,
    );
  }
});

test('gate ativo tem implementação; candidato NÃO tem', async () => {
  // Invariante I-06 ("lei sem executor não é lei") e M-12 (perda silenciosa). As duas
  // direções importam: gate ativo sem arquivo é lei sem executor; candidato COM arquivo é
  // um gate meio construído que ninguém sabe se roda.
  const { gates } = await carregarCatalogo();

  for (const g of gates) {
    const arquivo = join(RAIZ, 'gates', `${g.id}.mjs`);
    const existe = await access(arquivo).then(() => true, () => false);

    if (g.status === 'ativo') {
      assert.ok(existe, `gate ativo "${g.id}" não tem gates/${g.id}.mjs`);
    } else {
      assert.ok(!existe, `gate candidato "${g.id}" já tem implementação — promova ou remova`);
    }
  }
});

test('a implementação de gate ativo não está vazia nem truncada', async () => {
  // Invariante M-12 — perda silenciosa que não quebra nada.
  //
  // Um arquivo de gate com ZERO BYTES importa sem erro: só estoura quem pede um símbolo
  // nomeado dele. Se a suíte daquele gate fosse a única a importá-lo, um arquivo truncado
  // passaria por "gate ativo tem implementação" e o gate simplesmente deixaria de existir.
  //
  // Não é hipotético: aconteceu neste repositório. O harness de mutação escrevia no arquivo
  // real, um pipe fechado matou o processo no meio, e a restauração — que trunca antes de
  // escrever — deixou o gate em 0 bytes.
  const ativos = await gatesAtivos();
  for (const g of ativos) {
    const fonte = await readFile(join(RAIZ, 'gates', `${g.id}.mjs`), 'utf8');
    assert.ok(fonte.length > 0, `gates/${g.id}.mjs está VAZIO`);
    assert.match(fonte, /^export /m, `gates/${g.id}.mjs não exporta nada — truncado?`);
  }
});

test('os gates ativos são numerados de 1 a N, sem buraco nem repetição', async () => {
  const ativos = await gatesAtivos();
  const numeros = ativos.map((g) => g.numero).sort((a, b) => a - b);
  const esperado = Array.from({ length: ativos.length }, (_, i) => i + 1);
  assert.deepEqual(numeros, esperado, 'numeração dos gates ativos com buraco ou repetição');

  for (const g of ativos) {
    assert.equal(typeof g.numero, 'number', `gate ativo "${g.id}" sem número`);
  }
});

test('candidato não tem número reservado', async () => {
  // Número reservado para gate que não existe reaparece em documento gerado como se
  // existisse. Candidato entra na numeração no dia em que vira ativo.
  const { gates } = await carregarCatalogo();
  for (const g of gates.filter((x) => x.status === 'candidato')) {
    assert.equal(g.numero, null, `candidato "${g.id}" reservou o número ${g.numero}`);
  }
});

test('nenhum arquivo do repositório repete a contagem de gates', async () => {
  // Invariante M-06 — o caso mais importante deste arquivo.
  //
  // O v5 corrigiu a MESMA faixa de gates desatualizada duas vezes à mão (itens 176 e 232)
  // antes de entender que o conserto não é corrigir a ocorrência: é proibir a afirmação.
  // Quem precisa do número LÊ o catálogo.
  //
  // Isentos, e o motivo de cada um (mesma disciplina da allowlist de scanner de segredo do
  // v5: allowlist larga demais desliga a varredura sem quebrar teste nenhum):
  //   - policy/gates.json  → é a FONTE do número
  //   - este arquivo       → contém os padrões proibidos por definição (invariante I-09)
  const ISENTOS = new Set([
    'policy/gates.json',
    'test/cases/catalogo.test.mjs',
  ]);

  const PADROES = [
    /\b\d+\s+gates?\b/i,               // "8 gates"
    /\bgates?\s+\d+\s*[-–—]\s*\d+/i,   // "gates 1-8", "Gate 1–8"
    /\bos\s+\d+\s+gates\b/i,           // "os 8 gates" (número ANTES da palavra)
  ];

  const acusacoes = [];
  for await (const rel of arquivosDeTexto(RAIZ)) {
    if (ISENTOS.has(rel)) continue;
    const texto = await readFile(join(RAIZ, rel), 'utf8');
    texto.split('\n').forEach((linha, i) => {
      for (const p of PADROES) {
        if (p.test(linha)) acusacoes.push(`${rel}:${i + 1}: ${linha.trim()}`);
      }
    });
  }

  assert.deepEqual(
    acusacoes,
    [],
    `contagem de gates afirmada em prosa — leia o catálogo:\n${acusacoes.join('\n')}`,
  );
});

// ---------------------------------------------------------------------------

const IGNORAR = new Set(['.git', 'node_modules', 'test/fixtures']);

async function* arquivosDeTexto(raiz, prefixo = '') {
  const entradas = await readdir(join(raiz, prefixo), { withFileTypes: true });
  for (const e of entradas) {
    const rel = prefixo ? `${prefixo}/${e.name}` : e.name;
    if (IGNORAR.has(rel) || IGNORAR.has(e.name)) continue;
    if (e.isDirectory()) {
      yield* arquivosDeTexto(raiz, rel);
    } else if (/\.(mjs|json|md|yml|yaml)$/.test(e.name)) {
      yield rel;
    }
  }
}
