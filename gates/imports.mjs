// Gate `imports` — todo import de pacote tem dependencia declarada.
//
// O gate anti-alucinacao. Importar um pacote que nao existe e o defeito mais frequente de
// codigo gerado por IA, e ele nao quebra type-check quando o pacote e so um nome.
//
// O v5 errou este gate nos DOIS sentidos ao mesmo tempo (item 208), e as duas correcoes sao
// o desenho deste arquivo:
//
//   1. Varredura por lista de EXCLUSAO a partir da raiz, nunca de inclusao. Uma lista de
//      inclusao decide de antemao onde o codigo mora, e erra: `pages/`, `server/`, `api/`,
//      `routes/`, `middleware/`, a raiz e o monorepo eram todos cegos. O desconhecido tem de
//      ser varrido, nao ignorado.
//   2. A lista de builtins vem de `module.builtinModules` — a implementacao contando a
//      verdade sobre si (M-06). Escrita a mao, ela tinha 15 de ~40 nomes, e `net`, `assert`,
//      `worker_threads`, `tls` e `dns` viravam acusacao de alucinacao.

import { readFile, readdir } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { join } from 'node:path';

import { compilarIsencoes } from './lib/isencoes.mjs';

const BUILTINS = new Set(builtinModules);

const JS = /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/i;
const PY = /\.py$/i;

// Exclusao, nunca inclusao. Cada nome aqui e um diretorio que NAO e fonte do projeto.
const DIR_EXCLUIDOS = new Set([
  'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.turbo',
  'coverage', 'vendor', '.git', '.venv', 'venv', '__pycache__', '.cache',
]);

export function deveVarrer(caminho) {
  const partes = caminho.split(/[\\/]/);
  if (partes.some((p) => DIR_EXCLUIDOS.has(p))) return false;
  return JS.test(caminho);
}

/** 'lodash/merge' -> 'lodash' · '@scope/ui/botao' -> '@scope/ui' */
export function pacoteBase(especificador) {
  const partes = especificador.split('/');
  return especificador.startsWith('@') ? partes.slice(0, 2).join('/') : partes[0];
}

const PADROES = [
  /\bimport\s+(?:type\s+)?[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/,
  /\bimport\s*['"]([^'"]+)['"]/,
  /\bexport\s+[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/,
];

export function extrairImports(caminho, texto) {
  const achados = [];

  texto.split(/\r?\n/).forEach((linha, i) => {
    // Comentario de linha inteira nao e codigo. Nao vale a pena ir alem disso: um parser
    // de verdade custa uma dependencia, e este gate nao tem nenhuma.
    if (/^\s*(\/\/|\*|\/\*)/.test(linha)) return;

    for (const padrao of PADROES) {
      const m = linha.match(padrao);
      if (m) {
        achados.push({ arquivo: caminho, linha: i + 1, especificador: m[1] });
        break;
      }
    }
  });

  return achados;
}

/** Especificador que nao aponta para pacote publicado. */
function ehLocal(especificador) {
  return (
    // Especificador com interpolacao nao e resolvivel estaticamente: o nome do pacote so
    // existe em tempo de execucao. Acusar `${nome}` de alucinacao e reprovar quem esta
    // certo (M-02). Apareceu na primeira execucao real, contra os proprios casos deste
    // gate, que montam especificadores em laco.
    especificador.includes('${') ||
    especificador.startsWith('.') ||        // relativo
    especificador.startsWith('/') ||        // absoluto
    especificador.startsWith('#') ||        // subpath imports do package.json
    especificador.startsWith('@/') ||       // alias de tsconfig/bundler
    especificador.startsWith('~') ||        // alias de bundler
    especificador.startsWith('node:') ||    // builtin explicito
    BUILTINS.has(pacoteBase(especificador))
  );
}

export function analisar({ arquivos = [], manifesto = null } = {}) {
  const pular = (aviso) => ({ estado: 'pulado', achados: [], aviso });

  const varridos = arquivos.filter((a) => deveVarrer(a.caminho));

  if (varridos.length === 0) {
    // Lacuna DECLARADA, nunca omitida (M-17). E o ponto exato onde o v5 dizia
    // "todos os imports tem pacote declarado" sem ter aberto um arquivo.
    const temPython = arquivos.some((a) => PY.test(a.caminho));
    return pular(
      temPython
        ? 'ha fonte Python e este gate ainda nao cobre esse ecossistema — nada foi conferido'
        : 'nenhum arquivo de fonte JavaScript/TypeScript encontrado — nada foi conferido',
    );
  }

  if (!manifesto || typeof manifesto !== 'object') {
    // Itens 186 e 211. Manifesto ilegivel devolvia lista vazia, indistinguivel de "nada
    // faltando" — e o gate afirmava ter conferido. Aqui isso e um estado proprio.
    return {
      estado: 'erro',
      achados: [],
      aviso: 'manifesto de dependencias ausente ou ilegivel — os imports NAO foram conferidos',
    };
  }

  const declarados = new Set(
    Object.keys({
      ...manifesto.dependencies,
      ...manifesto.devDependencies,
      ...manifesto.peerDependencies,
      ...manifesto.optionalDependencies,
    }),
  );

  const achados = [];
  for (const a of varridos) {
    for (const imp of extrairImports(a.caminho, a.conteudo)) {
      if (ehLocal(imp.especificador)) continue;
      if (declarados.has(pacoteBase(imp.especificador))) continue;
      achados.push({
        ...imp,
        motivo: `"${imp.especificador}" importado e nao declarado no manifesto`,
      });
    }
  }

  return { estado: achados.length ? 'falha' : 'ok', achados, aviso: null };
}

// ------------------------------------------------------------------ varredura

export async function rodar(raizProjeto, opcoes = {}) {
  const isencao = compilarIsencoes(opcoes.isencoes ?? [], 'imports');
  const arquivos = [];
  for await (const rel of caminhar(raizProjeto)) {
    if (isencao.isento(rel)) continue;
    const conteudo = await readFile(join(raizProjeto, rel), 'utf8').catch(() => '');
    arquivos.push({ caminho: rel, conteudo });
  }

  let manifesto = null;
  try {
    manifesto = JSON.parse(await readFile(join(raizProjeto, 'package.json'), 'utf8'));
  } catch {
    manifesto = null; // tratado como estado `erro` em analisar(), nunca como "nada faltando"
  }

  return { ...analisar({ arquivos, manifesto }), isentos: isencao.aplicadas() };
}

async function* caminhar(raizProjeto, prefixo = '') {
  const entradas = await readdir(join(raizProjeto, prefixo), { withFileTypes: true }).catch(() => []);
  for (const e of entradas) {
    if (DIR_EXCLUIDOS.has(e.name)) continue;
    const rel = prefixo ? `${prefixo}/${e.name}` : e.name;
    if (e.isDirectory()) yield* caminhar(raizProjeto, rel);
    else if (JS.test(e.name) || PY.test(e.name)) yield rel;
  }
}
