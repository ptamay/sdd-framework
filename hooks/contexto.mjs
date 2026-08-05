// Contexto de sessao — o substituto do `00-core.md` sempre-ativo do v5.
//
// DUAS diferencas em relacao ao v5, e as duas sao decisoes:
//
//   CONDICIONAL   so injeta quando o diretorio tem `.sdd/`. O v5 carregava as regras em
//                 toda sessao porque as regras moravam no projeto; aqui o plugin pode estar
//                 habilitado em projetos que nao usam o framework, e despejar processo em
//                 cima de quem nao pediu e o jeito mais rapido de alguem desabilitar tudo.
//
//   DERIVADO      o texto injetado e MONTADO a partir de `policy/`, nunca escrito a mao.
//                 Era assim que o v5 acumulava versoes divergentes da mesma lista: quatro
//                 copias da zona somente-leitura, todas diferentes, e a mais curta era a que
//                 o agente lia sempre. Aqui, se um gate entra no catalogo, ele aparece aqui.

import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';

import { gatesAtivos, carregarCatalogo } from '../gates/lib/policy.mjs';

const bruto = await lerStdin();
let evento = {};
try {
  evento = JSON.parse(bruto || '{}');
} catch {
  // Sem evento legivel, nao ha diretorio para inspecionar. Sair calado e o correto: injetar
  // processo em cima de um projeto que talvez nem use o framework e pior que nao injetar.
  process.exit(0);
}

const raiz = evento.cwd ?? process.cwd();

if (!(await existe(join(raiz, '.sdd')))) process.exit(0);

const ativos = await gatesAtivos();
const catalogo = await carregarCatalogo();
const candidatos = catalogo.gates.filter((g) => g.status === 'candidato');

const memoria = await lerMemoria(raiz);

const linhas = [
  '# Constitutional SDD — ativo neste projeto',
  '',
  'Este diretorio tem `.sdd/`, entao o framework governa o trabalho aqui.',
  '',
  '## Antes de gerar codigo',
  '',
  'Abra a resposta com UMA linha, e **cite de verdade** — nunca fabrique a citacao:',
  '',
  '`🔒 Task ativa: "<numero e titulo exatos do plan.md>" · restricao: "<1 frase textual da constitution.md>" · rota: <sprint|quick-fix|CR>`',
  '',
  'Quem RECEBE essa linha confere a citacao. Nao e desconfianca: ela e a prova de leitura do',
  'framework inteiro, e uma citacao fabricada ali produz a fraude que ela existe para impedir,',
  'com aparencia de conformidade exemplar. Ja aconteceu — um sub-agente citou um artigo que',
  'nao existia no arquivo.',
  '',
  '## Memoria do projeto',
  '',
  memoria.length
    ? memoria.map((m) => `- \`${m}\``).join('\n')
    : '- (vazia — rode a rota de escopo antes de qualquer codigo)',
  '',
  '## Gates que rodam aqui',
  '',
  ...ativos.map((g) => `${g.numero}. **${g.titulo}** — ${g.prova}`),
  '',
  `Rode com \`sdd-gates\` antes de qualquer merge ou push. Falha = pare e reporte; nao contorne.`,
  '',
  'Tres estados, nao dois: `ok`, `falha` e **`pulado`**. Um gate que pulou nao aprovou nada —',
  'e o relatorio diz quantos de fato verificaram.',
];

if (candidatos.length) {
  linhas.push(
    '',
    `Ainda NAO cobertos por gate (${candidatos.map((g) => g.id).join(', ')}) — o que eles`,
    'verificariam continua sendo responsabilidade de quem revisa.',
  );
}

console.log(linhas.join('\n'));

// ---------------------------------------------------------------------------

async function existe(caminho) {
  return access(caminho).then(() => true, () => false);
}

async function lerMemoria(raiz) {
  const nomes = ['constitution.md', 'spec.md', 'plan.md', 'tasks.md'];
  const achados = [];
  for (const n of nomes) {
    if (await existe(join(raiz, '.sdd', 'memory', n))) achados.push(`.sdd/memory/${n}`);
  }
  return achados;
}

async function lerStdin() {
  const partes = [];
  for await (const p of process.stdin) partes.push(p);
  return Buffer.concat(partes).toString('utf8');
}

export { readFile };
