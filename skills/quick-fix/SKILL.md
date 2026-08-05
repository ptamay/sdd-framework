---
name: quick-fix
description: Ajuste pontual sob o Constitutional SDD — estilo, texto, bugfix isolado, sem mudanca de escopo. Use quando o usuario pede uma correcao pequena e localizada num projeto que ja tem memoria estabelecida.
---

## Papel

Aplicar um ajuste pontual sem abrir sprint e sem tocar em escopo.

## Antes de qualquer coisa, carregue o contrato

```bash
sdd-rota quick-fix
```

Esse comando imprime, **a partir do catalogo de policy**, o que esta rota entrega, as secoes
obrigatorias de cada artefato, as regras que valem aqui e os gates que rodam. Siga o que ele
imprimir.

> Este arquivo e deliberadamente fino. Descrever o processo aqui criaria uma segunda fonte
> de verdade para o mesmo fato — e foi assim que a versao anterior deste framework chegou a
> ter tres formas diferentes de criterio de aceite em tres pontos do MESMO ciclo, nenhuma
> delas quebrando teste. O processo vive em `policy/`; a skill so aponta.

## Especifico desta rota

Se o ajuste tocar requisito, lei ou stack, ele **nao e** quick-fix. Pare e redirecione para `/sdd:change-request` — a rota errada e como escopo entra sem ninguem decidir.

## Ao terminar

```bash
sdd-gates
```

Falha = pare e reporte, nao contorne. `pulado` nao e aprovacao: o relatorio diz quantos gates
de fato verificaram alguma coisa.
