// Casos das rotas, skills e sub-agentes.
//
// Escritos ANTES da implementacao (M-08).
//
// A camada de processo e onde o v5 acumulou a maior parte dos seus 288 achados, e quase
// nenhum deles quebrava teste: eram fatos escritos duas vezes que divergiram. Os casos aqui
// nao verificam o TEXTO do processo — verificam as duas propriedades estruturais que
// impedem a divergencia de nascer:
//
//   1. rota e skill nao divergem em NENHUMA direcao
//   2. a skill nao REPETE o que o catalogo ja diz

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

import { raizDoRepo } from '../../gates/lib/policy.mjs';
import { lerFrontmatter } from '../frontmatter.mjs';

const exec = promisify(execFile);
const RAIZ = raizDoRepo();
const lerPolicy = async (n) => JSON.parse(await readFile(join(RAIZ, 'policy', n), 'utf8'));
const existe = (c) => access(join(RAIZ, c)).then(() => true, () => false);

// --------------------------------------------------------------------- rota x skill

test('toda rota tem skill, e toda skill tem rota', async () => {
  // As duas direcoes importam. Rota sem skill e lei sem executor (I-06). Skill sem rota e
  // executor que ninguem sabe de onde veio — e que ninguem revisa quando a rota muda.
  const { rotas } = await lerPolicy('rotas.json');
  const dirs = (await readdir(join(RAIZ, 'skills'), { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  assert.deepEqual(dirs.sort(), rotas.map((r) => r.skill).sort());

  for (const r of rotas) {
    assert.ok(await existe(`skills/${r.skill}/SKILL.md`), `rota "${r.id}" sem SKILL.md`);
  }
});

test('toda rota entrega artefatos que o contrato de memoria conhece', async () => {
  const { rotas } = await lerPolicy('rotas.json');
  const memoria = await lerPolicy('memoria.json');
  const ids = memoria.arquivos.map((a) => a.id);

  for (const r of rotas) {
    for (const e of r.entrega) {
      assert.ok(ids.includes(e), `rota "${r.id}" entrega "${e}", que nao existe no contrato`);
    }
  }
});

test('todo estagio citado por uma rota existe', async () => {
  const { rotas, estagios } = await lerPolicy('rotas.json');
  const ids = estagios.map((e) => e.id);
  for (const r of rotas) {
    assert.ok(ids.includes(r.estagio), `rota "${r.id}" cita estagio inexistente`);
  }
});

// --------------------------------------------------------------------- skill nao repete

test('a skill aponta para o contrato em vez de reescreve-lo', async () => {
  // A propriedade que mantem a camada fina fina. Uma skill que descreve o processo vira a
  // enesima copia do mesmo fato, e o v5 provou que copias divergem em silencio: chegou a
  // ter TRES formas de criterio de aceite em tres pontos do mesmo ciclo.
  const { rotas } = await lerPolicy('rotas.json');

  for (const r of rotas) {
    const texto = await readFile(join(RAIZ, 'skills', r.skill, 'SKILL.md'), 'utf8');
    const linhas = texto.split('\n').length;

    assert.ok(linhas < 60, `skills/${r.skill} tem ${linhas} linhas — esta reescrevendo o processo`);
    assert.match(texto, new RegExp(`sdd-rota ${r.id}\\b`), `skills/${r.skill} nao carrega o contrato`);
    assert.match(texto, /sdd-gates/, `skills/${r.skill} nao manda rodar os gates`);
  }
});

test('nenhuma skill ou agente repete um valor que vive no catalogo', async () => {
  // O caso mais importante deste arquivo. No v5 o minimo de cobertura vivia numa valvula E
  // estava fixado em prosa em quatro outros lugares — num projeto que baixou a regua, o
  // checklist reprovava o que o gate aprovava.
  const { gates } = await lerPolicy('gates.json');
  const minimo = String(gates.find((g) => g.id === 'coverage').minimoPadrao);

  const acusacoes = [];
  for (const dir of ['skills', 'agents']) {
    for await (const rel of arquivosMd(join(RAIZ, dir), dir)) {
      const texto = await readFile(join(RAIZ, rel), 'utf8');
      texto.split('\n').forEach((linha, i) => {
        if (new RegExp(`\\b${minimo}\\s*%`).test(linha)) acusacoes.push(`${rel}:${i + 1}`);
      });
    }
  }

  assert.deepEqual(acusacoes, [], `minimo de cobertura fixado em prosa — leia o catalogo`);
});

// --------------------------------------------------------------------- sub-agentes

test('todo sub-agente declara nome, ferramentas e modelo', async () => {
  for await (const rel of arquivosMd(join(RAIZ, 'agents'), 'agents')) {
    const texto = await readFile(join(RAIZ, rel), 'utf8');
    const fm = texto.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fm, `${rel} sem frontmatter`);

    for (const campo of ['name', 'description', 'tools', 'model']) {
      assert.match(fm[1], new RegExp(`^${campo}:`, 'm'), `${rel} sem "${campo}"`);
    }
  }
});

test('o revisor NAO tem permissao de escrita — e isso e a definicao dele', async () => {
  // Restricao de ferramenta e enforcement, nao documentacao. Um revisor que conserta o que
  // deveria auditar deixa de ser revisor no momento em que conserta — e isso o v5 provou
  // funcionando em execucao real: "achou o bloqueador e reportou sem consertar".
  const texto = await readFile(join(RAIZ, 'agents', 'review-agent.md'), 'utf8');
  const tools = texto.match(/^tools:\s*(.+)$/m)[1];

  assert.doesNotMatch(tools, /\bWrite\b/, 'o revisor ganhou Write');
  assert.doesNotMatch(tools, /\bEdit\b/, 'o revisor ganhou Edit');
});

test('o agente somente-leitura nao tem Bash — a prosa dele nao pode mandar criar branch', async () => {
  // Contradicao entre o que o frontmatter PERMITE e o que a prosa MANDA nao quebra teste
  // nenhum: some numa leitura e aparece na execucao (item 246 do v5).
  const texto = await readFile(join(RAIZ, 'agents', 'task-agent.md'), 'utf8');
  const tools = texto.match(/^tools:\s*(.+)$/m)[1];

  assert.doesNotMatch(tools, /\bBash\b/);
  assert.doesNotMatch(tools, /\bWrite\b/);
  assert.match(texto, /reporta/i, 'o agente sem Bash precisa dizer que REPORTA a branch');
});

// --------------------------------------------------------------------- contrato executavel

test('sdd-rota imprime o contrato de toda rota, sem estourar', async () => {
  const { rotas } = await lerPolicy('rotas.json');
  for (const r of rotas) {
    const { stdout } = await exec(process.execPath, [join(RAIZ, 'bin', 'sdd-rota'), r.id]);
    assert.match(stdout, new RegExp(`# Rota: ${r.id}`));
    assert.match(stdout, /## Regras desta rota/);
    assert.match(stdout, /## Gates que valem aqui/);
  }
});

test('sdd-rota recusa rota desconhecida em vez de imprimir nada', async () => {
  // Comando que sai 0 sem imprimir e a leitura de "tudo certo" — o defeito que a primeira
  // execucao do runner cometeu.
  await assert.rejects(
    () => exec(process.execPath, [join(RAIZ, 'bin', 'sdd-rota'), 'nao-existe']),
    (erro) => /rota desconhecida/.test(erro.stderr),
  );
});

// ---------------------------------------------------------------------------

async function* arquivosMd(absoluto, prefixo) {
  for (const e of await readdir(absoluto, { withFileTypes: true })) {
    const rel = `${prefixo}/${e.name}`;
    if (e.isDirectory()) yield* arquivosMd(join(absoluto, e.name), rel);
    else if (e.name.endsWith('.md')) yield rel;
  }
}

// --------------------------------------------------------------------- esforco

test('toda rota tem camada de esforco declarada, e a camada existe', async () => {
  // O v5 congelou esta escolha numa geracao antiga do modelo e passou a rotear TODA sprint
  // critica — auth, isolamento de tenant, dinheiro — para um modelo que ja nao era o mais
  // capaz. Nao era deriva de documentacao: era a decisao de orquestracao sendo tomada com
  // lista vencida, no ponto de maior risco do processo.
  const { rotas } = await lerPolicy('rotas.json');
  const esforco = await lerPolicy('esforco.json');

  for (const r of rotas) {
    const e = esforco.rotas[r.id];
    assert.ok(e, `rota "${r.id}" sem camada de esforco declarada`);
    assert.ok(e.porque?.length > 20, `rota "${r.id}" sem motivo para a camada`);
    if (e.camada !== 'por-agente') {
      assert.ok(esforco.camadas[e.camada], `rota "${r.id}" cita camada inexistente: ${e.camada}`);
    }
  }
});

test('a tabela aloca CAMADAS, nunca versoes de modelo', async () => {
  // O conserto do item 233 aplicado na origem. Um identificador de versao aqui envelhece
  // sozinho e ninguem percebe — foi assim que a decisao mais cara do processo passou a ser
  // tomada com uma lista vencida.
  const esforco = await lerPolicy('esforco.json');
  const bruto = JSON.stringify(esforco);

  assert.doesNotMatch(bruto, /claude-[a-z]+-\d/, 'identificador de versao no catalogo de esforco');
  assert.doesNotMatch(bruto, /\d{8}/, 'data de versao no catalogo de esforco');

  for (const c of Object.values(esforco.camadas)) {
    assert.match(c.modelo, /^[a-z]+$/, `"${c.modelo}" parece versao, nao camada`);
  }
});

test('o agente que AUDITA nao pode cair de camada', async () => {
  // A auditoria do v5 falhou por esforco baixo, e foi essa falha que motivou fixar a camada
  // na definicao do agente em vez de deixa-la como recomendacao em prosa.
  //
  // A primeira versao deste caso casava /^model:\s*opus\s*$/m contra o TEXTO CRU do arquivo
  // — e passou durante todo o tempo em que o frontmatter do review-agent nao parseava. A
  // linha existia; o campo estava sendo descartado no load. O caso guardava a APARENCIA do
  // invariante, que e a definicao de passar pelo motivo errado (M-09).
  //
  // Ler depois do parse e a correcao. A camada alvo vem da policy, nunca literal aqui: o
  // apelido de camada envelhece sozinho, e foi por congelar um literal que o v5 roteou
  // sprint critica para um modelo vencido.
  const { camadas, agentes } = await lerPolicy('esforco.json');
  const { campos, erro } = lerFrontmatter(
    await readFile(join(RAIZ, 'agents', 'review-agent.md'), 'utf8'),
  );

  assert.equal(erro, undefined, `o frontmatter do revisor nao le: ${erro}`);
  assert.equal(agentes['review-agent'].camada, 'alto', 'a policy tirou o revisor da camada alta');
  assert.equal(campos.model, camadas.alto.modelo, 'o revisor saiu da camada alta');
});
