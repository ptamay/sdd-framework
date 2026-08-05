// Casos da embalagem como plugin do Claude Code.
//
// Escritos ANTES da implementacao (M-08).
//
// Um plugin mal montado falha do jeito pior: em silencio. Componente no diretorio errado
// simplesmente nao carrega, hook apontando para arquivo inexistente nao dispara, e binario
// sem bit de execucao e ignorado — nada disso produz erro, so ausencia. E ausencia de
// enforcement e indistinguivel de enforcement que aprovou (M-12).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

import { decidir } from '../../hooks/guard.mjs';
import { raizDoRepo } from '../../gates/lib/policy.mjs';

const exec = promisify(execFile);
const RAIZ = raizDoRepo();
const existe = (c) => access(join(RAIZ, c)).then(() => true, () => false);

// --------------------------------------------------------------------- manifesto

test('o manifesto e valido e declara versao EXPLICITA', async () => {
  const m = JSON.parse(await readFile(join(RAIZ, '.claude-plugin', 'plugin.json'), 'utf8'));

  assert.match(m.name, /^[a-z][a-z0-9-]*$/, 'nome precisa ser kebab-case (vira o namespace)');
  assert.ok(m.description?.length > 20);

  // Sem `version`, o Claude Code cai no SHA do commit e TODO push vira versao nova para
  // quem instalou. Um framework de governanca precisa do contrario: mudanca so quando
  // alguem decide entregar.
  assert.match(m.version, /^\d+\.\d+\.\d+$/, 'versao ausente ou fora de semver');
});

test('componentes ficam na RAIZ do plugin, nunca dentro de .claude-plugin/', async () => {
  // O erro mais comum, e ele nao produz erro nenhum: o componente simplesmente nao carrega.
  for (const dir of ['hooks', 'bin', 'gates', 'policy']) {
    assert.ok(await existe(dir), `${dir}/ ausente na raiz`);
    assert.equal(
      await existe(join('.claude-plugin', dir)),
      false,
      `${dir}/ dentro de .claude-plugin/ — nao vai carregar`,
    );
  }
  assert.ok(await existe('.claude-plugin/plugin.json'));
});

// --------------------------------------------------------------------- hooks

test('todo hook aponta para arquivo existente e usa CLAUDE_PLUGIN_ROOT', async () => {
  // Hook apontando para arquivo que nao existe nao dispara e nao reclama. E `${CLAUDE_PLUGIN_ROOT}`
  // e obrigatorio porque o diretorio do plugin MUDA a cada atualizacao.
  const { hooks } = JSON.parse(await readFile(join(RAIZ, 'hooks', 'hooks.json'), 'utf8'));

  const comandos = Object.values(hooks)
    .flat()
    .flatMap((e) => e.hooks)
    .map((h) => h.command);

  assert.ok(comandos.length > 0, 'nenhum hook declarado');

  for (const cmd of comandos) {
    assert.match(cmd, /\$\{CLAUDE_PLUGIN_ROOT\}/, `caminho absoluto ou relativo em: ${cmd}`);

    const relativo = cmd.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"']+)/)?.[1];
    assert.ok(relativo, `nao deu para extrair o alvo de: ${cmd}`);
    assert.ok(await existe(relativo), `hook aponta para arquivo inexistente: ${relativo}`);
  }
});

// --------------------------------------------------------------------- bit de execucao

test('o executavel tem o bit de execucao NO INDICE DO GIT', async () => {
  // Licao que o v5 pagou TRES vezes (itens 204, 207 e 287). Em Windows o bit nao existe no
  // filesystem e o git grava 100644; um script sem ele e PULADO EM SILENCIO em Linux e
  // macOS. O gate olha o indice, nao o `-x` local, porque so o indice da a mesma resposta
  // nos tres sistemas — e e o que um clone recebe.
  const { stdout } = await exec('git', ['ls-files', '-s', 'bin/sdd-gates'], { cwd: RAIZ });

  assert.notEqual(stdout.trim(), '', 'bin/sdd-gates ainda nao esta no indice — rode `git add`');
  assert.match(
    stdout,
    /^100755 /,
    'bin/sdd-gates sem bit de execucao: `git update-index --chmod=+x bin/sdd-gates`',
  );
});

test('o executavel tem shebang de Node', async () => {
  const fonte = await readFile(join(RAIZ, 'bin', 'sdd-gates'), 'utf8');
  assert.match(fonte.split('\n')[0], /^#!\/usr\/bin\/env node$/);
});

test('o que o git entrega e LF — CRLF no shebang quebra o executavel', async () => {
  // O item 171 do v5 existe porque a conversao CRLF desarmou um gate inteiro. Aqui o
  // estrago e mais direto: com \r no fim da primeira linha, o kernel do Linux procura o
  // interpretador `/usr/bin/env node\r` e responde "bad interpreter". O plugin instala,
  // aparece na lista, e o comando nao roda — sem mensagem que explique.
  //
  // A verificacao olha o BLOB do git (o que um clone recebe), nao a copia de trabalho:
  // em Windows a copia local pode ter CRLF legitimamente.
  //
  // Cobre skills e agentes tambem, e isso saiu de um defeito real: o frontmatter YAML dos
  // sub-agentes nasceu em CRLF e o parser de frontmatter simplesmente NAO RECONHECEU o
  // bloco — o agente carregaria sem `tools:` e sem `model:`, isto e, sem a restricao de
  // ferramenta que e a razao de ele existir. Dois casos vizinhos passaram mesmo assim,
  // porque o regex deles tolerava o `\r`: aprovaram pelo motivo errado (M-09).
  const { stdout: lista } = await exec(
    'git',
    ['ls-files', 'bin', 'hooks', 'skills', 'agents'],
    { cwd: RAIZ },
  );

  for (const alvo of lista.split('\n').filter(Boolean)) {
    const { stdout } = await exec('git', ['show', `:${alvo}`], { cwd: RAIZ });
    assert.equal(stdout.includes('\r'), false, `${alvo} entra no git com CRLF`);
  }
});

// --------------------------------------------------------------------- guard

test('barra escrita na lista de isencoes, por qualquer ferramenta de edicao', () => {
  for (const tool_name of ['Write', 'Edit', 'MultiEdit']) {
    const r = decidir({ tool_name, tool_input: { file_path: '.sdd/gates-ignore.json' } });
    assert.ok(r, `${tool_name} passou`);
    assert.match(r, /quem isenta e quem revisa/);
  }
});

test('barra escrita via shell, inclusive redirecionamento', () => {
  for (const command of [
    'rm .sdd/gates-ignore.json',
    'sed -i "s/x/y/" .sdd/gates-ignore.json',
    'echo "{}" > .sdd/gates-ignore.json',
    'cp /tmp/outro.json .sdd/gates-ignore.json',
  ]) {
    assert.ok(decidir({ tool_name: 'Bash', tool_input: { command } }), `passou: ${command}`);
  }
});

test('LER a lista de isencoes e livre', () => {
  // O v5 registrou QUATRO ocorrencias da mesma classe: a defesa impedindo a verificacao que
  // ela propria exige. Bloqueio sem justificativa e o que ensina alguem a procurar contorno.
  for (const command of [
    'cat .sdd/gates-ignore.json',
    'grep -n secrets .sdd/gates-ignore.json',
    'git diff .sdd/gates-ignore.json',
    'sdd-gates .',
  ]) {
    assert.equal(decidir({ tool_name: 'Bash', tool_input: { command } }), null, `barrou: ${command}`);
  }
});

test('nao barra o resto do projeto', () => {
  assert.equal(decidir({ tool_name: 'Edit', tool_input: { file_path: 'src/app.ts' } }), null);
  assert.equal(decidir({ tool_name: 'Edit', tool_input: { file_path: '.sdd/coverage-min' } }), null);
  assert.equal(decidir({ tool_name: 'Bash', tool_input: { command: 'rm dist/bundle.js' } }), null);
  assert.equal(decidir({ tool_name: 'Read', tool_input: { file_path: '.sdd/gates-ignore.json' } }), null);
});

test('evento sem forma conhecida nao barra nem estoura', () => {
  assert.equal(decidir(undefined), null);
  assert.equal(decidir({}), null);
  assert.equal(decidir({ tool_name: 'Bash' }), null);
});
