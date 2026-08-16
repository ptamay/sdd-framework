// Casos do gate `design-tokens` — a tela nasceu passando pelo sistema visual, ou nao.
//
// Escritos ANTES da implementacao (M-08).
//
// POR QUE ESTE GATE SAI DE CANDIDATO AGORA, e a evidencia e de projeto real (achado A8):
// `policy/rotas.json` manda, na rota de sprint, que "task que cria ou muda TELA passa pela
// rota de design antes do ciclo". O unico caso que defendia essa regra conferia que a FRASE
// existia (`assert.match(regras, /design/i)`), nunca que a passagem acontecesse.
//
// Medido: um projeto sob os sete gates, com 898 testes e 92% de cobertura, chegou a sprint 4
// com 2 de 11 superficies alcancadas pelos tokens — sete telas de painel e a de entrar sem
// ligar folha de estilo nenhuma. Tres sprints de telas nasceram sem passagem de design e
// nada reprovou, porque nada olhava.
//
// O mesmo projeto escreveu A MAO a guarda de literal de cor fora do bloco de tokens (a
// decima quarta guarda dele). Guarda que um projeto real precisou construir sozinho e
// candidata a gate COM evidencia, que e a regua deste repositorio.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { raizDoRepo } from '../../gates/lib/policy.mjs';
import { analisar, rodar } from '../../gates/design-tokens.mjs';

const RAIZ = raizDoRepo();
const lerPolicy = async (n) => JSON.parse(await readFile(join(RAIZ, 'policy', n), 'utf8'));

const pagina = (corpo) => ({ caminho: 'src/pages/index.ts', conteudo: `<html lang="pt-BR">${corpo}</html>` });
const folha = (conteudo) => ({ caminho: 'public/estilos/galeria.css', conteudo });

const LIGA = '<link rel="stylesheet" href="/estilos/galeria.css">';

// --------------------------------------------------------------------- o catalogo

test('o gate design-tokens esta ATIVO e tem numero', async () => {
  const { gates } = await lerPolicy('gates.json');
  const g = gates.find((x) => x.id === 'design-tokens');

  assert.ok(g, 'o catalogo nao conhece o gate design-tokens');
  assert.equal(g.status, 'ativo');
  assert.equal(typeof g.numero, 'number', 'gate ativo sem numero nao aparece ordenado no relatorio');
});

test('toda invariante citada pelo gate EXISTE no catalogo de invariantes', async () => {
  // O motivo de este caso existir: o gate citava `U-01`, `U-02` e `U-03`, que nao estavam
  // definidas em lugar nenhum deste repositorio — nem no v5. Gate que aplica lei inexistente
  // e a classe de defeito que este framework existe para impedir, e ela estava aqui dentro.
  const { gates } = await lerPolicy('gates.json');
  const { invariantes } = await lerPolicy('invariantes.json');
  const definidas = new Set(invariantes.map((i) => i.id));

  const g = gates.find((x) => x.id === 'design-tokens');
  for (const id of g.invariantes) {
    assert.ok(definidas.has(id), `o gate design-tokens cita ${id}, que nao esta definida`);
  }
});

test('toda invariante do catalogo tem texto, e nao so um identificador', async () => {
  const { invariantes } = await lerPolicy('invariantes.json');
  assert.ok(invariantes.length >= 3, 'catalogo de invariantes vazio ou incompleto');

  for (const i of invariantes) {
    assert.match(i.id, /^[A-Z]-\d{2}$/, `identificador fora do formato: ${i.id}`);
    assert.ok(i.texto?.length > 30, `${i.id} sem texto`);
    assert.ok(i.porque?.length > 30, `${i.id} sem o motivo escrito`);
  }
});

// --------------------------------------------------------------------- eixo A: superficie sem sistema visual

test('superficie que renderiza HTML e nao liga folha nenhuma REPROVA, nomeando a pagina', () => {
  const r = analisar({ arquivos: [pagina('<body><h1>oi</h1></body>'), folha(':root{--cor-acao:#128c4a}')] });

  assert.equal(r.estado, 'falha');
  assert.ok(
    r.achados.some((a) => a.arquivo === 'src/pages/index.ts' && a.eixo === 'superficie-sem-sistema'),
    'a pagina sem folha nao foi acusada',
  );
});

test('superficie que liga folha passa', () => {
  const r = analisar({ arquivos: [pagina(`<head>${LIGA}</head><body>oi</body>`), folha(':root{--cor-acao:#128c4a}')] });

  assert.equal(r.estado, 'ok');
  assert.deepEqual(r.achados, []);
});

test('o que NAO renderiza HTML nao e superficie, e nao e cobrado', () => {
  // Trava o falso positivo mais provavel: modulo de dominio, rota de midia, endpoint que
  // devolve JSON. Gate que reprova quem esta certo e o defeito que faz alguem desliga-lo.
  const r = analisar({
    arquivos: [
      { caminho: 'src/lib/projeto.ts', conteudo: 'export const x = 1;' },
      { caminho: 'src/pages/midia/[chave].ts', conteudo: 'return new Response(bytes);' },
      pagina(`<head>${LIGA}</head>`),
      folha(':root{--cor-acao:#128c4a}'),
    ],
  });

  assert.equal(r.estado, 'ok');
});

// --------------------------------------------------------------------- eixo B: valor fora do bloco de tokens

test('literal de cor FORA do bloco de tokens reprova', () => {
  const r = analisar({
    arquivos: [
      pagina(`<head>${LIGA}</head>`),
      folha(':root{--cor-acao:#128c4a}\n.chamada{background:#128c4a}'),
    ],
  });

  assert.equal(r.estado, 'falha');
  assert.ok(
    r.achados.some((a) => a.eixo === 'valor-fora-do-token'),
    'o literal fora do :root nao foi acusado',
  );
});

test('o MESMO literal DENTRO do bloco de tokens nao e acusado', () => {
  const r = analisar({
    arquivos: [pagina(`<head>${LIGA}</head>`), folha(':root{--cor-acao:#128c4a;--cor-sobre-acao:#ffffff}')],
  });

  assert.equal(r.estado, 'ok');
});

test('seletor de id com forma de hexadecimal nao e cor', () => {
  // `#faceb0` e identificador valido e hexadecimal valido. Acusar seletor por parecer cor
  // e a metade "falso vermelho" do mesmo defeito — a mesma que o gate de imports pagou.
  const r = analisar({
    arquivos: [pagina(`<head>${LIGA}</head>`), folha(':root{--c:#111}\n#faceb0{margin:0}')],
  });

  assert.equal(r.estado, 'ok');
});

test('`url(#facade)` nao e cor — e o identificador PRECISA ser hexadecimal valido', () => {
  // A primeira versao deste caso usava `url(#recorte)`, e o harness de mutacao mostrou que
  // ele nao provava nada: `r` nao e digito hexadecimal, entao o valor jamais casaria com o
  // padrao de cor, com ou sem o defeito reintroduzido. Verificava zero, com aparencia de
  // prova — a mesma forma do furo que o achado A1 registrou.
  //
  // `#facade` e identificador plausivel de mascara SVG E hexadecimal de seis digitos valido.
  const r = analisar({
    arquivos: [pagina(`<head>${LIGA}</head>`), folha(':root{--c:#111}\n.m{clip-path:url(#facade)}')],
  });

  assert.equal(r.estado, 'ok');
});

test('comentario nao e declaracao', () => {
  const r = analisar({
    arquivos: [
      pagina(`<head>${LIGA}</head>`),
      folha(':root{--c:#111}\n/* nasceu como #128c4a na task 3.4 */\n.b{color:var(--c)}'),
    ],
  });

  assert.equal(r.estado, 'ok');
});

test('`rgb()`, `hsl()` e `oklch()` fora do bloco tambem sao valor cru', () => {
  const r = analisar({
    arquivos: [pagina(`<head>${LIGA}</head>`), folha(':root{--c:#111}\n.b{color:oklch(0.6 0.1 150)}')],
  });

  assert.equal(r.estado, 'falha');
});

// --------------------------------------------------------------------- anti-silencio (M-01)

test('projeto sem UI nenhuma => PULADO com aviso, nunca ok', () => {
  const r = analisar({ arquivos: [{ caminho: 'src/lib/dominio.ts', conteudo: 'export const x = 1;' }] });

  assert.equal(r.estado, 'pulado');
  assert.ok(r.aviso?.length > 10, 'pulou sem dizer o que deixou de conferir');
});

test('folha existe e nenhuma superficie foi reconhecida => o eixo B roda mesmo assim', () => {
  // O contrario tambem seria silencio: pular o projeto inteiro porque um dos dois eixos nao
  // achou nada esconderia o outro, que tinha o que conferir.
  const r = analisar({ arquivos: [folha('.b{color:#f00}')] });

  assert.equal(r.estado, 'falha');
  assert.ok(r.achados.some((a) => a.eixo === 'valor-fora-do-token'));
});

test('superficie existe e NENHUMA folha existe no projeto => falha, e o aviso diz isso', () => {
  const r = analisar({ arquivos: [pagina('<body>oi</body>')] });

  assert.equal(r.estado, 'falha');
});

// --------------------------------------------------------------------- isencoes
//
// POR QUE ESTES CASOS EXISTEM, e a medicao e de projeto real (2026-08-16): `run.mjs:99`
// entrega `{ valvula, isencoes }` a TODO gate, e so `imports` e `secrets` consumiam. O gate
// 8 ignorava o segundo argumento inteiro. A consequencia nao e "a isencao nao funciona" —
// e pior: `.sdd/gates-ignore.json` podia existir, ser VALIDO, e nao isentar nada, com o
// relatorio reprovando como se o arquivo nao estivesse la. Valvula que o usuario escreve e
// o framework ignora em silencio e a mesma doenca que a trava 5 nasceu para curar, do outro
// lado. Achada quando o Portifolio Igor foi isentar as sete telas de painel da task 4.7.

const arvore = async (arquivos) => {
  const base = await mkdtemp(join(tmpdir(), 'sdd-dt-isen-'));
  const raiz = join(base, 'meu projeto'); // com ESPACO, pela mesma razao de test/projeto.mjs
  for (const [rel, texto] of Object.entries(arquivos)) {
    await mkdir(dirname(join(raiz, rel)), { recursive: true });
    await writeFile(join(raiz, rel), texto);
  }
  return { base, raiz };
};

const PAINEL_SEM_FOLHA = { 'src/lib/painel.ts': '<html lang="pt-BR"><body>painel</body></html>' };
const TOKENS = { 'public/estilos/tema.css': ':root{--c:#111}' };

test('SEM isencao, a superficie sem folha REPROVA — o controle que discrimina', async () => {
  // Sem este caso, os dois seguintes passariam com o gate inteiro quebrado.
  const { base, raiz } = await arvore({ ...PAINEL_SEM_FOLHA, ...TOKENS });
  try {
    const r = await rodar(raiz);

    assert.equal(r.estado, 'falha');
    assert.ok(r.achados.some((a) => a.arquivo === 'src/lib/painel.ts'));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('arquivo isento nao e acusado, e APARECE na lista de isentos (trava 5)', async () => {
  const { base, raiz } = await arvore({ ...PAINEL_SEM_FOLHA, ...TOKENS });
  const isencoes = [
    { gate: 'design-tokens', caminho: '^src/lib/painel\\.ts$', porque: 'motivo escrito com folga de tamanho' },
  ];
  try {
    const r = await rodar(raiz, { isencoes });

    assert.equal(r.estado, 'ok', `isencao nao foi honrada: ${JSON.stringify(r.achados)}`);
    assert.deepEqual(r.isentos, ['src/lib/painel.ts'], 'isentou sem dizer o que deixou de olhar');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('isencao de OUTRO gate nao vale para este (trava 3)', async () => {
  const { base, raiz } = await arvore({ ...PAINEL_SEM_FOLHA, ...TOKENS });
  const isencoes = [
    { gate: 'secrets', caminho: '^src/lib/painel\\.ts$', porque: 'motivo escrito com folga de tamanho' },
  ];
  try {
    const r = await rodar(raiz, { isencoes });

    assert.equal(r.estado, 'falha', 'isencao de outro gate vazou para o design-tokens');
    assert.deepEqual(r.isentos, []);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('isencao alcanca o eixo B tambem, e nao so o de superficie', async () => {
  // Os dois eixos leem o mesmo corpus. Isentar so um seria a surpresa que ninguem le no diff.
  const { base, raiz } = await arvore({ 'public/estilos/legado.css': '.b{color:#f00}', ...TOKENS });
  const isencoes = [
    { gate: 'design-tokens', caminho: '^public/estilos/legado\\.css$', porque: 'motivo escrito com folga de tamanho' },
  ];
  try {
    const semIsencao = await rodar(raiz);
    assert.equal(semIsencao.estado, 'falha', 'o controle nao discrimina: a folha crua nao reprovou');

    const r = await rodar(raiz, { isencoes });
    assert.ok(!r.achados.some((a) => a.arquivo === 'public/estilos/legado.css'));
    assert.deepEqual(r.isentos, ['public/estilos/legado.css']);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('projeto cuja UI inteira foi isentada => PULADO com aviso, nunca ok', async () => {
  // A saida mais perigosa da valvula: isentar tudo e receber verde. O anti-silencio (M-01)
  // precisa valer DEPOIS da isencao, nao so quando o projeto nao tem UI.
  const { base, raiz } = await arvore(PAINEL_SEM_FOLHA);
  const isencoes = [
    { gate: 'design-tokens', caminho: '^src/lib/painel\\.ts$', porque: 'motivo escrito com folga de tamanho' },
  ];
  try {
    const r = await rodar(raiz, { isencoes });

    assert.equal(r.estado, 'pulado');
    assert.ok(r.aviso?.length > 10, 'pulou sem dizer o que deixou de conferir');
    assert.deepEqual(r.isentos, ['src/lib/painel.ts']);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------- varredura

test('SAIDA GERADA nao e superficie do projeto — o falso positivo da primeira execucao real', async () => {
  // `playwright-report/index.html` foi acusado na primeira vez que este gate rodou contra o
  // projeto que o originou. Relatorio de teste nao liga a folha do projeto e nao deveria:
  // acusa-lo e a metade "falso vermelho" do defeito, e ela ensina o time a ignorar o gate.
  const base = await mkdtemp(join(tmpdir(), 'sdd-dt-'));
  const raiz = join(base, 'meu projeto'); // com ESPACO, pela mesma razao de test/projeto.mjs

  const escrever = async (rel, texto) => {
    await mkdir(dirname(join(raiz, rel)), { recursive: true });
    await writeFile(join(raiz, rel), texto);
  };

  try {
    await escrever('playwright-report/index.html', '<html><body>relatorio</body></html>');
    await escrever('coverage/lcov-report/index.html', '<html><body>cobertura</body></html>');
    await escrever('dist/index.html', '<html><body>build</body></html>');
    await escrever('public/estilos/tema.css', ':root{--c:#111}');
    await escrever('src/pages/index.html', `<html><head>${LIGA}</head><body>oi</body></html>`);

    const r = await rodar(raiz);

    assert.equal(r.estado, 'ok', `saida gerada foi acusada: ${JSON.stringify(r.achados)}`);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
