/**
 * **"Visto por último"** — o carimbo de presença virando frase.
 *
 * A lateral da home dizia ONLINE/OFFLINE, e OFFLINE é a resposta para quase
 * todo mundo quase o tempo todo: não separa quem fechou o jogo há cinco minutos
 * de quem não entra há três semanas. O carimbo já existia
 * (`perfis.visto_em`, migration 0034) e agora sai por `meus_amigos`
 * (migration 0049); o que mora aqui é só a tradução dele para uma linha.
 *
 * Sem DOM e sem `fetch` de propósito: é o que permite testá-la em Node
 * (`node web/js/vistoem.test.mjs`), e ela erra **calada** de três jeitos que
 * nenhum console acusa —
 *
 *   • **carimbo que não veio.** Um cliente falando com um servidor anterior à
 *     0049 recebe o campo AUSENTE, e `new Date(undefined)` é um `Date`
 *     inválido: `toLocaleString` nele devolve "Invalid Date", que iria para a
 *     tela como se fosse uma data. Aqui isso vira `null` — "não sei dizer" —, e
 *     quem chama simplesmente não desenha a linha;
 *   • **o dia.** "há 20 horas" pode ser hoje de manhã ou anteontem à noite,
 *     conforme a hora em que se olha. O pedido foi dia E hora, então é isso que
 *     sai — com "hoje"/"ontem" no lugar da data quando cabem, que é o caso em
 *     que o número da data não diz nada a mais;
 *   • **a virada do dia.** "Ontem" é dia de CALENDÁRIO, não 24 horas: às 00:30,
 *     23:50 foi ontem, e uma conta por milissegundos diria "hoje". A conta é
 *     entre as meias-noites locais, que também atravessa horário de verão sem
 *     escorregar um dia (o dia de 23h ou 25h arredonda para 1).
 *
 * A hora é a LOCAL de quem lê — o carimbo viaja com fuso (`timestamptz`), e
 * quem está no Brasil não quer ler o horário UTC de quando o amigo saiu.
 */

const dois = (n) => String(n).padStart(2, '0');

/** A meia-noite LOCAL do dia de `d`, em ms. */
const meiaNoite = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * @param {string|number|Date|null|undefined} quando  o `visto_em` do amigo.
 * @param {Date} [agora]  injetável para o teste.
 * @returns {string|null} `"hoje às 14:32"`, `"ontem às 09:05"`,
 *   `"12/07/2026 às 21:40"` — ou `null` quando não dá para saber.
 */
export function textoVistoEm(quando, agora = new Date()) {
  if (quando === null || quando === undefined || quando === '') return null;
  const d = quando instanceof Date ? quando : new Date(quando);
  if (Number.isNaN(d.getTime())) return null;

  const hora = `${dois(d.getHours())}:${dois(d.getMinutes())}`;
  const dias = Math.round((meiaNoite(agora) - meiaNoite(d)) / 86_400_000);

  if (dias === 0) return `hoje às ${hora}`;
  if (dias === 1) return `ontem às ${hora}`;
  // Data cheia também para o FUTURO (dias < 0): relógios discordam, e "amanhã
  // às 08:00" numa lista de presença seria mais confuso que a data crua.
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()} às ${hora}`;
}
