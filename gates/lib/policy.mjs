// Leitor do catalogo de politicas.
//
// Todo consumidor do framework -- runner de gates, skills, gerador de documentacao -- passa
// por aqui. Nada repete um fato que este modulo sabe ler (invariante I-01).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

/**
 * Raiz da instalacao do framework.
 *
 * Dentro do plugin o harness exporta CLAUDE_PLUGIN_ROOT. Fora dele (desenvolvimento, CI),
 * deriva do proprio modulo. Preferir a variavel importa porque o diretorio do plugin MUDA a
 * cada atualizacao.
 */
export function raizDoRepo() {
  if (process.env.CLAUDE_PLUGIN_ROOT) return resolve(process.env.CLAUDE_PLUGIN_ROOT);
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

let cache = null;

export async function carregarCatalogo() {
  if (cache) return cache;

  const caminho = join(raizDoRepo(), 'policy', 'gates.json');

  let bruto;
  try {
    bruto = await readFile(caminho, 'utf8');
  } catch (erro) {
    // Anti-silencio (M-01): catalogo ilegivel NUNCA vira "nenhum gate a rodar". O v5 pagou
    // duas vezes por status de saida confundido com resultado vazio (itens 186 e 211).
    throw new Error(`catalogo de gates ilegivel em ${caminho}: ${erro.message}`);
  }

  let catalogo;
  try {
    catalogo = JSON.parse(bruto);
  } catch (erro) {
    throw new Error(`catalogo de gates com JSON invalido: ${erro.message}`);
  }

  if (!Array.isArray(catalogo.gates)) {
    throw new Error('catalogo de gates sem a lista "gates"');
  }

  cache = catalogo;
  return catalogo;
}

let cacheMemoria = null;

/**
 * O contrato do Memory Bank, lido do catalogo — nunca reescrito por quem consome.
 *
 * Existe porque `hooks/contexto.mjs` mantinha a propria lista de arquivos em codigo, com
 * QUATRO nomes, enquanto `policy/memoria.json` declarava seis. O sintoma nao aparece na
 * saida: `overview.md` simplesmente nunca foi citado no contexto de sessao, e ausencia de
 * arquivo que nunca esteve la ninguem nota. Mesmo modo de errar que M-12 nomeia, na camada
 * de processo.
 */
export async function carregarMemoria() {
  if (cacheMemoria) return cacheMemoria;

  const caminho = join(raizDoRepo(), 'policy', 'memoria.json');

  let bruto;
  try {
    bruto = await readFile(caminho, 'utf8');
  } catch (erro) {
    // Mesma disciplina de `carregarCatalogo`: contrato ilegivel nao vira lista vazia. Lista
    // vazia aqui e indistinguivel de "o projeto nao tem memoria", que e o estado legitimo.
    throw new Error(`contrato de memoria ilegivel em ${caminho}: ${erro.message}`);
  }

  let contrato;
  try {
    contrato = JSON.parse(bruto);
  } catch (erro) {
    throw new Error(`contrato de memoria com JSON invalido: ${erro.message}`);
  }

  if (!Array.isArray(contrato.arquivos)) {
    throw new Error('contrato de memoria sem a lista "arquivos"');
  }

  cacheMemoria = contrato;
  return contrato;
}

export async function gatesAtivos() {
  const { gates } = await carregarCatalogo();
  return gates.filter((g) => g.status === 'ativo').sort((a, b) => a.numero - b.numero);
}

export async function gate(id) {
  const { gates } = await carregarCatalogo();
  const encontrado = gates.find((g) => g.id === id);
  if (!encontrado) throw new Error(`gate desconhecido: ${id}`);
  return encontrado;
}
