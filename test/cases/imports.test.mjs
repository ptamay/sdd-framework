// Casos do gate `imports` — o gate anti-alucinacao.
//
// Escritos ANTES da implementacao (M-08). O v5 errou este gate nos DOIS sentidos ao mesmo
// tempo (item 208), e as duas metades tem casos aqui:
//
//   falso ✅  a varredura era por lista de INCLUSAO (src, app, lib, components), entao um
//             import inventado em `pages/` — o Pages Router padrao do Next.js — era invisivel,
//             e o gate imprimia "todos os imports tem pacote declarado" sem ter aberto o arquivo.
//   falso ❌  a lista de builtins era escrita a mao e tinha 15 dos ~40, entao `net`, `assert`,
//             `worker_threads`, `tls` e `dns` eram ACUSADOS de alucinacao.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builtinModules } from 'node:module';

import { analisar, deveVarrer, pacoteBase, extrairImports } from '../../gates/imports.mjs';

const arq = (caminho, conteudo) => ({ caminho, conteudo });
const MANIFESTO = {
  dependencies: { lodash: '^4', react: '^18', '@scope/ui': '^1' },
  devDependencies: { vitest: '^1' },
};

const acusa = (arquivos, manifesto = MANIFESTO) =>
  analisar({ arquivos, manifesto }).achados.length > 0;

// --------------------------------------------------------------------- ACUSA

test('import de pacote nao declarado', () => {
  assert.ok(acusa([arq('src/a.ts', "import x from 'pacote-que-nao-existe';")]));
});

test('require de pacote nao declarado', () => {
  assert.ok(acusa([arq('src/a.js', "const x = require('pacote-que-nao-existe');")]));
});

test('import dinamico de pacote nao declarado', () => {
  assert.ok(acusa([arq('src/a.ts', "const m = await import('pacote-que-nao-existe');")]));
});

test('o achado nomeia arquivo, linha e especificador', () => {
  const { achados } = analisar({
    arquivos: [arq('src/a.ts', "import a from 'react';\nimport b from 'inventado';")],
    manifesto: MANIFESTO,
  });
  assert.equal(achados.length, 1);
  assert.equal(achados[0].arquivo, 'src/a.ts');
  assert.equal(achados[0].linha, 2);
  assert.equal(achados[0].especificador, 'inventado');
});

// --------------------------------------------------------------------- NAO ACUSA

test('builtins do Node NAO sao acusados — inclusive os que o v5 acusava (item 208)', () => {
  // A lista nao pode ser escrita a mao. Ela vem de `module.builtinModules`, que e a
  // implementacao contando a verdade sobre si — invariante M-06.
  for (const nome of ['fs', 'path', 'net', 'assert', 'worker_threads', 'tls', 'dns', 'crypto', 'url']) {
    assert.ok(builtinModules.includes(nome), `fixture desatualizada: ${nome} nao e builtin`);
    assert.ok(!acusa([arq('src/a.js', `import x from '${nome}';`)]), `acusou builtin: ${nome}`);
  }
});

test('prefixo node: nao e acusado', () => {
  assert.ok(!acusa([arq('src/a.mjs', "import { readFile } from 'node:fs/promises';")]));
  assert.ok(!acusa([arq('src/a.mjs', "import { test } from 'node:test';")]));
});

test('modulo virtual de runtime nao e acusado — `cloudflare:` esta para o workerd como `node:` para o Node', () => {
  // Achado em projeto real (Portifolio Igor, task 1.11): `import { env } from
  // "cloudflare:workers"` e o UNICO caminho ate os bindings do D1 desde o Astro v6, e o gate
  // acusava alucinacao onde havia API de plataforma. O `npm run build` do projeto provava o
  // contrario — o modulo resolve no workerd. Gate que reprova quem esta certo (M-02).
  for (const e of ['cloudflare:workers', 'cloudflare:sockets', 'cloudflare:email']) {
    assert.ok(!acusa([arq('src/a.ts', `import x from '${e}';`)]), `acusou virtual: ${e}`);
  }
});

test('o namespace virtual NAO abre a porta para esquema qualquer', () => {
  // A trava do caso acima, e a razao de a lista ser NOMEADA em vez de um `/^[a-z]+:/`: um
  // padrao de esquema qualquer engoliria URL remota e todo nome inventado com dois-pontos.
  // Cada namespace entra na lista com evidencia de que o runtime o serve, um de cada vez.
  for (const e of ['inventado:coisa', 'https://cdn.exemplo/x.js', 'npm:pacote-que-nao-existe']) {
    assert.ok(acusa([arq('src/a.ts', `import x from '${e}';`)]), `deixou passar: ${e}`);
  }
});

test('caminho relativo nao e pacote', () => {
  for (const e of ['./util', '../lib/x', './a.js']) {
    assert.ok(!acusa([arq('src/a.ts', `import x from '${e}';`)]), `acusou relativo: ${e}`);
  }
});

test('alias de projeto e subpath imports nao sao acusados', () => {
  // `@/`, `~/` e `#` sao resolvidos por tsconfig/bundler ou pelo campo "imports" do
  // package.json. Acusa-los reprovaria a convencao padrao do Next.js.
  for (const e of ['@/components/Botao', '~/lib/db', '#interno/log']) {
    assert.ok(!acusa([arq('src/a.tsx', `import x from '${e}';`)]), `acusou alias: ${e}`);
  }
});

test('subpath de pacote declarado nao e acusado', () => {
  assert.ok(!acusa([arq('src/a.ts', "import merge from 'lodash/merge';")]));
  assert.ok(!acusa([arq('src/a.ts', "import b from '@scope/ui/botao';")]));
});

test('devDependencies contam como declaradas', () => {
  // Arquivo de teste importa o runner, e ele mora em devDependencies. Acusar isso
  // reprovaria todo projeto com suite — gate que reprova quem esta certo (M-02).
  assert.ok(!acusa([arq('test/a.test.ts', "import { it } from 'vitest';")]));
});

test('import de tipo nao e acusado quando o pacote existe', () => {
  assert.ok(!acusa([arq('src/a.ts', "import type { FC } from 'react';")]));
});

// --------------------------------------------------------------------- varredura (item 208)

test('a varredura e por EXCLUSAO: todo diretorio de codigo entra', () => {
  // O v5 tinha lista de inclusao com quatro nomes. Estes seis eram cegos, e o primeiro e o
  // Pages Router padrao do Next.js.
  for (const c of [
    'pages/index.tsx', 'server/api.ts', 'api/rota.js', 'routes/user.ts',
    'middleware.ts', 'test/a.test.ts', 'index.js', 'packages/web/src/a.ts',
  ]) {
    assert.equal(deveVarrer(c), true, `nao varreria: ${c}`);
  }
});

test('import alucinado em pages/ e ACUSADO — o falso verde do item 208, ponta a ponta', () => {
  // O caso acima prova o predicado; este prova o GATE. A distincao importa: a assercao no
  // lugar errado vale menos que assercao nenhuma (M-09), e o falso ✅ do v5 era exatamente
  // um import inventado no Pages Router padrao do Next.js passando sem que o arquivo fosse
  // aberto. Descoberto por mutacao: derrubar a varredura para lista de inclusao NAO fazia
  // nenhum caso de `analisar` cair.
  const { estado, achados } = analisar({
    arquivos: [arq('pages/index.tsx', "import x from 'pacote-alucinado';")],
    manifesto: MANIFESTO,
  });
  assert.equal(estado, 'falha');
  assert.equal(achados[0].arquivo, 'pages/index.tsx');
});

test('o que NAO deve ser varrido', () => {
  for (const c of [
    'node_modules/react/index.js', 'dist/bundle.js', '.next/static/x.js',
    'coverage/lcov-report/a.js', 'build/out.js', 'README.md',
  ]) {
    assert.equal(deveVarrer(c), false, `varreria indevidamente: ${c}`);
  }
});

// --------------------------------------------------------------------- anti-silencio

test('manifesto ausente NUNCA vira "ok" com zero achados (itens 186 e 211)', () => {
  // O v5 deu falso verde aqui duas vezes, nos dois ecossistemas, pelo mesmo motivo: o
  // status de saida do checker era capturado junto com o texto, entao um crash devolvia
  // string vazia — indistinguivel de "nada faltando". O gate afirmava "todos os imports
  // resolvem" sem ter verificado um unico.
  const r = analisar({ arquivos: [arq('src/a.ts', "import x from 'seja-o-que-for';")], manifesto: null });
  assert.notEqual(r.estado, 'ok');
  assert.ok(r.aviso?.length > 0, 'nao explicou por que nao conferiu');
});

test('projeto sem arquivo varrivel pula com aviso, nao aprova', () => {
  const r = analisar({ arquivos: [arq('README.md', '# oi')], manifesto: MANIFESTO });
  assert.equal(r.estado, 'pulado');
  assert.ok(r.aviso?.length > 0);
});

test('ecossistema nao coberto pula com aviso explicito', () => {
  // Lacuna DECLARADA, nao omitida (M-17). Um projeto Python hoje nao e conferido por este
  // gate — e ele tem de dizer isso, nao passar em silencio.
  const r = analisar({ arquivos: [arq('app/main.py', 'import requests')], manifesto: null });
  assert.equal(r.estado, 'pulado');
  assert.match(r.aviso, /python|nao coberto|não coberto/i);
});

// --------------------------------------------------------------------- auxiliares

test('pacoteBase separa escopo, subpath e nome simples', () => {
  assert.equal(pacoteBase('lodash'), 'lodash');
  assert.equal(pacoteBase('lodash/merge'), 'lodash');
  assert.equal(pacoteBase('@scope/ui'), '@scope/ui');
  assert.equal(pacoteBase('@scope/ui/botao'), '@scope/ui');
});

test('extrairImports pega as quatro formas e ignora o que esta em comentario', () => {
  const texto = [
    "import a from 'um';",
    "const b = require('dois');",
    "await import('tres');",
    "export { c } from 'quatro';",
    "// import z from 'ignorado';",
  ].join('\n');
  const achados = extrairImports('src/a.ts', texto).map((i) => i.especificador);
  assert.deepEqual(achados, ['um', 'dois', 'tres', 'quatro']);
});
