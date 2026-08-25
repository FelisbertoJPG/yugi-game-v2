using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// **O NPC sabe usar as cartas deste deck?** — `--cobertura &lt;arquivo.ydk&gt;`
    ///
    /// Existe por uma pergunta que se repete toda vez que um deck de adversário
    /// ganha carta nova: *"adicionei uns cards e ele não sabe usar"*. Até aqui a
    /// resposta saía de ler o `NpcBrain` inteiro procurando o id — e o
    /// `NpcBrain` tem 3 mil linhas, metade das regras não cita id nenhum (elas
    /// reconhecem a carta pelo EFEITO), e o que se procura é justamente o que
    /// **não** está lá. Procurar ausência lendo código é como o buraco passa.
    ///
    /// Aqui a resposta é MEDIDA, não deduzida: cada carta do deck é oferecida ao
    /// cérebro sozinha, em vários estados de mesa, e pergunta-se se ele a
    /// escolhe em algum deles. Carta que ele nunca escolhe é carta que ele não
    /// sabe usar — que é literalmente a definição.
    ///
    /// **O que isto NÃO prova.** Que a jogada é BOA, ou que sai na hora certa: a
    /// mesa aqui é montada à mão, não é um duelo. E o contrário também vale —
    /// "nunca escolhida" pode ser a resposta certa para uma carta cuja hora não
    /// está entre os cenários abaixo. É uma varredura para achar o que olhar, e
    /// o que ela aponta vira regra com teste próprio, num duelo de verdade.
    /// </summary>
    public static class Cobertura
    {
        /// <summary>
        /// Os estados de mesa. Não são decorativos: quase toda regra do cérebro
        /// olha para a relação entre os dois campos (a `ameacaReal`), então uma
        /// mesa só esconderia metade das regras — e uma carta que só sai quando
        /// se está perdendo apareceria como "não sabe usar".
        /// </summary>
        static readonly Mesa[] MESAS =
        {
            new("mesa vazia",               new uint[0],            new uint[0]),
            new("apanhando (vazio x 1700)", new uint[0],            new[] { BATTLE_OX }),
            new("apanhando (800 x 2300)",   new[] { MYSTICAL_ELF }, new[] { GAIA_NV7 }),
            new("empatado (1700 x 1700)",   new[] { BATTLE_OX },    new[] { BATTLE_OX }),
            new("dominando (2300 x 300)",   new[] { GAIA_NV7 },     new[] { PETIT_MOTH }),
            new("so' eu em campo",          new[] { BATTLE_OX },    new uint[0]),
            // As duas de baixo existem porque a versao anterior desta sonda
            // apontou dois buracos que nao eram: o Foolish Burial so' e' jogado
            // com uma reanimacao na MAO, e o Shifting Shadows so' com carta
            // VIRADA para esconder. Uma mesa que nunca tem nem uma coisa nem
            // outra reporta as duas como "ele nao sabe usar" — e um relatorio de
            // ausencia que da' falso positivo deixa de ser lido.
            new("com duas viradas minhas",  new[] { MYSTICAL_ELF, PETIT_MOTH }, new[] { BATTLE_OX },
                viradas: true),
            new("com reanimacao na mao",    new[] { MYSTICAL_ELF }, new[] { BATTLE_OX },
                acompanha: MONSTER_REBORN),
            // Racas VARIADAS do meu lado. Terceiro falso positivo medido: uma
            // magia de campo so' e' ativada quando ha' monstro MEU de uma raca
            // que ELA reforca (ativa-la sem isso reforcaria so' o outro lado),
            // e todas as mesas acima sao de Guerreiro/Mago/Inseto — nenhuma
            // Mountain ou Umi encontrava beneficiado, e as duas apareciam como
            // "ele nao sabe usar" mesmo tendo regra. Dragao + Peixe/WATER +
            // Demonio + Besta-Guerreira cobrem os campos do pool de hoje.
            new("racas variadas do meu lado",
                new[] { BLUE_EYES, SETE_CORES, KING_YAMIMAKAI, BATTLE_OX, KYONSHEE },
                new[] { GAIA_NV7 }),
        };

        /// <param name="viradas">Os meus monstros entram com a face para BAIXO.</param>
        /// <param name="acompanha">Uma segunda carta na mao — o par de quem so' e'
        /// jogada em combo. A sonda continua exigindo que o motivo cite a carta
        /// PROBADA, entao a acompanhante nunca conta como acerto.</param>
        sealed record Mesa(string Nome, uint[] Meu, uint[] Dele,
                           bool viradas = false, uint acompanha = 0);

        const uint PETIT_MOTH = 58192742, MYSTICAL_ELF = 15025844,
                   BATTLE_OX = 5053103, GAIA_NV7 = 6368038,
                   MONSTER_REBORN = 83764718;

        // Corpos escolhidos pela RACA, para a mesa variada acima. Todos Normais
        // (vanilla): o que importa neles e' a raca e o atributo, nao o efeito.
        const uint BLUE_EYES = 89631139,      // Dragao   — Mountain
                   SETE_CORES = 23771716,     // Peixe / WATER — Umi, A Legendary Ocean
                   KING_YAMIMAKAI = 69455834, // Demonio  — Yami
                   KYONSHEE = 24530661;       // Zumbi    — Wasteland

        public static int Run(string sa, string caminho)
        {
            if (string.IsNullOrWhiteSpace(caminho) || !File.Exists(caminho))
            {
                Log.Err($"uso: --cobertura <arquivo.ydk>   (nao achei '{caminho}')");
                return 2;
            }

            var (main, extra) = LerYdk(caminho);
            if (main.Count == 0) { Log.Err("o .ydk nao tem main deck"); return 2; }

            using var db = new DatabaseManager(sa);
            Log.Info($"=== cobertura de {Path.GetFileName(caminho)} " +
                     $"({main.Count} no main, {extra.Count} no extra) ===\n");

            var sabe = new List<string>();
            var naoSabe = new List<string>();

            foreach (uint code in main.Distinct().OrderBy(c => c))
            {
                var st = db.Stats(code);
                string nome = db.Nome(code);
                string rotulo = $"{code} {nome}";

                // Monstro sem efeito não passa por regra de ativação nenhuma: a
                // regra dele é a de invocação, que trata todo corpo igual pelo
                // statline. Dizer que ele "não sabe usar" seria ruído — e ruído
                // numa varredura de ausência é o que faz ninguém mais lê-la.
                if (st.IsMonster && (st.Type & TYPE_EFFECT) == 0)
                {
                    sabe.Add($"{rotulo}  [corpo Normal — entra pela regra de invocacao]");
                    continue;
                }

                var (escolhida, onde, porque) = Sonda(db, code, st);
                if (escolhida) sabe.Add($"{rotulo}\n        {onde}: {porque}");
                else naoSabe.Add($"{rotulo}  [{Classe(st)}, category 0x{st.Category:x}]");
            }

            Log.Info($"-- ELE USA ({sabe.Count}) --");
            foreach (var s in sabe) Log.Info("  ok   " + s);

            Log.Info($"\n-- NENHUMA REGRA ESCOLHEU ({naoSabe.Count}) --");
            if (naoSabe.Count == 0) Log.Info("  (nenhuma)");
            foreach (var s in naoSabe) Log.Info("  ??   " + s);

            Log.Info("\n(uma carta aqui embaixo nao e' necessariamente um buraco —");
            Log.Info(" pode ser que a hora dela nao esteja entre as mesas testadas.)");
            return 0;
        }

        const uint TYPE_EFFECT = 0x20;

        static string Classe(DatabaseManager.CardStats st) =>
            st.IsMonster ? "monstro com efeito" : st.IsTrap ? "armadilha" : st.IsSpell ? "magia" : "?";

        /// <summary>
        /// Oferece a carta sozinha ao cérebro, mesa por mesa, e devolve a
        /// primeira escolha. Sozinha de propósito: com o deck inteiro na oferta,
        /// uma carta de prioridade baixa nunca seria escolhida e apareceria como
        /// desconhecida — o que se mede aqui é se EXISTE regra, não a ordem
        /// entre elas.
        /// </summary>
        static (bool, string, string) Sonda(DatabaseManager db, uint code, DatabaseManager.CardStats st)
        {
            foreach (var mesa in MESAS)
            {
                string nome = mesa.Nome;
                var meuCampo = mesa.Meu.ToList();
                var campoDele = mesa.Dele.ToList();
                var minhaMao = new List<uint> { code };
                if (mesa.acompanha != 0) minhaMao.Add(mesa.acompanha);

                // `fieldOf` e' "monstro com a FACE PARA CIMA": numa mesa de cartas
                // viradas ele volta vazio, e e' assim que o cerebro le' o mundo.
                var meuVisivel = mesa.viradas ? new List<uint>() : meuCampo;
                int minhaPos = mesa.viradas ? 0x8 : 0x1;

                var brain = new NpcBrain(db,
                    fieldOf: p => p == 1 ? meuVisivel : campoDele,
                    log: _ => { },
                    handOf: p => p == 1 ? minhaMao : new List<uint>(),
                    fieldPosOf: p => (p == 1 ? meuVisivel : campoDele)
                                     .Select(c => (c, 0x1)).ToList(),
                    todoFieldPosOf: p => p == 1
                                     ? meuCampo.Select((c, i) => (c, minhaPos, i)).ToList()
                                     : campoDele.Select((c, i) => (c, 0x1, i)).ToList());

                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                // A carta entra nas DUAS listas que cabem a ela: um monstro com
                // efeito pode ser jogada de invocação (o Mago do Tempo é assim),
                // e magia/armadilha só existe como ativação.
                if (st.IsMonster)
                {
                    q.summonable.Add(new InteractiveDuel.Act { code = code, index = 0, location = 0x2 });
                    q.settable.Add(new InteractiveDuel.Act { code = code, index = 0, location = 0x2 });
                }
                q.activatable.Add(new InteractiveDuel.Act { code = code, index = 0, location = 0x2 });
                if (st.IsTrap) q.settableST.Add(new InteractiveDuel.Act { code = code, index = 0, location = 0x2 });

                NpcBrain.Play p;
                try { p = brain.Decide(q, 1); }
                catch (Exception e) { return (false, nome, "a regra estourou: " + e.Message); }

                // "endturn" e a invocação genérica de corpo não contam como saber
                // usar uma carta COM efeito: elas sairiam igual com um vanilla no
                // lugar. O que se procura é uma regra que reagiu a ESTA carta.
                // O motivo tem de CITAR esta carta. Sem essa exigencia, a mesa que
                // poe uma acompanhante na mao contaria a jogada DELA como acerto
                // da carta probada — e a sonda passaria a mentir justamente nos
                // casos que ela ganhou para cobrir.
                if (p.Action == "endturn") continue;
                if (!CitaACarta(p.Why, code)) continue;

                return (true, nome, $"{p.Action} — {p.Why}");
            }
            return (false, null, null);
        }

        /// <summary>
        /// A regra falou DESTA carta, ou só descreveu um corpo qualquer? O `why`
        /// das regras próprias cita o código; o da invocação genérica fala em
        /// ATK/DEF e nível.
        /// </summary>
        static bool CitaACarta(string why, uint code) =>
            why != null && why.Contains(code.ToString());

        // ------------------------------------------------------------------ ydk

        static (List<uint> main, List<uint> extra) LerYdk(string caminho)
        {
            var main = new List<uint>();
            var extra = new List<uint>();
            var alvo = main;
            foreach (string cru in File.ReadAllLines(caminho))
            {
                string linha = cru.Trim();
                if (linha.Length == 0) continue;
                if (linha.StartsWith("#main", StringComparison.OrdinalIgnoreCase)) { alvo = main; continue; }
                if (linha.StartsWith("#extra", StringComparison.OrdinalIgnoreCase)) { alvo = extra; continue; }
                if (linha.StartsWith("!side", StringComparison.OrdinalIgnoreCase)) break;
                if (linha[0] == '#' || linha[0] == '!') continue;
                if (uint.TryParse(linha, out uint code)) alvo.Add(code);
            }
            return (main, extra);
        }
    }
}
