using System;
using System.Collections.Generic;
using System.Linq;

namespace DuelServer
{
    /// <summary>
    /// IA do "NPC do Teste de Batalha" — o primeiro oponente que realmente joga.
    ///
    /// As regras são exatamente as pedidas, nesta ordem de prioridade:
    ///   4. Pote da Ganância vem sempre antes de qualquer invocação.
    ///   3. Se der para invocar um monstro de nível maior (com tributo), é ele.
    ///   2. Se o oponente tem em campo um monstro com ATK maior que tudo que o NPC
    ///      tem na mão, o NPC SETA o monstro de maior DEF (defesa).
    ///   1. Caso contrário, invoca em ataque o monstro de maior ATK (Nv 1-4).
    ///   0. Nada a fazer: encerra o turno.
    ///
    /// Nota sobre "por em defesa": pelas regras oficiais, Invocação Normal é
    /// sempre em ataque com a face para cima — quem coloca em defesa é o Set
    /// (face para baixo). Por isso a regra 2 vira um Set, que é a única forma
    /// legal de colocar um monstro em defesa no próprio turno.
    /// </summary>
    public sealed class NpcBrain
    {
        public const uint POT_OF_GREED = 55144522;

        readonly DatabaseManager _cards;
        readonly Func<int, IReadOnlyList<uint>> _fieldOf;   // monstros em campo de um jogador
        readonly Action<string> _log;

        public NpcBrain(DatabaseManager cards,
                        Func<int, IReadOnlyList<uint>> fieldOf,
                        Action<string> log = null)
        {
            _cards = cards;
            _fieldOf = fieldOf;
            _log = log ?? (_ => { });
        }

        /// <summary>O que o NPC decidiu fazer, já no vocabulário do InteractiveDuel.</summary>
        public readonly struct Play
        {
            public readonly string Action;   // activate | summon | setmonster | endturn
            public readonly int Index;
            public readonly string Why;
            public Play(string action, int index, string why)
            { Action = action; Index = index; Why = why; }
        }

        /// <summary>Decide a jogada a partir de um SELECT_IDLECMD do NPC.</summary>
        public Play Decide(InteractiveDuel.Question q, int me)
        {
            int foe = 1 - me;

            // --- regra 4: Pote da Ganância antes de tudo -----------------
            foreach (var a in q.activatable)
            {
                if (a.code == POT_OF_GREED)
                    return new Play("activate", a.index, "Pote da Ganancia primeiro (regra 4)");
            }

            // Separa a mão invocável por nível.
            var baixos = new List<(InteractiveDuel.Act act, DatabaseManager.CardStats st)>();
            var altos = new List<(InteractiveDuel.Act act, DatabaseManager.CardStats st)>();
            foreach (var a in q.summonable)
            {
                var st = _cards.Stats(a.code);
                if (!st.IsMonster) continue;
                (st.Level >= 5 ? altos : baixos).Add((a, st));
            }

            // --- regra 3: nível maior tem precedência --------------------
            if (altos.Count > 0)
            {
                var melhor = altos.OrderByDescending(x => x.st.AtkValue).First();
                return new Play("summon", melhor.act.index,
                    $"nivel {melhor.st.Level} disponivel com tributo (regra 3) — " +
                    $"{melhor.act.code} ATK {melhor.st.AtkValue}");
            }

            // --- regra 2: ameaça em campo -> setar o de maior DEF --------
            int ameaca = MaiorAtkEmCampo(foe);
            int meuMelhorAtk = baixos.Count > 0 ? baixos.Max(x => x.st.AtkValue) : -1;

            if (ameaca > meuMelhorAtk && q.settable.Count > 0)
            {
                var defensor = q.settable
                    .Select(a => (act: a, st: _cards.Stats(a.code)))
                    .Where(x => x.st.IsMonster)
                    .OrderByDescending(x => x.st.DefValue)
                    .FirstOrDefault();

                if (defensor.st.IsMonster)
                {
                    return new Play("setmonster", defensor.act.index,
                        $"oponente tem ATK {ameaca} > minha mao ({meuMelhorAtk}) — " +
                        $"setando DEF {defensor.st.DefValue} (regra 2)");
                }
            }

            // --- regra 1: maior ATK em ataque ---------------------------
            if (baixos.Count > 0)
            {
                var melhor = baixos.OrderByDescending(x => x.st.AtkValue).First();
                return new Play("summon", melhor.act.index,
                    $"maior ATK da mao: {melhor.act.code} ATK {melhor.st.AtkValue} (regra 1)");
            }

            return new Play("endturn", 0, "nada a fazer");
        }

        /// <summary>Maior ATK entre os monstros do jogador indicado.</summary>
        int MaiorAtkEmCampo(int player)
        {
            int max = -1;
            foreach (uint code in _fieldOf(player))
            {
                var st = _cards.Stats(code);
                if (st.IsMonster && st.AtkValue > max) max = st.AtkValue;
            }
            return max;
        }
    }
}
