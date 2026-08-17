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

---

# Leva de 2026-08-15/16 — a rota `design`, medida no primeiro projeto que a usou

Mesmo projeto privado, agora na **sprint 4** (identidade visual e conteúdo editorial). A rota
`design` nasceu em `2113297` e a versão subiu para 0.4.0 em `2df5efc`; estes dois achados são o que
**usá-la uma vez** devolveu. Os dois compartilham a mesma causa e por isso vêm juntos: a rota
descreve um elo em prosa e não entrega o mecanismo que o mede.

---

## A7 · O executor de UI é detectado por PROSA, e a prosa envelheceu em menos de 24 horas — CONSERTADO em 2026-08-16 (0.5.0)

`skills/design/SKILL.md:19` manda, em título: **"O executor e EXTERNO — detecte, nao presuma"**. O
framework não entrega detecção nenhuma. `sdd-rota design` imprime quando, estágio, esforço, prova de
leitura, entrega, regras e gates — e **não diz uma palavra sobre o executor**. A skill descreve os
dois mundos e deixa a pergunta "em qual deles estou?" para o agente resolver sozinho.

**Medido, e o intervalo é o achado:**

| Quando | O quê | Origem |
|---|---|---|
| 2026-08-15 | A rota fecha. `.sdd/memory/design.md` afirma: *"o plugin **não está habilitado** … Esta rota correu **pelo fluxo próprio**, à mão"*, e a tabela de estado repete: `Executor de craft \| marketplace adicionado, **plugin não habilitado**` | commit `fba2fc0` do projeto |
| — | A detecção que produziu essa frase foi o agente **lendo `~/.claude/plugins/known_marketplaces.json` à mão** | transcrito da própria rota |
| 2026-08-16 **07:24:15Z** | O plugin é instalado e habilitado — `installed_plugins.json` e `.claude/settings.json` → `enabledPlugins` | máquina do usuário |
| 2026-08-16 | **O artefato continua afirmando que não está.** Nenhum gate, hook ou rota percebeu | leitura desta sessão |

**Menos de 24 horas entre o fato escrito e o fato falso**, num arquivo que o próprio framework
obriga a existir. E a ironia é exata: `.sdd/memory/design.md` abre com uma seção chamada
**"Ponteiros — a disciplina deste arquivo"**, escrita porque este projeto já registrou **três**
ocorrências de ponteiro em prosa que envelheceu. O quarto foi produzido pela rota que escreveu a
seção.

**Por que não é cosmético.** As duas metades da rota mudam de comportamento conforme a resposta:
com executor presente, é ele quem constrói as telas; ausente, o fluxo é à mão. Um agente que lê
"não está habilitado" num artefato de 2026-08-15 **não vai procurar o comando**, e vai construir à
mão numa máquina onde o craft está instalado. Falha silenciosa — a categoria que a própria rota
manda listar primeiro.

**Conserto:** detecção mecânica, não prosa. Uma lib no plugin (`gates/lib/executor-ui.mjs`) que lê
`~/.claude/plugins/installed_plugins.json` e as chaves `enabledPlugins` dos `settings.json` de
projeto e de usuário, e `sdd-rota design` passa a imprimir uma linha de estado — `presente
(impeccable@<versao>)` ou `ausente`, com o comando de instalação. **O artefato para de afirmar o
estado do executor**: ele passa a apontar para o comando que o mede, que é a mesma disciplina que
esse arquivo já aplica a valor de token.

**Caso que falha antes:** `sdd-rota design` imprime o estado do executor. Com fixture de
`installed_plugins.json` contendo o executor habilitado, a saída diz `presente` e traz a versão;
sem ele, diz `ausente` e traz o comando de instalação. **Mutação correspondente:** remover a linha
de estado da saída derruba o caso — hoje nada cai, porque nada é impresso.

### Conserto entregue

`gates/lib/executor-ui.mjs`, com **dez casos** em `test/cases/executor-ui.test.mjs` e **duas
mutações** no catálogo. `sdd-rota design` passa a imprimir a seção `## Executor de craft` — e só
essa rota, com um caso travando a generalização: sinal impresso em toda rota vira ruído, e ruído
lido sete vezes por sprint deixa de ser lido.

**Três estados, não dois, e é a decisão central do conserto:** `presente`, `ausente` (com o motivo
— *não instalado* e *instalado e não habilitado* são consertos diferentes, e colapsá-los manda
instalar o que já está instalado) e **`indeterminado`**. Sem o terceiro, um catálogo ilegível
viraria `ausente` e a rota construiria à mão numa máquina onde o craft está instalado — falha
silenciosa, que é a categoria que esta rota manda listar primeiro. É a mesma lição de A4, aplicada
antes de A4 fechar.

**A regra que impede a reincidência entrou no catálogo, não na skill:** o artefato **não afirma** o
estado do executor — aponta para o comando que o mede. Congelar em prosa um fato que muda sozinho é
a mesma doença de copiar valor de token, com outra roupa.

**Medido depois do conserto**, no mesmo projeto: `sdd-rota design` imprime
`presente — impeccable@4.1.1`.

---

## A8 · "Task que cria ou muda TELA passa pela rota de design" é frase, e o caso que a defende confere a frase — CONSERTADO em 2026-08-16 (0.5.0)

`policy/rotas.json`, rota `sprint`, quinta regra:

> "Task que cria ou muda TELA passa pela rota de design antes do ciclo: o artefato de design
> governa, e a restricao textual da lei vai junto como brief."

O caso que a prende (`test/cases/design.test.mjs:87`) é:

```js
assert.match(regras, /design/i, 'a rota de sprint nao cita o artefato de design');
```

**Ele afirma que a regra CITA a palavra.** Nenhum caso, gate ou hook mede que a passagem aconteceu.
É a mesma forma do defeito que o próprio A1 descreve — o caso achou o comentário e não o
comportamento —, agora na rota de design.

**Medido no projeto, e o número é o achado:**

| Fato | Origem |
|---|---|
| A rota `design` rodou **uma vez**, e **depois** da task 4.2 (`fba2fc0` vem depois de `a180eb4`) | histórico do projeto |
| As tasks 4.1 e 4.2 mudaram tela — tokens em `galeria.css`, marca na home e no detalhe — e **nenhuma passou pela rota**: o artefato ainda não existia | `tasks.md`, tabela de fechadas |
| **2 de 11 superfícies** têm tokens alcançando | inventário da própria rota, `design.md` |
| **Sete telas de painel e a de entrar não ligam folha de estilo nenhuma** — rodam no estilo padrão do navegador | idem, conferido lendo os arquivos |
| A única superfície que existe **por causa** da invariante de contato (`/contato`) tem folha com **uma regra** e nenhum `:root` | idem |

Três sprints de telas nasceram sem passagem de design, num projeto sob os sete gates, com 898
testes e 92% de cobertura. **Nada reprovou, porque nada olhava.**

**Conserto — e ele tem uma dependência que precisa ser dita.** O gate candidato para isto já existe
no catálogo (`policy/gates.json`, `design-tokens`) e **não pode ser ativado como está**: ele declara
as invariantes `U-01`, `U-02` e `U-03`, que **não estão definidas em lugar nenhum deste
repositório** — a orfandade já está reportada no cabeçalho de `test/cases/design.test.mjs`, e
definir lei que um gate diz aplicar, sem saber a intenção de quem a citou, é fabricar a lei. **Ou as
invariantes ganham texto por decisão do dono, ou o gate perde a citação.** É o primeiro passo, e não
é técnico.

Feito isso, duas verificações, do barato ao caro:

1. **Literal de estilo fora do bloco de tokens**, em toda folha do projeto. O projeto de origem
   escreveu essa guarda **à mão** (`src/lib/guardas.ts`, `coresLiteraisForaDoBlocoDeTokens`, a
   décima quarta guarda dele) porque o framework não a tinha. Guarda que um projeto real precisou
   construir sozinho é candidata a gate com evidência, que é a régua deste arquivo.
2. **Superfície que renderiza HTML e não liga a folha que declara os tokens.** É o que mede
   "a tela nasceu sem passar pelo design", e é o que os 2-de-11 acima teriam acusado na sprint 2.
   **Limite declarado:** depende de como a stack liga folha a página, então nasce cobrindo o que
   for reconhecido e **pula com aviso** no resto — nunca `ok`.

**Caso que falha antes:** projeto-fixture com uma página que renderiza HTML e não liga folha
nenhuma; o gate reprova nomeando a página. **Mutação correspondente:** ligar a folha na fixture faz
o caso passar, e removê-la de uma página que a tinha derruba um caso — as duas direções, que é o
padrão que este projeto já mecanizou para o elo `PASSOS_DO_FOCO` × folha.

**O que este achado NÃO afirma:** que o executor de craft precise ser dependência dura. Continua
não podendo ser, pelo motivo já escrito em `plugin.json` e travado por caso. O que falta não é
dependência — é **medição de que a passagem aconteceu**, e ela funciona igual nos dois mundos.

### Conserto entregue

**Gate 8, `design-tokens`, saiu de candidato** — `gates/design-tokens.mjs`, com **17 casos** e
**quatro mutações**. Dois eixos, porque medem coisas diferentes: `superficie-sem-sistema` (arquivo
que renderiza documento e não liga folha nenhuma) e `valor-fora-do-token` (literal de cor em
declaração fora do bloco de tokens — a guarda que o projeto de origem teve de escrever à mão).

**O que ele NÃO faz está declarado no catálogo, não omitido:** U-01 (contraste calculado) e U-02
(gamut e colisão de luminância) seguem **sem executor**, e por isso **saíram da citação de
invariantes do gate**. Gate que cita lei que não aplica é o defeito que este conserto acabou de
remover — reintroduzi-lo no mesmo commit teria sido trocar um por outro.

**Medido contra o projeto de origem, depois do conserto:** `falha`, com **7 acusações e nenhum
falso positivo** — `entrar` e as seis telas de painel, exatamente as superfícies que o inventário
da rota de design tinha listado como sem folha. E a medição **corrigiu a prosa do artefato**, que
dizia "as sete telas do painel e a de entrar" enquanto a própria tabela dele listava seis.

**O primeiro falso positivo real virou caso.** Na primeira execução o gate acusou
`playwright-report/index.html`: saída gerada não é superfície do projeto, e acusá-la ensina o time a
ignorar o gate. A lista de exclusão cresceu e ganhou caso próprio, que roda `rodar()` contra
fixture de disco — num caminho **com espaço**, pela mesma razão de `test/projeto.mjs`.

**E o harness de mutação pegou um furo nos casos deste conserto**, que é literalmente para isso que
ele existe: o caso de `url(#recorte)` passava com o defeito reintroduzido, porque `r` não é dígito
hexadecimal e o valor jamais casaria com o padrão de cor, com ou sem defeito. Verificava zero, com
aparência de prova — a mesma forma do furo registrado em A1. Corrigido para `url(#facade)`, que é
identificador plausível de máscara SVG **e** hexadecimal de seis dígitos válido.

---

## A9 · Nenhuma invariante citada pelos gates existe em arquivo — e o catálogo agora tem três

**Medido em 2026-08-16, ao tentar ativar o gate 8.** `policy/gates.json` cita invariantes em toda
entrada — `S-01`, `S-02`, `S-03`, `M-01`, `M-02`, `M-03`, `M-10`, `M-12`, `P-13`, `I-01`, `I-06`,
`U-01`, `U-02`, `U-03`. **Nenhuma delas tinha texto em arquivo nenhum deste repositório.** Não
estão no v5 tampouco: uma varredura por `U-01` em todo o v5 volta vazia.

O sintoma já estava reportado, e só na metade: o cabeçalho de `test/cases/design.test.mjs` registra
as três de UI como órfãs e decide, corretamente, não inventá-las. **Ninguém tinha olhado as outras
onze.**

**Por que é da mesma família dos outros achados desta leva:** um gate que declara aplicar `M-02` dá
a quem lê o relatório a impressão de que existe uma lei escrita governando aquela verificação. Não
existe. A citação parece rastreabilidade e é decoração — a mesma aparência de conformidade que a
prova de leitura do framework existe para impedir.

**Conserto parcial, entregue:** `policy/invariantes.json` nasce como fonte única, com **I-01,
U-01, U-02 e U-03** definidas — texto, motivo e a **derivação declarada** de cada uma. As três de UI
saíram do que o próprio gate já dizia provar em `prova` e `porque`, mais o que a sprint 4 mediu;
I-01 já era afirmada em dois lugares do repositório antes de existir catálogo. Um caso trava a
reincidência: **toda invariante citada pelo gate 8 precisa existir no catálogo**, com texto e
motivo.

**Ainda aberto, e é o que fecha de verdade:** as **onze restantes**. Não foram escritas de
improviso, e a omissão é declarada em `policy/invariantes.json`. Escrevê-las por conta própria
produziria exatamente a fabricação que este arquivo nasceu para consertar — elas exigem a mesma
conversa que as três de UI tiveram. **Dono: o mantenedor do framework.**

**Caso que falha antes, quando fechar:** toda invariante citada por gate **ativo** existe no
catálogo. Hoje esse caso falharia, e por isso ele ainda não foi escrito — escrevê-lo agora exigiria
inventar onze leis para deixá-lo verde, que é o caminho errado.

---

## A10 · `run.mjs` entrega `isencoes` a TODO gate, e só dois consumiam — CONSERTADO em 2026-08-16 (0.5.0), incluindo a lista inteira

**Medido em 2026-08-16**, ao aplicar a válvula que o próprio A8 deixou como recomendação: isentar
as sete telas do Portifólio Igor do gate 8, com a task 4.7 como dono.

`gates/run.mjs:99` chama `modulo.rodar(raiz, { valvula, isencoes })` — **todo** gate recebe as
isenções. Uma varredura por `isencoes` em `gates/*.mjs` volta com **`imports` e `secrets`, e mais
nada**. O gate 8 nasceu ignorando o segundo argumento inteiro, e não é o único que pode estar assim.

**A consequência não é "a isenção não funciona", e é aí que dói:** `.sdd/gates-ignore.json` podia
existir, **passar nas cinco travas de validação** — ancorado, estreito, por gate, justificado — e
não isentar coisa nenhuma, com o relatório reprovando exatamente como se o arquivo não estivesse
lá. O usuário lê o próprio arquivo, lê o vermelho, e não tem como saber qual dos dois está mentindo.

**É a trava 5 pelo avesso.** A trava 5 existe porque isenção invisível é indistinguível de gate
desligado; este defeito é a outra face — **isenção visível no diff que o gate nunca honrou**. Da
mesma família de A7 e A8: o framework declarando um comportamento que nada media.

**Conserto, entregue:** `design-tokens.mjs` compila as isenções e tira o arquivo do **corpus**,
antes de `analisar()`. Corpus e não achados, porque os dois eixos leem a mesma lista — filtrar
achado a achado isentaria o eixo de superfície e deixaria o de token cobrando o mesmo arquivo.

**O caso que ninguém escreveria por hábito, e é o que segura a válvula:** projeto cuja UI inteira
foi isentada sai **`pulado`**, nunca `ok`. O anti-silêncio de M-01 passa a valer **depois** da
isenção — isentar tudo e receber verde seria a válvula fabricando aprovação, que é o oposto do que
ela existe para fazer. Cinco casos novos, com o controle que discrimina (sem isenção, reprova) e
duas mutações: o gate voltar a ignorar a válvula, e o isentado sumir do relatório.

**Fechado no mesmo dia, e o fecho é de contrato, não de gate.** Conferir os outros cinco mostrou
que "todo gate honra isenção" seria a regra errada — três deles não varrem arquivo:

| Gate | Varre arquivo? | Decisão |
|---|---|---|
| `secrets`, `imports`, `design-tokens` | sim | honram, e já honravam ao fim do dia |
| `migrations` | sim | **era lacuna** — passou a honrar |
| `env-bypass` | sim | **era lacuna, e a mais crua**: o `rodar` nem aceitava `opcoes` |
| `tdd-order` | não — lê o histórico do git | não honra |
| `coverage` | não — lê relatório, que é saída gerada | não honra; a válvula dele é o mínimo |
| `typecheck` | não — invoca o verificador da stack | não honra; o recorte é do `tsconfig` (I-01) |

Cada gate **declara** em `policy/gates.json` qual dos dois é, com o motivo escrito. E a declaração
não é a prova: `test/cases/contrato-isencoes.test.mjs` mede as duas metades — para quem declara
honrar, um fixture em disco que o gate **acusa** (controle que discrimina) e depois deixa de acusar
sob isenção, com o caminho em `isentos`; e um caso que reprova o gate que declara honrar **sem ter
fixture que o prove**, para que a próxima declaração não vire decoração.

**A metade que fecha A10 do lado do usuário é a trava 6:** isenção que nomeia gate que não honra é
**recusada**, com o gate no texto do erro. Antes ela era aceita e ignorada — o usuário escrevia,
passava nas cinco travas, e nada acontecia. Recusar é acionável; aceitar e ignorar é o silêncio.

**Uma decisão de fixture que vale registrar, porque é sobre a lista crescer:** os venenos do
arquivo de contrato são montados em pedaços em vez de escritos inteiros. Escritos inteiros, os
gates 1 e 3 acusariam o próprio arquivo, e o caminho conhecido seria mais duas linhas em
`.sdd/gates-ignore.json` — como já acontece com `secrets.test.mjs` e `imports.test.mjs`. Lá a
isenção se justifica: aqueles testam a **detecção**, e credencial fora do formato real não prova
nada. Aqui não: este arquivo só precisa que o gate acuse **alguma coisa**. Isenção gasta é
permanente, e com ela um segredo real colado ali deixaria de ser pego. **A lista do que os gates
deixam de olhar só cresce quando não há outro caminho.**

---

## Não é achado, e vale registrar: a trava de isenção funcionou — DUAS vezes

O hook barrou a escrita de `.sdd/gates-ignore.json` por quem estava escrevendo o código, com a
mensagem certa — descreva a isenção e deixe o dono aplicar. Aconteceu num caso real, e o efeito foi
o desenhado: a isenção foi estreitada a um arquivo antes de chegar ao dono, em vez de tirar um
módulo inteiro da varredura.

**Barrou de novo em 2026-08-16, na segunda tentativa de aplicar a mesma válvula — e desta vez o
adiamento foi o que achou A10.** Obrigado a descrever a isenção em vez de escrevê-la, quem estava
no código foi conferir se o gate a honrava. Não honrava. **A trava pegou um defeito que ela não
foi desenhada para pegar**, porque a fricção que ela impõe é exatamente "explique isto antes de
gravar" — e explicar exigiu ler o gate.
