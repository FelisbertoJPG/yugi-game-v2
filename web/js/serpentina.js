/**
 * **Quantos quadros cabem numa linha da serpentina** — a conta da Trilha de
 * Duelos, sem DOM e sem CSS, para poder ser testada em Node.
 *
 * A trilha é uma serpentina: as linhas alternam o sentido e os quadros são
 * ligados por traços que saem do próprio quadro (`::after` horizontal,
 * `::before` vertical). Esse desenho depende de UMA coisa: **todas as linhas
 * terem a mesma largura**. A linha invertida é `row-reverse`, então ela encosta
 * os quadros na borda DIREITA do espaço que recebe — se esse espaço for a tela
 * inteira, a linha de baixo vai parar do outro lado do monitor e o conector
 * vertical desce para o vazio.
 *
 * Era exatamente o sintoma relatado: *"as conexões ficam quebradas quando a
 * tela fica cheia ou o tamanho da janela muda"*. O desenho antigo fixava
 * **quatro** por linha, escrito à mão, e nunca media nada — então ele só estava
 * certo na largura em que foi desenhado.
 *
 * A conta erra CALADA nos dois sentidos, e é por isso que ela mora aqui com
 * teste próprio:
 *
 *   • **para mais** (esquecer que são `n − 1` vãos, e não `n`): a linha fica
 *     mais larga que o espaço, transborda, e a serpentina inteira sai do lugar
 *     sem nenhum aviso;
 *   • **para menos**: cabem cinco e ele põe quatro — nada quebra, só sobra um
 *     buraco à direita que ninguém identifica como defeito.
 */

/**
 * Quantos quadros de `quadro` px, separados por vãos de `vao` px, cabem em
 * `largura` px.
 *
 * `n` quadros ocupam `n*quadro + (n-1)*vao`. Invertendo:
 * `n = (largura + vao) / (quadro + vao)`.
 *
 * Nunca devolve zero: numa janela estreitíssima a serpentina vira uma coluna de
 * um quadro por linha, que continua sendo um caminho legível. Devolver zero
 * faria o laço que fatia a lista **não avançar nunca** — a tela congelaria com
 * o navegador a 100% de CPU, que é bem pior que um layout apertado.
 */
export function quantosCabem(largura, quadro, vao) {
  if (!(largura > 0) || !(quadro > 0)) return 1;
  const v = vao > 0 ? vao : 0;
  return Math.max(1, Math.floor((largura + v) / (quadro + v)));
}

/**
 * O inverso: a largura exata de uma linha com `n` quadros. É a mesma conta que
 * o `calc()` de `.linha` faz no CSS, e existe aqui para o teste poder provar
 * que as duas são inversas — uma linha que o `quantosCabem` autoriza nunca pode
 * ser mais larga que o espaço que ele mediu.
 */
export function larguraDaLinha(n, quadro, vao) {
  if (!(n > 0)) return 0;
  return n * quadro + (n - 1) * (vao > 0 ? vao : 0);
}
