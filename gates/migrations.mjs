// Gate `migrations` — todo UP tem DOWN real, na forma do dialeto da stack.
//
// O gate com mais defeitos medidos no v5 (cinco, dois deles falso verde). O desenho aqui e
// governado por tres decisoes que custaram caro la:
//
//   1. O dialeto e DETECTADO, nunca assumido. Codificar a convencao de um fornecedor como se
//      fosse a regra fazia o gate imprimir "nenhuma migration encontrada" e PASSAR em toda
//      stack diferente dela.
//   2. Um gate que nao sabe o que esta olhando nunca diz `ok`. Ha tres estados, nao dois:
//      `ok`, `falha` e `pulado` — e `pulado` sempre carrega o motivo.
//   3. "Nao ha down" e "o down esta vazio" sao achados DIFERENTES, com mensagens diferentes.
//      Confundi-los reprovava todo projeto drizzle com o diagnostico errado.

import { readFile, readdir } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';

import { compilarIsencoes } from './lib/isencoes.mjs';

const DRIVERS = [
  'pg', 'postgres', 'postgresql', 'mysql', 'mysql2', 'mariadb', 'sqlite3', 'better-sqlite3',
  'mongodb', 'mongoose', 'psycopg2', 'psycopg2-binary', 'asyncpg', 'sqlalchemy', 'pymongo',
  '@prisma/client', 'drizzle-orm', 'knex', 'sequelize', 'typeorm', '@supabase/supabase-js',
];

// ------------------------------------------------------------------ corpo de funcao

const VAZIO_APOS_LIMPEZA = /^\s*$/;

/**
 * A funcao `nome` tem corpo?
 *
 *   true  — declarada e vazia (ou so comentario / `pass`)
 *   false — declarada e com corpo real
 *   null  — NAO declarada
 *
 * O terceiro valor existe porque ausencia e vacuidade sao achados distintos (item 199).
 */
export function corpoVazio(texto, nome) {
  if (new RegExp(`^\\s*def\\s+${nome}\\s*\\(`, 'm').test(texto)) {
    return corpoVazioPython(texto, nome);
  }
  return corpoVazioJs(texto, nome);
}

function corpoVazioJs(texto, nome) {
  const re = new RegExp(`\\b${nome}\\b`, 'g');
  let m;

  while ((m = re.exec(texto)) !== null) {
    const depois = texto.slice(m.index + nome.length);
    // Precisa PARECER definicao de funcao: `down(`, `down =`, `down:`. Sem isso, uma
    // mencao em prosa ou em string viraria analise.
    if (!/^\s*[(=:]/.test(depois)) continue;

    // O corte comeca no token `nome` — e este e o item 200 inteiro. O v5 procurava a
    // primeira `{` da LINHA, que num arquivo de uma linha e a do objeto externo: o corpo
    // do `up` contava como corpo do `down`, e o stub vazio passava como rollback pronto.
    const abre = depois.indexOf('{');
    if (abre === -1 || abre > 200) continue;

    const corpo = corpoEntreChaves(depois.slice(abre));
    if (corpo === null) continue;

    return VAZIO_APOS_LIMPEZA.test(semComentarios(corpo));
  }

  return null;
}

function corpoVazioPython(texto, nome) {
  const linhas = texto.split(/\r?\n/);
  const iDef = linhas.findIndex((l) => new RegExp(`^\\s*def\\s+${nome}\\s*\\(`).test(l));
  if (iDef === -1) return null;

  const recuoDef = linhas[iDef].match(/^\s*/)[0].length;
  const corpo = [];

  for (let i = iDef + 1; i < linhas.length; i++) {
    const linha = linhas[i];
    if (VAZIO_APOS_LIMPEZA.test(linha)) continue;
    if (linha.match(/^\s*/)[0].length <= recuoDef) break;
    corpo.push(linha.trim());
  }

  const util = corpo.filter((l) => !l.startsWith('#') && l !== 'pass' && !/^["']{3}/.test(l));
  return util.length === 0;
}

/** Conteudo entre a primeira `{` e a `}` que a fecha. */
function corpoEntreChaves(texto) {
  if (texto[0] !== '{') return null;
  let nivel = 0;
  for (let i = 0; i < texto.length; i++) {
    if (texto[i] === '{') nivel++;
    else if (texto[i] === '}') {
      nivel--;
      if (nivel === 0) return texto.slice(1, i);
    }
  }
  return null;
}

function semComentarios(texto) {
  return texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// ------------------------------------------------------------------ deteccao

const INDICIOS = [
  ['prisma', (c) => /(^|\/)schema\.prisma$/.test(c)],
  ['alembic', (c) => /(^|\/)alembic\.ini$/.test(c) || /(^|\/)alembic\/versions\//.test(c)],
  ['mongo', (c) => /(^|\/)migrate-mongo-config\.(js|cjs|mjs|ts|json)$/.test(c)],
  ['drizzle', (c) => /(^|\/)drizzle\.config\.(js|ts|mjs|cjs)$/.test(c)],
  ['jsmig', (c) => /(^|\/)(knexfile|\.node-pg-migraterc)/.test(c)],
  ['pair', (c) => /(^|\/)supabase\/migrations\//.test(c)],
];

export function detectar({ arquivos = [], manifesto = {}, valvula = null } = {}) {
  if (valvula) {
    return { dialeto: valvula, motivo: `declarado na valvula de escape: "${valvula}"` };
  }

  const caminhos = arquivos.map((a) => a.caminho);

  for (const [dialeto, casa] of INDICIOS) {
    if (caminhos.some(casa)) {
      return { dialeto, motivo: `indicio de ${dialeto} encontrado na arvore` };
    }
  }

  // A partir daqui nao ha dialeto reconhecido. As duas saidas seguintes sao OPOSTAS, e
  // separa-las e o coracao do anti-silencio deste gate.
  const deps = Object.keys({ ...manifesto.dependencies, ...manifesto.devDependencies });
  const temBanco =
    deps.some((d) => DRIVERS.includes(d)) ||
    caminhos.some((c) => /(^|\/)migrations?\//.test(c));

  if (temBanco) {
    return {
      dialeto: 'desconhecido',
      motivo:
        'ha indicio de banco de dados e nenhum layout de migration reconhecido. ' +
        'Declare o dialeto na valvula de escape (migrations-layout) — um gate que nao sabe ' +
        'o que esta olhando nao pode aprovar.',
    };
  }

  return { dialeto: 'sem-banco', motivo: 'nenhum indicio de banco de dados no projeto' };
}

// ------------------------------------------------------------------ analise

const SQL = /\.sql$/i;
const JS = /\.(js|cjs|mjs|ts)$/i;
const PY = /\.py$/i;

const raiz = (c) => basename(c).replace(/\.(down\.)?sql$/i, '');

export function analisar({ dialeto, arquivos = [] } = {}) {
  const pular = (aviso) => ({ estado: 'pulado', achados: [], aviso });

  if (dialeto === 'none') {
    return pular('gate desligado por declaracao explicita na valvula de escape');
  }
  if (dialeto === 'sem-banco') {
    return pular('projeto sem indicio de banco de dados — nao ha migration para conferir');
  }
  if (dialeto === 'desconhecido') {
    return {
      estado: 'falha',
      achados: [{ arquivo: null, motivo: 'dialeto de migration nao reconhecido' }],
      aviso: null,
    };
  }

  const ups = migrationsDoDialeto(dialeto, arquivos);

  // Item 254. Diretorio do dialeto vazio NAO e "conferi e esta certo". O v5 imprimia
  // "0 migration(s) com DOWN pareado" — o ✅ mais facil de acreditar do conjunto, dado por
  // nao ter olhado nada, e no dialeto default da propria stack de referencia.
  if (ups.length === 0) {
    return pular(`dialeto "${dialeto}" detectado, mas nenhuma migration encontrada — nada foi conferido`);
  }

  const achados = [];
  for (const up of ups) {
    const problema = conferir(dialeto, up, arquivos);
    if (problema) achados.push({ arquivo: up.caminho, motivo: problema });
  }

  return { estado: achados.length ? 'falha' : 'ok', achados, aviso: null };
}

function migrationsDoDialeto(dialeto, arquivos) {
  switch (dialeto) {
    case 'pair':
      return arquivos.filter((a) => /supabase\/migrations\//.test(a.caminho) && SQL.test(a.caminho));
    case 'prisma':
      return arquivos.filter((a) => /migration\.sql$/i.test(a.caminho));
    case 'drizzle':
      return arquivos.filter((a) => SQL.test(a.caminho) && !/\.down\.sql$/i.test(a.caminho));
    case 'alembic':
      return arquivos.filter((a) => PY.test(a.caminho) && /versions\//.test(a.caminho));
    case 'mongo':
    case 'jsmig':
      return arquivos.filter((a) => JS.test(a.caminho) && /(^|\/)migrations?\//.test(a.caminho));
    default:
      return [];
  }
}

function conferir(dialeto, up, arquivos) {
  const existe = (teste) => arquivos.some((a) => teste(a.caminho));

  switch (dialeto) {
    case 'pair': {
      const stem = raiz(up.caminho);
      const achou = existe(
        (c) => c !== up.caminho && !/supabase\//.test(c) && SQL.test(c) && raiz(c) === stem,
      );
      return achou ? null : 'UP sem rollback pareado — nao ha DOWN correspondente';
    }
    case 'prisma': {
      const irmao = join(dirname(up.caminho), 'down.sql').replace(/\\/g, '/');
      return existe((c) => c === irmao) ? null : 'nao ha down.sql ao lado do migration.sql';
    }
    case 'drizzle': {
      const irmao = up.caminho.replace(/\.sql$/i, '.down.sql');
      // A mensagem diz AUSENCIA, nunca "vazio" (item 199): drizzle emite SQL puro e nao
      // gera down — procurar uma funcao down() dentro de um .sql nunca acha, e o v5
      // reprovava todo projeto drizzle com o diagnostico trocado.
      return existe((c) => c === irmao) ? null : 'nao ha o irmao .down.sql — rollback ausente';
    }
    case 'alembic': {
      const r = corpoVazio(up.conteudo, 'downgrade');
      if (r === null) return 'funcao downgrade() ausente';
      return r ? 'downgrade() declarado e vazio — stub nao e rollback' : null;
    }
    case 'mongo':
    case 'jsmig': {
      const r = corpoVazio(up.conteudo, 'down');
      if (r === null) return 'funcao down() ausente';
      return r ? 'down() declarado e vazio — stub nao e rollback' : null;
    }
    default:
      return 'dialeto sem regra de conferencia';
  }
}

// ------------------------------------------------------------------ varredura

const IGNORAR_DIR = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage']);

export async function rodar(raizProjeto, opcoes = {}) {
  // A valvula vem do runner, que e o dono da leitura de `.sdd/`. Gate nao le valvula do
  // disco: duas fontes para o mesmo fato e como a divergencia comeca (I-01).
  const valvula = opcoes.valvula ?? null;

  // O isento sai do CORPUS, antes de `detectar()` e de `analisar()`. Aqui isso importa mais
  // do que em qualquer outro gate: o par UP/DOWN e conferido por PRESENCA DE IRMAO na arvore,
  // entao filtrar achado a achado deixaria o arquivo isentado ainda valendo como DOWN de
  // outra migration — a isencao mudaria a resposta de uma pergunta que ninguem fez.
  const isencao = compilarIsencoes(opcoes.isencoes ?? [], 'migrations');
  const arquivos = [];
  for await (const rel of caminhar(raizProjeto)) {
    if (isencao.isento(rel)) continue;
    const conteudo = await readFile(join(raizProjeto, rel), 'utf8').catch(() => '');
    arquivos.push({ caminho: rel, conteudo });
  }

  const manifesto = JSON.parse(
    await readFile(join(raizProjeto, 'package.json'), 'utf8').catch(() => '{}'),
  );

  const { dialeto, motivo } = detectar({ arquivos, manifesto, valvula });
  return { ...analisar({ dialeto, arquivos }), dialeto, motivo, isentos: isencao.aplicadas() };
}

async function* caminhar(raizProjeto, prefixo = '') {
  const entradas = await readdir(join(raizProjeto, prefixo), { withFileTypes: true }).catch(() => []);
  for (const e of entradas) {
    const rel = prefixo ? `${prefixo}/${e.name}` : e.name;
    if (IGNORAR_DIR.has(e.name)) continue;
    if (e.isDirectory()) yield* caminhar(raizProjeto, rel);
    else if (SQL.test(e.name) || JS.test(e.name) || PY.test(e.name) || /\.(ini|json|prisma)$/i.test(e.name)) {
      yield rel;
    }
  }
}
