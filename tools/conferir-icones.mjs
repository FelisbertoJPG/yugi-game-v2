/**
 * Confere as ARTES do catálogo de ícones.
 *
 *   node tools/conferir-icones.mjs
 *
 * Desde a migration 0039 a imagem mora no BANCO, na coluna `imagem` de cada
 * ícone. Antes era um arquivo em `web/img/icones/` que viajava no `game.zip`, e
 * este script existia para cruzar as duas fontes — a mesma família do
 * `boosters:check` e do `conteudo:check`.
 *
 * Com uma fonte só, a pergunta ficou mais simples e continua valendo a pena:
 * **algum ícone está sem arte?** A coluna é nullable de propósito (uma migração
 * futura precisa poder criar a linha antes da imagem), então o banco aceita —
 * e quem joga vê o círculo genérico no lugar do desenho, sem erro em lugar
 * nenhum.
 *
 * Só lê, não escreve nada; a chave é a publishable, a mesma que vai no jogo.
 */
const URL_BASE = 'https://shclhlbfkdnnqxboiuqc.supabase.co';
const KEY = 'sb_publishable_FxGEPSbXqJEBBUqG9ugJ6w_3z5AaVzC';

const verde = (t) => `\x1b[32m${t}\x1b[0m`;
const vermelho = (t) => `\x1b[31m${t}\x1b[0m`;
const amarelo = (t) => `\x1b[33m${t}\x1b[0m`;

/** O MESMO formato do `check` da coluna e do `caminhoDoIcone` no cliente. */
const IMAGEM = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

const campos = 'id,nome,imagem,preco,raridade,gratuito,na_loja';
const r = await fetch(`${URL_BASE}/rest/v1/icones?select=${campos}&order=ordem,nome`,
                      { headers: { apikey: KEY } });
if (!r.ok) {
  console.error(vermelho(`\n  nao consegui ler o catalogo: HTTP ${r.status}\n`));
  process.exit(1);
}
const icones = await r.json();

console.log(`\n  catalogo: ${icones.length} icone(s) publicado(s)\n`);

let problemas = 0;
let bytes = 0;

for (const i of icones) {
  const ok = IMAGEM.test(i.imagem ?? '');
  if (ok) bytes += i.imagem.length; else problemas++;
  const etiquetas = [
    i.gratuito ? 'gratuito' : null,
    i.na_loja ? `loja ${i.preco} DP` : null,
    i.raridade,
    ok ? `${Math.round(i.imagem.length / 1024)} KB` : null,
  ].filter(Boolean).join(' · ');
  console.log(`  ${ok ? verde('OK      ') : vermelho('SEM ARTE')} ${i.id} — ${i.nome}  (${etiquetas})`);
}

if (problemas) {
  console.log(vermelho(`\n  ${problemas} icone(s) sem arte.`));
  console.log('  Quem joga ve o circulo generico no lugar do desenho, sem erro nenhum.');
  console.log('  Abra web/icones.html (Area de Teste), clique no icone e escolha uma imagem.\n');
  process.exit(1);
}

if (!icones.length) {
  console.log(amarelo('  nenhum icone cadastrado ainda.'));
  console.log('  Cadastre em web/icones.html (Area de Teste), logado como admin.\n');
} else {
  console.log(verde(`\n  OK: todo icone tem arte (${Math.round(bytes / 1024)} KB no total).\n`));
}
