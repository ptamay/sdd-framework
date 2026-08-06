// Harness de mutacao — executor do invariante M-19.
//
//   npm run mutar
//
// Para cada entrada de `mutacoes.json`, reintroduz um defeito historico no gate e roda a
// suite daquele gate. A saida diz QUAIS casos cairam.
//
// O criterio de sucesso e invertido em relacao a uma suite normal: aqui, mutacao que NAO
// derruba nenhum caso e o problema. Ela significa que a suite passaria por cima de um
// defeito que ja custou caro uma vez — e o v5 nomeou essa classe tres vezes ("teste que
// passa pelo motivo errado e pior que teste ausente") sem nunca ter tido como medi-la.
//
// ---------------------------------------------------------------------------
// A ARVORE DE TRABALHO NUNCA E TOCADA — e isto e conserto, nao precaucao.
//
// A primeira versao mutava o arquivo real e restaurava num `finally`. Custou um gate: um
// `| head -22` fechou o pipe, o processo morreu com EPIPE no meio da mutacao, e o
// `finally` nao terminou. O arquivo ficou com ZERO BYTES — porque a propria restauracao e
// nao-atomica: `writeFile` trunca e so depois escreve.
//
// Nenhum `finally` conserta isso, porque a falha esta em ter escrito no original. A
// mutacao acontece numa COPIA descartavel, e o pior caso de um kill vira lixo no diretorio
// temporario do sistema.
// ---------------------------------------------------------------------------

import { readFile, writeFile, cp, rm, mkdtemp } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const { mutacoes } = JSON.parse(await readFile(join(RAIZ, 'test', 'mutacoes.json'), 'utf8'));

const banco = await mkdtemp(join(tmpdir(), 'sdd-mutacao-'));
let furos = 0;
let naoAplicadas = 0;

try {
  // `agents` e `skills` entram porque defeito historico tambem mora em metadata: o
  // frontmatter que nao parseia derruba `tools` e `model`, e isso ja aconteceu duas vezes
  // por causas diferentes.
  //
  // `bin` entra por outra razao, e ela e do harness: a suite de rotas executa `sdd-rota` a
  // partir da raiz. Sem o binario no banco, TODA mutacao nessa suite derrubaria aqueles
  // casos por ENOENT — e um caido por motivo errado conta como mutacao pega, escondendo o
  // furo que o harness existe para achar.
  for (const dir of ['gates', 'policy', 'test', 'agents', 'skills', 'bin', 'hooks']) {
    await cp(join(RAIZ, dir), join(banco, dir), { recursive: true });
  }
  await cp(join(RAIZ, 'package.json'), join(banco, 'package.json'));

  for (const m of mutacoes) {
    // Duas formas de alvo:
    //
    //   `gate`    caminho dentro de gates/ (ex.: "lib/isencoes"), suite deduzida do nome.
    //             Modulo compartilhado tambem carrega defeito historico — e o de isencoes
    //             carrega o mais perigoso de todos: a lista do que os gates deixam de olhar.
    //   `arquivo` caminho a partir da raiz, com `suite` declarada. Existe porque nem todo
    //             defeito historico esta em codigo de gate: o frontmatter de um agente
    //             derrubou `tools` e `model` sem quebrar uma linha de logica.
    const alvo = m.arquivo ?? `gates/${m.gate}.mjs`;
    const suiteId = m.suite ?? m.gate.split('/').pop();

    const original = await readFile(join(RAIZ, alvo), 'utf8');
    const mutado = original.replace(m.de, m.para);

    console.log(`\n▶ ${m.gate ?? m.arquivo} · ${m.nome}`);
    console.log(`  origem: ${m.origem}`);

    if (mutado === original) {
      // O trecho a mutar sumiu: o codigo mudou e o catalogo nao acompanhou. Nao e sucesso —
      // e uma mutacao que deixou de medir o que dizia medir.
      console.log('  ⚠ TRECHO NAO ENCONTRADO — o catalogo de mutacoes esta desatualizado');
      naoAplicadas++;
      continue;
    }

    await writeFile(join(banco, alvo), mutado);
    const caidos = await rodarSuite(join(banco, 'test', 'cases', `${suiteId}.test.mjs`), banco);
    await writeFile(join(banco, alvo), original);

    if (caidos.length === 0) {
      console.log('  ✖ FURO — nenhum caso caiu com o defeito reintroduzido');
      furos++;
    } else {
      for (const c of caidos) console.log(`  ✔ caiu: ${c}`);
    }
  }
} finally {
  await rm(banco, { recursive: true, force: true }).catch(() => {});
}

console.log('\n' + '-'.repeat(70));
console.log(`mutacoes: ${mutacoes.length} · furos: ${furos} · nao aplicadas: ${naoAplicadas}`);

if (furos || naoAplicadas) {
  console.log('\nFuro = a suite nao pega um defeito que ja custou caro uma vez.');
  console.log('Nao aplicada = o codigo mudou e o catalogo de mutacoes ficou para tras.');
  process.exit(1);
}

console.log('toda mutacao derrubou ao menos um caso.');

async function rodarSuite(suite, banco) {
  let saida = '';
  try {
    // CLAUDE_PLUGIN_ROOT e fixado no banco de proposito. `raizDoRepo()` prefere a variavel
    // quando ela existe — e ela EXISTE quando `npm run mutar` roda de dentro de uma sessao
    // do Claude Code. Sem isto, o caso leria o arquivo REAL em vez da copia mutada, a
    // mutacao nao derrubaria nada, e o furo reportado seria do harness, nao da suite.
    const env = { ...process.env, CLAUDE_PLUGIN_ROOT: banco };
    const { stdout } = await exec('node', ['--test', suite], {
      env,
      maxBuffer: 16 * 1024 * 1024,
    });
    saida = stdout;
  } catch (erro) {
    saida = erro.stdout ?? '';
  }
  // `node --test` imprime cada falha DUAS vezes: inline e no resumo final. Sem o Set a
  // contagem sai dobrada — familia M-12, cometida dentro do arquivo que a persegue.
  return [...new Set([...saida.matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]))];
}
