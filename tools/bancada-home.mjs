/**
 * **A bancada da HOME**: gera `bancada-home.html` na raiz, com a lateral social
 * (perfil, amigos, notificações) e o menu desenhados com dados de mentira —
 * sem servidor, sem login e sem rede. Dois cliques no arquivo.
 *
 *     node tools/bancada-home.mjs
 *
 * Existe pela mesma razão da `bancada-visual.mjs`: **mudança visual não se
 * prova em teste de lógica**. A lateral saiu publicada uma vez flutuando no
 * meio da tela, com 21 testes de notificação passando — porque nenhum deles
 * olha para onde a caixa aterrissa.
 *
 * O CSS e o MARKUP são **fatiados** do `web/index.html`, nunca copiados. Uma
 * cópia passaria a valer por si e deixaria de provar o que está no jogo: seria
 * possível consertar a bancada e publicar a home quebrada. O que a bancada
 * troca é só o que depende de rede — os nomes, o DP e a contagem viram texto
 * fixo, e o `<script type="module">` inteiro fica de fora.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fonte = fs.readFileSync(path.join(raiz, 'web', 'index.html'), 'utf8');

/** Fatia entre dois marcadores, com erro claro quando o marcador sumiu. */
function fatiar(texto, abre, fecha, oQue) {
  const i = texto.indexOf(abre);
  const j = texto.indexOf(fecha, i + abre.length);
  if (i < 0 || j < 0) {
    throw new Error(`nao achei ${oQue} em web/index.html — o marcador "${abre}" mudou?`);
  }
  return texto.slice(i + abre.length, j);
}

const css = fatiar(fonte, '<style>', '</style>', 'o CSS da home');
const corpo = fatiar(fonte, '<div class="home">', '\n</div>\n\n<!-- O cartão', 'o markup da home');

// Os dados de mentira. Só texto: nada aqui muda uma regra de layout — se
// mudasse, a bancada estaria provando outra tela.
const AMIGOS = [
  ['[22502] Felisberto', true],
  ['[11337] Ciclano', true],
  ['[448752] gabby', true],
  ['[984381] Geiso', false],
  ['[12034] cdreyer', false],
];

const linhas = AMIGOS.map(([nome, on]) => `
      <button class="amigo${on ? ' on' : ''}"${on ? '' : ' disabled'}>
        <span class="mini">🂠</span>
        <span class="nome">${nome}</span>
        <span class="estado">${on ? 'ONLINE' : 'OFFLINE'}</span>
        <span class="ponto${on ? ' on' : ''}"></span>
      </button>`).join('');

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bancada — Home</title>
<link rel="stylesheet" href="web/css/ui.css">
<style>${css}</style>
</head>
<body>
<div class="home">${corpo
  .replace('<span id="eu-nome">…</span>', '<span id="eu-nome">Felisberto</span>')
  .replace('<span class="etiqueta" id="eu-etiqueta"></span>',
           '<span class="etiqueta" id="eu-etiqueta">[22502]</span>')
  .replace('<div class="dp" id="dp">— DP</div>', '<div class="dp" id="dp">5600 DP</div>')
  .replace('<span class="n" id="amigos-n"></span>',
           `<span class="n" id="amigos-n">${AMIGOS.filter((a) => a[1]).length}/${AMIGOS.length} online</span>`)
  .replace('<div class="vazio">carregando…</div>', linhas)
  .replace('<span class="cont" id="notif-n">0</span>', '<span class="cont" id="notif-n">2</span>')
  .replace('<button class="notif-btn" id="btn-notif">', '<button class="notif-btn tem" id="btn-notif">')
  .replace('<span class="muted" id="user-tag"></span>', '<span class="muted" id="user-tag">Felisberto</span>')
  .replace('<b id="online-n">—</b>', '<b id="online-n">12</b>')
  .replace('class="online-agora frio"', 'class="online-agora"')
  .replace('<footer id="foot">carregando…</footer>',
           '<footer id="foot">sua Coleção: 1121 cartas · banco: 13.728 cartas</footer>')
}
</div>

<!-- O cartão de notificação, aberto: é o estado que mais custa conferir na
     tela real, porque exige alguém do outro lado mandando um convite. -->
<div class="fundo show" id="fundo">
  <div class="cartaz">
    <h2>NOTIFICAÇÕES</h2>
    <p class="sub">clique numa para responder</p>
    <div class="aviso-lista">
      <button class="aviso">
        <span class="icone">⚔️</span>
        <span class="txt"><b>[11337] Ciclano</b><span class="tipo">CHAMOU VOCÊ PARA DUELAR</span></span>
      </button>
      <button class="aviso">
        <span class="icone">🤝</span>
        <span class="txt"><b>[984381] Geiso</b><span class="tipo">QUER TE ADICIONAR</span></span>
      </button>
    </div>
    <div class="erro"></div>
    <div class="botoes" style="margin-top:12px"><button class="recusar">fechar</button></div>
  </div>
</div>

<button class="deck-fab" title="deck atual">🎴<span class="badge ok">✓</span></button>

<script>
// A bancada tem UM comportamento: o cartão fecha, para dar para ver a home
// atrás dele. Nada mais — o resto é a tela real, fatiada.
document.getElementById('fundo').onclick = (e) => {
  if (e.target.id === 'fundo' || e.target.classList.contains('recusar')) {
    e.currentTarget.classList.remove('show');
  }
};
</script>
</body>
</html>
`;

const saida = path.join(raiz, 'bancada-home.html');
fs.writeFileSync(saida, html);
console.log(`  bancada-home.html gerado (${(html.length / 1024).toFixed(1)} KB)`);
console.log('  dois cliques no arquivo — sem servidor, sem login.');
