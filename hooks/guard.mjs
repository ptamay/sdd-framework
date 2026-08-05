// Guard do harness — barra a unica escrita que o agente nao pode fazer sozinho.
//
// O v5 tinha 269 linhas de guard porque a camada de instrucao inteira morava dentro do
// repositorio do projeto, ao alcance do agente. No v6 ela mora no plugin, fora do projeto:
// quase tudo aquilo deixou de ter o que defender.
//
// Sobrou UMA coisa, e e a mais perigosa das duas que existiam:
//
//   `.sdd/gates-ignore.json` e a lista do que os gates DEIXAM de olhar. Alargada, o
//   relatorio fica verde e a varredura some sem quebrar teste nenhum. E exatamente por isso
//   que o v5 pos a allowlist do scanner de segredo na zona protegida — allowlist e
//   superficie de ataque, nao conforto.
//
// O agente PROPOR uma isencao e legitimo e util. O que ele nao pode e aplica-la sozinho:
// quem isenta e quem revisa. Mesma logica do selo do v5, reduzida ao que ainda faz sentido.
//
// Guard e redutor de acidente, nao garantia — ele roda so no Claude Code. A garantia dura
// continua sendo o diff: o arquivo e versionado, e as cinco travas o validam a cada execucao.

import { readFile } from 'node:fs/promises';

const PROTEGIDOS = [/(^|[\\/])\.sdd[\\/]gates-ignore\.json$/];

// Verbos de shell que escrevem. O v5 aprendeu, em quatro ocorrencias distintas, que a
// classe precisa de FRONTEIRA: sem ela, `NO` casa `NODE_` e `rm` casa `rmdir` de outra
// coisa. Aqui a fronteira e o inicio do comando ou um separador.
const ESCRITA_SHELL =
  /(^|[;&|]\s*)(rm|mv|cp|sed|tee|truncate|dd)\b|>>?\s*[^\s|&;]*\.sdd[\\/]gates-ignore\.json/;

/**
 * Decide se a chamada deve ser barrada. Puro: o hook so faz I/O.
 *
 * Devolve `null` para liberar, ou a mensagem que o modelo vai ler.
 */
export function decidir(evento) {
  const ferramenta = evento?.tool_name ?? '';
  const entrada = evento?.tool_input ?? {};

  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(ferramenta)) {
    const alvo = entrada.file_path ?? entrada.notebook_path ?? '';
    if (PROTEGIDOS.some((p) => p.test(alvo))) return motivo(alvo);
    return null;
  }

  if (ferramenta === 'Bash') {
    const comando = String(entrada.command ?? '');
    // LER a lista de isencoes e livre e necessario — o v5 barrou por engano a propria
    // verificacao que ele mandava fazer, quatro vezes, e registrou que bloqueio sem
    // justificativa e o que ensina alguem a procurar contorno.
    if (!/gates-ignore\.json/.test(comando)) return null;
    if (!ESCRITA_SHELL.test(comando)) return null;
    return motivo('.sdd/gates-ignore.json');
  }

  return null;
}

function motivo(alvo) {
  return [
    `BARRADO: ${alvo} e a lista do que os gates deixam de olhar.`,
    '',
    'Alargar essa lista deixa o relatorio verde sem que nada tenha sido conferido, e nao',
    'quebra teste nenhum. Por isso quem isenta e quem revisa, nunca quem escreve o codigo.',
    '',
    'O que fazer: descreva ao usuario a isencao que voce quer (gate, caminho ancorado com',
    '^ e $, e o motivo), e deixe que ele a aplique. As cinco travas do arquivo continuam',
    'valendo, e o runner imprime tudo o que foi isentado a cada execucao.',
  ].join('\n');
}

// ------------------------------------------------------------------ entrada do hook

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const bruto = await lerStdin();
  let evento;
  try {
    evento = JSON.parse(bruto || '{}');
  } catch {
    // Evento ilegivel NAO vira liberacao silenciosa: avisa e libera, porque barrar tudo por
    // um payload malformado transformaria o guard em obstaculo — e obstaculo alguem desliga.
    process.stderr.write('guard: evento do hook ilegivel, seguindo sem barrar\n');
    process.exit(0);
  }

  const barrado = decidir(evento);
  if (barrado) {
    process.stderr.write(`${barrado}\n`);
    process.exit(2); // 2 = bloqueia a chamada e devolve o motivo ao modelo
  }
  process.exit(0);
}

async function lerStdin() {
  const partes = [];
  for await (const p of process.stdin) partes.push(p);
  return Buffer.concat(partes).toString('utf8');
}

export { readFile };
