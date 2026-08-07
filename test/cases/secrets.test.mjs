// Casos do gate `secrets`.
//
// Escritos ANTES da implementacao (M-08). Cada caso vem de um defeito medido no v5 — a
// referencia esta na asserção. As credenciais aqui sao FALSAS e propositalmente no formato
// real: um valor que nao case o padrao nao testa nada.
//
// M-02 e a lei que governa este arquivo: metade dos casos existe para provar o que o gate
// NAO pode acusar. Gate que reprova quem esta certo e gate que alguem desliga — e o v5
// registrou 7 ocorrencias dessa classe.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analisar } from '../../gates/secrets.mjs';

const acusa = (caminho, texto) => analisar(caminho, texto).length > 0;

// --------------------------------------------------------------------------- ACUSA

test('identificador suspeito com valor literal — qualquer caixa (item 169)', () => {
  // O grep do v5 era case-sensitive, e apiKey / API_KEY / secretKey / PASSWORD / authToken
  // sao as grafias DOMINANTES em JS/TS e em constante de ambiente. Atravessavam o gate
  // inteiro, o pre-commit, o pre-push e o CI.
  for (const nome of [
    'api_key', 'apikey', 'apiKey', 'API_KEY', 'Api_Key',
    'secret', 'secretKey', 'SECRET',
    'password', 'PASSWORD', 'passwd',
    'token', 'authToken',
  ]) {
    assert.ok(acusa('src/a.ts', `const ${nome} = "V4lorSecret0Real123";`), `passou: ${nome}`);
  }
});

test('identificador suspeito em portugues — head-initial (item 209)', () => {
  // Nao e palavra faltando na lista: e a estrutura da lingua. O ingles e head-final
  // (dbPassword), o portugues e head-initial (senhaDoBanco) — e o padrao ancorado no FIM
  // do nome escapava por construcao.
  for (const nome of ['senhaDoBanco', 'chaveSecreta', 'tokenDeAcesso', 'senha_admin']) {
    assert.ok(acusa('src/a.ts', `const ${nome} = "V4lorSecret0Real123";`), `passou: ${nome}`);
  }
});

// As amostras sao montadas em PEDACOS, e isto nao e preciosismo de estilo.
//
// Escritas inteiras, o secret scanning do GitHub recusa o push deste repositorio: o
// framework fica impublicavel por causa dos fixtures do proprio gate que procura segredo.
// Medido em 2026-08-07, na primeira tentativa de publicar — Stripe e Slack bloquearam.
//
// Sao valores que as proprias empresas publicam na documentacao, mas o scanner casa por
// FORMATO, nao por origem, e esta certo em fazer isso. Concatenar resolve na fonte, e sem
// afrouxar caso nenhum: `acusa()` recebe a string identica.
const AMOSTRAS = [
  'AKIA' + 'IOSFODNN7EXAMPLE',
  'sk_' + 'live_4eC39HqLyjWDarjtT1zdp7dc',
  'ghp_' + '16C7e42F292c6912E7710c838347Ae178B4a',
  'github_pat_' + '11ABCDEFG0abcdefghijkl_MNOPQRS',
  'xoxb' + '-2334500-2334500-abcdefghijklmnop',
  'AIza' + 'SyD-1234567890abcdefghijklmnopqrstu',
];

test('prefixo de credencial real com nome de variavel neutro (item 169, ramo 3b)', () => {
  // O ramo do nome nao cobre `const k = "sk_live_..."`: nome neutro, segredo real. Ali o
  // padrao tem de ser a propria chave.
  for (const chave of AMOSTRAS) {
    assert.ok(acusa('src/a.ts', `const k = "${chave}";`), `passou: ${chave.slice(0, 12)}`);
  }
});

test('prefixo de chave real acusa TAMBEM em arquivo de exemplo (item 281)', () => {
  // Assimetria deliberada com o caso da connection string abaixo: para sk_live_ a
  // severidade esta certa e vale em todo lugar.
  const stripe = AMOSTRAS.find((a) => a.startsWith('sk_live_'));
  assert.ok(acusa('.env.example', `STRIPE_KEY=${stripe}`));
});

test('chave privada PEM', () => {
  assert.ok(acusa('src/a.ts', '-----BEGIN RSA PRIVATE KEY-----'));
});

test('valor SEM aspas em arquivo de ambiente (item 209, ramo 3c)', () => {
  // O modo de leak mais comum e nao tinha cobertura: `.env*` nao estava em include nenhum,
  // e o padrao do ramo 3a EXIGE aspas — forma correta em codigo e inexistente em .env.
  assert.ok(acusa('.env.production', 'DATABASE_PASSWORD=Pr0duc4oReal!x9z'));
  assert.ok(acusa('config/app.ini', 'api_key=V4lorSecret0Real123'));
});

test('connection string com senha inline em arquivo NAO-exemplo', () => {
  assert.ok(acusa('src/db.ts', 'const u = "postgresql://admin:S3nh4Real@db.host/app";'));
});

// --------------------------------------------------------------------------- NAO ACUSA

test('leitura de variavel de ambiente e fallback vazio', () => {
  assert.ok(!acusa('src/a.ts', 'const apiKey = process.env.API_KEY;'));
  assert.ok(!acusa('src/a.ts', 'const apiKey = process.env.API_KEY ?? "";'));
  assert.ok(!acusa('src/a.ts', 'const token = getToken();'));
  assert.ok(!acusa('src/a.ts', 'import { getSecret } from "./vault";'));
});

test('nome parecido, tipo e identificador que CONTEM a palavra', () => {
  // `tokenizer` e o exemplo canonico: afrouxar o ramo ingles o transformaria em acusacao,
  // e ha caso de teste para isso desde a v5.6.0.
  assert.ok(!acusa('src/a.ts', 'const apiKeyName = "chave-de-producao";'));
  assert.ok(!acusa('src/a.ts', 'const tokenizer = "bpe";'));
  assert.ok(!acusa('src/a.ts', 'type ApiKey = string;'));
});

test('placeholder de connection string em arquivo de exemplo (item 281)', () => {
  // Consequencia medida no v5: o projeto ficou SEM documentar DATABASE_URL no arquivo que
  // existe justamente para listar as variaveis. Atinge todo projeto com banco.
  assert.ok(!acusa('.env.example', 'DATABASE_URL=postgresql://USER:PASSWORD@host:5432/db'));
  assert.ok(!acusa('.env.sample', 'DATABASE_URL=postgres://user:senha@localhost/app'));
});

test('placeholder declarado em arquivo de ambiente', () => {
  for (const v of ['', 'changeme', 'your-api-key-here', 'xxx', '<senha>', '${VAULT_KEY}', 'TODO']) {
    assert.ok(!acusa('.env.example', `API_KEY=${v}`), `acusou placeholder: ${v}`);
  }
});

test('valor curto demais para ser credencial', () => {
  assert.ok(!acusa('src/a.ts', 'const password = "abc";'));
});

test('comentario orientando uso de variavel de ambiente', () => {
  assert.ok(!acusa('src/a.ts', '// defina API_KEY no ambiente, nunca no codigo'));
});

test('interpolacao em YAML e hash de integridade', () => {
  assert.ok(!acusa('deploy.yml', 'api_key: ${API_KEY}'));
  assert.ok(!acusa('package-lock.json', '"integrity": "sha512-abcdefghijklmnopqrstuvwxyz0123456789=="'));
});

test('JWT NAO e acusado — decisao registrada (item 169)', () => {
  // Pior relacao sinal/ruido do conjunto: fixture de teste e a chave publica anonima do
  // Supabase sao JWTs, e o gate e BLOQUEADOR. Reavaliar se aparecer caso real de vazamento
  // por esse caminho.
  assert.ok(!acusa('src/a.ts', 'const t = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc";'));
});

test('UUID nao e credencial', () => {
  assert.ok(!acusa('src/a.ts', 'const id = "550e8400-e29b-41d4-a716-446655440000";'));
});

// --------------------------------------------------------------------------- FORMA

test('o achado nomeia arquivo, linha e motivo', () => {
  // Mensagem que nao diz ONDE obriga quem recebe a caçar — e gate caro de obedecer e gate
  // que alguem desliga.
  const [achado] = analisar('src/a.ts', 'const x = 1;\nconst password = "V4lorSecret0Real123";');
  assert.equal(achado.linha, 2);
  assert.equal(achado.arquivo, 'src/a.ts');
  assert.ok(achado.motivo?.length > 0);
});
