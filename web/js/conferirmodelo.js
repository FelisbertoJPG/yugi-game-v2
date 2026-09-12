/**
 * **Este `.glb` serve para o nosso boneco?** — a regra, sem tela e sem Node.
 *
 * Dois lugares perguntam isso: `tools/conferir-modelos.mjs` (antes de o arquivo
 * entrar no repositório) e a **Bancada de Modelos** (`web/modelos.html`, quando
 * se arrasta um arquivo para a tela). Duas cópias da regra divergiriam caladas —
 * o CLI aprovaria o que a bancada recusa, e ninguém saberia qual está certo.
 *
 * Por isso aqui não há `fs`, não há `three` e não há DOM: só o cabeçalho JSON de
 * um glTF entrando e um veredito saindo. É o que deixa `conferirmodelo.test.mjs`
 * rodar em Node.
 *
 * ---
 *
 * ## O ESQUELETO deixou de reprovar
 *
 * Até 07/09/2026 um `.glb` com `skins` era recusado aqui: `boneco3d.js` pendura
 * malhas rígidas nas juntas, e um modelo rigado entrava e ficava parado numa
 * pose de T enquanto o boneco andava. Como quase todo personagem grátis vem
 * rigado, isso reprovava o mundo inteiro.
 *
 * `repartir.js` mudou o caso: sem nós de junta, o corpo é fatiado pela POSIÇÃO
 * (cabeça, tronco, braços, pernas) a partir da pose de bind, e as fatias giram.
 * O rig é ignorado — e não faz falta, porque nunca usámos animação de arquivo.
 *
 * **Regra que contradiz o código é pior que regra nenhuma**: ela reprova o que
 * funciona, e quem a lê vai procurar outro pacote. Por isso este arquivo mudou
 * junto, e não depois.
 *
 * ## Por que TRÊS vereditos e não dois
 *
 * "Não serve" manda procurar outro pacote; "precisa de ajuste" manda reexportar
 * o que já se tem. Um veredito só transformaria as duas coisas em "deu errado",
 * e a segunda é a que tem conserto.
 */

/** A altura do boneco, em metros. A mesma de `modelos.js` (`ALTURA_BONECO`). */
export const ALTURA_BONECO = 1.72;

/** As juntas que `boneco3d.js` conhece. */
export const JUNTAS = ['raiz', 'tronco', 'cabeca', 'bracoE', 'bracoD', 'pernaE', 'pernaD'];

/**
 * Os nomes que o Kenney usa, e para onde eles vão.
 *
 * Não é conveniência: é o que o `modelos.json` já grava em `juntas`, e ter a
 * tabela aqui deixa a bancada MONTAR esse trecho de manifesto sozinha, em vez
 * de a pessoa digitar seis pares à mão e descobrir o erro de digitação só
 * quando o braço não mexer.
 */
export const APELIDOS = {
  root: 'raiz', torso: 'tronco', head: 'cabeca',
  'arm-left': 'bracoE', 'arm-right': 'bracoD',
  'leg-left': 'pernaE', 'leg-right': 'pernaD',
  // outras convenções comuns, para o mesmo apelido não ter de ser descoberto
  // duas vezes por quem experimenta um pacote novo
  hips: 'raiz', spine: 'tronco', chest: 'tronco',
  armL: 'bracoE', armR: 'bracoD', legL: 'pernaE', legR: 'pernaD',
};

const MAGIC = 0x46546c67;      // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"

/**
 * O cabeçalho JSON de um `.glb`, a partir de um `ArrayBuffer`.
 *
 * O binário é `magic | versão | tamanho` seguido de chunks, e o primeiro chunk
 * é o JSON. Ler isso à mão é mais barato que carregar um parser — e é o que
 * permite responder "serve?" **sem decodificar um único vértice**.
 *
 * Levanta com mensagem legível: quem arrastou um `.fbx` para a bancada precisa
 * ler "não é um .glb", e não um `RangeError` de leitura fora do buffer.
 */
export function lerCabecalhoGlb(buffer) {
  const v = new DataView(buffer);
  if (v.byteLength < 12 || v.getUint32(0, true) !== MAGIC) {
    // O `.gltf` SOLTO (JSON + `.bin` + `textures/` ao lado) é a outra metade do
    // formato, e é como o Sketchfab entrega por padrão. Recusá-lo pela
    // assinatura mandaria converter o arquivo só para descobrir o que ele é —
    // quando o JSON já está aqui, legível, com tudo o que a conferência pede.
    // Um `.vroid` é o PROJETO do VRoid Studio, e não um modelo: um zip com o
    // formato interno deles. É a confusão mais provável de quem acabou de criar
    // um personagem lá — o arquivo que o programa salva sozinho não é o que se
    // exporta. Dizer "não é um .glb" mandaria procurar o defeito no lugar
    // errado; o que falta é um passo, e ele tem nome.
    if (v.getUint8(0) === 0x50 && v.getUint8(1) === 0x4b) {
      throw new Error('isto e um arquivo de PROJETO (.vroid / zip), nao um modelo. '
        + 'No VRoid Studio use Exportar -> VRM e traga o .vrm');
    }
    const texto = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(v.byteLength, 64)));
    if (texto.trimStart().startsWith('{')) {
      try {
        return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer)));
      } catch {
        throw new Error('parece um .gltf mas o JSON esta quebrado');
      }
    }
    throw new Error('nao e um .glb (o arquivo nao comeca com "glTF")');
  }
  const total = Math.min(v.getUint32(8, true), v.byteLength);
  let off = 12;
  while (off + 8 <= total) {
    const tam = v.getUint32(off, true);
    const tipo = v.getUint32(off + 4, true);
    off += 8;
    if (tipo === CHUNK_JSON) {
      const bytes = new Uint8Array(buffer, off, Math.min(tam, total - off));
      return JSON.parse(new TextDecoder().decode(bytes));
    }
    off += tam;
  }
  throw new Error('glb sem bloco JSON');
}

/**
 * O que interessa de um glTF.
 *
 * A caixa envolvente sai dos `min`/`max` dos acessores de POSITION — a
 * especificação os torna obrigatórios para esse atributo, então o tamanho se
 * mede de graça. Ler o binário inteiro para responder "que altura tem?" seria
 * pagar megabytes por seis números.
 */
export function resumoDoGltf(g) {
  let tri = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (const m of g?.meshes ?? []) {
    for (const p of m.primitives ?? []) {
      const pos = g.accessors?.[p.attributes?.POSITION];
      const idx = p.indices !== undefined ? g.accessors?.[p.indices] : null;
      tri += Math.floor(((idx ?? pos)?.count ?? 0) / 3);
      if (Array.isArray(pos?.min) && Array.isArray(pos?.max)) {
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], pos.min[i]);
          max[i] = Math.max(max[i], pos.max[i]);
        }
      }
    }
  }

  const nos = (g?.nodes ?? []).map((n) => n.name).filter(Boolean);
  const imgs = g?.images ?? [];
  return {
    tri,
    nos,
    skins: (g?.skins ?? []).length,
    animacoes: (g?.animations ?? []).map((a) => a.name ?? '?'),
    materiais: (g?.materials ?? []).length,
    externas: imgs.map((i) => i.uri).filter((u) => u && !String(u).startsWith('data:')),
    embutidas: imgs.filter((i) => i.uri === undefined || String(i.uri).startsWith('data:')).length,
    // `null` quando nenhum acessor trouxe min/max: dizer "0 m" seria INVENTAR
    caixa: Number.isFinite(min[0]) ? { min, max, alt: max[1] - min[1] } : null,
    // VRM declara-se numa extensão: é o mesmo binário glTF, com rig humanoide
    vrm: !!(g?.extensions?.VRM || g?.extensions?.VRMC_vrm),
  };
}

/**
 * As juntas reconhecidas neste arquivo: `[{ no, junta }]`.
 *
 * `raiz` entra aqui (é informação: o nó existe), mas NÃO entra no manifesto —
 * ver `trechoDoManifesto`.
 */
export function juntasReconhecidas(nos) {
  return (nos ?? [])
    .map((no) => ({ no, junta: JUNTAS.includes(no) ? no : APELIDOS[no] }))
    .filter((x) => x.junta);
}

/**
 * O trecho de `modelos.json` para este arquivo — pronto para copiar.
 *
 * Existe para tirar da mão o que é mecânico e erra calado: seis pares de
 * `no: junta` digitados à mão, e um erro de digitação num deles não dá erro
 * nenhum — o braço simplesmente não mexe.
 *
 * **`raiz` fica de fora, e isso não é economia de linha.** `repartirPorJunta`
 * acha a junta de cada malha SUBINDO pelos pais até encontrar um nome conhecido.
 * Com `root: "raiz"` no manifesto, o nó de topo vira um nome conhecido — e toda
 * malha que não estivesse sob uma junta nomeada pararia ali, em vez de cair na
 * junta padrão do slot. Ela ficaria pendurada na raiz, imóvel, enquanto o resto
 * do corpo anda. O `modelos.json` que já está no projeto omite `root` pelo mesmo
 * motivo; gerar um trecho que o inclui contrariaria o que funciona hoje.
 */
export function trechoDoManifesto(caminho, nos) {
  const pares = juntasReconhecidas(nos).filter((p) => p.no !== p.junta && p.junta !== 'raiz');
  if (!pares.length) return { corpo: caminho };
  return {
    corpo: { arquivo: caminho, juntas: Object.fromEntries(pares.map((p) => [p.no, p.junta])) },
  };
}

/**
 * `{ veredito, notas, resumo }`. `comoPeca` muda duas conferências, porque as
 * duas leis do README §3/§5 divergem aqui: o **corpo** é normalizado para
 * 1,72 m e mantém a textura; a **peça** entra na escala em que foi exportada e
 * perde a textura para o tingimento do vestiário.
 */
export function conferir(nome, g, { comoPeca = false } = {}) {
  const r = resumoDoGltf(g);
  const notas = [];
  let veredito = 'serve';
  const rebaixar = (v) => {
    if (veredito === 'nao' || v === 'nao') veredito = v === 'nao' ? 'nao' : veredito;
    else veredito = 'ajusta';
  };

  // O ESQUELETO deixou de reprovar em 07/09/2026, e este parágrafo é o registro
  // de por quê — uma regra que contradiz o código é pior que regra nenhuma:
  // ela reprova o que funciona, e quem a lê vai procurar outro pacote.
  //
  // `repartir.js` passou a repartir o corpo pela POSIÇÃO quando não há nós de
  // junta, e isso vale para um modelo rigado igual: a malha entra na **pose de
  // bind** (a que está gravada nos vértices) e é fatiada em cabeça, tronco,
  // braços e pernas. O `andar()` gira as fatias. O esqueleto é ignorado, e não
  // faz falta: não usávamos animação de arquivo nenhum.
  //
  // Medido num VRM do VRoid de verdade: 1,720 m, pés em y=0, e anda.
  if (r.skins > 0) {
    notas.push(['ok', `tem esqueleto (${r.skins} skin), e isso NAO reprova mais:`
      + ' o corpo entra na pose de bind e e repartido por posicao (repartir.js)']);
    notas.push(['..', 'o rig e ignorado — a pose que vale e a gravada nos vertices,'
      + ' e a de T e corrigida na entrada']);
  } else {
    notas.push(['ok', 'malha rigida (0 skins) — e o que boneco3d.js pendura nas juntas']);
  }

  const pares = juntasReconhecidas(r.nos);
  if (pares.length) {
    notas.push(['ok', `${pares.length} junta(s): ${pares.map((p) => `${p.no}->${p.junta}`).join(', ')}`]);
  } else if (comoPeca) {
    notas.push(['..', 'sem no nomeado: a peca vai INTEIRA para a junta padrao do slot'
      + ' (e o certo para cabelo e sapato; uma jaqueta precisaria dos nos)']);
  } else {
    notas.push(['..', 'sem no de junta: o corpo sera repartido pela POSICAO'
      + ' (cabeca, tronco, bracos, pernas) — e o caminho normal para modelo'
      + ' baixado, que vem com os nos renomeados para Object_17']);
  }

  for (const uri of r.externas) {
    notas.push(['..', `textura EXTERNA "${uri}" — tem de viajar junto, na pasta do .glb`
      + (comoPeca ? ' (mas PECA e' + ' descartada e tingida pelo vestiario)' : ' (senao entra BRANCO)')]);
  }
  if (!r.externas.length && !r.embutidas && r.materiais && !comoPeca) {
    notas.push(['..', 'sem textura: entra com a cor do material']);
  }

  if (r.caixa) {
    const alt = r.caixa.alt;
    if (comoPeca) {
      // a PEÇA não é normalizada: tem de vir na escala do boneco, em metros
      if (alt > ALTURA_BONECO * 1.2 || alt < 0.02) {
        notas.push(['!', `${alt.toFixed(2)} de altura — PECA nao e reescalada; exporte em metros,`
          + ` com o boneco de ${ALTURA_BONECO} m como referencia`]);
        rebaixar('ajusta');
      } else {
        notas.push(['ok', `${alt.toFixed(2)} m de altura, plausivel para uma peca`]);
      }
    } else {
      notas.push(['..', `${alt.toFixed(2)} unidades de altura -> normalizado para ${ALTURA_BONECO} m`]);
    }
  } else {
    notas.push(['!', 'sem min/max nos acessores: nao da para medir sem decodificar']);
  }

  notas.push(['..', `${r.tri} triangulos, ${r.materiais} material(is)`
    + (r.animacoes.length ? `, ${r.animacoes.length} animacao(oes) no arquivo (ignoradas hoje)` : '')]);

  return { nome, veredito, notas, resumo: r };
}
