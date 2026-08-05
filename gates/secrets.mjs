// Gate `secrets` — nenhum segredo literal no repositorio.
//
// Nucleo puro: `analisar(caminho, texto)` nao toca disco. E o que torna os casos rapidos e
// legiveis, e o que faltava no v5, onde toda verificacao exigia fixture em disco.
//
// Tres ramos independentes, cada um por um furo medido:
//   nome+valor       identificador sensivel com literal — case-insensitive (item 169) e com
//                    ramo proprio para portugues head-initial (item 209)
//   prefixo          formato de credencial reconhecivel — acusa em TODO lugar (item 281)
//   ambiente         valor SEM aspas em arquivo de ambiente — a forma que o ramo 1 nao ve,
//                    porque ele exige aspas e .env nao tem (item 209)
//   conexao          senha inline em URL — isenta arquivo de exemplo (item 281)

import { readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';

// Palavras que tornam um identificador sensivel. Comparadas contra o identificador PARTIDO
// em palavras (camelCase e snake_case), nunca contra a string crua: e o que separa `token`
// de `tokenizer` sem precisar de lista de excecao.
const SENSIVEIS = new Set([
  'secret', 'secrets', 'password', 'passwd', 'pwd', 'token', 'credential', 'apikey',
  'senha', 'segredo', 'segreda', 'credencial', 'secreta', 'secreto',
]);

// `key` sozinho e generico demais (sortKey, cacheKey, rowKey). So conta acompanhado.
const QUALIFICAM_KEY = new Set(['api', 'private', 'secret', 'access', 'auth', 'encryption']);

// Identificador que termina nestas palavras descreve o segredo, nao o contem.
const METADADO = new Set(['name', 'names', 'type', 'id', 'label', 'field', 'header', 'prefix', 'key_name']);

const PREFIXOS = [
  [/\bAKIA[0-9A-Z]{16}\b/, 'chave de acesso AWS'],
  [/\b[sr]k_(live|test)_[A-Za-z0-9]{16,}\b/, 'chave Stripe'],
  [/\bgh[pousr]_[A-Za-z0-9]{36}\b/, 'token GitHub'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/, 'token GitHub (fine-grained)'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/, 'token Slack'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'chave Google API'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'chave privada PEM'],
];

// JWT (eyJ...) fica DELIBERADAMENTE fora. E o padrao com pior relacao sinal/ruido do
// conjunto: fixture de teste e a chave publica anonima do Supabase sao JWTs, e este gate
// bloqueia. Reavaliar se aparecer caso real de vazamento por esse caminho. (item 169)

const PLACEHOLDERS = [
  /^$/, /^(changeme|change_me|todo|tbd|xxx+|placeholder|example|dummy|fake|test)$/i,
  /^(your|my|seu|sua)[-_]/i, /^<.*>$/, /^\$\{.*\}$/, /^\{\{.*\}\}$/,
  /^(password|senha|secret|api[-_]?key|user|usuario)$/i,
];

const EXT_AMBIENTE = /(^\.env($|\.)|\.(ini|properties|cfg|conf)$)/i;
const EH_EXEMPLO = /\.(example|sample|template|dist|local)$/i;

const VALOR_MINIMO = 8;

export function analisar(caminho, texto) {
  const nomeArquivo = basename(caminho);
  const ehAmbiente = EXT_AMBIENTE.test(nomeArquivo);
  const ehExemplo = EH_EXEMPLO.test(nomeArquivo);
  const achados = [];

  texto.split(/\r?\n/).forEach((linha, i) => {
    const registrar = (motivo, regra) =>
      achados.push({ arquivo: caminho, linha: i + 1, motivo, regra });

    // --- ramo `prefixo`: formato reconhecivel. Acusa em todo lugar, exemplo incluido.
    for (const [padrao, nome] of PREFIXOS) {
      if (padrao.test(linha)) {
        registrar(`${nome} literal no fonte`, 'prefixo');
        return;
      }
    }

    // --- ramo `conexao`: senha inline em URL. Placeholder e o real sao estruturalmente
    // identicos e nenhum prefixo os separa — por isso a isencao e por arquivo, nao por valor.
    const conexao = linha.match(/\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:([^\s:@/]+)@/i);
    if (conexao && !ehExemplo && !ehPlaceholder(conexao[1])) {
      registrar('senha embutida em connection string', 'conexao');
      return;
    }

    // --- ramo `ambiente`: CHAVE=valor sem aspas.
    if (ehAmbiente) {
      const m = linha.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*?)\s*$/);
      if (m && sensivel(m[1])) {
        const valor = m[2].replace(/^["']|["']$/g, '');
        if (!ehPlaceholder(valor) && valor.length >= VALOR_MINIMO) {
          registrar(`valor literal em "${m[1]}"`, 'ambiente');
        }
      }
      return;
    }

    // --- ramo `nome+valor`: identificador sensivel recebendo literal entre aspas.
    // Exige a forma de ATRIBUICAO com literal: e o que deixa passar `process.env.X`,
    // chamada de funcao, anotacao de tipo e comentario que so MENCIONA a variavel.
    const atrib = linha.match(
      /([A-Za-z_$][\w$]*)\s*[:=]\s*(["'`])((?:(?!\2)[^\\]|\\.)*)\2/,
    );
    if (atrib && sensivel(atrib[1])) {
      const valor = atrib[3];
      if (!ehPlaceholder(valor) && valor.length >= VALOR_MINIMO) {
        registrar(`valor literal em "${atrib[1]}"`, 'nome+valor');
      }
    }
  });

  return achados;
}

/** Parte camelCase e snake_case em palavras minusculas. */
function palavras(identificador) {
  return identificador
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function sensivel(identificador) {
  const p = palavras(identificador);
  if (p.length === 0) return false;
  if (METADADO.has(p[p.length - 1])) return false;

  for (let i = 0; i < p.length; i++) {
    if (SENSIVEIS.has(p[i])) return true;
    if (p[i] === 'key' && i > 0 && QUALIFICAM_KEY.has(p[i - 1])) return true;
  }
  return false;
}

function ehPlaceholder(valor) {
  const v = valor.trim();
  return PLACEHOLDERS.some((p) => p.test(v));
}

// --------------------------------------------------------------------------- varredura

const IGNORAR_DIR = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage', 'vendor']);
const VARRER = /\.(js|jsx|mjs|cjs|ts|tsx|py|rb|go|rs|java|php|json|ya?ml|toml|ini|properties|cfg|conf|sh|ps1|env)$/i;

/**
 * Roda o gate contra uma arvore de projeto.
 *
 * Lista de EXCLUSAO a partir da raiz, nunca de inclusao: o desconhecido tem de ser varrido,
 * nao ignorado (item 208 — `pages/` do Next.js era invisivel para o gate de imports).
 */
export async function rodar(raiz) {
  const achados = [];
  let varridos = 0;

  for await (const rel of arquivos(raiz)) {
    const texto = await readFile(join(raiz, rel), 'utf8').catch(() => null);
    if (texto === null) continue;
    varridos++;
    achados.push(...analisar(rel, texto));
  }

  // Anti-silencio: zero arquivo varrido nao e "nenhum segredo encontrado".
  if (varridos === 0) {
    return {
      estado: 'pulado',
      achados: [],
      aviso: 'nenhum arquivo varrivel encontrado — nada foi conferido',
    };
  }

  return { estado: achados.length ? 'falha' : 'ok', achados, aviso: null };
}

async function* arquivos(raiz, prefixo = '') {
  const entradas = await readdir(join(raiz, prefixo), { withFileTypes: true }).catch(() => []);
  for (const e of entradas) {
    const rel = prefixo ? `${prefixo}/${e.name}` : e.name;
    if (IGNORAR_DIR.has(e.name)) continue;
    if (e.isDirectory()) yield* arquivos(raiz, rel);
    else if (VARRER.test(e.name) || /^\.env($|\.)/i.test(e.name)) yield rel;
  }
}
