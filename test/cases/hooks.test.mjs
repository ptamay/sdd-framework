// Casos do PROTOCOLO dos hooks — o processo, nao a funcao pura.
//
// `decidir()` do guard ja tinha casos, e bons. O que nao tinha era o involucro: ler o JSON
// do stdin, decidir, e sinalizar ao harness. E o involucro e onde mora a falha que interessa,
// porque ela e muda nos dois hooks:
//
//   guard      sinaliza por CODIGO DE SAIDA (2 barra, 0 libera). Um wrapper que estoura, que
//              nao le o stdin ou que sai 0 por engano nao barra nada — e nao existe tela onde
//              isso apareca. A barreira fica desarmada com `decidir()` perfeito e cobertura
//              cheia, que e a definicao de enforcement ausente indistinguivel de enforcement
//              que aprovou (M-12).
//
//   contexto   sinaliza por STDOUT, e roda no topo do modulo — nao da para importar sem
//              executar. Se ele estoura, a sessao comeca sem o contexto do projeto e nada
//              denuncia: o agente trabalha fora do framework achando que esta dentro.
//
// Por isso todo caso aqui SOBE O PROCESSO. Importar a funcao e testar outra coisa.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { decidir } from '../../hooks/guard.mjs';
import { gatesAtivos, carregarCatalogo, raizDoRepo } from '../../gates/lib/policy.mjs';

const RAIZ = raizDoRepo();

/** Sobe o hook como o harness sobe: processo proprio, evento no stdin. */
function rodarHook(arquivo, payload) {
  const corpo = typeof payload === 'string' ? payload : JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(RAIZ, 'hooks', arquivo)], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let saida = '';
    let erro = '';
    p.stdout.on('data', (d) => (saida += d));
    p.stderr.on('data', (d) => (erro += d));
    p.on('error', reject);
    p.on('close', (codigo) => resolve({ codigo, saida, erro }));

    p.stdin.end(corpo);
  });
}

/**
 * Raiz temporaria com ESPACO no nome, pela mesma razao que test/projeto.mjs: tres bugs
 * historicos do v5 foram de word-splitting, e o espaco e o cenario em que apareceram.
 */
async function novaRaiz() {
  const base = await mkdtemp(join(tmpdir(), 'sdd-hook-'));
  const raiz = join(base, 'meu projeto');
  await mkdir(raiz, { recursive: true });
  return raiz;
}

// =========================================================================== guard

const EVENTO_BARRA = {
  tool_name: 'Write',
  tool_input: { file_path: '.sdd/gates-ignore.json' },
};

test('guard: o evento que barra sai com codigo 2', async () => {
  // 2 e o unico codigo que o harness le como "bloqueia e devolve o motivo ao modelo".
  // Qualquer outro — inclusive 1 — deixa a chamada passar.
  const { codigo, erro } = await rodarHook('guard.mjs', EVENTO_BARRA);

  assert.equal(codigo, 2, 'a escrita na lista de isencoes NAO foi barrada');
  assert.match(erro, /quem isenta e quem revisa/);
});

test('guard: o motivo que chega ao modelo e EXATAMENTE o que decidir devolve', async () => {
  // A costura entre a funcao pura e o processo. Ela nunca tinha sido exercitada: `decidir`
  // podia estar perfeito e o wrapper mandar string vazia, mensagem truncada ou o objeto
  // serializado — e o modelo receberia isso como justificativa do bloqueio.
  const { erro } = await rodarHook('guard.mjs', EVENTO_BARRA);

  assert.equal(erro.trimEnd(), decidir(EVENTO_BARRA));
});

test('guard: o evento que libera sai com 0 e em silencio', async () => {
  const { codigo, erro } = await rodarHook('guard.mjs', {
    tool_name: 'Edit',
    tool_input: { file_path: 'src/app.ts' },
  });

  assert.equal(codigo, 0);
  assert.equal(erro, '', 'o guard falou sem ter o que barrar');
});

test('guard: escrita via shell tambem sai com 2', async () => {
  const { codigo } = await rodarHook('guard.mjs', {
    tool_name: 'Bash',
    tool_input: { command: 'echo "{}" > .sdd/gates-ignore.json' },
  });

  assert.equal(codigo, 2);
});

test('guard: LER a lista pelo shell continua livre', async () => {
  const { codigo, erro } = await rodarHook('guard.mjs', {
    tool_name: 'Bash',
    tool_input: { command: 'cat .sdd/gates-ignore.json' },
  });

  assert.equal(codigo, 0);
  assert.equal(erro, '');
});

test('guard: payload ilegivel NAO barra, e avisa', async () => {
  // Barrar tudo por um payload malformado transformaria o guard em obstaculo — e obstaculo
  // alguem desliga. Mas liberar CALADO seria a falha muda de novo: tem que sair no stderr.
  const { codigo, erro } = await rodarHook('guard.mjs', 'isto nao e json');

  assert.equal(codigo, 0);
  assert.match(erro, /ilegivel/);
});

test('guard: stdin vazio nao barra nem estoura', async () => {
  const { codigo } = await rodarHook('guard.mjs', '');
  assert.equal(codigo, 0);
});

// =========================================================================== contexto

test('contexto: projeto sem o marcador nao recebe injecao nenhuma', async () => {
  // O plugin pode estar habilitado em projetos que nao usam o framework. Despejar processo
  // em cima de quem nao pediu e o jeito mais rapido de alguem desabilitar tudo.
  const raiz = await novaRaiz();
  try {
    const { codigo, saida } = await rodarHook('contexto.mjs', { cwd: raiz });

    assert.equal(codigo, 0);
    assert.equal(saida, '', 'injetou processo num projeto que nao declarou o framework');
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test('contexto: .sdd/ sem framework.json NAO injeta — o marcador e EXPLICITO', async () => {
  // A versao anterior do framework usa o mesmo diretorio `.sdd/`. Abrir o repositorio dela
  // com este plugin carregado injetaria o processo errado, sem nada que denunciasse a troca.
  const raiz = await novaRaiz();
  try {
    await mkdir(join(raiz, '.sdd', 'memory'), { recursive: true });
    await writeFile(join(raiz, '.sdd', 'memory', 'spec.md'), '# spec\n');

    const { codigo, saida } = await rodarHook('contexto.mjs', { cwd: raiz });

    assert.equal(codigo, 0);
    assert.equal(saida, '', 'a mera existencia de .sdd/ disparou a injecao');
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test('contexto: com o marcador, injeta e lista TODO gate ativo do catalogo', async () => {
  // Derivado, nunca escrito a mao. Era assim que o v5 acumulava versoes divergentes da mesma
  // lista — e a mais curta era a que o agente lia sempre. Se um gate entra no catalogo, ele
  // aparece aqui; o caso falha no dia em que alguem escrever a lista na mao.
  const raiz = await novaRaiz();
  try {
    await mkdir(join(raiz, '.sdd'), { recursive: true });
    await writeFile(join(raiz, '.sdd', 'framework.json'), JSON.stringify({ framework: 'sdd' }));

    const { codigo, saida } = await rodarHook('contexto.mjs', { cwd: raiz });

    assert.equal(codigo, 0);
    assert.ok(saida.length > 0, 'o marcador estava la e nada foi injetado');

    for (const g of await gatesAtivos()) {
      assert.ok(saida.includes(g.titulo), `o contexto nao cita o gate ativo "${g.id}"`);
    }
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test('contexto: o gate CANDIDATO aparece como ainda nao coberto', async () => {
  // O que nenhum gate mede precisa ser dito, senao a lista de gates vira promessa de
  // cobertura total — e o que ficou de fora nao tem quem assuma.
  const raiz = await novaRaiz();
  try {
    await mkdir(join(raiz, '.sdd'), { recursive: true });
    await writeFile(join(raiz, '.sdd', 'framework.json'), '{}');

    const { saida } = await rodarHook('contexto.mjs', { cwd: raiz });
    const { gates } = await carregarCatalogo();

    for (const g of gates.filter((x) => x.status === 'candidato')) {
      assert.ok(saida.includes(g.id), `o contexto nao declara o candidato "${g.id}"`);
    }
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test('contexto: a memoria presente e listada, e a ausente e dita como ausente', async () => {
  const raiz = await novaRaiz();
  try {
    await mkdir(join(raiz, '.sdd', 'memory'), { recursive: true });
    await writeFile(join(raiz, '.sdd', 'framework.json'), '{}');

    const vazia = await rodarHook('contexto.mjs', { cwd: raiz });
    assert.match(vazia.saida, /vazia/, 'memoria vazia passou sem ser declarada vazia');

    await writeFile(join(raiz, '.sdd', 'memory', 'constitution.md'), '# lei\n');
    const cheia = await rodarHook('contexto.mjs', { cwd: raiz });
    assert.match(cheia.saida, /constitution\.md/);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test('contexto: payload ilegivel sai calado', async () => {
  const { codigo, saida } = await rodarHook('contexto.mjs', 'isto nao e json');

  assert.equal(codigo, 0);
  assert.equal(saida, '');
});
