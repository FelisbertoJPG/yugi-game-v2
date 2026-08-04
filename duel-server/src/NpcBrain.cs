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

        // Cartas com efeito que o NPC sabe pilotar por ID.
        const uint MONSTER_REBORN = 83764718;    // reanima o mais forte do GY
        const uint TRIBUTE_TO_DOOMED = 79759861;  // descarta 1 → destrói 1 monstro
        const uint BURST_STREAM = 17655904;       // destrói todos os monstros do oponente (exige Blue-Eyes)
        const uint TIME_WIZARD = 71625222;        // moeda: cara varre o campo dele, coroa varre o meu
        const uint TOON_WORLD = 15259703;         // habilita o pacote Toon inteiro

        // Pacote do Wevil: o casulo transforma um Inseto fraco em Larvae/Great/
        // Perfectly Ultimate Great Moth depois de 2/4/6 turnos equipado — o motor
        // já faz a contagem sozinha (ver TestWeevil), o NPC só precisa: equipar
        // no inseto MAIS FRACO (não no melhor atacante — o ATK dele vira 0
        // enquanto durar), e depois Invocar Especialmente cada mariposa assim
        // que o motor a oferecer em `spSummonable`.
        const uint COCOON_OF_EVOLUTION = 40240595;
        const uint INSECT_ARMOR_LASER = 3492538;   // +700 ATK — o alvo default (maior ATK) já serve
        const uint INSECT_IMITATION = 96965364;    // tributa 1 inseto fraco, traz 1 mais forte do deck
        // O Lua do Cocoon (s.filter) só aceita Petit Moth COM A FACE PRA CIMA
        // como alvo — setado (virado) não serve nunca. Só existe 1 código.
        const uint PETIT_MOTH = 58192742;
        static readonly HashSet<uint> MARIPOSAS_CASULO = new()
        {
            87756343, // Larvae Moth
            14141448, // Great Moth
            48579379, // Perfectly Ultimate Great Moth
        };

        const byte HAND = 0x2, MZONE = 0x4, GRAVE = 0x10;
        const uint TYPE_SPELL = 0x2, TYPE_TRAP = 0x4, TYPE_RITUAL = 0x80;

        // "Ativar quando der" — decks reais além do Kaiba/Joey. Burn = dano fixo,
        // dispara sempre; remoção de monstro/ST só quando há alvo. O RITUAL é
        // reconhecido por TIPO (qualquer magia-ritual), não por ID — assim o combo
        // ritual→GY→Reborn vale pro Skull Guardian (Kaiba), Zera/Fortress (Joey) etc.
        static readonly HashSet<uint> BURN = new()
        {
            19523799, // Ookazi
            46130346, // Hinotama
            76103675, // Sparks
            73134081, // Final Flame
            46918794, // Tremendous Fire
            52684508, // Inferno Fire Blast (Red-Eyes)
        };
        static readonly HashSet<uint> REMOCAO_MONSTRO = new()
        {
            12580477, // Raigeki
            53129443, // Dark Hole
            66788016, // Fissure
        };
        static readonly HashSet<uint> REMOCAO_ST = new()
        {
            18144506, // Harpie's Feather Duster
            5318639,  // Mystical Space Typhoon
            60082869, // Dust Tornado (Armadilha Normal)
        };

        /// <summary>
        /// Magias/armadilhas que vale destruir mesmo ABERTAS no campo.
        ///
        /// O caso que motivou a lista: Call of the Haunted é contínua e fica com
        /// a face para cima. O script dela destrói o monstro revivido quando ela
        /// sai do campo — então um Dust Tornado nela é 2-por-1, e não o
        /// desperdício que seria estourar uma magia normal já resolvida.
        ///
        /// Critério para entrar aqui: a carta tem de SUSTENTAR alguma coisa
        /// enquanto está em campo. Magia normal, que resolve e vai embora, nunca
        /// entra.
        /// </summary>
        static readonly HashSet<uint> ALVO_ST_ABERTO = new()
        {
            97077563, // Call of the Haunted — leva junto o monstro que reviveu
            72302403, // Swords of Revealing Light — trava os ataques por 3 turnos
        };

        /// <summary>
        /// Magias que FUNDEM. Vão por ID, e não por tipo como o ritual, porque
        /// não existe bit de "magia de fusão": a Polymerization é uma Magia
        /// Normal comum — quem carrega a receita é o monstro fundido, no Lua
        /// dele. Sem type flag para consultar, a lista é explícita.
        /// </summary>
        static readonly HashSet<uint> FUSAO = new()
        {
            24094653, // Polymerization
        };

        /// <summary>
        /// "Adição específica": busca uma carta NOMEADA do deck para a mão
        /// (diferente da compra às cegas do Pote da Ganância).
        ///
        /// Existem para ser usadas ANTES da compra. O motivo é concreto: comprar
        /// primeiro pode trazer justamente a carta que a busca traria, e aí a
        /// busca vira carta morta. Buscar primeiro nunca desperdiça, e ainda
        /// afina o deck para a compra seguinte.
        /// </summary>
        static readonly HashSet<uint> BUSCA_ESPECIFICA = new()
        {
            26902560, // Fusion Sage — busca 1 Polymerization
            // King of the Swamp — descarta a si mesmo para buscar 1 Polymerization.
            // O descarte NÃO é perda: ele é substituto de material de fusão e o
            // `subcon` do script dele aceita HAND, ONFIELD **e GRAVE**. Ou seja,
            // vai para o cemitério e continua servindo de matéria. Buscar com ele
            // é ganho puro, e por isso entra na mesma lista da Sage.
            79109599,
            // Reinforcement of the Army — busca 1 Guerreiro Nv≤4. Não nomeia uma
            // carta como as outras duas, mas é a mesma jogada: tirar do deck em
            // vez de comprar às cegas, e por isso vale a mesma prioridade.
            32807846,
            // Toon Table of Contents — busca 1 carta "Toon" (qual, o DecideSelect
            // decide: Toon World primeiro, se ainda não estiver na mão/campo).
            89997728,
        };

        /// <summary>
        /// Toons "clássicos": não podem ser Invocados/Setados normalmente — só
        /// entram por Invocação Especial DA MÃO (`spSummonable`) enquanto o NPC
        /// controla Toon World, alguns pedindo tributo (o motor só oferece a
        /// opção quando o custo é pagável; o alvo do tributo é o DecideSelect de
        /// sempre, que já sacrifica os mais fracos). Os Toons "modernos" (Gemini
        /// Elf, Cannon Soldier, Barrel Dragon etc.) NÃO entram aqui: eles são
        /// Invocação Normal comum e a lógica de beatdown (`Monstros(q.summonable)`)
        /// já os pega de graça, sem precisar saber que são Toon.
        /// </summary>
        static readonly HashSet<uint> TOON_ESPECIAIS = new()
        {
            65458948, // Toon Mermaid — sem tributo
            91842653, // Toon Summoned Skull — tributa 1
            90960358, // Toon Dark Magician Girl — tributa 1
            53183600, // Blue-Eyes Toon Dragon — tributa 2
        };

        readonly DatabaseManager _cards;
        readonly Func<int, IReadOnlyList<uint>> _fieldOf;   // monstros face-up em campo
        readonly Func<int, IReadOnlyList<uint>> _handOf;    // cartas na mão de um jogador
        readonly Func<int, int> _stCountOf;                 // zonas de magia/armadilha ocupadas
        readonly Func<int, int> _setStCountOf;              // dessas, quantas estão VIRADAS
        readonly Func<int, IReadOnlyList<uint>> _faceUpStOf; // magias/armadilhas ABERTAS
        readonly Func<int, IReadOnlyList<(uint code, int pos)>> _fieldPosOf;
        readonly Action<string> _log;

        const int POS_ATAQUE = 0x1, POS_DEFESA = 0x4;

        public NpcBrain(DatabaseManager cards,
                        Func<int, IReadOnlyList<uint>> fieldOf,
                        Action<string> log = null,
                        Func<int, IReadOnlyList<uint>> handOf = null,
                        Func<int, int> stCountOf = null,
                        Func<int, IReadOnlyList<(uint code, int pos)>> fieldPosOf = null,
                        Func<int, int> setStCountOf = null,
                        Func<int, IReadOnlyList<uint>> faceUpStOf = null)
        {
            _cards = cards;
            _fieldOf = fieldOf;
            _log = log ?? (_ => { });
            _handOf = handOf ?? (_ => Array.Empty<uint>());
            _stCountOf = stCountOf ?? (_ => 0);
            _setStCountOf = setStCountOf ?? (_ => 0);
            _faceUpStOf = faceUpStOf ?? (_ => Array.Empty<uint>());
            // Sem informação de posição, assume ATAQUE — é o comportamento
            // anterior, e mantém os testes que montam campo só com códigos.
            _fieldPosOf = fieldPosOf
                ?? (p => _fieldOf(p).Select(c => (c, POS_ATAQUE)).ToList());
        }

        /// <summary>
        /// Quanto vale ENFRENTAR este monstro: a ATK se ele está em ataque, a DEF
        /// se está deitado. É o número que a batalha realmente usa — comparar
        /// sempre pela ATK fazia o NPC atacar uma parede 800/2000 achando que
        /// enfrentava 800.
        /// </summary>
        int ValorNaBatalha((uint code, int pos) m)
        {
            var st = _cards.Stats(m.code);
            return (m.pos & POS_DEFESA) != 0 ? st.DefValue : st.AtkValue;
        }

        // ---- atalhos de leitura da situação ----
        bool Ativavel(InteractiveDuel.Question q, uint code) => q.activatable.Any(a => a.code == code);
        int IdxAtivavel(InteractiveDuel.Question q, uint code) => q.activatable.First(a => a.code == code).index;
        bool NaMao(int me, uint code) => _handOf(me).Contains(code);
        bool EhArmadilha(uint code) => (_cards.Stats(code).Type & TYPE_TRAP) != 0;
        bool EhRitual(uint code) { var t = _cards.Stats(code).Type; return (t & TYPE_SPELL) != 0 && (t & TYPE_RITUAL) != 0; }
        int QtdMonstros(int player) => _fieldOf(player).Count(c => _cards.Stats(c).IsMonster);
        InteractiveDuel.Act AtivavelSe(InteractiveDuel.Question q, Func<uint, bool> ok) => q.activatable.FirstOrDefault(a => ok(a.code));

        /// <summary>O que o NPC decidiu fazer, já no vocabulário do InteractiveDuel.</summary>
        public readonly struct Play
        {
            public readonly string Action;   // activate | summon | setmonster | endturn
            public readonly int Index;
            public readonly string Why;
            public Play(string action, int index, string why)
            { Action = action; Index = index; Why = why; }
        }

        /// <summary>Decisão da Battle Phase: atacar (com qual monstro) ou encerrar.</summary>
        public readonly struct BattlePlay
        {
            public readonly bool Attack;
            public readonly int Index;
            public readonly string Why;
            public BattlePlay(bool attack, int index, string why)
            { Attack = attack; Index = index; Why = why; }
        }

        /// <summary>Uma carta candidata, já com os stats resolvidos.</summary>
        readonly struct Cand
        {
            public readonly InteractiveDuel.Act Act;
            public readonly DatabaseManager.CardStats St;
            public readonly bool Ok;
            public Cand(InteractiveDuel.Act act, DatabaseManager.CardStats st)
            { Act = act; St = st; Ok = true; }

            /// <summary>Statline ofensivo: só vale a pena em ataque se ATK &gt; DEF.</summary>
            public bool Ofensivo => St.AtkValue > St.DefValue;
        }

        /// <summary>
        /// Main Phase. Ordem de decisão do deck Blue-Eyes do Kaiba (a estratégia
        /// que o jogador descreveu):
        ///   0. Busca específica (Fusion Sage) — ANTES da compra, senão o Pote
        ///      pode trazer a carta buscada e matar a busca.
        ///   0.1 Pote da Ganância.
        ///   1. COMBO: Tribute to The Doomed com Monster Reborn na mão — descarta
        ///      um dragão para estourar a ameaça e revivê-lo depois.
        ///   2. Setar armadilha (mantendo SEMPRE ≥1 zona de magia/arm. livre).
        ///   3. Tribute to The Doomed sem o Reborn — ainda estoura a ameaça real.
        ///   4. Monster Reborn — reanima o mais forte do cemitério.
        ///   5. Ritual (Skull Guardian) tributando monstro de nível alto.
        ///   5.1 Fusão (Polymerization) — mesma lógica do ritual: corpo grande em
        ///      campo e materiais no cemitério, alimentando o Reborn.
        ///   6. Beatdown: sobe os dragões (sacrificando os fracos) ou beater Nv4.
        ///   7. Burst Stream of Destruction — só quando limpa 2+ monstros.
        ///   8. Batalha / encerrar o turno.
        /// As escolhas de tributo/alvo/descarte ficam no DecideSelect.
        /// </summary>
        public Play Decide(InteractiveDuel.Question q, int me)
        {
            int foe = 1 - me;

            // 0. BUSCA ESPECÍFICA antes da compra. Comprar primeiro pode trazer a
            //    carta que a busca traria — e aí a busca vira carta morta. Buscar
            //    primeiro nunca desperdiça. O Pote continua logo abaixo, então na
            //    decisão seguinte ele sai do mesmo jeito, só que com o deck já
            //    afinado.
            var buscaEsp = AtivavelSe(q, BUSCA_ESPECIFICA.Contains);
            if (buscaEsp.code != 0)
                return new Play("activate", buscaEsp.index,
                    $"busca especifica antes da compra ({buscaEsp.code})");

            // 0.1 Pote da Ganância antes de qualquer invocação.
            if (Ativavel(q, POT_OF_GREED))
                return new Play("activate", IdxAtivavel(q, POT_OF_GREED), "Pote da Ganancia primeiro");

            // 0.2 Toon World o quanto antes: sem ele os Toons "clássicos" da mão
            // não têm como entrar (spsummon) e os "modernos" em campo não atacam
            // direto. É a carta que faz o resto do pacote Toon funcionar.
            if (Ativavel(q, TOON_WORLD))
                return new Play("activate", IdxAtivavel(q, TOON_WORLD),
                    "Toon World o quanto antes — habilita invocacao especial e ataque direto dos Toons");

            int ameaca = MaiorAtkEmCampo(foe);
            int meuMelhor = MaiorAtkEmCampo(me);
            bool oponenteTemMonstro = _fieldOf(foe).Any(c => _cards.Stats(c).IsMonster);
            // "ameaça real": o oponente tem um monstro que meu campo não supera.
            bool ameacaReal = oponenteTemMonstro && (meuMelhor < 0 || ameaca >= meuMelhor);

            // 1. COMBO no topo: Tribute to The Doomed + Monster Reborn na mão.
            if (Ativavel(q, TRIBUTE_TO_DOOMED) && ameacaReal && NaMao(me, MONSTER_REBORN))
                return new Play("activate", IdxAtivavel(q, TRIBUTE_TO_DOOMED),
                    "combo: Tribute to The Doomed (descarta dragao) + Monster Reborn na mao");

            // 2. Setar armadilha — só se sobrar ≥1 zona livre (magias reciclam o slot).
            var trap = q.settableST.FirstOrDefault(a => EhArmadilha(a.code));
            if (trap.code != 0 && _stCountOf(me) <= 3)
                return new Play("setspell", trap.index, $"seta armadilha {trap.code} (mantem zona p/ magias)");

            // Diagnóstico: "o NPC parou de setar armadilha" foi relatado em duelo
            // e a regra acima está certa (há teste). Quando ela NÃO dispara, o
            // motivo é sempre um destes dois — e sem registrar isso a próxima
            // investigação recomeça do zero.
            if (q.settableST.Count > 0 || trap.code != 0)
                _log($"nao setou armadilha: setaveis={q.settableST.Count} " +
                     $"armadilha_entre_elas={(trap.code != 0 ? trap.code.ToString() : "nenhuma")} " +
                     $"zonas_ocupadas={_stCountOf(me)} (limite: <=3)");

            // 3. Tribute to The Doomed sem o Reborn — descarta um dragão e estoura o mais forte.
            if (Ativavel(q, TRIBUTE_TO_DOOMED) && ameacaReal)
                return new Play("activate", IdxAtivavel(q, TRIBUTE_TO_DOOMED),
                    "Tribute to The Doomed: descarta dragao e estoura o mais forte do oponente");

            // 4. Monster Reborn — reanima o mais forte do cemitério (alvo no DecideSelect).
            if (Ativavel(q, MONSTER_REBORN))
                return new Play("activate", IdxAtivavel(q, MONSTER_REBORN),
                    "Monster Reborn: revive o mais forte do cemiterio");

            // 5. Ritual (QUALQUER magia-ritual) — tributa monstro de nível alto (pra
            //    reviver depois com o Reborn). Reconhecido por tipo, não por ID.
            var ritual = AtivavelSe(q, EhRitual);
            if (ritual.code != 0)
                return new Play("activate", ritual.index,
                    $"Ritual: invoca tributando monstro de nivel alto ({ritual.code})");

            // 5.1 FUSÃO — mesma lógica do ritual, e por isso vem logo depois: põe
            //     um corpo grande em campo E manda os materiais para o cemitério,
            //     que é de onde o Monster Reborn tira o alvo. O motor só oferece a
            //     Polymerization quando existe fusão possível com a mão/campo, então
            //     não é preciso conferir receita aqui — se ela está em `activatable`,
            //     há o que fundir.
            var fusao = AtivavelSe(q, FUSAO.Contains);
            if (fusao.code != 0)
                return new Play("activate", fusao.index,
                    $"Fusao: corpo grande em campo e materiais no cemiterio p/ o Reborn ({fusao.code})");

            // 5.15 Petit Moth com a face pra CIMA: se eu tenho Cocoon of
            //      Evolution na mão, o alvo do equip PRECISA estar face para
            //      cima (exigência do próprio Lua, `s.filter`). A defesa
            //      genérica (passo 6, mais abaixo) setaria o Petit Moth virado
            //      assim que aparecesse qualquer ameaça — e virado ele fica
            //      PERMANENTEMENTE inválido como alvo daquela cópia do casulo,
            //      matando o combo antes de começar. Mesmo espírito da regra
            //      5.7 (Mago do Tempo em ataque pela moeda): força a carta pra
            //      cima na hora certa, antes que a lógica de defesa a esconda.
            var petitParaCasulo = q.summonable.FirstOrDefault(a => a.code == PETIT_MOTH);
            if (petitParaCasulo.code == PETIT_MOTH && NaMao(me, COCOON_OF_EVOLUTION))
                return new Play("summon", petitParaCasulo.index,
                    "Petit Moth em ataque (nao setado): tenho Cocoon of Evolution na mao " +
                    "e o alvo do equip precisa estar com a face para cima");

            // 5.2 Cocoon of Evolution — equipa no inseto mais FRACO em campo (o
            //     motor só oferece a ativação quando existe alvo válido, então
            //     não é preciso checar "tenho inseto em campo" aqui). Marca
            //     `_proximoAlvoEquipFraco` para o DecideSelect que vem em seguida.
            if (!_casuloJaEquipado && Ativavel(q, COCOON_OF_EVOLUTION))
            {
                _proximoAlvoEquipFraco = true;
                _casuloJaEquipado = true;
                return new Play("activate", IdxAtivavel(q, COCOON_OF_EVOLUTION),
                    "Cocoon of Evolution: equipa no inseto mais fraco, comeca a contagem da evolucao");
            }

            // 5.3 Insect Armor with Laser Cannon — +700 ATK fixo. O alvo default
            //     do DecideSelect (maior ATK) já é o que se quer aqui: reforça o
            //     melhor atacante em vez de pouco importar.
            if (Ativavel(q, INSECT_ARMOR_LASER))
                return new Play("activate", IdxAtivavel(q, INSECT_ARMOR_LASER),
                    "Insect Armor with Laser Cannon: +700 ATK no melhor atacante");

            // 5.4 Insect Imitation — tributa 1 inseto (o DecideSelect já sacrifica
            //     o de menor ATK) para trazer um Inseto de nível +1 do PRÓPRIO
            //     deck. Sempre vale: troca o inseto mais fraco por um mais forte.
            if (Ativavel(q, INSECT_IMITATION))
                return new Play("activate", IdxAtivavel(q, INSECT_IMITATION),
                    "Insect Imitation: tributa o inseto mais fraco por um mais forte do deck");

            // 5.5 Remoção e burn (decks de queima como o do Joey):
            //   • remoção de monstro (Raigeki/Dark Hole/Fissure) só com alvo;
            //   • remoção de magia/armadilha (Harpie's/MST) só se o oponente tiver S/T;
            //   • burn (dano fixo) sempre que der — é a condição de vitória do deck.
            var remMon = AtivavelSe(q, REMOCAO_MONSTRO.Contains);
            if (remMon.code != 0 && QtdMonstros(foe) >= 1)
                return new Play("activate", remMon.index, $"remocao: limpa o campo do oponente ({remMon.code})");
            var remST = AtivavelSe(q, REMOCAO_ST.Contains);
            if (remST.code != 0 && _stCountOf(foe) >= 1)
                return new Play("activate", remST.index, $"remocao: destroi magia/armadilha do oponente ({remST.code})");
            var burn = AtivavelSe(q, BURN.Contains);
            if (burn.code != 0)
                return new Play("activate", burn.index, $"burn: dano fixo no oponente ({burn.code})");

            // 5.6 MAGO DO TEMPO — a moeda. Cara destrói os monstros DELE, coroa
            //     destrói os MEUS e ainda tira LP. É jogada de quem está atrás:
            //     quando o campo já está bom, arriscar só pode piorar.
            if (Ativavel(q, TIME_WIZARD))
            {
                var (arrisca, porque) = VaiArriscarAMoeda(q, me, foe, ameaca, meuMelhor);
                if (arrisca)
                    return new Play("activate", IdxAtivavel(q, TIME_WIZARD),
                        $"Mago do Tempo: {porque}");
                _log($"Mago do Tempo: NAO arrisca — {porque}");
            }

            // 5.7 PÔR O MAGO DO TEMPO EM CAMPO — com a face para cima.
            //
            // Sem isto a regra da moeda (5.6) nunca tinha chance: estar atrás é
            // exatamente a condição que faz a regra de defesa SETAR o monstro
            // mais fraco, e o Mago (500/400) é sempre o mais fraco. Setado, ele
            // fica virado — e carta virada não ativa efeito. Observado em duelo:
            // três turnos seguidos setando o Mago, que morria sem nunca jogar a
            // moeda.
            //
            // Invocar aqui é `summon` (ataque, face para cima) de propósito. Ele
            // morre fácil, mas o efeito é ignição de Main Phase: na decisão
            // seguinte a regra 5.6 já o encontra ativável.
            var mago = q.summonable.FirstOrDefault(a => a.code == TIME_WIZARD);
            if (mago.code == TIME_WIZARD && ameacaReal
                && AtivavelSe(q, FUSAO.Contains).code == 0)
                return new Play("summon", mago.index,
                    "Mago do Tempo em campo: a moeda so' existe com ele com a face para cima");

            // 5.8 TOON: Invocação Especial de um Toon "clássico" da mão. Só
            //     aparece em `spSummonable` quando o motor já confirma Toon World
            //     em campo (e tributo pagável, se pedir) — não há condição extra
            //     a checar aqui, o mesmo padrão da Sincro/Xyz (ver
            //     `ocgcore-protocolo`). Prioriza o de maior ATK disponível.
            var toonSp = Monstros(q.spSummonable)
                .Where(c => TOON_ESPECIAIS.Contains(c.Act.code))
                .OrderByDescending(c => c.St.AtkValue)
                .FirstOrDefault();
            if (toonSp.Ok)
                return new Play("spsummon", toonSp.Act.index,
                    $"Toon: invocacao especial de {toonSp.Act.code} (ATK {toonSp.St.AtkValue}) — Toon World ja habilita");

            // 5.9 MARIPOSA DO CASULO: o motor só oferece Larvae/Great/Perfectly
            //     Ultimate Great Moth em `spSummonable` depois de 2/4/6 turnos com
            //     o Cocoon of Evolution equipado (contagem do próprio Lua, ver
            //     TestWeevil) — sem esta regra elas nunca eram invocadas mesmo
            //     disponíveis, e o casulo inteiro não servia pra nada.
            var mariposaSp = Monstros(q.spSummonable)
                .Where(c => MARIPOSAS_CASULO.Contains(c.Act.code))
                .OrderByDescending(c => c.St.AtkValue)
                .FirstOrDefault();
            if (mariposaSp.Ok)
                return new Play("spsummon", mariposaSp.Act.index,
                    $"casulo evoluiu: Invocacao Especial de {mariposaSp.Act.code} (ATK {mariposaSp.St.AtkValue})");

            // 6. Beatdown: monstros grandes (sacrificando os fracos) ou beater Nv4.
            //    O filtro `TributoCompensa` impede o NPC de tributar um corpo
            //    melhor do que o que vai entrar. Vale para as DUAS listas: o Set
            //    de um Nv5+ é um Tribute Set e custa os mesmos tributos que a
            //    invocação. Filtrar só a de invocação deixava o NPC tributar uma
            //    fusão de 3200 para SETAR um Red-Eyes — o mesmo erro pela porta
            //    de trás.
            // Cocoon of Evolution é um Monstro de Efeito (0/2000) por baixo do
            // pano — DEF alta o suficiente pra essa lógica genérica de "seta o
            // melhor DEF quando ameaçado" QUEIMAR ele como parede assim que
            // aparece uma ameaça, antes da regra 5.2 (o equip de verdade) ter
            // qualquer chance. Uma vez set/invocado como monstro comum ele sai
            // da mão e o combo morre pra sempre com essa cópia. Fora das DUAS
            // listas — só entra em campo pela regra 5.2, nunca por aqui.
            var invocaveis = Monstros(q.summonable).Where(c => c.Act.code != COCOON_OF_EVOLUTION).ToList();
            // O Mago do Tempo NUNCA entra como parede: setá-lo o vira, e virado
            // ele perde a única coisa que vale nele (a moeda). Um 500/400 também
            // não segura nada. Fora da lista de setáveis, portanto.
            var setaveis = Monstros(q.settable)
                .Where(c => c.Act.code != TIME_WIZARD && c.Act.code != COCOON_OF_EVOLUTION)
                .ToList();
            var altasQueCompensam = invocaveis
                .Where(c => c.St.Level >= 5 && TributoCompensa(me, c.St, setando: false))
                .ToList();
            var setsQueCompensam = setaveis
                .Where(c => c.St.Level >= 5 && TributoCompensa(me, c.St, setando: true))
                .ToList();
            var jogadaAlta = Escolher(
                altasQueCompensam,
                setsQueCompensam,
                ameaca, "nivel maior");
            if (jogadaAlta.HasValue) return jogadaAlta.Value;

            var jogadaBaixa = Escolher(
                invocaveis.Where(c => c.St.Level <= 4).ToList(),
                setaveis.Where(c => c.St.Level <= 4).ToList(),
                ameaca, "nivel 1-4");
            if (jogadaBaixa.HasValue) return jogadaBaixa.Value;

            // 7. Burst Stream of Destruction — só quando limpa 2+ monstros do oponente.
            if (Ativavel(q, BURST_STREAM) && QtdMonstros(foe) >= 2)
                return new Play("activate", IdxAtivavel(q, BURST_STREAM),
                    "Burst Stream: destroi 2+ monstros do oponente");

            // 8. Nada mais no Main: vai à batalha se tiver monstro, senão encerra.
            if (q.canBattle && _fieldOf(me).Count > 0)
                return new Play("battle", 0, "ir para a Battle Phase");

            return new Play("endturn", 0, "nada a fazer");
        }

        /// <summary>
        /// Escolha inteligente numa seleção do NPC (SELECT_CARD/SELECT_TRIBUTE),
        /// pela LOCALIZAÇÃO das opções — resolve tributo, descarte, alvo e reborn:
        ///   • tributo (release&gt;0, meus monstros): sacrifica os de MENOR ATK.
        ///   • mão (custo de descarte, ex.: Tribute to The Doomed): descarta o MAIOR
        ///     monstro (pra reviver depois); sem monstro, a carta menos útil.
        ///   • campo/cemitério (alvo de remoção / Monster Reborn): o de MAIOR ATK.
        /// Devolve a lista de índices; o host codifica (EncodeSelect).
        /// </summary>
        public List<int> DecideSelect(InteractiveDuel.Question q, int me)
        {
            int need = Math.Max(1, q.selMin);
            var picks = new List<int>();
            if (q.choices.Count == 0) return picks;

            // Tributo por sacrifício: os mais FRACOS até somar os releases pedidos.
            if (q.choices[0].release > 0)
            {
                int soma = 0;
                foreach (var c in q.choices.OrderBy(c => _cards.Stats(c.code).AtkValue))
                {
                    if (soma >= need) break;
                    picks.Add(c.index);
                    soma += Math.Max(1, (int)c.release);
                }
                return picks;
            }

            // Alvo do Cocoon of Evolution: o inseto mais FRACO, não o mais forte
            // (o default logo abaixo é para remoção/reborn — o oposto do que o
            // casulo quer). `release==0` de propósito, nunca colide com o
            // tributo acima. Consome a flag numa tacada só, mesmo que a lista
            // de opções esteja vazia por algum motivo — nunca fica "presa"
            // esperando uma seleção que não vai vir.
            if (_proximoAlvoEquipFraco)
            {
                _proximoAlvoEquipFraco = false;
                if (q.choices.Count > 0)
                {
                    var maisFraco = q.choices.OrderBy(c => _cards.Stats(c.code).AtkValue).First();
                    return new List<int> { maisFraco.index };
                }
            }

            // Busca (ex.: Toon Table of Contents): se Toon World está entre as
            // opções e o NPC ainda não o tem nem na mão nem em campo, ele vem
            // em primeiro — sem ele nenhum outro Toon funciona por completo.
            // `release==0` aqui de propósito: nunca colide com o tributo acima.
            var toonWorld = q.choices.FirstOrDefault(c => c.code == TOON_WORLD);
            if (toonWorld.code == TOON_WORLD && !NaMao(me, TOON_WORLD) && !_faceUpStOf(me).Contains(TOON_WORLD))
                return new List<int> { toonWorld.index };

            byte loc = q.choices[0].location;
            var ordem = loc == HAND
                ? q.choices.OrderByDescending(ValorDescarte)                       // descarta o maior monstro
                : q.choices.OrderByDescending(c => _cards.Stats(c.code).AtkValue); // alvo/reborn: o mais forte

            foreach (var c in ordem)
            {
                if (picks.Count >= need) break;
                picks.Add(c.index);
            }
            return picks;
        }

        /// <summary>Prioridade de DESCARTE: o monstro de maior nível/ATK primeiro
        /// (será revivido); carta que não é monstro por último.</summary>
        int ValorDescarte(InteractiveDuel.Sel c)
        {
            var st = _cards.Stats(c.code);
            if (!st.IsMonster) return -1;
            return st.Level * 10000 + st.AtkValue;
        }

        /// <summary>
        /// Regra de batalha (SELECT_BATTLECMD). O motor pergunta uma vez por
        /// atacante disponível — quem já atacou sai da lista —, então basta
        /// decidir um ataque de cada vez:
        ///
        ///   • Campo do oponente vazio: ataque DIRETO com o de maior ATK — é dano
        ///     de graça.
        ///   • Oponente com monstros: ataca com o de maior ATK só se ele SUPERAR o
        ///     maior ATK que o oponente tem com a face para cima. Assim o NPC não
        ///     entrega o próprio monstro numa troca ruim. (A escolha do alvo fica
        ///     com o host/AutoSelect; se meu ATK já supera o maior deles, qualquer
        ///     alvo com a face para cima é uma troca favorável.)
        ///   • Nenhum ataque compensa: encerra a Battle Phase.
        ///
        /// Monstros setados do oponente têm DEF desconhecida, então não entram na
        /// conta da ameaça — atacá-los é um risco assumido, igual ao de um humano.
        /// </summary>
        public BattlePlay DecideBattle(InteractiveDuel.Question q, int me)
        {
            int foe = 1 - me;

            // ataque direto: qualquer atacante com a flag; o de maior ATK primeiro
            var diretos = q.attackers.Where(a => a.canDirect).ToList();
            if (diretos.Count > 0)
            {
                var a = diretos.OrderByDescending(x => _cards.Stats(x.code).AtkValue).First();
                return new BattlePlay(true, a.index,
                    $"campo do oponente vazio — ataque direto com {a.code} " +
                    $"(ATK {_cards.Stats(a.code).AtkValue})");
            }

            if (q.attackers.Count == 0)
                return new BattlePlay(false, 0, "sem atacantes");

            var melhor = q.attackers.OrderByDescending(x => _cards.Stats(x.code).AtkValue).First();
            int meuAtk = _cards.Stats(melhor.code).AtkValue;

            // O que existe do outro lado, avaliado pelo número que a BATALHA usa:
            // ATK de quem está em ataque, DEF de quem está deitado. Uma Mystical
            // Elf (800/2000) em defesa vale 2000 aqui, não 800 — era exatamente
            // essa confusão que fazia o Battle Ox (1700) se jogar contra ela.
            var doOponente = _fieldPosOf(foe)
                .Where(m => _cards.Stats(m.code).IsMonster)
                .Select(m => (m.code, valor: ValorNaBatalha(m)))
                .ToList();

            if (doOponente.Count == 0)
                return new BattlePlay(true, melhor.index,
                    $"campo do oponente sem monstro visivel — ataca com {melhor.code}");

            // Basta UM alvo que eu vença: o motor pergunta o alvo em seguida.
            var maisFraco = doOponente.OrderBy(m => m.valor).First();
            if (meuAtk > maisFraco.valor)
                return new BattlePlay(true, melhor.index,
                    $"ATK {meuAtk} supera o alvo mais fraco ({maisFraco.code} vale {maisFraco.valor}) " +
                    $"— ataca com {melhor.code}");

            return new BattlePlay(false, 0,
                $"meu melhor ATK ({meuAtk}) nao vence nem o alvo mais fraco " +
                $"({maisFraco.code} vale {maisFraco.valor}) — encerra o combate");
        }

        /// <summary>
        /// O coração da decisão, em duas etapas — nesta ordem:
        ///
        ///   1. **Statline da própria carta.** Só entra em ataque quem tem
        ///      ATK &gt; DEF. Um 1200/2000 é uma parede: mesmo podendo vencer o
        ///      que está em campo, rende mais setado do que atacando.
        ///   2. **Situação do campo.** Se a ameaça do oponente supera o melhor
        ///      atacante disponível, seta o de maior DEF em vez de entregar o
        ///      monstro.
        ///
        /// Devolve null quando não há monstro nenhum nesta faixa de nível.
        /// </summary>
        Play? Escolher(List<Cand> invocaveis, List<Cand> setaveis, int ameaca, string tag)
        {
            // etapa 1: só é atacante quem tem o statline para isso
            var atacante = invocaveis
                .Where(c => c.Ofensivo)
                .OrderByDescending(c => c.St.AtkValue)
                .FirstOrDefault();

            var defensor = setaveis
                .OrderByDescending(c => c.St.DefValue)
                .FirstOrDefault();

            int meuAtk = atacante.Ok ? atacante.St.AtkValue : -1;

            // etapa 2: campo. Ameaça maior que meu melhor atacante -> defende.
            if (defensor.Ok && ameaca > meuAtk)
            {
                string motivo = atacante.Ok
                    ? $"oponente tem ATK {ameaca} > meu melhor atacante ({meuAtk})"
                    : $"oponente tem ATK {ameaca} e nao tenho atacante";
                return new Play("setmonster", defensor.Act.index,
                    $"{motivo} — setando {defensor.Act.code} " +
                    $"(ATK {defensor.St.AtkValue}/DEF {defensor.St.DefValue}) [{tag}]");
            }

            if (atacante.Ok)
            {
                return new Play("summon", atacante.Act.index,
                    $"ATK {atacante.St.AtkValue} > DEF {atacante.St.DefValue}, vale atacar" +
                    (ameaca >= 0 ? $" (campo tem {ameaca})" : "") +
                    $" — {atacante.Act.code} [{tag}]");
            }

            // Nenhum monstro com statline de ataque: os que tenho são paredes.
            if (defensor.Ok)
            {
                return new Play("setmonster", defensor.Act.index,
                    $"DEF {defensor.St.DefValue} >= ATK {defensor.St.AtkValue}, " +
                    $"melhor setado — {defensor.Act.code} [{tag}]");
            }

            return null;
        }

        /// <summary>
        /// Decisão de corrente (SELECT_CHAIN com opções).
        ///
        /// A maioria das armadilhas da Lista 1 é reativa e o motor só abre a
        /// janela delas no momento certo, então ativar o que é oferecido está
        /// certo. A exceção é a REMOÇÃO DE MAGIA/ARMADILHA.
        ///
        /// Motivo, vindo de uma jogada real: o NPC gastou um Dust Tornado sobre
        /// uma magia de ritual do oponente. Destruir uma magia que **já está
        /// resolvendo** não impede nada — a carta foi queimada à toa. Ela só vale
        /// contra o que ainda está BAIXADO, então é isso que se exige aqui.
        ///
        /// `me` é quem está decidindo; sem saber disso não dá para olhar o campo
        /// do adversário certo.
        /// </summary>
        /// <summary>
        /// Em que posição pôr um monstro que o motor deixa escolher (ritual e
        /// invocações especiais em geral).
        ///
        /// Usa o MESMO critério da invocação normal (`Cand.Ofensivo`): só vai
        /// para ataque quem tem ATK &gt; DEF. Um ritual 1200/2000 rende mais
        /// deitado — e agora ele PODE ficar deitado com a face para cima, que é
        /// diferente de setar.
        ///
        /// `mask` é o que o motor aceita (0x1 ataque, 0x4 defesa com a face para
        /// cima). Se a defesa não estiver na máscara, não há escolha a fazer.
        /// </summary>
        public int DecidePosicao(uint code, byte mask)
        {
            const int FACEUP_DEFESA = 0x4;
            bool podeDefesa = (mask & FACEUP_DEFESA) != 0;
            bool podeAtaque = (mask & POS_ATAQUE) != 0;
            if (!podeDefesa) return POS_ATAQUE;
            if (!podeAtaque) return FACEUP_DEFESA;

            var st = _cards.Stats(code);
            bool ofensivo = st.AtkValue > st.DefValue;
            _log($"posicao de {code} ({st.AtkValue}/{st.DefValue}): " +
                 (ofensivo ? "ataque" : "defesa (DEF >= ATK)"));
            return ofensivo ? POS_ATAQUE : FACEUP_DEFESA;
        }

        /// <summary>
        /// Setado logo antes de mandar ativar o Cocoon of Evolution — a próxima
        /// seleção (o alvo do equip) vem por aqui e não pela regra genérica de
        /// "maior ATK" (que é certa para remoção/reborn, mas errada pro casulo:
        /// ele quer o inseto mais FRACO, o melhor atacante não deve virar uma
        /// parede de 0 ATK por 6 turnos). Consumido (voltando a false) assim que
        /// `DecideSelect` usa.
        /// </summary>
        bool _proximoAlvoEquipFraco;

        /// <summary>
        /// Já equipei um Cocoon of Evolution nesta partida? O Lua dele
        /// (`checkcon2`/`checkop2`) reseta a contagem de turnos quando o GRUPO
        /// de alvos "muda de identidade" entre checagens — equipar uma SEGUNDA
        /// cópia no MESMO Petit Moth (o motor deixa, `s.filter` não exclui
        /// quem já está equipado) reinicia o contador sem nenhum aviso, e a
        /// evolução nunca completa. Sem visibilidade de "quem já tem o quê"
        /// equipado, a trava é uma via só: depois do primeiro equip bem
        /// sucedido, nunca mais tenta de novo nesta partida — desperdiça
        /// cópias extras em vez de arriscar quebrar a única em andamento.
        /// </summary>
        bool _casuloJaEquipado;

        /// <summary>
        /// Já pus uma carta NESTA cadeia? O motor abre uma janela por elo, e sem
        /// esta memória o NPC tratava cada janela como se fosse a primeira.
        /// </summary>
        bool _jaEncadeou;

        /// <summary>
        /// A cadeia acabou: pode encadear de novo na próxima.
        ///
        /// Quem chama é o host, quando aparece uma pergunta que NÃO é janela de
        /// corrente — durante a montagem da cadeia só existem janelas de
        /// corrente, então qualquer outra pergunta significa que ela já resolveu.
        /// </summary>
        public void ResetCadeia() => _jaEncadeou = false;

        public int DecideChain(InteractiveDuel.Question q, int me = 1)
        {
            int foe = 1 - me;

            // UMA carta por cadeia.
            //
            // O relato que originou a regra: numa Invocação-Normal o NPC ativava
            // DOIS Trap Hole seguidos. O primeiro já destrói o monstro, então o
            // segundo resolve sem alvo e vai direto para o cemitério — carta
            // jogada fora.
            //
            // A regra é grosseira de propósito: ela também impede encadeamentos
            // legítimos, mas no pool da Lista 1 (Trap Hole, Mirror Force, Waboku,
            // Negate Attack, Sakuretsu) somar duas cartas na mesma cadeia é
            // desperdício em praticamente todos os casos. Se o motor OBRIGAR a
            // ativar (`chainForced`), a regra sai da frente.
            if (_jaEncadeou && !q.chainForced)
            {
                _log("chain: ja ativei uma carta nesta cadeia — nao gasta outra");
                return -1;
            }

            foreach (var c in q.choices)
            {
                if (!REMOCAO_ST.Contains(c.code)) { _jaEncadeou = true; return c.index; }

                // Vale gastar a remoção? Duas situações justificam:
                bool temSetada = _setStCountOf(foe) > 0;
                var abertaValiosa = _faceUpStOf(foe).FirstOrDefault(ALVO_ST_ABERTO.Contains);
                if (temSetada || abertaValiosa != 0)
                {
                    _log($"chain: usa {c.code} — " + (abertaValiosa != 0
                        ? $"o oponente tem {abertaValiosa} aberta (leva junto o que ela sustenta)"
                        : "o oponente tem magia/armadilha setada"));
                    _jaEncadeou = true;
                    return c.index;
                }
                _log($"chain: guarda {c.code} — o oponente nao tem alvo que valha");
            }
            // Só sobraram cartas que não vale a pena gastar agora.
            return -1;
        }

        List<Cand> Monstros(List<InteractiveDuel.Act> lista)
        {
            var outp = new List<Cand>();
            foreach (var a in lista)
            {
                var st = _cards.Stats(a.code);
                if (st.IsMonster) outp.Add(new Cand(a, st));
            }
            return outp;
        }

        /// <summary>
        /// Vale arriscar a moeda do Mago do Tempo?
        ///
        /// O efeito é simétrico e cruel: cara varre o campo do oponente, coroa
        /// varre o MEU e ainda cobra metade do ATK perdido em LP. Ou seja, o
        /// valor da jogada depende inteiramente de quem tem mais a perder.
        ///
        /// Três recusas, em ordem — cada uma vem de um jeito de a aposta ser
        /// ruim mesmo quando "dá para ativar":
        ///
        ///   1. **Tenho fusão pronta.** Se a Polymerization está ativável, o
        ///      motor está dizendo que há material suficiente na mão/campo. Pôr
        ///      um corpo grande é melhor do que jogar moeda — e o material que a
        ///      coroa destruiria era justamente o da fusão.
        ///   2. **O oponente não tem monstro.** Cara não destrói nada, coroa
        ///      destrói tudo que é meu. Aposta sem prêmio.
        ///   3. **Meu campo já dá conta.** Se o meu melhor monstro alcança a
        ///      ameaça, estou ganhando a troca sem moeda nenhuma.
        ///
        /// Sobra o caso em que a regra existe: estou atrás, o oponente tem corpo
        /// que eu não supero, e a moeda é a única saída.
        /// </summary>
        (bool arrisca, string porque) VaiArriscarAMoeda(
            InteractiveDuel.Question q, int me, int foe, int ameaca, int meuMelhor)
        {
            if (AtivavelSe(q, FUSAO.Contains).code != 0)
                return (false, "tenho fusao pronta — material vale mais que a moeda");

            if (!_fieldPosOf(foe).Any(m => _cards.Stats(m.code).IsMonster))
                return (false, "o oponente nao tem monstro — cara nao destroi nada");

            // "Campo bom" também é ter algo grande, mesmo que a ameaça seja maior:
            // o monstro grande costuma ser o que a coroa levaria embora.
            int meuMaiorCorpo = _fieldPosOf(me)
                .Where(m => _cards.Stats(m.code).IsMonster)
                .Select(m => _cards.Stats(m.code).AtkValue)
                .DefaultIfEmpty(-1).Max();

            if (meuMelhor >= ameaca && meuMelhor >= 0)
                return (false, $"meu campo ({meuMelhor}) ja alcanca a ameaca ({ameaca})");

            if (meuMaiorCorpo >= CORPO_GRANDE)
                return (false, $"tenho corpo grande em campo ({meuMaiorCorpo}) — nao arrisco perder");

            return (true, $"estou atras ({meuMelhor} contra {ameaca}) — a moeda e' a saida");
        }

        /// <summary>A partir daqui um monstro é "grande" demais para se arriscar
        /// a perder numa moeda. 2000 é a faixa dos Nv6/Nv7 e das fusões básicas.</summary>
        const int CORPO_GRANDE = 2000;

        /// <summary>
        /// Quantos tributos um monstro deste nível exige (regra oficial):
        /// Nv5-6 = 1, Nv7-8 = 2, Nv9+ = 3. Nv1-4 não custa nada.
        /// </summary>
        static int TributosPara(int level) =>
            level >= 9 ? 3 : level >= 7 ? 2 : level >= 5 ? 1 : 0;

        /// <summary>
        /// A invocação por tributo COMPENSA?
        ///
        /// Nasceu de uma jogada absurda observada em duelo: o NPC fundiu um 2600
        /// e no turno seguinte tributou essa mesma fusão para invocar um 2500.
        /// A regra de beatdown só comparava o candidato com a ameaça do
        /// OPONENTE — nunca com o que ela ia destruir do próprio lado.
        ///
        /// O `DecideSelect` sacrifica sempre os monstros de MENOR ATK, então é
        /// contra esses que a conta tem de ser feita: se o melhor entre os que
        /// sairiam já vale tanto quanto o que entra, a troca é ruim e a jogada
        /// não deve nem ser considerada.
        ///
        /// Não conta monstro setado: o NPC só enxerga os com a face para cima
        /// (`FaceUpMonsters`), que é a mesma informação que um humano teria.
        ///
        /// Quando vê MENOS monstros do que os tributos exigidos, julga assim
        /// mesmo pelo que enxerga, em vez de liberar a jogada. Um 2600 visível
        /// não deixa de ser um mau tributo por existir um setado que eu não sei
        /// qual é — e liberar nesse caso era justamente o buraco por onde a
        /// jogada absurda voltava a passar. Só confia no motor quando não há
        /// monstro visível nenhum: aí realmente não há nada conhecido a perder.
        ///
        /// `setando` troca o que se ganha: um monstro SETADO defende com a DEF,
        /// então é a DEF dele que precisa superar o que sai — comparar pela ATK
        /// deixaria passar "tributo um 3200 para setar um 2400/2000", que na
        /// prática entrega 3200 de ataque em troca de 2000 de defesa.
        /// </summary>
        bool TributoCompensa(int me, DatabaseManager.CardStats entra, bool setando)
        {
            int n = TributosPara(entra.Level);
            if (n == 0) return true;                       // Nv1-4: não custa nada

            var sacrificados = _fieldOf(me)
                .Select(c => _cards.Stats(c))
                .Where(s => s.IsMonster)
                .OrderBy(s => s.AtkValue)                  // os mais fracos vão primeiro
                .Take(n)
                .ToList();

            if (sacrificados.Count == 0) return true;      // nada visível a perder

            int maiorPerdido = sacrificados.Max(s => s.AtkValue);
            int ganho = setando ? entra.DefValue : entra.AtkValue;
            return ganho > maiorPerdido;
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
