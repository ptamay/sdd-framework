---
name: change-request
description: Registrar uma ideia nova ou mudanca de escopo, lei, stack ou requisito num projeto Constitutional SDD. Use quando o usuario propoe algo que nao cabe na sprint ativa, ou quando um pedido de ajuste revela mudanca de escopo.
---

## Papel

Registrar e decidir uma mudanca de escopo, lei, stack ou requisito.

## Antes de qualquer coisa, carregue o contrato

```bash
sdd-rota change-request
```

Esse comando imprime, **a partir do catalogo de policy**, o que esta rota entrega, as secoes
obrigatorias de cada artefato, as regras que valem aqui e os gates que rodam. Siga o que ele
imprimir.

> Este arquivo e deliberadamente fino. Descrever o processo aqui criaria uma segunda fonte
> de verdade para o mesmo fato — e foi assim que a versao anterior deste framework chegou a
> ter tres formas diferentes de criterio de aceite em tres pontos do MESMO ciclo, nenhuma
> delas quebrando teste. O processo vive em `policy/`; a skill so aponta.

## Especifico desta rota

Mudanca de lei **nao entra por sprint**. Entra aqui, e quem decide e o usuario.

## Ao terminar

```bash
sdd-gates
```

Falha = pare e reporte, nao contorne. `pulado` nao e aprovacao: o relatorio diz quantos gates
de fato verificaram alguma coisa.
