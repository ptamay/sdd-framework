---
name: sprint
description: Executar uma sprint do Constitutional SDD: implementar as tasks da sprint ativa em ciclo TDD atomico, sob os gates mecanicos. Use quando o usuario diz 'sprint', 'implementar as tasks', 'proxima sprint', ou o plano tem sprint ativa pronta.
---

## Papel

Implementar as tasks da sprint ativa, uma por vez, em ciclo TDD atomico.

## Antes de qualquer coisa, carregue o contrato

```bash
sdd-rota sprint
```

Esse comando imprime, **a partir do catalogo de policy**, o que esta rota entrega, as secoes
obrigatorias de cada artefato, as regras que valem aqui e os gates que rodam. Siga o que ele
imprimir.

> Este arquivo e deliberadamente fino. Descrever o processo aqui criaria uma segunda fonte
> de verdade para o mesmo fato — e foi assim que a versao anterior deste framework chegou a
> ter tres formas diferentes de criterio de aceite em tres pontos do MESMO ciclo, nenhuma
> delas quebrando teste. O processo vive em `policy/`; a skill so aponta.

## Especifico desta rota

Delegue aos sub-agentes **pelo nome**, em janela propria: `task-agent` (so leitura), `code-agent` (o unico que escreve), `review-agent` (**sem permissao de escrita**, por construcao — ele acha e reporta, a correcao volta pelo `code-agent`), `memory-agent` (encerra a sprint).

Rodar os quatro papeis na sessao principal desperdica a janela de contexto e devolve a auditoria ao esforco baixo. Foi uma falha que ja custou caro.

## Ao terminar

```bash
sdd-gates
```

Falha = pare e reporte, nao contorne. `pulado` nao e aprovacao: o relatorio diz quantos gates
de fato verificaram alguma coisa.
