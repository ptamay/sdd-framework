---
name: design
description: Fechar o sistema visual de um projeto — direcao, tokens e os limites que a lei impoe ao desenho — e construir as telas com o executor de craft de UI quando ele existir. Use quando o usuario diz 'design', 'identidade visual', 'estilizar a tela', 'o painel esta feio', ou quando uma task de sprint vai criar ou mudar tela.
---

## Papel

Decidir como o sistema PARECE, e registrar isso onde a sprint seguinte encontre.

## Antes de qualquer coisa, carregue o contrato

```bash
sdd-rota design
```

Esse comando imprime, **a partir do catalogo de policy**, o que esta rota entrega, as secoes
obrigatorias do artefato, as regras que valem aqui e os gates que rodam. Siga o que ele imprimir.

## O executor e EXTERNO — detecte, nao presuma

O craft de UI preferido e o **`impeccable`** (`pbakaus/impeccable`), instalado pelo usuario com
`/plugin marketplace add pbakaus/impeccable`. Ele **nao vem com este framework** e pode nao estar
na maquina.

**A deteccao e do comando, nunca da sua leitura.** O `sdd-rota design` acima imprimiu a secao
`## Executor de craft` com **um de tres estados** — presente, ausente, indeterminado — e o que fazer
em cada um. Nao releia catalogo de plugin a mao, e **nao escreva o estado no artefato**: estado que
muda sozinho, congelado em prosa, envelhece. Este framework mediu 24 horas entre o fato escrito e o
fato falso.

Nao instale o plugin por conta propria e **nunca** declare dependencia dura dele: dependencia que
nao resolve faz o `enable` FALHAR, e ai nao e a UI que para, e o framework inteiro.

## Especifico desta rota

**A lei vai como brief, e ela e o unico motivo de esta rota existir.** Um agente de design produz,
por padrao, atributo `style`, fonte de origem externa, animacao e script. Levante na
`constitution.md` e na `spec.md` o que esta proibido, escreva na secao `## Limites da lei`, e so
entao peca o desenho — a secao e o brief, e ela vai **antes**, nunca em revisao depois.

**Primeiro na lista de limites vai a restricao que falha em SILENCIO.** Estilo bloqueado por CSP e
descartado pelo navegador sem erro, sem log e sem teste vermelho: o desenho parece entregue e nao
esta. Restricao que quebra a suite se defende sozinha; essa nao.

**O `PRODUCT.md` do executor sai de `overview.md` e `spec.md`** — nao reentreviste o usuario sobre o
que a memoria do projeto ja responde. O `DESIGN.md` dele e derivado e **nao repete valor de token**.

**Delegue em janela propria**, como as outras rotas: rodar o levantamento da lei e o craft na mesma
sessao devolve a decisao ao esforco de quem ja gastou a janela lendo CSS.

## Ao terminar

```bash
sdd-gates
```

Falha = pare e reporte, nao contorne. `pulado` nao e aprovacao: o relatorio diz quantos gates de
fato verificaram alguma coisa.
