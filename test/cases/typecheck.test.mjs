// Casos do gate `typecheck`.
//
// Escritos ANTES da implementacao (M-08).
//
// Unico gate que invoca FERRAMENTA EXTERNA, e por isso o unico que carrega o item 255. A
// propriedade central dele — uma invocacao so — e INVISIVEL na saida: rodar o verificador
// uma ou duas vezes imprime exatamente o mesmo texto. So um teste de comportamento pega, e
// e por isso que o executor e injetavel.
//
// O que o v5 pagou por nao ter isso: eram duas invocacoes quando FALHAVA (uma para o status,
// outra para o texto). Quem ja estava com problema pagava o dobro no gate mais caro — e os
// dois processos podiam ver arvores diferentes, de modo que o erro IMPRESSO nao era o que
// reprovou.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectar, interpretar, rodar } from '../../gates/typecheck.mjs';

const arq = (caminho, conteudo = '') => ({ caminho, conteudo });

/** Executor falso que CONTA invocacoes — o instrumento que o v5 nao tinha. */
function espiao(resultado) {
  const chamadas = [];
  const executar = async (comando, args) => {
    chamadas.push({ comando, args });
    return resultado;
  };
  return { executar, chamadas };
}

// --------------------------------------------------------------------- deteccao

test('detecta o verificador pelo indicio do projeto', () => {
  assert.equal(detectar({ arquivos: [arq('tsconfig.json'), arq('src/a.ts')] }).ferramenta, 'tsc');
  assert.equal(detectar({ arquivos: [arq('mypy.ini'), arq('app/a.py')] }).ferramenta, 'mypy');
  assert.equal(
    detectar({ arquivos: [arq('pyproject.toml', '[tool.mypy]\nstrict = true')] }).ferramenta,
    'mypy',
  );
});

test('projeto sem verificador configurado NAO tem ferramenta', () => {
  // Gate que reprova quem esta certo e gate que alguem desliga (M-02). Um projeto em
  // JavaScript puro nao esta defeituoso por nao ter tsconfig.
  assert.equal(detectar({ arquivos: [arq('src/a.js'), arq('package.json')] }).ferramenta, null);
});

// --------------------------------------------------------------------- interpretacao

test('saida zero e aprovacao', () => {
  assert.equal(interpretar({ codigo: 0, saida: '' }).estado, 'ok');
});

test('saida nao-zero e falha, e o texto do processo e PRESERVADO', () => {
  // Segunda metade do item 255: o erro impresso tem de ser o que reprovou. Com duas
  // invocacoes ele podia ser de outra execucao, sobre outra arvore.
  const texto = "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.";
  const r = interpretar({ codigo: 2, saida: texto });
  assert.equal(r.estado, 'falha');
  assert.equal(r.saida, texto, 'o texto reportado nao e o do processo que reprovou');
});

test('falha de spawn NAO e "sem erros de tipo"', () => {
  // Itens 186 e 211. Um crash devolvia string vazia, indistinguivel de saida limpa, e o
  // gate afirmava que os tipos estavam certos sem ter verificado um unico.
  const r = interpretar({ codigo: null, saida: '', erroDeSpawn: 'ENOENT' });
  assert.equal(r.estado, 'erro');
  assert.notEqual(r.estado, 'ok');
  assert.ok(r.aviso?.length > 0);
});

// --------------------------------------------------------------------- item 255

test('o verificador e invocado UMA vez quando passa', async () => {
  const { executar, chamadas } = espiao({ codigo: 0, saida: '' });
  await rodar('/projeto', { executar, deteccao: { ferramenta: 'tsc' } });
  assert.equal(chamadas.length, 1);
});

test('o verificador e invocado UMA vez quando FALHA — este e o item 255', async () => {
  // O caminho que o v5 pagava em dobro: quem ja estava com problema rodava o gate mais
  // caro duas vezes. Nenhum dos dois caminhos pode invocar mais de uma vez.
  const { executar, chamadas } = espiao({ codigo: 2, saida: 'error TS2322' });
  const r = await rodar('/projeto', { executar, deteccao: { ferramenta: 'tsc' } });
  assert.equal(chamadas.length, 1, `invocou ${chamadas.length} vezes no caminho de falha`);
  assert.equal(r.estado, 'falha');
});

test('a saida reportada e exatamente a da invocacao que decidiu', async () => {
  const texto = 'error TS1005: expected ;';
  const { executar } = espiao({ codigo: 2, saida: texto });
  const r = await rodar('/projeto', { executar, deteccao: { ferramenta: 'tsc' } });
  assert.equal(r.saida, texto);
});

// --------------------------------------------------------------------- anti-silencio

test('sem verificador configurado => pulado com motivo', async () => {
  const { executar, chamadas } = espiao({ codigo: 0, saida: '' });
  const r = await rodar('/projeto', { executar, deteccao: { ferramenta: null } });
  assert.equal(r.estado, 'pulado');
  assert.ok(r.aviso?.length > 0);
  assert.equal(chamadas.length, 0, 'invocou ferramenta sem ter ferramenta');
});

test('verificador CONFIGURADO mas ausente na maquina => erro, nunca ok', async () => {
  // Mesma familia do "ha suite de teste e nao ha relatorio" do gate de cobertura. O projeto
  // declara ser tipado e nada foi conferido — dizer ✅ ali e o falso verde.
  const { executar } = espiao({ codigo: null, saida: '', erroDeSpawn: 'ENOENT' });
  const r = await rodar('/projeto', { executar, deteccao: { ferramenta: 'tsc' } });
  assert.equal(r.estado, 'erro');
  assert.match(r.aviso, /tsc|verificador/i);
});
