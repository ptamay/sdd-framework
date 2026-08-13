# Achados — bancada da próxima versão

Defeitos do framework encontrados **usando-o em projeto real**, não lendo o código dele. Cada item
traz o que foi medido, o conserto concreto e o caso que precisa falhar antes do conserto — que é a
regra de admissão que o próprio framework impõe: nada entra sem constar de uma bancada, nada sai
daqui sem prova.

Origem das evidências desta leva: um projeto privado sob SDD, sprint 1 (12 tasks) e sprint 1.5,
entre 2026-08-08 e 2026-08-12. O que muda a natureza dos achados A1 e A2 é a data de 2026-08-12:
foi quando o repositório desse projeto ganhou remote e **o job de CI rodou pela primeira vez**. Até
ali, todo veredito de gate vinha de execução local, e os dois defeitos são invisíveis localmente.

---

## A1 · `sdd:init` gera um CI que cega o gate 4 — CONSERTADO em 2026-08-13

`bin/sdd-init:335` emite o passo de checkout assim:

```yaml
      - uses: actions/checkout@v4
```

Sem `with:`, o `actions/checkout` clona com **`fetch-depth: 1`** — um commit. O gate 4 (`tdd-order`)
audita comparando o commit de teste com o de implementação **num range de histórico**; sem
histórico, ele não tem o que comparar e sai `pulado`, sem reprovar nada.

**Medido:** primeira execução real do job num projeto com 3 commits de teste antes de implementação
na janela auditada, todos na ordem certa. Runner: `[pulou] 4. Ordem TDD` — "nenhum commit de
implementacao com escopo de task na janela auditada". Local, na mesma árvore: `[ok]`. Depois de
`fetch-depth: 0`, o runner passou de `4 verificado(s)` para `6 verificado(s)`.

**Por que é o pior desta lista:** o cabeçalho que o próprio `sdd-init` escreve no `ci.yml` diz que
este job é *"o unico enforcement que roda ONDE O AGENTE NAO ESCREVE"*, e cita o caso do v5 — um
agente reescreveu a regra de segurança, rodou a selagem sozinho, commitou e recebeu aprovação de
todos os gates locais. O gate 4 é exatamente o que pegaria "commitei o teste depois", e era ele o
único cego no runner. **Todo projeto gerado pelo `sdd:init` até aqui carrega isso**, e não descobre
até publicar.

**Conserto:**

```yaml
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
```

**Caso que falha antes:** o YAML gerado por `sdd-init` contém `fetch-depth: 0` no passo de checkout.
Existe em `test/cases/init.test.mjs`, com a mutação correspondente no catálogo (`test/mutacoes.json`)
— reintroduzir o checkout raso derruba o caso.

**O que aconteceu ao escrever esse caso, e vale mais do que o conserto:** a primeira versão dele
**passava com o defeito reintroduzido**. O comentário que o conserto acrescentou ao template
documenta o `fetch-depth: 0` em prosa e cita `actions/checkout` pelo nome; o caso procurava o passo
por `includes` e achava o bloco do **comentário**. Verificava zero, com aparência de prova. Quem
pegou foi `npm run mutar` — `FURO — nenhum caso caiu com o defeito reintroduzido` —, que é
literalmente para isso que a mutação existe. Corrigido tirando comentário antes de procurar.

**Ainda aberto, e é o que fecha de verdade:** clone raso não pode sair como `pulado`. Enquanto o
gate 4 não distinguir "não pude auditar" de "não havia o que auditar", o mesmo defeito volta em
qualquer outra forma de histórico incompleto — ver A4.

---

## A2 · Bandeira desconhecida vira caminho, cria diretório e grava execução fantasma

`bin/sdd-gates:22`:

```js
const raiz = process.argv[2] ?? process.cwd();
```

Não há tratamento de bandeira. `sdd-gates --versao` trata `--versao` como caminho de projeto, **cria
o diretório** na raiz do repositório e grava nele uma execução completa:

```json
{"veredito":"nada-verificado","verificados":0,"pulados":7,"branch":null,"head":null}
```

**Dois danos, e o segundo é o que importa.** O primeiro é sujeira: um diretório de nome
impronunciável na árvore de trabalho — *este próprio repositório tem um `--help/` não rastreado, da
mesma causa, de antes deste achado*. O segundo: a linha gravada tem `branch: null` e `head: null` e
entra no **mesmo formato** das execuções reais. `execucoes.jsonl` é o histórico de conformidade do
projeto, e um erro de digitação consegue escrever nele um registro sem commit associado.

**Conserto:** reconhecer `--versao`/`--version`/`--help`/`-h` antes de resolver caminho, e **recusar
caminho inexistente em vez de criá-lo**. Caminho que não existe nunca é um projeto a verificar —
criar o diretório não serve a nenhum uso legítimo.

**Caso que falha antes:** invocar com caminho inexistente sai com erro, não cria diretório e não
escreve execução nenhuma.

---

## A3 · Gate 6 (`env-bypass`) não enxerga configuração de plataforma na raiz

`gates/env-bypass.mjs:32` reconhece `.env*`, `*.{env,ini,cfg,conf,properties}`, `compose*.y?ml` e
`config/*.{json,yaml,toml,js,ts}`. **`wrangler.toml` na raiz não casa com nenhum** — e num projeto
Cloudflare Workers é nele que se declara binding, variável e bandeira de compatibilidade: é a
configuração de produção mais importante que o projeto tem.

**Medido:** quinze execuções seguidas com o gate 6 `pulado` num projeto cuja constituição **nomeia
o gate 6 como a execução de uma lei de segurança** ("limite de tentativas… é o gate 6 do framework,
e vale como lei aqui"). A lei apontava para uma verificação que nunca rodou, e nada no framework
percebeu. A sprint teve de construir guarda própria no código do projeto para cobrir o buraco.

**Conserto barato:** acrescentar os nomes fixos de configuração de plataforma na raiz —
`wrangler.{toml,json,jsonc}`, `fly.toml`, `netlify.toml`, `vercel.json`, `app.yaml`, `render.yaml`.
São nomes, não heurística.

**O buraco maior, que o conserto acima não fecha:** o gate lê **configuração**, não código. Um
`if (import.meta.env.DEV)` dentro do módulo que implementa o limite de tentativas passa por baixo
dele sem reprovar nada. Duas direções: varrer código em caminho declarado como crítico, ou o runner
**avisar quando um gate `pulado` for nomeado pela constituição do projeto**.

---

## A4 · `pulado` não distingue "não havia o que conferir" de "não consegui conferir"

Três instâncias já medidas, e as três saem iguais no relatório:

| Situação | Hoje | O que é de verdade |
|---|---|---|
| Gate 4 em clone raso (A1) | `pulado` | **impedido** — havia o que auditar e a ferramenta não pôde ver |
| Gate 4 com escopo não reconhecido (`gates/tdd-order.mjs:39` casa só `TASK-\d+`; escopo `1.2`, que é a numeração que a própria `tasks.md` usa, não casa) | `pulado` | **impedido** — há commits, o formato é que não foi reconhecido |
| Gate 6 sem arquivo de configuração (A3) | `pulado` | **não aplicável** — este é o único legítimo |

"6 ok · 1 pulado", repetido quinze vezes num encerramento de sprint, lê como "tudo verde" para quem
não sabe o que `pulado` significa — e quem lê o relatório no fim da sprint é exatamente quem não
sabe.

**Conserto:** dois estados no lugar de um — `nao-aplicavel` e `impedido`. `impedido` conta como
falha, ou no mínimo como aviso de topo, e nunca como aprovação.

---

## A5 · `continue-on-error: true` no passo de instalação de dependências

`bin/sdd-init:342`. Quando `npm ci` falha, o job **segue** e quebra num passo posterior, que não é a
causa. Quem lê o log encontra o sintoma e não o defeito.

**Conserto:** remover, ou substituir por condição explícita sobre a existência de `package.json` —
que é o caso legítimo que o `continue-on-error` tenta cobrir hoje, e cobre errado.

---

## A6 · Nada mecaniza requisito órfão

**Medido:** auditoria de encerramento cruzando 66 requisitos funcionais da `spec.md` com os
requisitos que as sete sprints reivindicam em `plan.md`. **Oito não tinham sprint nenhuma** — e o
achado que importa não é esse: **quatro já estavam SATISFEITOS** por uma sprint que não os listava.

Requisito satisfeito por acidente não tem teste que o defenda, e a sprint seguinte o desfaz sem
reprovar nada. Caso concreto no projeto de origem: um requisito de "nenhum recurso de terceiro"
existe só porque a CSP está fechada, e a sprint seguinte quer abrir uma diretiva para incorporar
vídeo.

**Conserto:** a varredura é barata — os requisitos estão em `spec.md` em formato regular e as
sprints os citam em `plan.md`. Cruzar os dois conjuntos e reportar o complemento acha isto em
milissegundos. Tira `task-binding` do "ainda não coberto por gate" com evidência de projeto real.

---

## Não é achado, e vale registrar: a trava de isenção funcionou

O hook barrou a escrita de `.sdd/gates-ignore.json` por quem estava escrevendo o código, com a
mensagem certa — descreva a isenção e deixe o dono aplicar. Aconteceu num caso real, e o efeito foi
o desenhado: a isenção foi estreitada a um arquivo antes de chegar ao dono, em vez de tirar um
módulo inteiro da varredura. No fim, nem foi usada — o defeito do gate foi consertado.
