using System.Collections.Generic;

namespace YGO
{
    /// <summary>
    /// Representa uma ação disponível para uma carta específica.
    /// </summary>
    public struct CardAction
    {
        public uint code;       // ID da carta
        public byte controller; // Quem controla (0 ou 1)
        public byte location;   // Onde está (2=mão, 4=campo, etc.)
        public byte sequence;   // Posição na zona
        public int index;       // Índice na lista original (usado na resposta ao motor)
    }

    /// <summary>
    /// Dados parseados de um MSG_SELECT_IDLECMD.
    /// Contém tudo que o jogador pode fazer neste momento.
    /// </summary>
    public class IdleCommandData
    {
        public int player;
        public List<CardAction> summonable = new List<CardAction>();      // Invocação Normal
        public List<CardAction> spSummonable = new List<CardAction>();    // Invocação Especial
        public List<CardAction> repositionable = new List<CardAction>(); // Mudar posição
        public List<CardAction> activatable = new List<CardAction>();     // Efeitos ativáveis
        public List<CardAction> settable = new List<CardAction>();        // Setar (virar p/ baixo)
        public bool canBattlePhase;
        public bool canEndPhase;

        /// <summary>
        /// Verifica se uma carta específica (pelo ID) pode ser invocada normalmente.
        /// </summary>
        public bool CanNormalSummon(uint cardId)
        {
            foreach (var action in summonable)
                if (action.code == cardId) return true;
            return false;
        }

        /// <summary>
        /// Retorna o índice da carta na lista de invocáveis para montar a resposta.
        /// </summary>
        public int GetSummonIndex(uint cardId)
        {
            for (int i = 0; i < summonable.Count; i++)
                if (summonable[i].code == cardId) return i;
            return -1;
        }

        /// <summary>
        /// Verifica se uma carta pode ser setada.
        /// </summary>
        public bool CanSet(uint cardId)
        {
            foreach (var action in settable)
                if (action.code == cardId) return true;
            return false;
        }

        public int GetSetIndex(uint cardId)
        {
            for (int i = 0; i < settable.Count; i++)
                if (settable[i].code == cardId) return i;
            return -1;
        }
    }
}
