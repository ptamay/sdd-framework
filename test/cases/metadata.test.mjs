// Casos da metadata de skills e sub-agentes — o bloco de frontmatter.
//
// Escritos DEPOIS do defeito, e o defeito e REINCIDENTE. Vale registrar as duas entradas,
// porque a segunda so foi possivel por causa da forma da defesa contra a primeira:
//
//   1. o frontmatter dos agentes nasceu em CRLF e o parser nao reconheceu o bloco. Defesa
//      escrita: o caso do blob do git, em plugin.test.mjs.
//   2. seis descriptions sem aspas continham ": ". O YAML le isso como mapeamento aninhado,
//      o parse do bloco cai — MESMO EFEITO da primeira, causa diferente, e a defesa de (1)
//      nao viu nada porque ela guarda a causa.
//
// Nos dois casos o componente carrega em silencio com metadata VAZIA: sem `tools`, sem
// `model`, sem `description`. Ausencia de enforcement e indistinguivel de enforcement que
// aprovou (M-12).
//
// Por isso estes casos afirmam o EFEITO, nunca uma causa: a metadata le, tem os campos, e
// os campos dizem o que a policy exige. Qualquer terceira causa cai aqui sem ninguem
// precisar prever qual e.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { raizDoRepo } from '../../gates/lib/policy.mjs';
import { lerFrontmatter } from '../frontmatter.mjs';

const RAIZ = raizDoRepo();
const lerPolicy = async (n) => JSON.parse(await readFile(join(RAIZ, 'policy', n), 'utf8'));

async function agentes() {
  const dir = join(RAIZ, 'agents');
  const nomes = (await readdir(dir)).filter((n) => n.endsWith('.md'));

  return Promise.all(
    nomes.map(async (n) => ({
      id: n.replace(/\.md$/, ''),
      arquivo: `agents/${n}`,
      lido: lerFrontmatter(await readFile(join(dir, n), 'utf8')),
    })),
  );
}

async function skills() {
  const dir = join(RAIZ, 'skills');
  const nomes = (await readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  return Promise.all(
    nomes.map(async (n) => ({
      id: n,
      arquivo: `skills/${n}/SKILL.md`,
      lido: lerFrontmatter(await readFile(join(dir, n, 'SKILL.md'), 'utf8')),
    })),
  );
}

// --------------------------------------------------------------------- le sem ambiguidade

test('o frontmatter de todo agente e toda skill le sem ambiguidade', async () => {
  const componentes = [...(await agentes()), ...(await skills())];

  assert.ok(componentes.length > 0, 'nenhum componente encontrado — a varredura quebrou');

  for (const c of componentes) {
    assert.equal(c.lido.erro, undefined, `${c.arquivo}: ${c.lido.erro}`);
  }
});

// --------------------------------------------------------------------- campos obrigatorios

test('todo agente declara name, description, tools e model — com valor', async () => {
  // `tools` e `model` sao a razao de o sub-agente existir como definicao separada. Um agente
  // sem eles nao e um agente mais permissivo: e a thread principal com outro nome.
  for (const a of await agentes()) {
    const { campos, erro } = a.lido;
    assert.equal(erro, undefined, `${a.arquivo}: ${erro}`);

    for (const campo of ['name', 'description', 'tools', 'model']) {
      assert.ok(campos[campo], `${a.arquivo} sem "${campo}"`);
    }
    assert.equal(campos.name, a.id, `${a.arquivo}: name diverge do nome do arquivo`);
  }
});

test('toda skill declara name e description — com valor', async () => {
  // Sem `description` a skill so responde a invocacao explicita: o modelo perde o unico
  // sinal que diz QUANDO usar a rota. Ela nao some da lista, o que torna a perda invisivel.
  for (const s of await skills()) {
    const { campos, erro } = s.lido;
    assert.equal(erro, undefined, `${s.arquivo}: ${erro}`);

    assert.ok(campos.name, `${s.arquivo} sem "name"`);
    assert.ok(campos.description?.length > 40, `${s.arquivo} sem description util`);
    assert.equal(campos.name, s.id, `${s.arquivo}: name diverge do diretorio`);
  }
});

// --------------------------------------------------------------------- camada x policy

test('todo agente tem camada na policy, e toda camada da policy tem agente', async () => {
  // As duas direcoes. Agente sem camada declarada escolhe o modelo sozinho; camada declarada
  // sem agente e uma decisao que ninguem executa e que ninguem vai revisar quando mudar.
  const { agentes: tabela } = await lerPolicy('esforco.json');
  const noDisco = (await agentes()).map((a) => a.id);

  assert.deepEqual(noDisco.sort(), Object.keys(tabela).sort());
});

test('o model de cada agente e o da camada que a policy atribui a ele', async () => {
  // O caso que existia antes deste lia o TEXTO CRU do arquivo procurando /^model: opus$/m
  // e passou durante todo o tempo em que o bug esteve vivo: a linha estava la, so nao estava
  // sendo carregada. Ler o campo depois do parse e a diferenca entre guardar o invariante e
  // guardar a aparencia dele (M-09).
  const { camadas, agentes: tabela } = await lerPolicy('esforco.json');

  for (const a of await agentes()) {
    const { campos, erro } = a.lido;
    assert.equal(erro, undefined, `${a.arquivo}: ${erro}`);

    const camada = tabela[a.id]?.camada;
    assert.ok(camada, `${a.arquivo} sem camada na policy`);
    assert.ok(camadas[camada], `${a.arquivo} cita camada inexistente: ${camada}`);

    assert.equal(
      campos.model,
      camadas[camada].modelo,
      `${a.arquivo} esta em "${campos.model}" e a policy o poe na camada "${camada}" (${camadas[camada].modelo})`,
    );
  }
});
