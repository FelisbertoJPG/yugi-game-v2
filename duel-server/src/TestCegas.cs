using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// **Atacar o que nao se conhece — `--test-cegas`.**
    ///
    /// O relato: *"ele tentou me atacar com a Parede do Labirinto (0/3000) um
    /// monstro meu em DEF face-down, sem ter ideia da defesa dele. Monstro
    /// abaixo de 500 de ATK nao devia atacar o que ele nao conhece."*
    ///
    /// A causa nao era o criterio de batalha: era o cerebro nao distinguir
    /// **campo vazio** de **campo que ele nao consegue LER**. O NPC iniciante so'
    /// enxerga o que esta' com a face para cima (`MonstrosHonestos` filtra as
    /// viradas), entao um campo com monstros setados chegava a `DecideBattle`
    /// como uma lista VAZIA — e o ramo do campo vazio manda atacar, com a
    /// justificativa de dano de graca, que ali nao existe.
    ///
    /// O prejuizo e' assimetrico: batendo num monstro deitado com ATK menor que
    /// a DEF dele, quem ataca **nao perde o corpo, mas leva a diferenca como
    /// dano**. Com 0 de ATK nao ha' nem o lado bom.
    ///
    /// **Os pares CONTROLE sao o teste inteiro.** Uma regra que simplesmente
    /// parasse de atacar passaria no primeiro caso e seria pior que o defeito —
    /// um NPC que nao ataca nao fecha duelo nenhum.
    /// </summary>
    public static class TestCegas
    {
        const uint PAREDE = 67284908;    // Labyrinth Wall — 0/3000: nunca ganha uma batalha
        const uint PETIT = 58192742;     // Petit Moth — 300/200: abaixo do piso
        const uint OX = 5053103;         // Battle Ox — 1700/1000: acima do piso
        const uint ELF = 15025844;       // Mystical Elf — 800/2000: o alvo virado do jogador
        // 2200/100 — o ATK que mora ENTRE a aposta (2000) e o pior caso da faixa
        // (2400). É o único intervalo em que a memória muda a decisão, e por
        // isso é ele que os pares abaixo usam.
        const uint JIRAI_GUMO = 94773007;
        const uint PAREDE_2400 = 68075840; // Power Pro Knight Girls 1200/2400 Nv4 — o pior caso da faixa
        const uint MURO_NV5 = 32012841;  // Millennium Shield 0/3000 Nv5 — FORA da faixa de um set sem tributo
        const int MZONE = 0x4;
        const int POS_ATAQUE = 0x1, POS_DEFESA_VIRADA = 0x8;

        static int _pass, _fail;

        static void Check(string oque, bool ok, string detalhe = "")
        {
            if (ok) { Log.Info($"  OK    {oque}"); _pass++; }
            else { Log.Err($"  FALHA {oque} {detalhe}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== o NPC INICIANTE diante de uma carta virada ===\n");
            using var db = new DatabaseManager(sa);

            // O corpo do jogador esta' VIRADO. Para o iniciante ele nao existe:
            // e' exatamente o que `MonstrosHonestos` devolve — nada.
            var campoJogadorVirado = new List<(uint code, int pos, int seq)>
                { (ELF, POS_DEFESA_VIRADA, 0) };

            // --------------------------------------------------------- o defeito
            var r1 = Decidir(db, PAREDE, campoJogadorVirado, cego: true);
            Check("a Parede do Labirinto (0 de ATK) NAO ataca a carta virada",
                  !r1.Attack, $"(atacou: {r1.Why})");

            var r2 = Decidir(db, PETIT, campoJogadorVirado, cego: true);
            Check("Petit Moth (300) tambem nao — esta' abaixo do piso",
                  !r2.Attack, $"(atacou: {r2.Why})");

            // ------------------------------------------------------ par CONTROLE
            // Sem este, "nao atacou" nao provaria criterio nenhum: bastaria uma
            // regra que parasse de atacar sempre.
            var r3 = Decidir(db, OX, campoJogadorVirado, cego: true);
            Check("CONTROLE: o Battle Ox (1700) ATACA a mesma carta virada",
                  r3.Attack, $"(nao atacou: {r3.Why})");

            // O segundo controle: o MESMO corpo de 0 de ATK contra um campo
            // REALMENTE vazio continua atacando — ali e' dano de graca, e recusar
            // seria trocar um defeito por outro.
            var r4 = Decidir(db, PAREDE, new List<(uint, int, int)>(), cego: true, direto: true);
            Check("CONTROLE: com o campo dele VAZIO, a mesma Parede ataca (direto)",
                  r4.Attack, $"(nao atacou: {r4.Why})");

            // O terceiro: o NPC AVANCADO le a carta virada pela DEF real, entao
            // para ele a lista nao chega vazia e este ramo nem roda — a decisao
            // volta a ser a de sempre (0 nao vence 2000, nao ataca).
            var r5 = Decidir(db, PAREDE, campoJogadorVirado, cego: false);
            Check("CONTROLE: o avancado decide pela DEF real, nao pelo piso",
                  !r5.Attack && r5.Why.Contains("2000"), $"({r5.Why})");

            Log.Info("\n=== a carta VIRADA: a aposta, e a memoria que a vence ===\n");
            OVirado(db);

            Log.Info("\n=== o corpo EQUIPADO nao e' o mais barato do campo ===\n");
            OCorpoEquipado(db);

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        /// <summary>
        /// **A carta VIRADA deixou de ser um buraco.** O relato: *"ele está com
        /// medo de bater em qualquer card meu em def"*.
        ///
        /// A conta é a de qualquer jogador: o jogador só SETOU (sem tributo),
        /// então é nível ≤4, então **provavelmente** tem no máximo 2000 de DEF —
        /// e é uma APOSTA, não um teto: no pool, 9 de 544 cartas a furam (1,7%).
        ///
        /// E a aposta cai quando há informação melhor: se o NPC VIU o jogador
        /// buscar um muro, a carta setada é quase certamente ele.
        /// </summary>
        static void OVirado(DatabaseManager db)
        {
            // O jogador tem UM monstro virado na zona 0, posto sem tributo.
            var virado = new List<(int seq, int nivelMax)> { (0, 4) };

            // 2200 passa da aposta de 2000: ataca. (O Jirai Gumo esta' entre a
            // aposta e o pior caso da faixa (2400) DE PROPOSITO — e' o unico
            // intervalo em que a memoria muda a decisao, e por isso e' nele que
            // os quatro casos abaixo acontecem.)
            var forte = DecidirComVirado(db, JIRAI_GUMO, virado, vistos: null);
            Check("com 2200 de ATK, ATACA a carta virada (a aposta e' 2000)",
                  forte.Attack, $"(nao atacou: {forte.Why})");

            // CONTROLE: 1700 nao passa nem da aposta. Sem este par, "atacou" nao
            // provaria criterio nenhum — bastaria atacar sempre.
            var fraco = DecidirComVirado(db, OX, virado, vistos: null);
            Check("CONTROLE: com 1700 NAO ataca — nao vence nem a aposta",
                  !fraco.Attack, $"(atacou: {fraco.Why})");

            // A MEMORIA, e o par mais apertado que da' para montar: MESMO
            // atacante, MESMO campo, MESMA carta virada. So' muda o que o NPC
            // viu. Ele assistiu o jogador BUSCAR uma parede de 2400 (Nv4) que
            // ainda nao apareceu: o setado e' quase certamente ela, e 2200 deixa
            // de bastar.
            var comMemoria = DecidirComVirado(db, JIRAI_GUMO, virado,
                                              vistos: new List<uint> { PAREDE_2400 });
            Check("vendo o jogador BUSCAR um muro de 2400, o MESMO 2200 recua",
                  !comMemoria.Attack, $"(atacou assim mesmo: {comMemoria.Why})");

            // CONTROLE da memoria: a MESMA carta vista, mas de nivel 5 — ela nao
            // explica um set SEM tributo, entao a aposta volta a valer e o
            // ataque sai. Sem este par, "recuou" so' provaria que ver qualquer
            // coisa trava o NPC.
            var foraDaFaixa = DecidirComVirado(db, JIRAI_GUMO, virado,
                                               vistos: new List<uint> { MURO_NV5 });
            Check("CONTROLE: um muro de NIVEL 5 visto nao explica um set sem tributo",
                  foraDaFaixa.Attack, $"(recuou por uma carta que nao cabe na faixa: {foraDaFaixa.Why})");
        }

        static NpcBrain.BattlePlay DecidirComVirado(
            DatabaseManager db, uint meuCorpo,
            List<(int seq, int nivelMax)> virados, List<uint> vistos)
        {
            var campoNpc = new List<(uint code, int pos, int seq)> { (meuCorpo, POS_ATAQUE, 0) };
            var vazio = new List<(uint code, int pos, int seq)>();

            var cerebro = new NpcBrain(
                db,
                p => (p == 1 ? campoNpc : vazio).Select(m => m.code).ToList(),
                s => Log.Info($"    [npc] {s}"),
                _ => Array.Empty<uint>(),
                _ => 0,
                p => (p == 1 ? campoNpc : vazio).Select(m => (m.code, m.pos)).ToList(),
                _ => 0, _ => Array.Empty<uint>(), _ => 8000,
                p => p == 1 ? campoNpc : vazio,
                _ => Array.Empty<uint>(),
                null, null, null,
                p => p == 0 ? (IReadOnlyList<(int, int)>)virados : Array.Empty<(int, int)>(),
                p => p == 0 ? (IReadOnlyList<uint>)(vistos ?? new List<uint>()) : Array.Empty<uint>());

            var q = new InteractiveDuel.Question { kind = "battle", player = 1 };
            q.attackers.Add(new InteractiveDuel.Act
            {
                code = meuCorpo, index = 0, controller = 1, location = MZONE, sequence = 0,
                // O campo dele NAO esta vazio (ha' um virado), entao o motor nao
                // ofereceria ataque direto.
                canDirect = false,
            });
            return cerebro.DecideBattle(q, 1);
        }

        /// <summary>
        /// **O relato do Wevil:** *"ele equipa spell num monstro e tributa ele
        /// logo em seguida"*. O equipamento vai JUNTO para o cemitério, entao o
        /// atalho e' pago com duas cartas.
        ///
        /// O numero vivo sozinho nao resolvia: um Petit Moth de 300 com +700
        /// continua sendo 1000, e 1000 e' menos que o Battle Ox de 1700 que esta'
        /// ao lado. Quem responde e' o PRECO do corpo (`ValorDoMeuCorpo`), que
        /// agora conta a carta que sai junto.
        /// </summary>
        static void OCorpoEquipado(DatabaseManager db)
        {
            // Campo do NPC: o Moth REFORCADO na zona 0, o Ox limpo na zona 1.
            var campoNpc = new List<(uint code, int pos, int seq)>
                { (PETIT, POS_ATAQUE, 0), (OX, POS_ATAQUE, 1) };

            // O ATK vivo: o Moth esta' equipado (300 -> 1000), o Ox nao.
            (int, int)? Vivo(int player, int seq) =>
                player == 1 && seq == 0 ? (1000, 200)
                : player == 1 && seq == 1 ? (1700, 1000)
                : ((int, int)?)null;

            var barato = Cerebro(db, campoNpc, Vivo).CorpoMaisBarataParaTeste(1);
            Check("com o Moth EQUIPADO, o corpo mais barato passa a ser o Battle Ox",
                  barato.code == OX,
                  $"(escolheu {barato.code}, valor {barato.valor})");

            // CONTROLE: o MESMO campo com o Moth sem reforço nenhum. Aqui ele
            // TEM de ser o mais barato — senao "escolheu o Ox" nao provaria que
            // foi o equipamento que mudou a conta, so' que a regra parou de
            // escolher o menor.
            (int, int)? Limpo(int player, int seq) =>
                player == 1 && seq == 0 ? (300, 200)
                : player == 1 && seq == 1 ? (1700, 1000)
                : ((int, int)?)null;

            var baratoLimpo = Cerebro(db, campoNpc, Limpo).CorpoMaisBarataParaTeste(1);
            Check("CONTROLE: sem o equipamento, o mais barato volta a ser o Petit Moth",
                  baratoLimpo.code == PETIT,
                  $"(escolheu {baratoLimpo.code}, valor {baratoLimpo.valor})");
        }

        static NpcBrain Cerebro(DatabaseManager db,
                                List<(uint code, int pos, int seq)> campoNpc,
                                Func<int, int, (int atk, int def)?> vivo) => new NpcBrain(
            db,
            p => (p == 1 ? campoNpc : new List<(uint, int, int)>()).Select(m => m.Item1).ToList(),
            s => Log.Info($"    [npc] {s}"),
            _ => Array.Empty<uint>(),
            _ => 0,
            p => (p == 1 ? campoNpc : new List<(uint, int, int)>()).Select(m => (m.Item1, m.Item2)).ToList(),
            _ => 0, _ => Array.Empty<uint>(), _ => 8000,
            p => p == 1 ? campoNpc : new List<(uint, int, int)>(),
            _ => Array.Empty<uint>(),
            vivo);

        /// <summary>
        /// Monta o cerebro com um campo de mentira e pergunta a batalha.
        ///
        /// `cego` e' a diferenca entre os dois niveis, no unico ponto em que ela
        /// existe: o acessador do campo do oponente. Iniciante recebe a versao
        /// HONESTA (as viradas somem); avancado recebe tudo, com posicao.
        /// </summary>
        static NpcBrain.BattlePlay Decidir(DatabaseManager db, uint meuCorpo,
                                           List<(uint code, int pos, int seq)> campoJogador,
                                           bool cego, bool direto = false)
        {
            var campoNpc = new List<(uint code, int pos, int seq)> { (meuCorpo, POS_ATAQUE, 0) };
            var visivelDoJogador = cego
                ? campoJogador.Where(m => (m.pos & (0x2 | 0x8)) == 0).ToList()
                : campoJogador;

            var cerebro = new NpcBrain(
                db,
                p => (p == 1 ? campoNpc : visivelDoJogador).Select(m => m.code).ToList(),
                s => Log.Info($"    [npc] {s}"),
                _ => Array.Empty<uint>(),
                _ => 0,
                p => (p == 1 ? campoNpc : visivelDoJogador).Select(m => (m.code, m.pos)).ToList(),
                _ => 0, _ => Array.Empty<uint>(), _ => 8000,
                p => p == 1 ? campoNpc : visivelDoJogador,
                _ => Array.Empty<uint>());

            var q = new InteractiveDuel.Question { kind = "battle", player = 1 };
            q.attackers.Add(new InteractiveDuel.Act
            {
                code = meuCorpo, index = 0, controller = 1, location = MZONE, sequence = 0,
                // O motor so' oferece ataque DIRETO com o campo do outro lado
                // vazio — e e' esse byte que separa "vazio" de "ilegivel".
                canDirect = direto,
            });
            return cerebro.DecideBattle(q, 1);
        }
    }
}
