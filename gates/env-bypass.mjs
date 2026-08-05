// Gate `env-bypass` — nenhum atalho de desenvolvimento em configuracao de producao.
//
// O atalho que alguem cria para testar local e o que vaza para producao sem ninguem notar.
//
// DOIS EIXOS, e a distincao entre eles e o desenho inteiro deste arquivo:
//
//   relaxavel-so-em-dev   2FA, lockout, rate limit, verificacao, TLS. Desligar em
//                         desenvolvimento e o caminho legitimo — acusar ali reprovaria quem
//                         esta certo. Em producao ou staging, e bloqueador.
//
//   nunca-relaxa          isolamento de tenant, anti-injecao/sanitizacao, cifra de campo.
//                         Nao ha ambiente em que desligar isso seja aceitavel, nem local:
//                         o codigo escrito com o filtro de tenant desligado e o MESMO que
//                         vai para producao. Este eixo era regra em prosa no v5 e nao tinha
//                         gate nenhum.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Perfis onde relaxar deixa de ser legitimo.
const PROTEGIDO = [
  /(^|[.\/])(production|producao|prod|staging|homolog\w*)([.\/]|$)/i,
];

// Perfis explicitamente de desenvolvimento — verificados ANTES, porque `.env.development`
// tambem casaria padroes genericos.
const DESENVOLVIMENTO = [
  /(^|[.\/])(development|desenvolvimento|dev|local|test|testing|example|sample)([.\/]|$)/i,
];

const ARQUIVO_CONFIG =
  /(^|\/)(\.env($|\.)|.*\.(env|ini|cfg|conf|properties)$|(docker-)?compose[^/]*\.ya?ml$|config\/[^/]+\.(json|ya?ml|toml|js|ts)$)/i;

// Chaves cujo desligamento so e aceitavel fora de producao.
const RELAXAVEL = [
  /^(DISABLE|SKIP|BYPASS|ALLOW_INSECURE|INSECURE|DESABILITAR|PULAR|IGNORAR|SEM)_?/i,
  /^NO_/i,
  /^(RATE_?LIMIT|LOCKOUT|MFA|2FA|OTP|CAPTCHA|CSRF|HELMET|VERIFY_?SSL|SSL_?VERIFY|EMAIL_?VERIFICATION|LIMITE)/i,
  /^NODE_TLS_REJECT_UNAUTHORIZED$/i,
];

// Chaves que nao se relaxam em ambiente nenhum.
const NUNCA_RELAXA = [
  /TENANT/i,
  // `_` e caractere de palavra, entao `\b` NAO existe entre `SKIP` e `RLS`: a borda de
  // palavra nunca casa dentro de `SKIP_RLS`. A fronteira aqui e o separador.
  /(^|[_-])RLS([_-]|$)|ROW_?LEVEL/i,
  /SANITI[SZ]/i,
  /(FIELD_)?ENCRYPT/i,
  /INJECT/i,
];

// Valores que significam "desligado".
const DESLIGADO = /^(false|0|no|off|nao|não|disabled?)$/i;
const LIGADO = /^(true|1|yes|on|sim|enabled?)$/i;

export function ehPerfilProtegido(caminho) {
  if (DESENVOLVIMENTO.some((p) => p.test(caminho))) return false;
  return PROTEGIDO.some((p) => p.test(caminho));
}

/**
 * A chave, com este valor, representa um controle DESLIGADO?
 *
 * O valor importa tanto quanto o nome: `DISABLE_AUTH=false` e `RATE_LIMIT_ENABLED=true` sao
 * configuracoes corretas, e acusa-las e o defeito que faz alguem desligar o gate.
 */
function desligado(chave, valor) {
  // "NO" exige o separador. Sem ele, NODE_TLS_REJECT_UNAUTHORIZED era lido como chave
  // negativa, e o bypass de TLS mais direto que existe passava batido. Mesma familia do
  // "tokenizer" no gate de secrets: prefixo sem fronteira acusa ou absolve a palavra errada.
  const negativa = /^(DISABLE|SKIP|BYPASS|INSECURE|ALLOW_INSECURE|DESABILITAR|PULAR|IGNORAR|SEM)/i.test(chave) || /^NO_/i.test(chave);
  if (negativa) return LIGADO.test(valor);
  if (/^NODE_TLS_REJECT_UNAUTHORIZED$/i.test(chave)) return valor.trim() === '0';
  return DESLIGADO.test(valor);
}

export function analisar({ arquivos = [] } = {}) {
  const configs = arquivos.filter((a) => ARQUIVO_CONFIG.test(a.caminho));

  if (configs.length === 0) {
    return {
      estado: 'pulado',
      achados: [],
      aviso: 'nenhum arquivo de configuracao de ambiente encontrado — nada foi conferido',
    };
  }

  const achados = [];

  for (const a of configs) {
    const protegido = ehPerfilProtegido(a.caminho);

    a.conteudo.split(/\r?\n/).forEach((linha, i) => {
      if (/^\s*[#;]/.test(linha)) return; // comentario nao e configuracao

      const m = linha.match(/^\s*(?:export\s+)?["']?([A-Za-z_][\w.-]*)["']?\s*[:=]\s*["']?([^"'#;]*)["']?/);
      if (!m) return;

      const [, chave, valorBruto] = m;
      const valor = valorBruto.trim();
      if (!valor) return;

      const registrar = (eixo, motivo) =>
        achados.push({ arquivo: a.caminho, linha: i + 1, chave, valor, eixo, motivo });

      if (NUNCA_RELAXA.some((p) => p.test(chave)) && desligado(chave, valor)) {
        registrar(
          'nunca-relaxa',
          `"${chave}" desliga um controle que nao se relaxa em ambiente nenhum — nem em desenvolvimento`,
        );
        return;
      }

      if (protegido && RELAXAVEL.some((p) => p.test(chave)) && desligado(chave, valor)) {
        registrar(
          'relaxavel-so-em-dev',
          `"${chave}" desliga um controle de seguranca num perfil de producao/staging`,
        );
      }
    });
  }

  return { estado: achados.length ? 'falha' : 'ok', achados, aviso: null };
}

// ------------------------------------------------------------------ varredura

const IGNORAR_DIR = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

export async function rodar(raizProjeto) {
  const arquivos = [];
  for await (const rel of caminhar(raizProjeto)) {
    const conteudo = await readFile(join(raizProjeto, rel), 'utf8').catch(() => '');
    arquivos.push({ caminho: rel, conteudo });
  }
  return analisar({ arquivos });
}

async function* caminhar(raizProjeto, prefixo = '', profundidade = 0) {
  if (profundidade > 6) return;
  const entradas = await readdir(join(raizProjeto, prefixo), { withFileTypes: true }).catch(() => []);
  for (const e of entradas) {
    if (IGNORAR_DIR.has(e.name)) continue;
    const rel = prefixo ? `${prefixo}/${e.name}` : e.name;
    if (e.isDirectory()) yield* caminhar(raizProjeto, rel, profundidade + 1);
    else if (ARQUIVO_CONFIG.test(rel)) yield rel;
  }
}
