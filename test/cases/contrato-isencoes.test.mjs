// Contrato de isencoes — vale para a LISTA INTEIRA de gates, nao para um gate por vez.
//
// POR QUE ESTE ARQUIVO EXISTE (achado A10, medido em 2026-08-16): `run.mjs` entrega
// `{ valvula, isencoes }` a TODO gate, e so `imports` e `secrets` consumiam. `design-tokens`
// ignorava o argumento inteiro — entao `.sdd/gates-ignore.json` podia existir, PASSAR NAS
// CINCO TRAVAS de validacao, e nao isentar nada, com o relatorio reprovando como se o arquivo
// nao estivesse la. O usuario le o proprio arquivo, le o vermelho, e nao tem como saber qual
// dos dois esta mentindo.
//
// Consertar o gate 8 sozinho teria deixado a mesma armadilha em `migrations` e `env-bypass`,
// que tambem varrem a arvore. Por isso o conserto e de CONTRATO: cada gate DECLARA se honra
// isencao, e este arquivo mede as duas metades da declaracao.
//
//   honra: true    ha caso que prova, com fixture em disco e controle que discrimina.
//                  Declarar sem provar reprova aqui.
//
//   honra: false   a validacao RECUSA isencao que nomeie o gate, com mensagem acionavel.
//                  E a metade que importa mais: o usuario que escrever a isencao inutil
//                  recebe um erro em vez do silencio que produziu A10.
//
// A declaracao no catalogo NAO e a prova — e o indice dela. Um caso que so conferisse que o
// campo existe seria exatamente o defeito que o achado A8 nomeou.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { raizDoRepo } from '../../gates/lib/policy.mjs';
import { validarIsencoes } from '../../gates/lib/isencoes.mjs';

const RAIZ = raizDoRepo();

const catalogo = async () => {
  const { gates } = JSON.parse(await readFile(join(RAIZ, 'policy', 'gates.json'), 'utf8'));
  return gates;
};
const ativos = async () => (await catalogo()).filter((g) => g.status === 'ativo');

const MOTIVO = 'motivo escrito com folga sobre o minimo';

/** Projeto descartavel, com ESPACO no caminho pela mesma razao de test/projeto.mjs. */
async function arvore(arquivos) {
  const base = await mkdtemp(join(tmpdir(), 'sdd-contrato-'));
  const raiz = join(base, 'meu projeto');
  for (const [rel, texto] of Object.entries(arquivos)) {
    await mkdir(dirname(join(raiz, rel)), { recursive: true });
    await writeFile(join(raiz, rel), texto);
  }
  return { base, raiz };
}

// --------------------------------------------------------------------- as fixtures
//
// Uma por gate que declara honrar. Cada uma tem de ser um projeto que o gate ACUSA — o
// controle abaixo mede isso antes de aplicar a isencao, e um fixture que ja passa verde
// provaria zero.
//
// `alvo` nao pode ser CANARIO: `.env.production` esta na lista protegida, e por isso o
// fixture de `env-bypass` usa `config/producao.json`, que e perfil protegido pela mesma
// regra e nao e canario.

const PACOTE = JSON.stringify({ name: 'alvo', version: '1.0.0', dependencies: {} });

// Os venenos sao MONTADOS em pedacos, e isso nao e estilo.
//
// Escritos inteiros, os gates 1 e 3 acusariam ESTE arquivo — que e o que ja acontece com
// `test/cases/secrets.test.mjs` e `test/cases/imports.test.mjs`, e foi por isso que os dois
// entraram em `.sdd/gates-ignore.json`. Naqueles dois a isencao se justifica: eles testam a
// DETECCAO, e uma credencial que nao case o padrao real nao prova nada.
//
// Aqui nao. Este arquivo nao mede se o gate reconhece a forma de uma chave da AWS — ele so
// precisa que o gate acuse ALGUMA coisa para depois isentar. Entao montar em pedacos entrega
// o mesmo fixture sem gastar uma isencao, e isencao gasta e permanente: com ela, um segredo
// de verdade colado neste arquivo deixaria de ser pego. A lista do que os gates deixam de
// olhar so cresce quando nao ha outro caminho, e aqui ha.
const juntar = (...partes) => partes.join('');

const FIXTURES = {
  secrets: {
    alvo: 'src/configuracao.ts',
    arquivos: {
      'src/configuracao.ts': juntar('export const chave = "AKIA', 'IOSFODNN7EXAMPLE";\n'),
      'package.json': PACOTE,
    },
  },

  imports: {
    alvo: 'src/usa-pacote.ts',
    arquivos: {
      'src/usa-pacote.ts': juntar('im', 'port alguma from "biblioteca-que-ninguem-declarou";\nexport default alguma;\n'),
      'package.json': PACOTE,
    },
  },

  'design-tokens': {
    alvo: 'src/lib/painel.ts',
    arquivos: {
      'src/lib/painel.ts': '<html lang="pt-BR"><body>painel</body></html>',
      'public/estilos/tema.css': ':root{--c:#111}',
    },
  },

  migrations: {
    alvo: 'drizzle/0001_inicial.sql',
    arquivos: {
      'drizzle.config.ts': 'export default {};\n',
      'drizzle/0001_inicial.sql': 'CREATE TABLE projeto (id INTEGER PRIMARY KEY);\n',
      'package.json': PACOTE,
    },
  },

  'env-bypass': {
    alvo: 'config/producao.json',
    arquivos: {
      'config/producao.json': '{\n  "DISABLE_RATE_LIMIT": true\n}\n',
      'package.json': PACOTE,
    },
  },
};

const escapar = (caminho) => `^${caminho.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;

// --------------------------------------------------------------------- a declaracao

test('todo gate ATIVO DECLARA se honra isencao, e diz por que', async () => {
  // ATIVO, e nao "todo gate do catalogo", de proposito. Os candidatos nao tem implementacao:
  // declarar a semantica de isencao deles agora seria inventar o comportamento de um gate que
  // ninguem escreveu — a mesma fabricacao que `policy/invariantes.json` nasceu para consertar
  // (achado A9). O candidato promovido a ativo cai NESTE caso, que e quando a pergunta tem
  // resposta.
  for (const g of await ativos()) {
    assert.ok(g.isencoes, `o gate ${g.id} nao declara nada sobre isencoes`);
    assert.equal(typeof g.isencoes.honra, 'boolean', `${g.id}: "honra" precisa ser booleano`);
    assert.ok(
      g.isencoes.porque?.length > 30,
      `${g.id}: declaracao sem motivo escrito — e o motivo que impede a declaracao errada de sobreviver a revisao`,
    );
  }
});

test('todo gate ATIVO que declara honrar tem fixture que o prova', async () => {
  // Sem este caso, um gate novo poderia declarar `honra: true` e nunca ser medido — que e
  // a forma exata do defeito que este arquivo conserta, um nivel acima.
  for (const g of await ativos()) {
    if (!g.isencoes.honra) continue;
    assert.ok(
      FIXTURES[g.id],
      `o gate ${g.id} declara honrar isencao e nao ha fixture que prove — declaracao sem prova e decoracao`,
    );
  }
});

// --------------------------------------------------------------------- honra: true, medido

for (const [id, fixture] of Object.entries(FIXTURES)) {
  test(`${id}: SEM isencao, acusa o alvo — o controle que discrimina`, async () => {
    const { base, raiz } = await arvore(fixture.arquivos);
    try {
      const modulo = await import(`../../gates/${id}.mjs`);
      const r = await modulo.rodar(raiz);

      assert.ok(
        (r.achados ?? []).some((a) => a.arquivo === fixture.alvo),
        `o fixture de ${id} nao e acusado — os dois casos seguintes provariam nada. Saida: ${JSON.stringify(r)}`,
      );
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  test(`${id}: COM isencao, o alvo sai do corpus e APARECE em isentos`, async () => {
    const { base, raiz } = await arvore(fixture.arquivos);
    const isencoes = [{ gate: id, caminho: escapar(fixture.alvo), porque: MOTIVO }];
    try {
      const modulo = await import(`../../gates/${id}.mjs`);
      const r = await modulo.rodar(raiz, { isencoes });

      assert.ok(
        !(r.achados ?? []).some((a) => a.arquivo === fixture.alvo),
        `${id} nao honrou a isencao: ${JSON.stringify(r.achados)}`,
      );
      // Trava 5. Isencao que nao aparece na saida e indistinguivel de gate desligado.
      assert.deepEqual(r.isentos, [fixture.alvo], `${id} isentou sem dizer o que deixou de olhar`);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  test(`${id}: isencao de OUTRO gate nao vaza para este`, async () => {
    const { base, raiz } = await arvore(fixture.arquivos);
    const outro = id === 'secrets' ? 'imports' : 'secrets';
    const isencoes = [{ gate: outro, caminho: escapar(fixture.alvo), porque: MOTIVO }];
    try {
      const modulo = await import(`../../gates/${id}.mjs`);
      const r = await modulo.rodar(raiz, { isencoes });

      assert.ok(
        (r.achados ?? []).some((a) => a.arquivo === fixture.alvo),
        `isencao de "${outro}" vazou para "${id}"`,
      );
      assert.deepEqual(r.isentos, []);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
}

// --------------------------------------------------------------------- honra: false, recusado

test('isencao que nomeia gate que NAO honra e RECUSADA, com o gate no texto', async () => {
  // A metade que fecha A10 de verdade. Sem ela, o usuario escreve a isencao, ela passa nas
  // cinco travas, o gate a ignora, e o relatorio reprova sem explicar — que foi o que
  // aconteceu com o gate 8 e ninguem viu.
  const gates = await ativos();
  const naoHonram = gates.filter((g) => !g.isencoes.honra);

  assert.ok(naoHonram.length > 0, 'nenhum gate declara nao-honrar — o caso perdeu o objeto');

  for (const g of naoHonram) {
    const problemas = validarIsencoes(
      [{ gate: g.id, caminho: '^src/qualquer\\.ts$', porque: MOTIVO }],
      gates,
    );

    assert.ok(problemas.length > 0, `isencao para "${g.id}" foi aceita, e o gate nao a honra`);
    assert.ok(
      problemas.some((p) => p.includes(g.id)),
      `a recusa nao nomeia o gate "${g.id}": ${problemas.join(' | ')}`,
    );
  }
});

test('isencao para gate que HONRA continua sendo aceita', async () => {
  // O outro lado da trava 6. Uma recusa que recusasse tudo passaria no caso acima.
  const gates = await ativos();
  const honram = gates.filter((g) => g.isencoes.honra);

  for (const g of honram) {
    const problemas = validarIsencoes(
      [{ gate: g.id, caminho: '^src/qualquer\\.ts$', porque: MOTIVO }],
      gates,
    );
    assert.deepEqual(problemas, [], `isencao legitima para "${g.id}" foi recusada`);
  }
});

test('a lista de gates conhecidos ainda aceita a forma antiga, de identificadores', () => {
  // `validarIsencoes` passou a receber os OBJETOS do catalogo, para enxergar `honra`. A
  // forma antiga sobrevive: sem a declaracao, nada e recusado por trava 6 — o que preserva
  // quem chamava com uma lista de strings sem virar recusa surpresa.
  const problemas = validarIsencoes(
    [{ gate: 'secrets', caminho: '^src/x\\.ts$', porque: MOTIVO }],
    ['secrets', 'imports'],
  );

  assert.deepEqual(problemas, []);
});
