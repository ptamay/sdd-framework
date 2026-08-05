// Casos do gate `env-bypass`.
//
// Escritos ANTES da implementacao (M-08).
//
// O atalho que alguem cria para testar local e o que vaza para producao sem ninguem notar.
// Dois eixos independentes, e a distincao entre eles e o desenho deste gate:
//
//   RELAXAVEL EM DEV   2FA, lockout, rate limit, verificacao de e-mail. Desligar isso em
//                      desenvolvimento e legitimo; em producao ou staging, nao.
//   NUNCA RELAXA       isolamento de tenant, anti-injecao, secrets, cifra de campo. Nao ha
//                      ambiente em que desligar isso seja aceitavel — nem local.
//
// O segundo eixo era regra em prosa no v5 e nao tinha gate nenhum.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analisar, ehPerfilProtegido } from '../../gates/env-bypass.mjs';

const arq = (caminho, conteudo) => ({ caminho, conteudo });
const acusa = (caminho, conteudo) => analisar({ arquivos: [arq(caminho, conteudo)] }).achados.length > 0;

// --------------------------------------------------------------- perfil protegido

test('reconhece os perfis de producao e staging', () => {
  for (const c of [
    '.env.production', '.env.prod', '.env.staging',
    'config/production.json', 'config/staging.yml',
    'docker-compose.prod.yml', 'app.production.toml',
  ]) {
    assert.equal(ehPerfilProtegido(c), true, `nao reconheceu como protegido: ${c}`);
  }
});

test('nao trata dev, local e test como perfil protegido', () => {
  // Relaxar em desenvolvimento e o caminho legitimo. Acusar aqui seria reprovar quem esta
  // certo, e gate assim alguem desliga (M-02).
  for (const c of [
    '.env', '.env.development', '.env.local', '.env.test', '.env.example',
    'config/development.json', 'docker-compose.yml',
  ]) {
    assert.equal(ehPerfilProtegido(c), false, `tratou como protegido: ${c}`);
  }
});

// --------------------------------------------------------------- eixo 1: relaxavel

test('bypass de controle em perfil de producao e acusado', () => {
  for (const linha of [
    'DISABLE_AUTH=true',
    'SKIP_2FA=true',
    'RATE_LIMIT_ENABLED=false',
    'SKIP_EMAIL_VERIFICATION=true',
    'BYPASS_LOCKOUT=1',
    'ALLOW_INSECURE=true',
    'NODE_TLS_REJECT_UNAUTHORIZED=0',
    'VERIFY_SSL=false',
  ]) {
    assert.ok(acusa('.env.production', linha), `passou em producao: ${linha}`);
  }
});

test('as mesmas chaves em portugues sao acusadas', () => {
  // A licao do item 209 generaliza: a lista nao pode assumir que a base de codigo e em
  // ingles. Aqui o custo de errar e o mesmo — um bypass invisivel em producao.
  for (const linha of ['DESABILITAR_AUTH=true', 'PULAR_2FA=true', 'IGNORAR_LIMITE=true']) {
    assert.ok(acusa('.env.production', linha), `passou em producao: ${linha}`);
  }
});

test('o MESMO bypass em desenvolvimento NAO e acusado', () => {
  for (const c of ['.env.development', '.env.local', '.env.test']) {
    assert.ok(!acusa(c, 'SKIP_2FA=true'), `acusou em ambiente de desenvolvimento: ${c}`);
  }
});

test('o valor importa: controle LIGADO em producao passa', () => {
  for (const linha of ['RATE_LIMIT_ENABLED=true', 'VERIFY_SSL=true', 'DISABLE_AUTH=false']) {
    assert.ok(!acusa('.env.production', linha), `acusou configuracao correta: ${linha}`);
  }
});

// --------------------------------------------------------------- eixo 2: nunca relaxa

test('desligar isolamento de tenant e acusado em QUALQUER ambiente', () => {
  // Este eixo era regra em prosa no v5 e nao tinha gate. Nao ha ambiente em que desligar
  // isolamento de tenant seja aceitavel — o dado de um cliente aparecer para outro nao vira
  // menos grave por ser "so em dev", porque o codigo que se escreve com o filtro desligado
  // e o mesmo que vai para producao.
  //
  // A asserção verifica o EIXO, não só a acusação. Sem isso o caso aceitava a resposta
  // certa pelo motivo errado: `SKIP_RLS=true` em produção era acusado pelo prefixo `SKIP_`
  // (eixo relaxavel-so-em-dev) enquanto o padrão de RLS nunca casava — e em `.env.local` o
  // mesmo bypass passava batido. Asserção no lugar errado vale menos que asserção nenhuma
  // (M-09).
  for (const c of ['.env.production', '.env.development', '.env.local']) {
    for (const linha of ['DISABLE_TENANT_ISOLATION=true', 'SKIP_RLS=true']) {
      const { achados } = analisar({ arquivos: [arq(c, linha)] });
      assert.equal(achados.length, 1, `nao acusou "${linha}" em ${c}`);
      assert.equal(achados[0].eixo, 'nunca-relaxa', `eixo errado para "${linha}" em ${c}`);
    }
  }
});

test('desligar cifra de campo ou sanitizacao e acusado em qualquer ambiente', () => {
  for (const linha of ['DISABLE_FIELD_ENCRYPTION=true', 'SKIP_SANITIZE=true', 'DISABLE_ENCRYPTION=true']) {
    assert.ok(acusa('.env.development', linha), `passou em dev: ${linha}`);
  }
});

// --------------------------------------------------------------- forma e anti-silencio

test('o achado diz arquivo, linha, chave e a qual eixo pertence', () => {
  const { achados } = analisar({
    arquivos: [arq('.env.production', 'PORT=3000\nSKIP_2FA=true')],
  });
  assert.equal(achados.length, 1);
  assert.equal(achados[0].arquivo, '.env.production');
  assert.equal(achados[0].linha, 2);
  assert.equal(achados[0].chave, 'SKIP_2FA');
  assert.equal(achados[0].eixo, 'relaxavel-so-em-dev');
});

test('projeto sem arquivo de configuracao pula com aviso', () => {
  const r = analisar({ arquivos: [arq('src/app.ts', 'const x = 1;')] });
  assert.equal(r.estado, 'pulado');
  assert.ok(r.aviso?.length > 0);
});

test('comentario nao e configuracao', () => {
  assert.ok(!acusa('.env.production', '# SKIP_2FA=true  (nunca em producao!)'));
});
