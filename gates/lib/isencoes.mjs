// Isencoes de gate — a lista do que os gates DEIXAM de olhar.
//
// E a superficie mais perigosa do framework. Alargada, o relatorio fica verde e a varredura
// some sem quebrar teste nenhum. O v5 aprendeu isso com a allowlist do scanner de segredo,
// que precisou de dois casos so para impedir que ela casasse tudo — e o arquivo entrou na
// zona protegida porque allowlist e superficie de ataque, nao conforto.
//
// Seis travas:
//   1. ancorada     o caminho exige ^ e $. Sem eles, `vendor/x.test.mjs.bak` entra de carona
//   2. estreita     nenhum padrao pode alcancar um CANARIO — codigo comum de projeto
//   3. por gate     nao ha isencao global; ela vale para UM gate nomeado
//   4. justificada  sem motivo escrito, ninguem reabre a decisao depois
//   5. visivel      o gate reporta o que isentou (o v5 fechou o furo e a allowlist seguiu
//                   MUDA em tempo de execucao — ninguem via o arquivo sair da varredura)
//   6. honrada      o gate nomeado precisa DECLARAR que honra isencao. A trava 6 nasceu do
//                   achado A10: `design-tokens` ignorava o argumento inteiro, entao uma
//                   isencao podia passar nas cinco travas anteriores e nao isentar nada, com
//                   o relatorio reprovando como se o arquivo nao existisse. As cinco primeiras
//                   travas protegem o repositorio de uma isencao larga demais; a sexta protege
//                   o USUARIO de uma isencao que nao faz nada, que e o silencio ao contrario.

/**
 * Caminhos que uma isencao JAMAIS pode alcancar.
 *
 * Melhor do que proibir `.*` pelo nome: qualquer padrao que chegue a um destes e largo
 * demais, tenha a forma que tiver. Proibir a string `.*` so ensinaria a escrever `[^]*`.
 */
export const CANARIOS = [
  'src/index.ts',
  'src/lib/auth.ts',
  'app/main.py',
  'pages/index.tsx',
  'server/api/rota.ts',
  '.env.production',
  'supabase/migrations/001_init.sql',
  'prisma/schema.prisma',
  'package.json',
  'index.js',
];

const MOTIVO_MINIMO = 20;

/**
 * `gatesConhecidos` aceita as DUAS formas, e isso e deliberado.
 *
 * Objetos do catalogo — `{ id, isencoes: { honra } }` — ligam a trava 6. Identificadores
 * soltos mantem quem chamava antes funcionando, sem que a ausencia de declaracao vire recusa
 * surpresa: a trava 6 so recusa o que o catalogo AFIRMA nao honrar, nunca o que ele silencia.
 */
export function validarIsencoes(lista, gatesConhecidos = []) {
  if (!Array.isArray(lista)) return ['o arquivo de isencoes nao contem a lista "isencoes"'];

  const ids = gatesConhecidos.map((g) => (typeof g === 'string' ? g : g?.id));
  const naoHonram = new Set(
    gatesConhecidos
      .filter((g) => typeof g === 'object' && g?.isencoes && g.isencoes.honra === false)
      .map((g) => g.id),
  );

  const problemas = [];

  lista.forEach((entrada, i) => {
    const onde = `isencao #${i + 1}`;

    if (!entrada || typeof entrada !== 'object') {
      problemas.push(`${onde}: nao e um objeto`);
      return;
    }

    const { gate, caminho, porque } = entrada;

    // Trava 3 — por gate.
    if (!gate || typeof gate !== 'string') {
      problemas.push(`${onde}: sem o campo "gate" — nao existe isencao global`);
    } else if (!ids.includes(gate)) {
      problemas.push(`${onde}: gate desconhecido "${gate}"`);
    } else if (naoHonram.has(gate)) {
      // Trava 6. Recusar e ACIONAVEL; aceitar e ignorar e o silencio do achado A10.
      problemas.push(
        `${onde}: o gate "${gate}" nao honra isencao — ele nao varre arquivo, entao nao ha caminho a isentar. Uma isencao aqui seria aceita e nao faria nada`,
      );
    }

    // Trava 4 — justificada.
    if (typeof porque !== 'string' || porque.trim().length < MOTIVO_MINIMO) {
      problemas.push(
        `${onde}: sem motivo escrito (minimo ${MOTIVO_MINIMO} caracteres) — isencao sem motivo e isencao que ninguem reabre`,
      );
    }

    if (typeof caminho !== 'string' || caminho.length === 0) {
      problemas.push(`${onde}: sem o campo "caminho"`);
      return;
    }

    // Trava 1 — ancorada.
    if (!caminho.startsWith('^') || !caminho.endsWith('$')) {
      problemas.push(`${onde}: caminho "${caminho}" precisa comecar com ^ e terminar com $`);
      return;
    }

    let re;
    try {
      re = new RegExp(caminho);
    } catch (erro) {
      problemas.push(`${onde}: caminho nao e uma expressao valida (${erro.message})`);
      return;
    }

    // Trava 2 — estreita.
    const alcancados = CANARIOS.filter((c) => re.test(c));
    if (alcancados.length > 0) {
      problemas.push(
        `${onde}: caminho "${caminho}" e largo demais — alcanca ${alcancados.join(', ')}`,
      );
    }
  });

  return problemas;
}

/**
 * Compila as isencoes de UM gate.
 *
 * `aplicadas()` devolve o que de fato foi isentado durante a varredura — trava 5. Isencao
 * que nao aparece na saida e indistinguivel de gate desligado.
 */
export function compilarIsencoes(lista, gate) {
  const padroes = (Array.isArray(lista) ? lista : [])
    .filter((e) => e?.gate === gate && typeof e.caminho === 'string')
    .map((e) => {
      try {
        return new RegExp(e.caminho);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const usadas = new Set();

  return {
    vazia: padroes.length === 0,
    isento(caminho) {
      const casa = padroes.some((p) => p.test(caminho));
      if (casa) usadas.add(caminho);
      return casa;
    },
    aplicadas: () => [...usadas],
  };
}
