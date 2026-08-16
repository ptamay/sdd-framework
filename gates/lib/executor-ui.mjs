// Deteccao do executor de craft de UI — a resposta que a rota de design precisa e nao tinha.
//
// `skills/design/SKILL.md` manda, em titulo: "O executor e EXTERNO — detecte, nao presuma".
// Ate este modulo existir, o framework nao entregava deteccao nenhuma: a resposta vinha de o
// agente ler o catalogo de plugins A MAO e ESCREVER o resultado em prosa no artefato.
//
// O que isso custou, medido (achado A7): um projeto fechou a rota em 2026-08-15 afirmando
// "o plugin nao esta habilitado", o plugin foi habilitado em 2026-08-16T07:24:15Z, e o
// artefato continuou afirmando o contrario. Menos de 24 horas entre o fato escrito e o fato
// falso, num arquivo que o proprio framework obriga a existir — e nada percebeu, porque um
// fato que muda sozinho tinha sido congelado em prosa.
//
// TRES ESTADOS, NAO DOIS, e essa e a decisao central deste arquivo. "Nao consegui ver" NAO e
// "nao esta la":
//
//   presente        instalado E habilitado. E ele quem constroi as telas.
//   ausente         com o motivo — nao instalado, ou instalado e nao habilitado. Sao
//                   consertos diferentes, e colapsar os dois manda instalar o que ja esta.
//   indeterminado   o catalogo nao pode ser lido ou nao tem a forma esperada.
//
// Sem o terceiro estado, um catalogo ilegivel viraria `ausente` e a rota construiria a mao
// numa maquina onde o craft esta instalado — falha silenciosa, que e a categoria que esta
// rota manda listar PRIMEIRO. E a mesma licao do achado A4: `pulado` que nao distingue
// "nao havia o que conferir" de "nao consegui conferir" le como aprovacao.
//
// NAO declaramos dependencia dura do executor, e este modulo e o que torna isso viavel:
// dependencia que nao resolve faz o `enable` do plugin FALHAR, e ai nao e a UI que para, e
// o framework inteiro. Deteccao em tempo de execucao governa os dois mundos.

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** O executor preferido. Um nome, num lugar so (I-01). */
export const EXECUTOR = {
  nome: 'impeccable',
  chave: 'impeccable@impeccable',
  repo: 'pbakaus/impeccable',
  comando: '/plugin marketplace add pbakaus/impeccable',
};

/**
 * A decisao, pura — recebe o que foi lido, devolve o estado.
 *
 * `instalados`  o catalogo de plugins instalados do harness, ja desserializado.
 * `habilitados` a lista de mapas `enabledPlugins`, um por settings.json consultado.
 *               Projeto e usuario sao duas casas legitimas, e basta UMA habilitar.
 */
export function detectar({ instalados, habilitados = [] } = {}) {
  if (!instalados || typeof instalados !== 'object' || typeof instalados.plugins !== 'object' || instalados.plugins === null) {
    return {
      estado: 'indeterminado',
      motivo:
        'o catalogo de plugins instalados nao pode ser lido ou nao tem a forma esperada — ' +
        'isto NAO significa que o executor esta ausente',
      comando: EXECUTOR.comando,
    };
  }

  const entrada = instalados.plugins[EXECUTOR.chave];
  const instalacoes = Array.isArray(entrada) ? entrada : entrada ? [entrada] : [];

  if (instalacoes.length === 0) {
    return {
      estado: 'ausente',
      motivo: `${EXECUTOR.nome} nao esta instalado`,
      comando: EXECUTOR.comando,
    };
  }

  // Presenca do valor `true`, nao "chave existe": `{"impeccable@impeccable": false}` e uma
  // decisao de desligar, e le-la como habilitado inverteria o que o usuario escreveu.
  const ligado = habilitados.some((mapa) => mapa && mapa[EXECUTOR.chave] === true);

  if (!ligado) {
    return {
      estado: 'ausente',
      motivo:
        `${EXECUTOR.nome} esta instalado e NAO habilitado — ` +
        'acrescente `"enabledPlugins": {"' + EXECUTOR.chave + '": true}` ao settings.json do projeto',
      versao: instalacoes[0]?.version ?? null,
      comando: null,
    };
  }

  return {
    estado: 'presente',
    versao: instalacoes[0]?.version ?? null,
    motivo: null,
    comando: null,
  };
}

// ------------------------------------------------------------------ leitura do ambiente

const lerJson = async (caminho) => {
  const bruto = await readFile(caminho, 'utf8').catch(() => null);
  if (bruto === null) return undefined;
  try {
    return JSON.parse(bruto);
  } catch {
    // Arquivo presente e ilegivel nao vira "ausente". Quem o escreveu queria dizer alguma
    // coisa, e engoli-lo aqui reproduz exatamente o silencio que este modulo existe para
    // acabar. `null` distingue "existe e nao consegui ler" de `undefined`, "nao existe".
    return null;
  }
};

/**
 * Le o ambiente real e responde.
 *
 * `raizProjeto` entra porque o settings.json do PROJETO e a casa mais provavel do
 * `enabledPlugins` — foi onde o projeto de origem o habilitou.
 */
export async function detectarNoAmbiente(raizProjeto = process.cwd()) {
  const casa = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');

  const instalados = await lerJson(join(casa, 'plugins', 'installed_plugins.json'));

  const settings = await Promise.all([
    lerJson(join(raizProjeto, '.claude', 'settings.json')),
    lerJson(join(raizProjeto, '.claude', 'settings.local.json')),
    lerJson(join(casa, 'settings.json')),
  ]);

  // Um settings.json ilegivel poderia esconder a habilitacao. Dizer `ausente` ali seria
  // afirmar o que nao se sabe.
  if (settings.some((s) => s === null)) {
    return {
      estado: 'indeterminado',
      motivo: 'ha settings.json presente e ilegivel — a habilitacao do executor nao pode ser afirmada',
      comando: EXECUTOR.comando,
    };
  }

  return detectar({
    instalados: instalados === undefined ? { version: 0, plugins: {} } : instalados,
    habilitados: settings.filter(Boolean).map((s) => s.enabledPlugins ?? {}),
  });
}

/** Uma linha, para a saida da rota. */
export function linhaDeEstado(r) {
  if (r.estado === 'presente') {
    return `**Executor de craft:** presente — \`${EXECUTOR.nome}${r.versao ? `@${r.versao}` : ''}\`. ` +
      'Presente, ele NAO e opcional: e ele quem constroi as telas, e a secao `## Limites da lei` ' +
      'do artefato de design e o brief que ele le ANTES de desenhar.';
  }
  if (r.estado === 'indeterminado') {
    return `**Executor de craft:** INDETERMINADO — ${r.motivo}. ` +
      'Nao presuma nenhum dos dois mundos: resolva a leitura, ou diga na entrega que nao foi possivel saber.';
  }
  return `**Executor de craft:** ausente — ${r.motivo}. ` +
    (r.comando ? `Instale com \`${r.comando}\` ou ` : '') +
    'siga o fluxo desta rota a mao: o que se perde e craft, nunca governanca.';
}
