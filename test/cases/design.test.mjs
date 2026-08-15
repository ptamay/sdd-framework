// Casos da rota de design — o executor de UI e o artefato que ele produz.
//
// Escritos ANTES da implementacao (M-08).
//
// POR QUE ESTA ROTA EXISTE, e a resposta esta no proprio repositorio antes desta task: o v6
// ja citava a camada de UI em TRES lugares e nao a tinha em nenhum.
//
//   1. `.claude-plugin/plugin.json` descreve uma "skill de UI" que detecta o executor em
//      tempo de execucao — e `skills/` tem seis diretorios, nenhum deles de UI;
//   2. `policy/gates.json` traz o gate `design-tokens` como candidato;
//   3. esse gate cita as invariantes `U-01`, `U-02` e `U-03`, que NAO estao definidas em
//      lugar nenhum deste repositorio.
//
// Referencia a componente inexistente e a classe de defeito que este framework existe para
// impedir, e ela estava aqui dentro. Os casos abaixo prendem as duas pontas que esta task
// fecha; a terceira (as invariantes orfas) fica reportada, nao inventada — definir lei que
// um gate ja diz aplicar, sem saber a intencao de quem a citou, e fabricar a lei.
//
// A PROPRIEDADE CENTRAL: o executor e EXTERNO e pode nao estar instalado. A rota precisa
// funcionar nos dois mundos, e o unico jeito de garantir isso e nunca declarar dependencia
// dura dele — declarar dependencia que nao resolve faz o `enable` do plugin FALHAR, e ai
// nao e a UI que quebra, e o framework inteiro.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';

import { raizDoRepo } from '../../gates/lib/policy.mjs';

const RAIZ = raizDoRepo();
const lerPolicy = async (n) => JSON.parse(await readFile(join(RAIZ, 'policy', n), 'utf8'));
const existe = (c) => access(join(RAIZ, c)).then(() => true, () => false);

// --------------------------------------------------------------------- a rota

test('existe uma rota de design, e ela entrega o artefato de design', async () => {
  const { rotas } = await lerPolicy('rotas.json');
  const design = rotas.find((r) => r.id === 'design');

  assert.ok(design, 'nao ha rota de design');
  assert.ok(design.entrega.includes('design'), 'a rota de design nao entrega o artefato de design');
});

test('o artefato de design tem casa no contrato de memoria, com secoes', async () => {
  // Mesma exigencia dos outros cinco artefatos: sem secoes obrigatorias, o arquivo vira
  // texto livre e a proxima rota nao sabe onde ler. Foi assim que o v5 perdeu tres regras
  // de negocio que nao tinham onde morar.
  const memoria = await lerPolicy('memoria.json');
  const design = memoria.arquivos.find((a) => a.id === 'design');

  assert.ok(design, 'o contrato de memoria nao conhece o artefato de design');
  assert.equal(design.nasce, 'design', 'o artefato de design precisa nascer na rota de design');
  assert.ok(design.secoes?.length >= 2, 'o artefato de design sem secoes obrigatorias');
  assert.ok(design.regra?.length > 20, 'o artefato de design sem regra escrita');
});

// --------------------------------------------------------------------- o executor externo

test('o plugin NAO declara dependencia do executor de UI — ele e externo e opcional', async () => {
  // A razao esta escrita no proprio plugin.json e vale repetir aqui como caso: declarar
  // dependencia que nao resolve faz o `enable` FALHAR. Um framework de governanca que so
  // liga quando um plugin de terceiro esta instalado deixa de governar o caso comum.
  const plugin = JSON.parse(await readFile(join(RAIZ, '.claude-plugin', 'plugin.json'), 'utf8'));
  const declaradas = JSON.stringify({
    dependencies: plugin.dependencies,
    requiredPlugins: plugin.requiredPlugins,
    plugins: plugin.plugins,
  });

  assert.doesNotMatch(declaradas, /impeccable/i, 'o plugin declarou dependencia do executor de UI');
});

test('a skill de design declara os DOIS mundos: executor presente e executor ausente', async () => {
  // O caso que impede a regressao mais provavel desta rota. Uma skill que so descreve o
  // caminho feliz vira, na maquina sem o plugin, um ponteiro para comando que nao existe —
  // e o agente inventa um substituto em silencio, que e pior do que nao ter rota.
  assert.ok(await existe('skills/design/SKILL.md'), 'nao ha SKILL.md da rota de design');
  const texto = await readFile(join(RAIZ, 'skills', 'design', 'SKILL.md'), 'utf8');

  assert.match(texto, /impeccable/i, 'a skill nao nomeia o executor preferido');
  assert.match(texto, /ausente|nao encontrar|sem o executor/i, 'a skill nao trata o executor ausente');
});

// --------------------------------------------------------------------- o elo com a sprint

test('a rota de sprint manda a task de UI passar pelo executor, com a lei como brief', async () => {
  // O elo que faz a rota valer alguma coisa. Sem ele, o artefato de design existe e nenhuma
  // task e obrigada a olhar para ele — que e o modo de errar ja catalogado neste framework:
  // artefato satisfeito pela metade, sem dono declarado.
  const { rotas } = await lerPolicy('rotas.json');
  const sprint = rotas.find((r) => r.id === 'sprint');
  const regras = sprint.regras.join(' ');

  assert.match(regras, /design/i, 'a rota de sprint nao cita o artefato de design');
  assert.match(regras, /lei|constitution|restricao/i, 'a regra de UI nao manda passar a lei como brief');
});
