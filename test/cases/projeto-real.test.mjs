// Prova de execucao — os gates contra um projeto derivado de verdade.
//
// Este arquivo e a Fase E do plano de reconstrucao, em forma de caso. A licao que o v5
// registrou tres vezes e que nenhum outro caso deste repositorio cobre:
//
//   "Todo achado veio de OPERAR, nenhum de ler. Varios apareceram depois de os mesmos
//    arquivos terem sido lidos inteiros, varias vezes, na mesma revisao."
//
// Os casos por gate provam o gate. Este prova o SISTEMA: catalogo, runner, valvulas,
// isencoes, deteccao de stack e leitura de historico git, tudo junto, contra uma arvore
// real, num caminho COM ESPACO — o cenario em que tres bugs historicos do v5 apareceram.
//
// E prova a metade que a auto-execucao nao alcanca: no proprio repositorio do framework,
// quatro dos sete gates PULAM por nao haver o que conferir. Um deles poderia estar
// quebrado e ninguem saberia.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { executarTodos, lerValvulas, lerIsencoes } from '../../gates/run.mjs';
import { gatesAtivos } from '../../gates/lib/policy.mjs';
import { montarSao, montarDoente, limpar } from '../projeto.mjs';

let sao;
let doente;

before(async () => {
  sao = await montarSao();
  doente = await montarDoente();
});

after(async () => {
  await limpar(sao);
  await limpar(doente);
});

async function rodarNo(raiz) {
  return executarTodos({
    raiz,
    valvulas: await lerValvulas(raiz),
    isencoes: await lerIsencoes(raiz),
  });
}

const doGate = (r, id) => r.resultados.find((x) => x.id === id);

// --------------------------------------------------------------------- projeto sao

test('projeto sao: nenhum gate reprova', async () => {
  const r = await rodarNo(sao);

  const problemas = r.resultados
    .filter((x) => x.estado === 'falha' || x.estado === 'erro')
    .map((x) => `${x.id}: ${x.aviso ?? x.achados.map((a) => a.motivo).join('; ')}`);

  assert.deepEqual(problemas, [], 'gate reprovou projeto correto');
  assert.notEqual(r.veredito, 'reprovado');
});

test('projeto sao: o que era para PULAR no repositorio do framework agora VERIFICA', async () => {
  // Esta e a razao de existir deste arquivo. Na auto-execucao, migrations, tdd-order,
  // env-bypass e typecheck pulam — nao ha banco, nem commit com escopo de task, nem
  // config de ambiente, nem verificador. Aqui ha, e eles precisam dizer `ok`.
  const r = await rodarNo(sao);
  for (const id of ['migrations', 'tdd-order', 'env-bypass', 'typecheck', 'coverage']) {
    assert.equal(doGate(r, id).estado, 'ok', `${id} nao verificou o projeto sao`);
  }
});

test('projeto sao: bypass legitimo em desenvolvimento nao e acusado', async () => {
  // `.env.development` traz SKIP_2FA=true, que e o caminho correto. Gate que reprova quem
  // esta certo e gate que alguem desliga (M-02).
  const r = await rodarNo(sao);
  assert.equal(doGate(r, 'env-bypass').achados.length, 0);
});

// --------------------------------------------------------------------- projeto doente

test('projeto doente: TODOS os gates ativos disparam', async () => {
  // Sem este caso, um gate quebrado passaria por "pulou" para sempre no auto-teste.
  const ativos = await gatesAtivos();
  const r = await rodarNo(doente);

  const silenciosos = r.resultados.filter((x) => x.estado === 'ok' || x.estado === 'pulado');
  assert.deepEqual(
    silenciosos.map((x) => x.id),
    [],
    'gate nao disparou contra defeito plantado',
  );
  assert.equal(r.resultados.length, ativos.length);
  assert.equal(r.veredito, 'reprovado');
});

test('projeto doente: cada gate acusa o defeito que e DELE', async () => {
  // Reprovar pelo motivo errado e o mesmo que nao reprovar: a acusacao precisa apontar
  // para o defeito plantado, senao o caso valida a si mesmo (M-09).
  const r = await rodarNo(doente);
  const texto = (id) => {
    const g = doGate(r, id);
    return [g.aviso ?? '', ...g.achados.map((a) => `${a.arquivo ?? ''} ${a.motivo ?? ''}`)].join(' | ');
  };

  assert.match(texto('secrets'), /pagamento\.ts/, 'secrets nao apontou a credencial plantada');
  assert.match(texto('imports'), /stripe-que-ninguem-instalou/, 'imports nao apontou o pacote fantasma');
  assert.match(texto('migrations'), /rollback|DOWN/i, 'migrations nao apontou o UP sem par');
  assert.match(texto('tdd-order'), /TASK-001/, 'tdd-order nao apontou a task sem teste');
  assert.match(texto('coverage'), /41/, 'coverage nao reportou o percentual medido');
  assert.match(texto('env-bypass'), /SKIP_2FA|TENANT/, 'env-bypass nao apontou o bypass plantado');
  assert.match(texto('typecheck'), /reprovou/, 'typecheck nao reportou a reprovacao');
  assert.match(texto('design-tokens'), /painel\.html/, 'design-tokens nao apontou a tela sem folha');

  // O texto do verificador chega inteiro ao relatorio — segunda metade do item 255: o erro
  // impresso tem de ser o da invocacao que decidiu, nao de outra.
  assert.match(doGate(r, 'typecheck').saida, /TS2345/, 'a saida do verificador se perdeu');
});

test('projeto doente: o eixo nunca-relaxa dispara mesmo em perfil de producao', async () => {
  const r = await rodarNo(doente);
  const eixos = doGate(r, 'env-bypass').achados.map((a) => a.eixo);
  assert.ok(eixos.includes('nunca-relaxa'), 'o eixo que nao relaxa nao apareceu');
  assert.ok(eixos.includes('relaxavel-so-em-dev'), 'o eixo de producao nao apareceu');
});

// --------------------------------------------------------------------- sistema

test('o caminho com ESPACO nao quebra nenhum gate', async () => {
  // Tres bugs historicos do v5 foram de word-splitting, e o caminho com espaco e o cenario
  // em que apareceram. Em Node o risco muda de forma — mas o `git` do gate de ordem TDD e
  // o `npx` do type-check ainda sao processos externos recebendo caminho.
  assert.ok(sao.includes(' '), 'a bancada perdeu o espaco no caminho — o cenario sumiu');
  const r = await rodarNo(sao);
  assert.ok(r.resultados.every((x) => x.estado !== 'erro'), 'algum gate estourou com espaco no caminho');
});

test('a valvula do projeto e de fato lida do disco', async () => {
  // `.sdd/coverage-min` do projeto traz 80. Se o runner nao lesse, o gate cairia no padrao
  // do catalogo e o caso passaria pelo motivo errado — entao o doente prova o contrario:
  // 41% reprovando contra o minimo que veio do ARQUIVO.
  const valvulas = await lerValvulas(doente);
  assert.equal(valvulas.coverage, '80');
  assert.equal(doGate(await rodarNo(doente), 'coverage').minimo, 80);
});
