/**
 * Registro de "listas de cartas" — pools restritos que uma banlist pode
 * governar. Hoje só existe a Lista 1 (`web/js/lista1.js`), mas o desenho já é
 * pra escalar: uma banlist só precisa saber o `id` da lista que ela rege
 * (`banlist.listId`), e quem quiser o pool de verdade chama `getCardList(id)`.
 *
 * Pra adicionar uma "Lista 2" no futuro: criar `lista2.js` com sua função de
 * filtro (mesmo formato de `inLista1`) e adicionar uma entrada aqui — nada
 * mais muda (o editor de banlist e o Deck Builder já leem daqui).
 */
import { inLista1 } from './lista1.js';

export const CARD_LISTS = [
  { id: 'lista1', label: 'Lista 1', filter: inLista1 },
];

export function getCardList(id) {
  return CARD_LISTS.find((l) => l.id === id) ?? CARD_LISTS[0];
}
