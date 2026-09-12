/**
 * A **GAVETA** do Editor de Cena: as peças, agrupadas em seções dobráveis.
 *
 * Ela é um módulo próprio porque as DUAS telas a desenham igual — a página
 * (`cenapagina.js`) e a bancada (`tools/bancada-cena.mjs`). Duas cópias
 * divergiriam caladas, que é o que já aconteceu com a interação do editor antes
 * de ela virar `montarEditor`.
 *
 * ## Por que grupos, e por que o do Tag Force nasce FECHADO
 *
 * São 142 peças importadas do Tag Force contra uma dúzia de peças base. Numa
 * lista só, as importadas enterram as outras — e são justamente elas que quem
 * monta uma cena usa primeiro (uma árvore, uma pedra, uma placa de chão).
 *
 * Então cada grupo é um `<details>`, e o do Tag Force nasce fechado: ele é o
 * acervo grande em que se procura por nome, e não a prateleira do dia a dia.
 *
 * > **`<details>`/`<summary>` é HTML, não JS.** Abrir e fechar é do navegador:
 * > sem estado nosso, sem ouvinte de clique, e sem o defeito clássico de um
 * > acordeão escrito à mão — o `display` que some junto com a classe e deixa a
 * > seção aberta e vazia.
 */

/** O grupo em que uma peça do Tag Force cai. Nasce fechado (ver o cabeçalho). */
export const GRUPO_TAGFORCE = 'Tag Force — modelos de cenário';

/** A ordem das seções. O que não estiver aqui vai para o fim, na ordem que veio. */
export const ORDEM = ['Árvores e plantas', 'Pedras', 'Chão', GRUPO_TAGFORCE];

/**
 * Junta os dois catálogos numa lista só, cada peça com o seu `grupo`.
 *
 * As base vêm primeiro **na ordem de `ORDEM`**, e não na ordem em que chegaram:
 * a gaveta é lida de cima para baixo, e o que se usa mais tem de estar em cima.
 */
export function juntarCatalogos(base, tagforce) {
  const doTag = (tagforce ?? []).map((p) => ({ ...p, grupo: p.grupo ?? GRUPO_TAGFORCE }));
  return [...(base ?? []), ...doTag];
}

/**
 * Agrupa e ordena. Devolve `[{ grupo, pecas, aberto }]` — pronto para desenhar.
 *
 * `filtro` é o termo da busca: com ele, **todos os grupos abrem**, porque
 * procurar dentro de uma seção fechada não acha nada e parece que a busca não
 * funciona. Sem termo, só o Tag Force fica fechado.
 */
export function agrupar(catalogo, filtro = '') {
  const termo = String(filtro ?? '').trim().toLowerCase();
  const casa = (p) => !termo
    || p.id.toLowerCase().includes(termo)
    || String(p.nome ?? '').toLowerCase().includes(termo);

  const mapa = new Map();
  for (const p of catalogo ?? []) {
    if (!casa(p)) continue;
    const g = p.grupo || 'Outras';
    if (!mapa.has(g)) mapa.set(g, []);
    mapa.get(g).push(p);
  }

  const ordenados = [...mapa.entries()].sort((a, b) => {
    const ia = ORDEM.indexOf(a[0]), ib = ORDEM.indexOf(b[0]);
    // fora da ORDEM vai para o fim, mantendo a ordem em que apareceu
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });

  return ordenados.map(([grupo, pecas]) => ({
    grupo,
    pecas,
    // buscando, tudo abre: seção fechada esconde o resultado e a busca parece
    // não funcionar
    aberto: !!termo || grupo !== GRUPO_TAGFORCE,
  }));
}

/**
 * Desenha a gaveta dentro de `alvo`. Devolve o mapa `id → botão`, que é como a
 * tela marca qual peça está na mão.
 *
 * `aoEscolher(id)` é chamado no clique — inclusive na peça já ativa, porque
 * clicar de novo na mesma é o gesto de LARGAR (a saída mais perto da mão de
 * quem acabou de pegá-la, e que não exige descobrir o `Esc`).
 */
/**
 * Um interruptor de três estados para uma regra de classe ou de peça.
 *
 * Três, e não dois, porque **"não decidi" não é "decidi que não"**: o primeiro
 * volta ao padrão do catálogo (a altura decide a colisão, o `terreno` decide o
 * relevo) e o segundo é uma decisão que fica gravada. Com um par de caixinhas
 * ligado/desligado não haveria como DESFAZER uma decisão de classe — ela ficaria
 * para sempre, e a classe inteira herdaria um `false` que ninguém quis.
 */
function interruptor(rotulo, valor, aoTrocar, titulo) {
  const sel = document.createElement('select');
  sel.className = 'regra';
  if (titulo) sel.title = titulo;
  for (const [v, texto] of [['', rotulo + ': padrão'], ['sim', rotulo + ': sim'], ['nao', rotulo + ': não']]) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = texto;
    sel.appendChild(o);
  }
  sel.value = valor === true ? 'sim' : valor === false ? 'nao' : '';
  sel.onchange = () => aoTrocar(sel.value === '' ? undefined : sel.value === 'sim');
  // clicar no seletor NÃO pode abrir/fechar o `<details>` nem escolher a peça:
  // ele mora dentro dos dois, e o clique sobe
  sel.onclick = (e) => e.stopPropagation();
  return sel;
}

/**
 * `regras` e `aoMudarRegra` são opcionais — sem eles a gaveta é a de antes.
 * É o que deixa `tools/bancada-cena.mjs` seguir montando a mesma gaveta sem
 * carregar a tela de regras junto.
 */
export function desenharGaveta(alvo, secoes, aoEscolher,
                               { limitePorGrupo = 300, regras = null, aoMudarRegra = null } = {}) {
  alvo.textContent = '';
  const botoes = new Map();

  for (const s of secoes) {
    const det = document.createElement('details');
    det.className = 'grupo';
    det.open = s.aberto;

    const sum = document.createElement('summary');
    const nome = document.createElement('span');
    nome.textContent = s.grupo;
    const conta = document.createElement('span');
    conta.className = 'conta';
    conta.textContent = s.pecas.length;
    sum.append(nome, conta);
    det.appendChild(sum);

    // Os interruptores da CLASSE inteira. É o pedido: decidir de atacado que a
    // classe X não colide, e depois abrir a exceção peça a peça lá dentro.
    if (aoMudarRegra) {
      const linha = document.createElement('div');
      linha.className = 'regras';
      linha.append(
        interruptor('colide', regras?.grupos?.[s.grupo]?.colide,
          (v) => aoMudarRegra('grupos', s.grupo, 'colide', v),
          'barra quem anda — o padrão é decidir pela altura da peça'),
        interruptor('chão', regras?.grupos?.[s.grupo]?.terreno,
          (v) => aoMudarRegra('grupos', s.grupo, 'terreno', v),
          'acompanha o relevo — marque para uma estrada virar chão'),
      );
      det.appendChild(linha);
    }

    for (const p of s.pecas.slice(0, limitePorGrupo)) {
      const b = document.createElement('button');
      b.className = 'peca';
      b.type = 'button';

      const rot = document.createElement('span');
      // o nome legível quando existe (as base têm), o id quando não (Tag Force).
      // `textContent` sempre: o id vem de um arquivo gerado, e o nome é nosso,
      // mas a regra do projeto é uma só para texto que vai à tela.
      rot.textContent = p.nome ?? p.id;
      const med = document.createElement('span');
      med.className = 'medida';
      med.textContent = `${p.dim[0]}×${p.dim[1]}×${p.dim[2]} m · ${p.tri} tri`;
      b.append(rot, med);
      b.onclick = () => aoEscolher(p.id);
      botoes.set(p.id, b);
      det.appendChild(b);

      // A EXCEÇÃO dentro da classe. Só aparece para quem já mexeu na classe ou
      // na peça: pendurar dois seletores em cada uma das 142 do Tag Force
      // transformaria a gaveta num formulário e esconderia as peças, que são o
      // que se veio procurar aqui.
      const daPeca = regras?.pecas?.[p.id];
      const daClasse = regras?.grupos?.[s.grupo];
      if (aoMudarRegra && (daPeca || daClasse)) {
        const linha = document.createElement('div');
        linha.className = 'regras excecao';
        linha.append(
          interruptor('colide', daPeca?.colide,
            (v) => aoMudarRegra('pecas', p.id, 'colide', v), 'só esta peça'),
          interruptor('chão', daPeca?.terreno,
            (v) => aoMudarRegra('pecas', p.id, 'terreno', v), 'só esta peça'),
        );
        det.appendChild(linha);
      }
    }

    if (s.pecas.length > limitePorGrupo) {
      const nota = document.createElement('div');
      nota.className = 'nota';
      nota.textContent = `+${s.pecas.length - limitePorGrupo} — refine a busca`;
      det.appendChild(nota);
    }
    alvo.appendChild(det);
  }
  return botoes;
}
