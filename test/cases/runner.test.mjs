// Casos do runner.
//
// Escritos ANTES da implementacao (M-08).
//
// O runner e onde o anti-silencio pode ser reintroduzido NO NIVEL DE CIMA, e esse e o nivel
// onde ninguem procura. Sete gates podem estar corretos individualmente e o relatorio somar
// tudo em "✅ tudo certo" — reproduzindo, na agregacao, exatamente o defeito que cada gate
// foi desenhado para nao cometer.
//
// Tres propriedades sustentam isso:
//   - `erro` e `pulado` NAO colapsam em "nao-falhou"
//   - uma execucao em que NADA foi verificado nao pode ter a mesma cara de uma aprovacao
//   - todo gate ativo aparece no relatorio, inclusive o que estourou (M-12)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { agregar, codigoDeSaida, executarTodos, ehEntradaDireta, validarResultado } from '../../gates/run.mjs';
import { pathToFileURL } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RAIZ_VAZIA = await mkdtemp(join(tmpdir(), 'sdd-vazio-'));
import { gatesAtivos } from '../../gates/lib/policy.mjs';

const res = (id, estado, extra = {}) => ({ id, estado, achados: [], aviso: null, ...extra });

/** Carregador falso: devolve um modulo com `rodar` que responde o estado pedido. */
function carregadorFalso(porId) {
  return async (id) => {
    const resposta = porId[id];
    if (typeof resposta === 'function') return { rodar: resposta };
    if (resposta === undefined) throw new Error(`sem modulo para ${id}`);
    return { rodar: async () => ({ estado: resposta, achados: [], aviso: 'motivo qualquer' }) };
  };
}

// --------------------------------------------------------------------- agregacao

test('tudo ok => aprovado', () => {
  const r = agregar([res('a', 'ok'), res('b', 'ok')]);
  assert.equal(r.veredito, 'aprovado');
  assert.equal(r.verificados, 2);
});

test('qualquer falha => reprovado', () => {
  assert.equal(agregar([res('a', 'ok'), res('b', 'falha')]).veredito, 'reprovado');
});

test('`erro` NAO colapsa em nao-falha — tambem reprova', () => {
  // Um gate que nao conseguiu rodar nao provou nada. Trata-lo como "nao falhou" e o falso
  // verde da familia dos itens 186/211, agora no nivel da agregacao.
  const r = agregar([res('a', 'ok'), res('b', 'erro')]);
  assert.equal(r.veredito, 'reprovado');
});

test('tudo pulado NAO e aprovacao', () => {
  // Um projeto novo e vazio pula tudo legitimamente, e reprovar seria reprovar quem esta
  // certo (M-02). Mas o relatorio nao pode ter a mesma cara de uma aprovacao: nada foi
  // provado sobre este projeto, e isso tem de estar dito.
  const r = agregar([res('a', 'pulado'), res('b', 'pulado')]);
  assert.equal(r.veredito, 'nada-verificado');
  assert.notEqual(r.veredito, 'aprovado');
  assert.equal(r.verificados, 0);
  assert.equal(r.pulados, 2);
});

test('ok com pulados => aprovado, mas a contagem de pulados aparece', () => {
  const r = agregar([res('a', 'ok'), res('b', 'pulado'), res('c', 'pulado')]);
  assert.equal(r.veredito, 'aprovado');
  assert.equal(r.verificados, 1);
  assert.equal(r.pulados, 2);
});

test('o codigo de saida separa reprovado de tudo o mais', () => {
  assert.equal(codigoDeSaida('aprovado'), 0);
  assert.equal(codigoDeSaida('nada-verificado'), 0);
  assert.equal(codigoDeSaida('reprovado'), 1);
});

// --------------------------------------------------------------------- ponto de entrada

test('a deteccao de entrada direta funciona com espaco no caminho e em Windows', () => {
  // Achado na PRIMEIRA execucao real deste runner, e o pior sintoma possivel: saida vazia
  // com codigo 0 — que le exatamente como "tudo certo".
  //
  // A comparacao ingenua e `import.meta.url === 'file://' + argv[1]`. Ela nunca casa: a URL
  // do modulo tem TRES barras e percent-encoding; o argv traz o caminho nativo, com espacos
  // literais e, em Windows, barras invertidas. O runner inteiro virava no-op silencioso.
  for (const caminho of [
    'E:\\@Projetos\\@ESCOPO DE PROJETOS\\v6\\gates\\run.mjs',
    '/home/dev/meus projetos/v6/gates/run.mjs',
    '/home/dev/v6/gates/run.mjs',
  ]) {
    const url = pathToFileURL(caminho).href;
    assert.equal(ehEntradaDireta(url, caminho), true, `nao detectou entrada direta: ${caminho}`);
  }
});

test('modulo importado por outro NAO e entrada direta', () => {
  const url = pathToFileURL('/app/gates/run.mjs').href;
  assert.equal(ehEntradaDireta(url, '/app/test/x.mjs'), false);
  assert.equal(ehEntradaDireta(url, undefined), false);
});

// --------------------------------------------------------------------- execucao

test('roda exatamente os gates ATIVOS do catalogo, e nenhum candidato', async () => {
  // O runner nao tem lista propria: a lista e o catalogo (I-01). Foi assim que o v5
  // conseguiu ficar com quatro versoes divergentes da mesma faixa de gates.
  const ativos = await gatesAtivos();
  const chamados = [];
  const carregar = async (id) => ({
    rodar: async () => {
      chamados.push(id);
      return { estado: 'ok', achados: [], aviso: null };
    },
  });

  const r = await executarTodos({ raiz: '/projeto', carregar });

  assert.equal(chamados.length, ativos.length);
  assert.deepEqual(chamados.sort(), ativos.map((g) => g.id).sort());
  assert.equal(r.resultados.length, ativos.length);
});

test('todo gate ativo aparece no relatorio — inclusive o que ESTOUROU', async () => {
  // Invariante M-12: perda silenciosa. Um gate que lanca excecao e some do relatorio deixa
  // a saida com menos linhas e ninguem conta. O v5 pagou isso com um caso do autoteste que
  // se auto-desligava em worktree, sem uma linha de saida.
  const ativos = await gatesAtivos();
  const alvo = ativos[0].id;

  const carregar = async (id) => ({
    rodar: async () => {
      if (id === alvo) throw new Error('estourou de proposito');
      return { estado: 'ok', achados: [], aviso: null };
    },
  });

  const r = await executarTodos({ raiz: '/projeto', carregar });

  assert.equal(r.resultados.length, ativos.length, 'gate sumiu do relatorio');
  const doAlvo = r.resultados.find((x) => x.id === alvo);
  assert.equal(doAlvo.estado, 'erro');
  assert.match(doAlvo.aviso, /estourou de proposito/);
  assert.equal(r.veredito, 'reprovado');
});

test('gate ativo cujo modulo nao carrega vira erro, nunca omissao', async () => {
  const ativos = await gatesAtivos();
  const carregar = carregadorFalso({}); // nenhum modulo existe
  const r = await executarTodos({ raiz: '/projeto', carregar });

  assert.equal(r.resultados.length, ativos.length);
  assert.ok(r.resultados.every((x) => x.estado === 'erro'));
  assert.equal(r.veredito, 'reprovado');
});

test('uma falha nao impede os outros gates de rodarem', async () => {
  // Reportar tudo de uma vez e o que permite consertar em uma passada. Parar no primeiro
  // erro obriga a rodar o ciclo N vezes para descobrir N problemas.
  const ativos = await gatesAtivos();
  const carregar = async (id) => ({
    rodar: async () => ({
      estado: id === ativos[0].id ? 'falha' : 'ok',
      achados: id === ativos[0].id ? [{ motivo: 'x' }] : [],
      aviso: null,
    }),
  });

  const r = await executarTodos({ raiz: '/projeto', carregar });
  assert.equal(r.resultados.filter((x) => x.estado === 'ok').length, ativos.length - 1);
});

test('gate fora do CONTRATO vira erro, nunca simbolo estranho numa linha que passa', async () => {
  // Achado na primeira execucao real. O primeiro gate escrito devolvia um ARRAY de achados
  // em vez do objeto do contrato; o runner imprimia `[?]` no lugar do estado e contava
  // aquilo como "nao reprovou". Contrato sem verificacao nao e contrato (I-06).
  for (const retorno of [[], null, 'texto', { estado: 'talvez', achados: [] }, { estado: 'ok' }]) {
    const carregar = async () => ({ rodar: async () => retorno });
    const r = await executarTodos({ raiz: '/projeto', carregar });
    assert.ok(
      r.resultados.every((x) => x.estado === 'erro'),
      `retorno fora do contrato foi aceito: ${JSON.stringify(retorno)}`,
    );
    assert.equal(r.veredito, 'reprovado');
  }
});

test('todo gate ATIVO de verdade respeita o contrato', async () => {
  // Roda os modulos reais contra um diretorio vazio e confere a FORMA do que devolvem.
  // Sem este caso, uma violacao de contrato so aparece quando alguem roda o CLI e olha.
  const ativos = await gatesAtivos();
  for (const g of ativos) {
    const modulo = await import(`../../gates/${g.id}.mjs`);
    const bruto = await modulo.rodar(RAIZ_VAZIA);
    assert.equal(validarResultado(bruto), null, `gate "${g.id}" viola o contrato`);
  }
});

test('cada resultado carrega o numero e o titulo vindos do catalogo', async () => {
  const carregar = async () => ({ rodar: async () => ({ estado: 'ok', achados: [], aviso: null }) });
  const r = await executarTodos({ raiz: '/projeto', carregar });

  for (const x of r.resultados) {
    assert.equal(typeof x.numero, 'number');
    assert.ok(x.titulo?.length > 0, `${x.id} sem titulo`);
  }
});
