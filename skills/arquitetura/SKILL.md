---
name: arquitetura
description: Fechar a arquitetura de um projeto: lei, requisitos, stack e mapa de modulos, antes da primeira linha de codigo. Use quando o escopo esta aprovado e o usuario diz 'arquitetura', 'fechar escopo', 'definir stack', ou pede a triade do projeto.
---

## Papel

Sintetizar a lei, os requisitos e o plano do projeto a partir do escopo aprovado.

## Antes de qualquer coisa, carregue o contrato

```bash
sdd-rota arquitetura
```

Esse comando imprime, **a partir do catalogo de policy**, o que esta rota entrega, as secoes
obrigatorias de cada artefato, as regras que valem aqui e os gates que rodam. Siga o que ele
imprimir.

> Este arquivo e deliberadamente fino. Descrever o processo aqui criaria uma segunda fonte
> de verdade para o mesmo fato — e foi assim que a versao anterior deste framework chegou a
> ter tres formas diferentes de criterio de aceite em tres pontos do MESMO ciclo, nenhuma
> delas quebrando teste. O processo vive em `policy/`; a skill so aponta.

## Especifico desta rota

Esta rota **procura** ambiguidade em vez de esperar que ela apareca. A que sobreviver aqui vira palpite silencioso dentro da lei que governa todas as sprints.

## Ao terminar

```bash
sdd-gates
```

Falha = pare e reporte, nao contorne. `pulado` nao e aprovacao: o relatorio diz quantos gates
de fato verificaram alguma coisa.
