// Gate `typecheck` — o verificador de tipos da stack sai limpo.
//
// Pega a API alucinada que o gate de imports nao pega: o pacote existe, o metodo nao.
//
// E o unico gate que invoca FERRAMENTA EXTERNA, e por isso o unico com estas duas regras:
//
//   UMA INVOCACAO      o processo roda uma vez e a saida e guardada. O v5 invocava DUAS
//     (item 255)       vezes quando falhava — uma para o status, outra para o texto. Quem ja
//                      estava com problema pagava o dobro no gate mais caro, e os dois
//                      processos podiam ver arvores diferentes: o erro IMPRESSO nao era
//                      necessariamente o que reprovou.
//
//   CRASH != LIMPO     falha de spawn tem estado proprio. O v5 deu falso verde aqui nos dois
//     (itens 186/211)  ecossistemas pelo mesmo motivo: o status de saida era capturado junto
//                      com o texto, entao um crash devolvia string vazia — indistinguivel de
//                      "nenhum erro de tipo".
//
// O executor e injetavel porque a propriedade central e INVISIVEL na saida: rodar uma ou
// duas vezes imprime o mesmo texto. So um teste de comportamento pega.

import { readFile, readdir, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';

/**
 * Resolve COMO invocar o verificador, sem passar por lancador de pacote.
 *
 * Medido na primeira prova em projeto real, e o achado mais grave da Fase E:
 *
 *   execFile('npx', ...)      -> ENOENT em Windows. Nome sem extensao nao resolve sem PATHEXT.
 *   execFile('npx.cmd', ...)  -> EINVAL. O Node 20+ recusa spawn de .cmd/.bat sem shell
 *                                (correcao do CVE-2024-27980).
 *
 * Ou seja: o gate NUNCA poderia rodar em Windows. Todo usuario veria "verificador nao pode
 * ser executado" para sempre — um erro permanente reprovando toda execucao. Nenhuma leitura
 * acharia isso; so rodar acha.
 *
 * A saida e nao depender de lancador nenhum. O `tsc` do TypeScript e um script Node: roda-se
 * com o proprio executavel do Node, que ja esta em `process.execPath` e nao precisa de shell,
 * de PATHEXT nem de resolucao por nome.
 */
export async function resolverComando(ferramenta, raizProjeto) {
  if (ferramenta === 'tsc') {
    for (const relativo of [
      ['node_modules', 'typescript', 'bin', 'tsc'],
      ['node_modules', '.bin', 'tsc.js'],
    ]) {
      const script = join(raizProjeto, ...relativo);
      if (await existe(script)) {
        return { comando: process.execPath, args: [script, '--noEmit'] };
      }
    }
    return null;
  }

  if (ferramenta === 'mypy') {
    // `python -m mypy` evita o mesmo problema: o executavel do interpretador resolve, o
    // wrapper do pacote nao necessariamente.
    return {
      comando: process.platform === 'win32' ? 'python' : 'python3',
      args: ['-m', 'mypy', '.'],
    };
  }

  return null;
}

async function existe(caminho) {
  return access(caminho).then(() => true, () => false);
}

// ------------------------------------------------------------------ deteccao

export function detectar({ arquivos = [] } = {}) {
  const tem = (teste) => arquivos.some((a) => teste(a.caminho));

  if (tem((c) => /(^|\/)tsconfig[^/]*\.json$/i.test(c))) {
    return { ferramenta: 'tsc', motivo: 'tsconfig.json presente' };
  }
  if (tem((c) => /(^|\/)jsconfig\.json$/i.test(c))) {
    return { ferramenta: 'tsc', motivo: 'jsconfig.json presente' };
  }
  if (tem((c) => /(^|\/)mypy\.ini$/i.test(c)) || tem((c) => /(^|\/)\.mypy\.ini$/i.test(c))) {
    return { ferramenta: 'mypy', motivo: 'mypy.ini presente' };
  }

  const pyproject = arquivos.find((a) => /(^|\/)pyproject\.toml$/i.test(a.caminho));
  if (pyproject && /\[tool\.mypy\]/.test(pyproject.conteudo ?? '')) {
    return { ferramenta: 'mypy', motivo: 'secao [tool.mypy] no pyproject.toml' };
  }

  // Projeto em JavaScript puro nao esta defeituoso por nao ter verificador de tipos.
  return { ferramenta: null, motivo: 'nenhum verificador de tipos configurado no projeto' };
}

// ------------------------------------------------------------------ interpretacao

/**
 * Traduz o resultado de UMA invocacao em veredito.
 *
 * Puro de proposito: e aqui que mora a distincao entre "reprovou" e "nao rodou", que o v5
 * confundia por capturar status e texto na mesma expressao.
 */
export function interpretar({ codigo, saida = '', erroDeSpawn = null, ferramenta = 'o verificador' } = {}) {
  if (erroDeSpawn) {
    return {
      estado: 'erro',
      achados: [],
      saida,
      aviso: `${ferramenta} nao pode ser executado (${erroDeSpawn}) — os tipos NAO foram verificados`,
    };
  }

  if (codigo === 0) {
    return { estado: 'ok', achados: [], saida, aviso: null };
  }

  return {
    estado: 'falha',
    achados: [{ motivo: `${ferramenta} reprovou (codigo ${codigo})` }],
    saida,
    aviso: null,
  };
}

// ------------------------------------------------------------------ execucao

async function executarDeVerdade(comando, args, cwd) {
  return new Promise((resolve) => {
    execFile(comando, args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (erro, stdout, stderr) => {
      const saida = `${stdout ?? ''}${stderr ?? ''}`.trim();

      // `erro.code` textual (ENOENT, EACCES) significa que o processo nao chegou a rodar.
      // `erro.code` numerico e o status de saida — ou seja, ele RODOU e reprovou.
      if (erro && typeof erro.code === 'string') {
        resolve({ codigo: null, saida, erroDeSpawn: erro.code });
        return;
      }
      resolve({ codigo: erro ? (erro.code ?? 1) : 0, saida });
    });
  });
}

export async function rodar(raizProjeto, opcoes = {}) {
  const executar = opcoes.executar ?? ((c, a) => executarDeVerdade(c, a, raizProjeto));

  const deteccao = opcoes.deteccao ?? detectar({ arquivos: await inventario(raizProjeto) });

  if (!deteccao.ferramenta) {
    return {
      estado: 'pulado',
      achados: [],
      saida: '',
      aviso: `${deteccao.motivo} — nada foi verificado`,
      ferramenta: null,
    };
  }

  const alvo = opcoes.comando ?? (await resolverComando(deteccao.ferramenta, raizProjeto));

  if (!alvo) {
    // O projeto DECLARA ser tipado e o verificador nao esta instalado. Nada foi conferido —
    // e dizer `ok` aqui seria o falso verde. Mensagem acionavel, nao generica.
    return {
      estado: 'erro',
      achados: [],
      saida: '',
      aviso: `${deteccao.ferramenta} esta configurado no projeto mas nao instalado — os tipos NAO foram verificados`,
      ferramenta: deteccao.ferramenta,
    };
  }

  // UMA invocacao. O resultado inteiro — status, texto e falha de spawn — sai daqui, e nada
  // abaixo pode invocar de novo para "pegar a mensagem".
  const resultado = await executar(alvo.comando, alvo.args);

  return {
    ...interpretar({ ...resultado, ferramenta: deteccao.ferramenta }),
    ferramenta: deteccao.ferramenta,
  };
}

// ------------------------------------------------------------------ inventario

const IGNORAR_DIR = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.venv', 'venv']);
const INTERESSA = /(^|\/)(tsconfig[^/]*\.json|jsconfig\.json|mypy\.ini|\.mypy\.ini|pyproject\.toml)$/i;

async function inventario(raizProjeto) {
  const arquivos = [];
  for await (const rel of caminhar(raizProjeto)) {
    const conteudo = await readFile(join(raizProjeto, rel), 'utf8').catch(() => '');
    arquivos.push({ caminho: rel, conteudo });
  }
  return arquivos;
}

async function* caminhar(raizProjeto, prefixo = '', profundidade = 0) {
  if (profundidade > 3) return;
  const entradas = await readdir(join(raizProjeto, prefixo), { withFileTypes: true }).catch(() => []);
  for (const e of entradas) {
    if (IGNORAR_DIR.has(e.name)) continue;
    const rel = prefixo ? `${prefixo}/${e.name}` : e.name;
    if (e.isDirectory()) yield* caminhar(raizProjeto, rel, profundidade + 1);
    else if (INTERESSA.test(rel)) yield rel;
  }
}
