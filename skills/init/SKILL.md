---
name: init
description: Montar o esqueleto do Constitutional SDD num repositorio — memoria do projeto, valvulas de escape e o job de CI. Use quando o usuario diz 'novo projeto', 'iniciar', 'bootstrap', 'instalar o framework aqui', ou quando uma rota do SDD e pedida num diretorio que ainda nao tem `.sdd/`.

---

## Papel

Criar, no repositorio, o minimo que o framework precisa — e verificar o resultado.

## Antes de qualquer coisa, carregue o contrato

```bash
sdd-rota init
```

Esse comando imprime, **a partir do catalogo de policy**, o que esta rota entrega, as regras
que valem aqui e os gates que rodam. Siga o que ele imprimir.

> Este arquivo e deliberadamente fino. Descrever o processo aqui criaria uma segunda fonte
> de verdade para o mesmo fato — e foi assim que a versao anterior deste framework chegou a
> ter tres formas diferentes de criterio de aceite em tres pontos do MESMO ciclo, nenhuma
> delas quebrando teste. O processo vive em `policy/`; a skill so aponta.

## Especifico desta rota

O bootstrap e um comando, nao uma lista de arquivos para voce criar a mao:

```bash
sdd-init
```

Ele cria o que falta, **preserva o que ja existe**, e termina rodando os gates no projeto
recem-criado. Se o projeto nascer reprovado, isso e defeito do framework — reporte, nao
conserte por fora. A versao anterior entregou projetos reprovados de fabrica por tres
versoes seguidas, porque ninguem verificava o produto do bootstrap.

## Ao terminar

```bash
sdd-gates
```

Falha = pare e reporte, nao contorne. `pulado` nao e aprovacao: o relatorio diz quantos gates
de fato verificaram alguma coisa.
