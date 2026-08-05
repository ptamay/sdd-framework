// Construtor de projeto derivado real — a bancada da prova de execucao.
//
// O v5 registrou tres vezes que "todo achado veio de operar, nenhum de ler", e a §3.30
// registrou uma decisao que vale copiar: o projeto de prova foi montado num caminho COM
// ESPACO, de proposito, porque tres bugs historicos daquele framework foram de
// word-splitting e o espaco e o cenario em que eles apareceram.
//
// Dois projetos, e o SEGUNDO e o que importa:
//   sao     tudo em ordem — prova que os gates nao reprovam quem esta certo (M-02)
//   doente  um defeito por gate — prova que os SETE de fato disparam ponta a ponta
//
// Sem o doente, um gate quebrado passaria por "pulou" para sempre.

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);

async function git(cwd, ...args) {
  await exec('git', args, { cwd });
}

async function escrever(raiz, caminho, conteudo) {
  const destino = join(raiz, caminho);
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, conteudo);
}

/** Cria a raiz num diretorio temporario cujo nome CONTEM ESPACO. */
async function novaRaiz(rotulo) {
  const base = await mkdtemp(join(tmpdir(), 'sdd-prova-'));
  const raiz = join(base, `meu projeto ${rotulo}`);
  await mkdir(raiz, { recursive: true });
  return raiz;
}

async function comum(raiz) {
  await escrever(raiz, 'package.json', JSON.stringify({
    name: 'projeto-de-prova',
    version: '1.0.0',
    dependencies: { zod: '^3.0.0' },
    devDependencies: { typescript: '^5.0.0' },
  }, null, 2));

  await escrever(raiz, 'tsconfig.json', JSON.stringify({ compilerOptions: { strict: true } }, null, 2));

  // `tsc` falso: exercita o caminho do gate sem instalar o TypeScript inteiro. Mesma
  // tecnica do `npx` contador que o v5 usou para provar o item 255.
  //
  // E um script NODE, que e como o TypeScript de verdade se instala — e por isso o gate
  // consegue invoca-lo com `process.execPath`, sem shell, sem PATHEXT e sem lancador de
  // pacote. Foi montando esta bancada que apareceu o achado da Fase E: `npx` era ENOENT em
  // Windows e `npx.cmd` era EINVAL, entao o gate nunca teria rodado naquele sistema.
  await escrever(
    raiz,
    'node_modules/typescript/bin/tsc',
    'process.exit(Number(process.env.TSC_EXIT ?? 0));\n',
  );

  await escrever(raiz, '.sdd/coverage-min', '80\n');
}

async function historico(raiz, commits) {
  await git(raiz, 'init', '-b', 'main');
  await git(raiz, 'config', 'user.email', 'prova@exemplo.test');
  await git(raiz, 'config', 'user.name', 'Prova');

  for (const [i, mensagem] of commits.entries()) {
    await escrever(raiz, `.historico/${i}`, `${i}\n`);
    await git(raiz, 'add', '-A');
    await git(raiz, 'commit', '-m', mensagem, '--no-verify');
  }
}

// --------------------------------------------------------------------- projeto sao

export async function montarSao() {
  const raiz = await novaRaiz('sao');
  await comum(raiz);

  await escrever(raiz, 'src/agenda.ts', [
    "import { z } from 'zod';",
    "import { readFile } from 'node:fs/promises';",
    '',
    'export const Horario = z.object({ inicio: z.string() });',
    'export async function carregar(caminho: string) {',
    '  return readFile(caminho, "utf8");',
    '}',
  ].join('\n'));

  await escrever(raiz, 'test/agenda.test.ts', "import { Horario } from '../src/agenda';\n");

  // Migrations no dialeto `pair`, com o par presente.
  await escrever(raiz, 'supabase/migrations/001_init.sql', 'create table agendamento();');
  await escrever(raiz, 'db/migrations/001_init.down.sql', 'drop table agendamento;');

  // Producao com os controles LIGADOS; desenvolvimento pode relaxar o que e relaxavel.
  await escrever(raiz, '.env.production', 'RATE_LIMIT_ENABLED=true\nVERIFY_SSL=true\n');
  await escrever(raiz, '.env.development', 'SKIP_2FA=true\n');

  await escrever(raiz, 'coverage/lcov.info', lcov([[60, 55], [40, 33]])); // 88%

  await historico(raiz, [
    'chore(TASK-000): fundacao do repositorio',
    'test(TASK-001): agenda recusa horario ocupado',
    'feat(TASK-001): agenda com validacao de conflito',
    'refactor(TASK-001): extrai regra de conflito',
  ]);

  return raiz;
}

// --------------------------------------------------------------------- projeto doente

export async function montarDoente() {
  const raiz = await novaRaiz('doente');
  await comum(raiz);

  // 1. secrets — credencial literal no fonte. Montada por concatenacao para nao plantar
  //    uma string com forma de credencial neste arquivo, que nao e fixture de secrets.
  const chaveFalsa = 'sk_' + 'live_' + '4eC39HqLyjWDarjtT1zdp7dc';
  // 3. imports — pacote que nao esta no manifesto.
  await escrever(raiz, 'src/pagamento.ts', [
    "import Stripe from 'stripe-que-ninguem-instalou';",
    '',
    `const apiKey = "${chaveFalsa}";`,
    'export const cliente = new Stripe(apiKey);',
  ].join('\n'));

  await escrever(raiz, 'test/pagamento.test.ts', "import { cliente } from '../src/pagamento';\n");

  // 2. migrations — UP sem o par DOWN.
  await escrever(raiz, 'supabase/migrations/001_init.sql', 'create table pagamento();');

  // 6. env-bypass — bypass num perfil de producao, e um do eixo que nao relaxa em lugar nenhum.
  await escrever(raiz, '.env.production', 'SKIP_2FA=true\nDISABLE_TENANT_ISOLATION=true\n');

  // 5. coverage — relatorio abaixo do minimo declarado.
  await escrever(raiz, 'coverage/lcov.info', lcov([[100, 41]])); // 41%

  // 7. typecheck — o verificador reprova. O `tsc` falso do projeto sao sai 0; aqui ele
  //    imita a saida real do TypeScript, com codigo 2 e a mensagem no stdout.
  await escrever(raiz, 'node_modules/typescript/bin/tsc', [
    "console.log(\"src/pagamento.ts(4,32): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.\");",
    'process.exit(2);',
  ].join('\n'));

  // 4. tdd-order — implementacao sem teste anterior.
  await historico(raiz, [
    'chore(TASK-000): fundacao do repositorio',
    'feat(TASK-001): pagamento sem teste antes',
  ]);

  return raiz;
}

export async function limpar(raiz) {
  await rm(join(raiz, '..'), { recursive: true, force: true }).catch(() => {});
}

function lcov(registros) {
  return registros
    .map(([lf, lh], i) => `SF:/src/a${i}.ts\nLF:${lf}\nLH:${lh}\nend_of_record`)
    .join('\n');
}
