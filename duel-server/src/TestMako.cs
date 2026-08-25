using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste de aceitação do deck de ÁGUA do Mako — `--test-mako`.
    ///
    /// O deck (`decks/npc/mako/deck_1.ydk`) gira em torno de uma palavra: "Umi".
    /// Meia dúzia de cartas ligam condições "enquanto 'Umi' estiver em campo" sem
    /// se chamarem Umi, e é isso que o `NpcBrain` não enxergava.
    ///
    /// Três coisas provadas aqui, todas com PAR CONTROLE — sem ele "não fez"
    /// não prova nada, porque não fazer nada também passa:
    ///
    ///   1. **O Templo.** `Forgotten Temple of the Deep` bane um Fish/Sea
    ///      Serpent/Aqua Nv≤4 do próprio dono e o devolve na End Phase de um
    ///      turno DELE. O relato que originou tudo: o NPC banía o próprio monstro
    ///      em toda janela de corrente, turno após turno, de graça.
    ///
    ///      A causa é fina e vale ficar registrada: o banco marca o Templo com o
    ///      bit `0x100000` (INVOCAÇÃO ESPECIAL) por causa do RETORNO na End Phase,
    ///      e o cérebro lia isso como "esta carta põe corpo em campo". É o
    ///      contrário — ativar TIRA um corpo do campo. Como o efeito é
    ///      `EVENT_FREE_CHAIN`, o motor oferece a janela dela o tempo todo, e a
    ///      regra genérica do "corpo de graça" mordia a isca em todas.
    ///
    ///   2. **O que conta como Umi.** Umi, A Legendary Ocean, o próprio Templo,
    ///      Sea Stealth II, Pacifis, Magellanica, Lemuria — e a Maiden of the
    ///      Aqua, que só vale ENQUANTO não houver magia de campo aberta (qualquer
    ///      uma, inclusive uma do oponente sem nada a ver com água).
    ///
    ///   3. **Quem ganha proteção com ela.** O `The Legendary Fisherman` não pode
    ///      ser alvo de ataque — então deitá-lo de parede é esconder 1850 de ATK
    ///      com medo de um ataque que as regras não permitem.
    ///
    /// O ataque direto (`Amphibious Bugroth MK-11`, `Mega Fortress Whale`) NÃO
    /// tem teste aqui de propósito: `canDirect` vem do byte do próprio motor, que
    /// já resolve a condição da Umi sozinho — não há decisão nossa para provar.
    /// O que estava errado era só a explicação na tela, corrigida junto.
    /// </summary>
    public static class TestMako
    {
        const uint TEMPLO = 43889633;      // Forgotten Temple of the Deep (Armadilha Contínua)
        const uint UMI = 22702055;         // Umi (Magia de Campo)
        const uint OCEANO = 295517;        // A Legendary Ocean (nome vira "Umi")
        const uint MAIDEN = 17214465;      // Maiden of the Aqua — campo tratado como Umi
        const uint FISHERMAN = 3643300;    // The Legendary Fisherman 1850/1600
        const uint RARE_FISH = 80516007;   // Fusão Nv4 Fish 1500/1200 — a do Instant/Ready Fusion
        const uint JELLYFISH = 14851496;   // Nv4 Aqua 1200/1500
        const uint KAIRYU_SHIN = 76634149; // Nv5 Sea Serpent — FORA do alcance do Templo
        const uint TORRENTIAL = 7092142;   // Torrential Reborn
        const uint PREMATURE = 70828912;   // Premature Burial
        const uint MOUNTAIN = 50913601;    // magia de campo QUALQUER (desliga a Maiden)
        const uint RAIGEKI = 12580477;     // MAGIA que destrói monstro
        const uint TRAP_HOLE = 4206964;    // ARMADILHA que destrói monstro
        const uint TORPEDO_FISH = 90337190;// Nv3 Fish 1000/1000 — imune a MAGIA com Umi
        const uint BATTLE_OX = 5053103;    // corpo inerte do outro lado

        const byte POS_ATAQUE = 0x1, POS_DEFESA = 0x4;

        static int _pass, _fail;
        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== o Templo: banir so' com motivo ===\n");
            Templo(sa);
            Log.Info("\n=== a imunidade a magia que a Umi da' ===\n");
            QuemEhUmi(sa);
            Log.Info("\n=== ... e que ela cobre so' MAGIA ===\n");
            Protecao(sa);
            Log.Info("\n=== ativar a Umi: a carta em torno da qual o deck existe ===\n");
            AtivarOCampo(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------------
        // Monta um cérebro com o campo/mão/baixadas que o cenário pede.
        // `me` é sempre 1 (o NPC); 0 é o oponente.
        // ------------------------------------------------------------------
        /// <param name="condenados">
        /// Os CÓDIGOS que estão em campo como corpo condenado (Instant/Ready
        /// Fusion: não atacam e morrem na End Phase deste turno).
        ///
        /// Antes o cérebro adivinhava isso pelo TIPO da carta — "uma Fusão em
        /// campo só pode ter vindo do Instant/Ready Fusion" —, e o argumento valia
        /// para este deck e para mais nenhum: num deck com Polymerization o
        /// palpite mandaria banir o melhor corpo do campo achando que ele ia sumir
        /// sozinho. Hoje quem marca é o motor, pelo que aconteceu, e aqui a marca
        /// é dita explicitamente — que é justamente o que faz este teste continuar
        /// provando a REGRA e não a coincidência do deck.
        /// </param>
        static NpcBrain Cerebro(DatabaseManager db,
                                List<uint> meuCampo = null, List<uint> campoDele = null,
                                List<uint> minhaMao = null,
                                List<uint> minhasBaixadas = null, List<uint> minhasAbertas = null,
                                List<uint> condenados = null)
        {
            meuCampo ??= new List<uint>(); campoDele ??= new List<uint>();
            minhaMao ??= new List<uint>();
            minhasBaixadas ??= new List<uint>(); minhasAbertas ??= new List<uint>();
            condenados ??= new List<uint>();

            // O campo destes cenarios e' uma lista de codigos; a zona de cada um e'
            // o indice dela. E' o que permite marcar a condenacao por ZONA, como o
            // motor faz.
            return new NpcBrain(db,
                fieldOf: p => p == 1 ? meuCampo : campoDele,
                log: m => Log.Info($"    [npc] {m}"),
                handOf: p => p == 1 ? minhaMao : new List<uint>(),
                faceUpStOf: p => p == 1 ? minhasAbertas : new List<uint>(),
                setStOf: p => p == 1 ? minhasBaixadas : new List<uint>(),
                // A ZONA de cada monstro — o indice na lista. A condenacao e' por
                // zona (no motor tambem), entao sem isto ela nao teria onde pousar.
                todoFieldPosOf: p => (p == 1 ? meuCampo : campoDele)
                    .Select((c, i) => (code: c, pos: (int)POS_ATAQUE, seq: i)).ToList(),
                corpoCondenadoOf: (p, seq) => p == 1
                    && seq >= 0 && seq < meuCampo.Count && condenados.Contains(meuCampo[seq]));
        }

        static InteractiveDuel.Question Cadeia(uint oferecida, string gatilhoKind = "",
                                               uint gatilhoCode = 0, int gatilhoPlayer = -1)
        {
            var q = new InteractiveDuel.Question { kind = "chain", player = 1 };
            q.choices.Add(new InteractiveDuel.Sel { code = oferecida, index = 0 });
            q.chainTriggerKind = gatilhoKind;
            q.chainTriggerCode = gatilhoCode;
            q.chainTriggerPlayer = gatilhoPlayer;
            return q;
        }

        static InteractiveDuel.Question Idle(params uint[] ativaveis)
        {
            var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
            int i = 0;
            foreach (var c in ativaveis) q.activatable.Add(new InteractiveDuel.Act { code = c, index = i++ });
            return q;
        }

        // ------------------------------------------------------------------
        // 1. O TEMPLO
        // ------------------------------------------------------------------
        static void Templo(string sa)
        {
            var db = new DatabaseManager(sa);

            // --- a carta ainda BAIXADA: a oferta é a ativação dela, e pôr o
            //     Templo em campo é sempre bom (o nome vira "Umi").
            var b = Cerebro(db, meuCampo: new List<uint> { FISHERMAN },
                            minhasBaixadas: new List<uint> { TEMPLO });
            Check("Templo ainda baixado: ATIVA a carta (o nome dela vira Umi)",
                  b.DecideChain(Cadeia(TEMPLO), 1) == 0);

            // --- O BUG ORIGINAL. Templo JÁ em campo, nenhum monstro em risco:
            //     a janela abre (EVENT_FREE_CHAIN abre sempre) e ele tem de
            //     RECUSAR. Era aqui que ele banía o próprio monstro toda vez.
            b = Cerebro(db, meuCampo: new List<uint> { JELLYFISH },
                        minhasAbertas: new List<uint> { TEMPLO });
            Check("Templo em campo e ninguem em risco: NAO bane (era o bug do relato)",
                  b.DecideChain(Cadeia(TEMPLO), 1) == -1);

            // --- A jogada que o deck existe para fazer: a Fusão do Instant/Ready
            //     Fusion morre na End Phase. Banida, ela escapa e volta.
            b = Cerebro(db, meuCampo: new List<uint> { RARE_FISH, JELLYFISH },
                        minhasAbertas: new List<uint> { TEMPLO },
                        condenados: new List<uint> { RARE_FISH });
            Check("Fusao condenada em campo: BANE para ela nao morrer na End Phase",
                  b.DecideChain(Cadeia(TEMPLO), 1) == 0);

            // --- ... e ele bane a CERTA. O critério genérico de seleção pega o
            //     de maior ATK, que aqui seria o Jellyfish errado por 300.
            var q = new InteractiveDuel.Question { kind = "select", player = 1, selMin = 1, selMax = 1 };
            q.choices.Add(new InteractiveDuel.Sel { code = JELLYFISH, index = 0, location = 0x4 });
            q.choices.Add(new InteractiveDuel.Sel { code = RARE_FISH, index = 1, location = 0x4 });
            var escolha = b.DecideSelect(q, 1);
            Check("e bane a Fusao, nao o monstro que estava segurando o campo",
                  escolha.Count == 1 && escolha[0] == 1,
                  $"(escolheu indice {(escolha.Count > 0 ? escolha[0].ToString() : "nenhum")})");

            // --- PAR CONTROLE do combo: com o Torrential Reborn baixado, deixar
            //     morrer é melhor (revive E queima 500). Guardar o uso do Templo
            //     é a jogada — foi o que o Mako já fazia bem.
            b = Cerebro(db, meuCampo: new List<uint> { RARE_FISH },
                        minhasAbertas: new List<uint> { TEMPLO },
                        minhasBaixadas: new List<uint> { TORRENTIAL });
            Check("com Torrential Reborn baixado: NAO bane — deixa morrer e revive",
                  b.DecideChain(Cadeia(TEMPLO), 1) == -1);

            // --- mesmo par, pela outra porta: Premature Burial na mão.
            b = Cerebro(db, meuCampo: new List<uint> { RARE_FISH },
                        minhasAbertas: new List<uint> { TEMPLO },
                        minhaMao: new List<uint> { PREMATURE });
            Check("com Premature Burial na mao: NAO bane",
                  b.DecideChain(Cadeia(TEMPLO), 1) == -1);

            // --- fuga de remoção: o oponente ativou uma ARMADILHA que destrói.
            b = Cerebro(db, meuCampo: new List<uint> { JELLYFISH },
                        campoDele: new List<uint> { BATTLE_OX },
                        minhasAbertas: new List<uint> { TEMPLO });
            Check("ele ativou destruicao de monstro: BANE para escapar",
                  b.DecideChain(Cadeia(TEMPLO, "activation", TRAP_HOLE, 0), 1) == 0);

            // --- ... mas não se o alvo for IMUNE A MAGIA com a Umi em campo.
            //     O alvo TEM de ser alcançável pelo Templo (Nv≤4, Fish/Sea
            //     Serpent/Aqua) E imune — senão a linha passaria pelo motivo
            //     errado, com a lista de elegíveis vazia. O Legendary Fisherman
            //     é imune mas é WARRIOR: o Templo nem o alcança. Quem serve é o
            //     Torpedo Fish. (Aqui o próprio Templo em campo é a "Umi".)
            b = Cerebro(db, meuCampo: new List<uint> { TORPEDO_FISH },
                        campoDele: new List<uint> { BATTLE_OX },
                        minhasAbertas: new List<uint> { TEMPLO });
            Check("ameaca e' MAGIA e o alvo e' imune com Umi: NAO gasta o Templo",
                  b.DecideChain(Cadeia(TEMPLO, "activation", RAIGEKI, 0), 1) == -1);

            // --- o Templo não alcança Nv5+: sem alvo legal, não há o que decidir.
            b = Cerebro(db, meuCampo: new List<uint> { KAIRYU_SHIN },
                        minhasAbertas: new List<uint> { TEMPLO });
            Check("so' tenho um Nv5 (fora do alcance do Templo): NAO bane",
                  b.DecideChain(Cadeia(TEMPLO, "activation", TRAP_HOLE, 0), 1) == -1);

            // --- e a mesma decisão pela Main Phase, não só pela corrente.
            b = Cerebro(db, meuCampo: new List<uint> { RARE_FISH },
                        minhasAbertas: new List<uint> { TEMPLO },
                        condenados: new List<uint> { RARE_FISH });
            var play = b.Decide(Idle(TEMPLO), 1);
            Check("Main Phase: ativa o Templo pela Fusao condenada",
                  play.Action == "activate", $"(veio {play.Action})");

            // PAR CONTROLE NOVO, e ele so' e' possivel desde que a condenacao virou
            // MARCA: a MESMA Fusao em campo, sem a marca (veio da Polymerization e
            // vai FICAR), nao pode fazer o Templo sair. Banir ali seria tirar do
            // campo o corpo que estava segurando o turno.
            b = Cerebro(db, meuCampo: new List<uint> { RARE_FISH },
                        minhasAbertas: new List<uint> { TEMPLO });
            var semMarca = b.Decide(Idle(TEMPLO), 1);
            Check("par CONTROLE: a mesma Fusao SEM a marca (Polymerization) nao dispara o Templo",
                  semMarca.Action != "activate", $"(veio {semMarca.Action} — {semMarca.Why})");

            b = Cerebro(db, meuCampo: new List<uint> { JELLYFISH },
                        minhasAbertas: new List<uint> { TEMPLO });
            play = b.Decide(Idle(TEMPLO), 1);
            Check("Main Phase, ninguem em risco: NAO ativa o Templo",
                  play.Action != "activate", $"(veio {play.Action})");
        }

        // ------------------------------------------------------------------
        // 2. A IMUNIDADE QUE A UMI DÁ
        // ------------------------------------------------------------------
        //
        // LIMITE HONESTO DESTE BLOCO. A tabela `CONTAM_COMO_UMI` tem sete cartas,
        // mas hoje só uma delas é ALCANÇÁVEL por um teste: o próprio Templo. O
        // único consumidor de `UmiNoCampo()` é a imunidade a magia, e ela só é
        // consultada quando o Templo já está em campo — e um Templo em campo JÁ
        // é uma "Umi". Não dá para montar um caso em que a Umi venha de outra
        // carta e a decisão mude, porque a decisão exige a carta que sozinha já
        // satisfaz a condição.
        //
        // As outras seis entradas passam a valer no dia em que alguma decisão
        // depender de Umi sem o Templo — a candidata natural é preferir invocar
        // o Legendary Fisherman quando há Umi, já que ali ele é intocável. Está
        // escrito aqui para ninguém achar que a tabela está testada.
        static void QuemEhUmi(string sa)
        {
            var db = new DatabaseManager(sa);

            // CONTROLE: mesmo Templo, mesma magia, alvo SEM imunidade — bane.
            var b = Cerebro(db, meuCampo: new List<uint> { JELLYFISH },
                            campoDele: new List<uint> { BATTLE_OX },
                            minhasAbertas: new List<uint> { TEMPLO });
            Check("par controle: alvo sem imunidade — bane para escapar da magia",
                  b.DecideChain(Cadeia(TEMPLO, "activation", RAIGEKI, 0), 1) == 0);

            // O mesmo cenário trocando SÓ o monstro: agora ele é imune e o uso
            // do Templo fica guardado.
            b = Cerebro(db, meuCampo: new List<uint> { TORPEDO_FISH },
                        campoDele: new List<uint> { BATTLE_OX },
                        minhasAbertas: new List<uint> { TEMPLO });
            Check("mesmo cenario, alvo imune com Umi: guarda o uso",
                  b.DecideChain(Cadeia(TEMPLO, "activation", RAIGEKI, 0), 1) == -1);

            // E com DOIS elegíveis, um imune e um não, ele salva o que precisa
            // ser salvo em vez de desistir da jogada inteira.
            b = Cerebro(db, meuCampo: new List<uint> { TORPEDO_FISH, JELLYFISH },
                        campoDele: new List<uint> { BATTLE_OX },
                        minhasAbertas: new List<uint> { TEMPLO });
            Check("um imune e um exposto: nao desiste — bane o exposto",
                  b.DecideChain(Cadeia(TEMPLO, "activation", RAIGEKI, 0), 1) == 0);
        }

        // ------------------------------------------------------------------
        // 3. A IMUNIDADE É SÓ A MAGIA
        // ------------------------------------------------------------------
        static void Protecao(string sa)
        {
            var db = new DatabaseManager(sa);

            // Mesma Umi, mesmo monstro imune — mas a ameaça agora é ARMADILHA,
            // que a imunidade não cobre. Sem esta linha, "guardou o uso" acima
            // poderia ser o NPC simplesmente nunca banindo um Torpedo Fish.
            var b = Cerebro(db, meuCampo: new List<uint> { TORPEDO_FISH },
                            campoDele: new List<uint> { BATTLE_OX },
                            minhasAbertas: new List<uint> { TEMPLO });
            Check("mesma Umi, ameaca e' ARMADILHA: a imunidade nao cobre, BANE",
                  b.DecideChain(Cadeia(TEMPLO, "activation", TRAP_HOLE, 0), 1) == 0);
        }

        // ------------------------------------------------------------------
        // 4. ATIVAR A MAGIA DE CAMPO
        // ------------------------------------------------------------------
        //
        // A tabela `CAMPOS` conhecia UMA carta: a Mountain, do deck da Mai. O
        // deck do Mako roda 3 Umi mais 3 Terraforming para achá-la, e o NPC
        // nunca a ativava — a busca funcionava, a carta chegava a' mao e ficava
        // la' a partida inteira. Nenhum teste acusava, porque cada deck novo so'
        // provava as cartas que alguem lembrou de escrever.
        static void AtivarOCampo(string sa)
        {
            var db = new DatabaseManager(sa);

            InteractiveDuel.Question Mao(uint carta)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                q.activatable.Add(new InteractiveDuel.Act { code = carta, index = 0 });
                return q;
            }

            // Ganho por RAÇA: o Jellyfish é Aqua e a Umi lhe dá +200.
            var b = Cerebro(db, meuCampo: new List<uint> { JELLYFISH });
            Check("Umi com um Aqua meu em campo: ATIVA",
                  b.Decide(Mao(UMI), 1).Action == "activate");

            // O CASO QUE O ATK SOZINHO ERRA. O Legendary Fisherman e' WARRIOR:
            // a Umi nao lhe da' um ponto de ATK. Mas e' ela que o torna
            // intocavel — e' o momento em que a carta mais vale.
            b = Cerebro(db, meuCampo: new List<uint> { FISHERMAN });
            Check("Umi com so' o Fisherman (Warrior, ganha 0 de ATK): ATIVA pela PROTECAO",
                  b.Decide(Mao(UMI), 1).Action == "activate");

            // PAR CONTROLE: sem ninguem que ganhe nem que fique protegido, a
            // magia de campo e' global e ativar so' ajudaria o outro lado.
            b = Cerebro(db, meuCampo: new List<uint> { BATTLE_OX });
            Check("Umi com so' um Guerreiro sem protecao em campo: NAO ativa (par controle)",
                  b.Decide(Mao(UMI), 1).Action != "activate");

            // A Legendary Ocean reforça por ATRIBUTO (todo WATER), e por isso
            // alcança o Fisherman onde a Umi não alcança. Ler só a raça deixava
            // esta carta de fora em silêncio.
            b = Cerebro(db, meuCampo: new List<uint> { FISHERMAN });
            Check("A Legendary Ocean com o Fisherman (WATER): ATIVA pelo bonus de atributo",
                  b.Decide(Mao(OCEANO), 1).Action == "activate");

            b = Cerebro(db, meuCampo: new List<uint> { BATTLE_OX });
            Check("A Legendary Ocean sem nenhum WATER meu: NAO ativa (par controle)",
                  b.Decide(Mao(OCEANO), 1).Action != "activate");
        }
    }
}
