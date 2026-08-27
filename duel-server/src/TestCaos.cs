using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// O pacote **CAOS** do Yugi — `--test-caos`.
    ///
    /// O relato veio de um duelo real: *"o Yugi preferiu invocar um Lustro Negro
    /// em vez de usar Magician of Black Chaos + Chaos Scepter = combo pra banir
    /// meu ritual pra sempre; ele ia tirar 2 cards do meu campo, do jeito que fez
    /// tirou apenas 1"*.
    ///
    /// A **Chaos Scepter Blast** só liga com um **Mago (Spellcaster) de Nível 8
    /// ou mais** com a face para cima no campo dela, e aí bane 1 carta do campo
    /// **com a face para baixo** — remoção permanente, que não volta nem se
    /// identifica. O NPC tinha na mão a Espada, o **Magician of Black Chaos**
    /// (Nv8 MAGO) e o **Black Luster Soldier** (Nv8 GUERREIRO), mais os rituais
    /// dos dois. Pôs o Guerreiro, de 3000 de ATK.
    ///
    /// Não era critério errado: `AtivavelSe(q, EhRitual)` devolve o PRIMEIRO
    /// ritual ativável da lista. Não havia critério nenhum, então a escolha entre
    /// pôr 3000 de ATK e fechar um combo de duas remoções era a ordem em que o
    /// motor tivesse listado as cartas.
    ///
    /// A segunda metade veio do mesmo relato: *"ensina a máquina a baixar o Chaos
    /// Scepter caso não tenha uso, porque se ele é destruído traz um dos Chaos
    /// magician pro campo"*. É o próprio texto da carta, e a diferença está na
    /// ZONA — destruída na mão ela não faz nada; destruída na zona de magia, ela
    /// Invoca Especialmente do DECK.
    /// </summary>
    public static class TestCaos
    {
        const uint ESPADA = 15256925;        // Chaos Scepter Blast
        const uint MAGO_CAOS = 30208479;     // Magician of Black Chaos — Nv8 MAGO
        const uint LUSTRO = 5405694;         // Black Luster Soldier — Nv8 GUERREIRO
        const uint RITUAL_LUSTRO = 55761792; // Black Luster Ritual — NOMEIA o Lustro
        const uint RITUAL_MAGO = 76792184;   // Black Magic Ritual — NOMEIA o Mago
        const uint CHAOS_FORM = 21082832;    // Chaos Form — nao nomeia ninguem
        const uint POLY = 24094653;          // par controle: ritual nenhum
        const uint POT = 55144522;

        // O ALVO da Espada. Os codigos do duelo relatado.
        const uint REVIVIDO = 38999506;      // 2900/2450 — o corpo que o NPC reanimou
        const uint GAIA_NV7 = 6368038;       // 2300 — um monstro DELE em campo
        const uint DIM_PRISON = 70342110;    // uma armadilha, para a lista misturada
        const uint DARK_HOLE = 53129443;     // par controle: DESTROI os dois lados
        const uint RAIGEKI = 12580477;       // par controle: so' o lado DELE
        const uint MAGO_ILUSAO = 35191415;   // par controle: CORPO DE GRACA de verdade
        const uint DARK_MAGIC_VEIL = 82404868; // par controle: POE CORPO de verdade

        // O segundo relato: a magia de USO UNICO banida no meio da resolucao.
        const uint SUMMONERS_ART = 79816536;   // Magia NORMAL — busca 1 Normal Nv5+
        const uint TOON_WORLD = 15259703;      // par controle: Magia CONTINUA, FICA em campo

        const byte HAND = 0x2, MZONE = 0x4, SZONE = 0x8;

        static int _pass, _fail;

        static void Check(string oque, bool ok, string detalhe = "")
        {
            if (ok) { Log.Info($"  OK    {oque}"); _pass++; }
            else { Log.Err($"  FALHA {oque} {detalhe}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== o que o Lua diz das cartas ===\n");
            ALeitura(sa);

            Log.Info("\n=== a escolha do ritual (a jogada relatada) ===\n");
            AEscolha(sa);

            Log.Info("\n=== baixar a Espada quando ela nao tem uso ===\n");
            OGuardaChuva(sa);

            Log.Info("\n=== a Espada NAO pode virar contra o proprio NPC ===\n");
            OTiroNoPe(sa);

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------ leitura

        static void ALeitura(string sa)
        {
            using var db = new DatabaseManager(sa);

            var exige = db.ExigeCorpo(ESPADA);
            Check("a Espada exige um corpo de raça e nível", exige.raca != 0,
                  "(sem isto o cerebro nao sabe que ela esta' parada por FALTA DE CORPO)");
            Check("...e o corpo e' um MAGO", (exige.raca & db.Stats(MAGO_CAOS).Race) != 0,
                  $"(raca exigida 0x{exige.raca:x}, o Mago e' 0x{db.Stats(MAGO_CAOS).Race:x})");
            Check("...de nivel 8 ou mais", exige.nivel == 8, $"(veio {exige.nivel})");

            // O PAR CONTROLE que e' o coracao da jogada: o Lustro Negro tem o
            // mesmo nivel e MAIS ATK, e nao serve — ele e' Guerreiro.
            Check("par CONTROLE: o Lustro Negro (Nv8, 3000 ATK) NAO serve — e' Guerreiro",
                  (exige.raca & db.Stats(LUSTRO).Race) == 0,
                  "(era exatamente a troca que o NPC fez)");

            Check("par CONTROLE: o Pote da Ganancia nao exige corpo nenhum",
                  db.ExigeCorpo(POT).raca == 0);

            // Quem cada ritual NOMEIA — e o que fazer com o que nao nomeia ninguem.
            Check("Black Luster Ritual nomeia o Lustro", db.RitualInvoca(RITUAL_LUSTRO).Contains(LUSTRO));
            Check("Black Magic Ritual nomeia o Mago", db.RitualInvoca(RITUAL_MAGO).Contains(MAGO_CAOS));
            Check("Chaos Form nao nomeia ninguem (filtra por arquetipo)",
                  db.RitualInvoca(CHAOS_FORM).Count == 0,
                  "(fingir uma lista aqui faria o cerebro escolher errado com confianca)");
            Check("par CONTROLE: a Polymerization nao e' ritual e nao nomeia nada",
                  db.RitualInvoca(POLY).Count == 0);

            Check("a Espada se SALVA se destruida na zona de magia", db.SalvaSeDestruida(ESPADA));
            Check("par CONTROLE: o Pote nao", !db.SalvaSeDestruida(POT));
        }

        // ------------------------------------------------------------ tiro no pe

        /// <summary>
        /// O relato: *"npc brain usou o Chaos Scepter Blast no proprio monstro
        /// (esse monstro ele tomou controle meu — pegou do meu GY) e era de atk
        /// maior no campo (2900)"*.
        ///
        /// O log do duelo mostra o caminho inteiro:
        ///
        ///     [npc] activate -> Monster Reborn: revive o mais forte do cemiterio
        ///     [npc] posicao de 38999506 (2900/2450): ataque (ATK > DEF)
        ///     [npc] attack -> campo do oponente vazio — ataque direto
        ///     [npc] chain -> ativa 15256925 em resposta (idx 0)      &lt;-- sem criterio
        ///
        /// Sao DUAS metades, e cada uma sozinha ja' bastaria para o estrago:
        ///
        ///   A HORA — a Espada nunca teve regra de Main Phase. `DestroiMonstro` e
        ///       `DestroiSt` exigem `Duel.Destroy` no script, e ela usa
        ///       `Duel.Remove`; entao a UNICA coisa que chegava a ativa-la era a
        ///       regra generica da janela de corrente ("ativa em resposta"), que
        ///       nao pergunta nada. Como o efeito e' `EVENT_FREE_CHAIN`, a janela
        ///       abre sempre — inclusive com o campo dele vazio, que e' quando a
        ///       unica coisa que ela alcanca e' o proprio NPC.
        ///
        ///   O ALVO — a lista dela mistura MONSTRO e MAGIA/ARMADILHA dos DOIS
        ///       lados, e nenhum ramo do `DecideSelect` a reconhecia: o "alvo em
        ///       campo" so' olha `MZONE` e so' dispara quando o oponente tem
        ///       MONSTRO. Sem monstro dele, tudo caia no criterio generico —
        ///       maior ATK, sem perguntar de quem e' a carta.
        ///
        /// E' a mesma familia do Inseto Devorador de Homens do `--test-alvos`,
        /// por um buraco que aquela correcao nao fechou.
        /// </summary>
        static void OTiroNoPe(string sa)
        {
            using var db = new DatabaseManager(sa);

            // ---- o reconhecimento ----
            Check("a Espada BANE uma carta do campo", db.BaneDoCampo(ESPADA));
            Check("...e alcanca os DOIS lados", db.TiraDoCampoDosDoisLados(ESPADA),
                  "(e' por isso que ela pode virar contra quem a ativou)");

            // Par controle do alcance: o Raigeki tambem tira do campo, mas so' do
            // lado DELE — uma carta assim nunca corre este risco.
            Check("par CONTROLE: o Raigeki nao alcanca o meu lado",
                  !db.TiraDoCampoDosDoisLados(RAIGEKI),
                  "(o alcance e' um PAR, e ler so' metade dele e' como o alvo errado aparece)");

            // Par controle do BANIR: o Dark Hole alcanca os dois lados, mas
            // DESTROI — e destruicao ja' tem regra propria (`DestroiMonstro`).
            Check("par CONTROLE: o Dark Hole alcanca os dois lados...",
                  db.TiraDoCampoDosDoisLados(DARK_HOLE));
            Check("...mas NAO e' banimento — ele ja' tem regra propria",
                  !db.BaneDoCampo(DARK_HOLE));
            Check("par CONTROLE: o Pote da Ganancia nao tira nada do campo",
                  !db.TiraDoCampoDosDoisLados(POT) && !db.BaneDoCampo(POT));

            // ---- a decisao ----
            var meuCampo = new List<uint>();
            var campoDele = new List<uint>();
            var abertasDele = new List<uint>();   // magias/armadilhas dele com a face para CIMA
            int viradasDele = 0;                  // e as com a face para baixo

            var brain = new NpcBrain(db,
                fieldOf: p => p == 1 ? meuCampo : campoDele,
                log: _ => { },
                handOf: _ => new List<uint>(),
                stCountOf: p => p == 1 ? 0 : abertasDele.Count + viradasDele,
                setStCountOf: p => p == 1 ? 0 : viradasDele,
                faceUpStOf: p => p == 1 ? new List<uint>() : abertasDele,
                todoFieldPosOf: p => p == 1
                    ? meuCampo.Select((c, i) => (code: c, pos: 0x1, seq: i)).ToList()
                    : campoDele.Select((c, i) => (code: c, pos: 0x1, seq: i)).ToList());

            InteractiveDuel.Question Corrente()
            {
                var q = new InteractiveDuel.Question { kind = "chain", player = 1 };
                q.choices.Add(new InteractiveDuel.Sel { code = ESPADA, index = 0, location = SZONE });
                return q;
            }

            InteractiveDuel.Question NoCampo(uint code, byte onde = SZONE)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                q.activatable.Add(new InteractiveDuel.Act { code = code, index = 0, location = onde });
                return q;
            }

            void Zerar()
            {
                meuCampo.Clear(); campoDele.Clear(); abertasDele.Clear();
                viradasDele = 0; brain.ResetCadeia();
            }

            // A JANELA DE CORRENTE com o campo dele vazio: era aqui que ela saia.
            Zerar(); meuCampo.Add(REVIVIDO);
            Check("na corrente com o campo dele VAZIO, GUARDA a Espada",
                  brain.DecideChain(Corrente(), 1) < 0,
                  "(a unica coisa que ela alcancaria e' o proprio monstro do NPC)");

            // PAR CONTROLE: havendo carta do outro lado, ela continua saindo. Sem
            // esta linha, "guardou" ficaria de pe' com uma regra que nunca ativa.
            Zerar(); meuCampo.Add(REVIVIDO); campoDele.Add(GAIA_NV7);
            Check("par CONTROLE: com monstro DELE em campo, a Espada sai na corrente",
                  brain.DecideChain(Corrente(), 1) >= 0);

            // Uma carta VIRADA dele ja' basta — ela e' incognita, mas FICA, e
            // tira-la antes de atacar e' jogada classica.
            Zerar(); meuCampo.Add(REVIVIDO); viradasDele = 1;
            Check("uma magia/armadilha VIRADA dele tambem serve",
                  brain.DecideChain(Corrente(), 1) >= 0);

            // ---- o SEGUNDO relato: a magia de USO UNICO ----
            //
            // *"Ele usou num card de adicao meu, que naturalmente so' tem 1 uso, a
            // Summoner Art, entao foi gastar uma potencial defesa contra uma
            // ameaca na minha primeira movimentacao"*.
            //
            // O log mostra a jogada inteira:
            //     [rpc] /respond activate arg=1        <- o jogador ativa a busca
            //     [npc] chain -> ativa 15256925 em resposta
            //     [npc] remocao de campo: bane 79816536 do lado DELE
            //
            // Uma Magia NORMAL com a face para CIMA na zona so' esta' ali porque
            // esta' RESOLVENDO neste instante: banir nao impede o efeito (o motor
            // ja' a ativou) e ela ia para o cemiterio sozinha. O NPC pagou a
            // carta principal de remocao do deck para nao conseguir nada — e
            // ficou sem ela para a ameaca de verdade.
            //
            // A pergunta antiga era "ele tem ALGUMA carta?"; a de agora e' "ele
            // tem alguma que VALHA a remocao?", e a diferenca entre as duas e'
            // PERMANENCIA.
            Zerar(); meuCampo.Add(REVIVIDO); abertasDele.Add(SUMMONERS_ART);
            Check("com so' a magia de USO UNICO dele resolvendo, GUARDA a Espada",
                  brain.DecideChain(Corrente(), 1) < 0,
                  "(banir uma Normal aberta nao impede nada e queima a remocao)");

            // PAR CONTROLE: a mesma zona, com uma magia que FICA. Sem esta linha,
            // "guardou" ficaria de pe' com uma regra que nunca ativa contra S/T.
            Zerar(); meuCampo.Add(REVIVIDO); abertasDele.Add(TOON_WORLD);
            Check("par CONTROLE: contra uma magia CONTINUA dele, a Espada sai",
                  brain.DecideChain(Corrente(), 1) >= 0,
                  "(essa fica em campo, e tirar ela leva junto o que ela sustenta)");

            // E o reconhecimento por tras dos dois.
            Check("a Summoner's Art NAO fica em campo (Magia Normal)",
                  !db.FicaEmCampo(SUMMONERS_ART));
            Check("par CONTROLE: o Toon World fica (Magia Continua)",
                  db.FicaEmCampo(TOON_WORLD));
            Check("par CONTROLE: monstro nao e' magia/armadilha", !db.FicaEmCampo(REVIVIDO));

            // O ALVO, quando a Espada sai por outro motivo: entre uma magia dele
            // que FICA e a de uso unico que esta' resolvendo, nunca a segunda.
            Zerar(); meuCampo.Add(REVIVIDO); abertasDele.Add(TOON_WORLD);
            brain.DecideChain(Corrente(), 1);
            var qSt = new InteractiveDuel.Question
            { kind = "selectcard", player = 1, selMin = 1, selMax = 1 };
            qSt.choices.Add(new InteractiveDuel.Sel
            { code = SUMMONERS_ART, index = 0, controller = 0, location = SZONE, sequence = 0 });
            qSt.choices.Add(new InteractiveDuel.Sel
            { code = TOON_WORLD, index = 1, controller = 0, location = SZONE, sequence = 1 });
            var picksSt = brain.DecideSelect(qSt, 1);
            uint alvoSt = picksSt != null && picksSt.Count > 0 ? qSt.choices[picksSt[0]].code : 0;
            Check("entre as magias dele, nunca a de uso unico que esta' resolvendo",
                  alvoSt == TOON_WORLD, $"(veio {alvoSt})");

            // ---- a TERCEIRA porta, e a que o teste achou ----
            //
            // O banco marca a Espada como INVOCACAO ESPECIAL (0x100000) por causa
            // do efeito de ser DESTRUIDA, e a regra do "corpo de graca" lia isso
            // como "esta carta poe corpo em campo". Ativar nao poe corpo nenhum:
            // bane 1 carta. E' a MESMA armadilha do Templo do Mako, que era
            // resolvida por uma lista de ids — aqui ela e' lida da carta
            // (`SalvaSeDestruida`).
            //
            // Com os dois campos empatados a condicao do corpo de graca
            // (`QtdMonstros(me) <= QtdMonstros(foe)`) e' verdadeira, entao esta e'
            // a mesa em que aquela regra a pegava.
            Zerar(); meuCampo.Add(REVIVIDO); campoDele.Add(GAIA_NV7);
            brain.DecideChain(Corrente(), 1);
            Check("a Espada NAO e' 'corpo de graca' — o corpo dela vem de ser DESTRUIDA",
                  !(brain.PorqueDaCadeia ?? "").Contains("corpo em campo de graca"),
                  $"(veio: {brain.PorqueDaCadeia})");

            // PAR CONTROLE: a regra do corpo de graca continua de pe' para quem
            // REALMENTE poe corpo ao ser ativado. Sem esta linha, uma trava que
            // desligasse a regra inteira passaria igual.
            Zerar(); campoDele.Add(GAIA_NV7);
            var qMago = new InteractiveDuel.Question { kind = "chain", player = 1 };
            qMago.choices.Add(new InteractiveDuel.Sel { code = MAGO_ILUSAO, index = 0, location = HAND });
            brain.DecideChain(qMago, 1);
            Check("par CONTROLE: o Magician of Dark Illusion continua sendo corpo de graca",
                  (brain.PorqueDaCadeia ?? "").Contains("corpo em campo de graca"),
                  $"(veio: {brain.PorqueDaCadeia})");

            // O MAIN PHASE, que ate' agora nao tinha regra nenhuma para ela.
            Zerar(); meuCampo.Add(REVIVIDO); campoDele.Add(GAIA_NV7);
            var m1 = brain.Decide(NoCampo(ESPADA), 1);
            Check("no Main Phase ela ganhou regra: com campo dele, ATIVA",
                  m1.Action == "activate" && (m1.Why ?? "").Contains(ESPADA.ToString()),
                  $"(veio {m1.Action} — {m1.Why})");

            Zerar(); meuCampo.Add(REVIVIDO);
            var m2 = brain.Decide(NoCampo(ESPADA), 1);
            Check("par CONTROLE: campo dele vazio, GUARDA",
                  !((m2.Action == "activate") && (m2.Why ?? "").Contains(ESPADA.ToString())),
                  $"(veio {m2.Action} — {m2.Why})");

            // ---- a QUARTA porta, achada pelo `--cobertura` ----
            //
            // A regra 5.375 ("qualquer carta que ponha corpo em campo") le' o
            // MESMO bit do banco e tambem pegava a Espada — e ela vem ANTES da
            // 5.505, entao vencia. Com o meu campo vazio ela dizia
            // "poe corpo em campo — estou sem monstro", que e' o contrario do que
            // ativar a Espada faz: ativar TIRA uma carta do campo.
            Zerar(); campoDele.Add(GAIA_NV7);
            var m3 = brain.Decide(NoCampo(ESPADA), 1);
            Check("com o MEU campo vazio, ela nao e' confundida com 'poe corpo em campo'",
                  !(m3.Why ?? "").Contains("poe corpo em campo"),
                  $"(veio {m3.Action} — {m3.Why})");
            Check("...e sai pela regra do BANIMENTO",
                  m3.Action == "activate" && (m3.Why ?? "").Contains("bane"),
                  $"(veio {m3.Action} — {m3.Why})");

            // PAR CONTROLE: a regra 5.375 continua de pe' para quem POE CORPO de
            // verdade ao ser ativado. Sem esta linha, uma trava que desligasse a
            // regra inteira passaria igual.
            Zerar(); campoDele.Add(GAIA_NV7);
            var m4 = brain.Decide(NoCampo(DARK_MAGIC_VEIL), 1);
            Check("par CONTROLE: o Dark Magic Veil continua pondo corpo em campo",
                  (m4.Why ?? "").Contains("poe corpo em campo"),
                  $"(veio {m4.Action} — {m4.Why})");

            // ---- o ALVO ----
            //
            // A lista que o motor manda: o MEU monstro de 2900 (o maior ATK da
            // mesa) mais uma armadilha DELE. E' a forma exata do duelo relatado.
            InteractiveDuel.Question Alvos()
            {
                var q = new InteractiveDuel.Question
                { kind = "selectcard", player = 1, selMin = 1, selMax = 1 };
                q.choices.Add(new InteractiveDuel.Sel
                { code = REVIVIDO, index = 0, controller = 1, location = MZONE, sequence = 0 });
                q.choices.Add(new InteractiveDuel.Sel
                { code = DIM_PRISON, index = 1, controller = 0, location = SZONE, sequence = 0 });
                return q;
            }

            uint Escolhido(InteractiveDuel.Question q, List<int> picks) =>
                picks != null && picks.Count > 0 ? q.choices[picks[0]].code : 0;

            // PAR CONTROLE primeiro, e ele e' o bug relatado: sem a marca, o
            // criterio generico ordena por ATK sem perguntar de quem e' a carta.
            Zerar(); meuCampo.Add(REVIVIDO); viradasDele = 1;
            var qc = Alvos();
            uint semMarca = Escolhido(qc, brain.DecideSelect(qc, 1));
            Check("par CONTROLE: sem a marca, o generico bane o MEU 2900",
                  semMarca == REVIVIDO,
                  $"(veio {semMarca} — se nao for o meu, a armadilha mudou de lugar)");

            // Com a marca (que a regra 5.505 e a janela de corrente agora poem),
            // a remocao mira o lado DELE.
            Zerar(); meuCampo.Add(REVIVIDO); campoDele.Add(GAIA_NV7); viradasDele = 1;
            brain.DecideChain(Corrente(), 1);
            var qm = Alvos();
            uint comMarca = Escolhido(qm, brain.DecideSelect(qm, 1));
            Check("com a marca, bane a carta DELE",
                  comMarca == DIM_PRISON, $"(veio {comMarca})");

            // E o monstro dele vem antes da magia/armadilha dele.
            Zerar(); meuCampo.Add(REVIVIDO); campoDele.Add(GAIA_NV7);
            brain.DecideChain(Corrente(), 1);
            var qd = new InteractiveDuel.Question
            { kind = "selectcard", player = 1, selMin = 1, selMax = 1 };
            qd.choices.Add(new InteractiveDuel.Sel
            { code = REVIVIDO, index = 0, controller = 1, location = MZONE, sequence = 0 });
            qd.choices.Add(new InteractiveDuel.Sel
            { code = DIM_PRISON, index = 1, controller = 0, location = SZONE, sequence = 0 });
            qd.choices.Add(new InteractiveDuel.Sel
            { code = GAIA_NV7, index = 2, controller = 0, location = MZONE, sequence = 0 });
            uint alvoMonstro = Escolhido(qd, brain.DecideSelect(qd, 1));
            Check("entre as cartas dele, o MONSTRO vem antes da armadilha",
                  alvoMonstro == GAIA_NV7, $"(veio {alvoMonstro})");
        }

        // ------------------------------------------------------------ escolha

        static void AEscolha(string sa)
        {
            using var db = new DatabaseManager(sa);
            var minhaMao = new List<uint>();
            var meuCampo = new List<uint>();

            var brain = new NpcBrain(db,
                fieldOf: p => p == 1 ? meuCampo : new List<uint>(),
                log: _ => { },
                handOf: p => p == 1 ? minhaMao : new List<uint>(),
                todoFieldPosOf: p => p == 1
                    ? meuCampo.Select((c, i) => (code: c, pos: 0x1, seq: i)).ToList()
                    : new List<(uint, int, int)>());

            InteractiveDuel.Question Idle(params uint[] ativaveis)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                int i = 0;
                foreach (var c in ativaveis)
                    q.activatable.Add(new InteractiveDuel.Act { code = c, index = i++, location = 0x2 });
                return q;
            }

            // A MÃO DO DUELO RELATADO: a Espada parada, os dois corpos Nv8 e os
            // dois rituais. Antes, `AtivavelSe` levava o primeiro da lista — e a
            // lista comeca pelo ritual do Lustro.
            minhaMao.Clear(); meuCampo.Clear();
            minhaMao.AddRange(new[] { ESPADA, MAGO_CAOS, LUSTRO, RITUAL_LUSTRO, CHAOS_FORM });
            var p1 = brain.Decide(Idle(RITUAL_LUSTRO, CHAOS_FORM), 1);
            Check("escolhe o ritual que traz o MAGO, e nao o que traz o Lustro",
                  p1.Action == "activate" && p1.Index == 1,
                  $"(veio {p1.Action} idx {p1.Index} — {p1.Why})");
            Check("e diz por que (a carta parada na mao)",
                  (p1.Why ?? "").Contains(ESPADA.ToString()), $"(motivo: {p1.Why})");

            // ...e a ESCOLHA do monstro tem de cumprir a decisao. Sem isto o
            // criterio generico (maior ATK) traria o Guerreiro de volta, desfazendo
            // tudo na pergunta seguinte.
            var sel = new InteractiveDuel.Question { kind = "selectcard", player = 1, selMin = 1, selMax = 1 };
            sel.choices.Add(new InteractiveDuel.Sel { code = LUSTRO, index = 0, location = 0x2, controller = 1 });
            sel.choices.Add(new InteractiveDuel.Sel { code = MAGO_CAOS, index = 1, location = 0x2, controller = 1 });
            var escolha = brain.DecideSelect(sel, 1);
            Check("e invoca o MAGO, mesmo o Lustro tendo 200 de ATK a mais",
                  escolha.Count == 1 && escolha[0] == 1,
                  $"(escolheu {(escolha.Count > 0 ? sel.choices[escolha[0]].code.ToString() : "nenhum")})");

            // PAR CONTROLE 1: sem a Espada na mao nao ha' combo a fechar, e a regra
            // nao pode se meter — o ritual volta a ser o primeiro ativavel.
            minhaMao.Clear(); meuCampo.Clear();
            minhaMao.AddRange(new[] { MAGO_CAOS, LUSTRO, RITUAL_LUSTRO, CHAOS_FORM });
            var p2 = brain.Decide(Idle(RITUAL_LUSTRO, CHAOS_FORM), 1);
            Check("par CONTROLE: sem a Espada na mao, nao ha' preferencia",
                  p2.Action == "activate" && p2.Index == 0,
                  $"(veio idx {p2.Index} — {p2.Why})");

            // PAR CONTROLE 2: o corpo JA' esta' em campo. A Espada nao esta' parada
            // por falta dele, e gastar um ritual para repetir o que ja' existe
            // seria trocar uma carta por nada.
            minhaMao.Clear(); minhaMao.AddRange(new[] { ESPADA, MAGO_CAOS, LUSTRO, RITUAL_LUSTRO, CHAOS_FORM });
            meuCampo.Clear(); meuCampo.Add(MAGO_CAOS);
            var p3 = brain.Decide(Idle(RITUAL_LUSTRO, CHAOS_FORM), 1);
            Check("par CONTROLE: com o Mago JA' em campo, nao ha' preferencia",
                  p3.Action == "activate" && p3.Index == 0,
                  $"(veio idx {p3.Index} — {p3.Why})");

            // PAR CONTROLE 3: so' o ritual do Lustro disponivel. Ele NOMEIA o
            // Guerreiro, entao nao acorda nada — mas continua sendo jogada, e a
            // regra nao pode travar o turno recusando-a.
            minhaMao.Clear(); meuCampo.Clear();
            minhaMao.AddRange(new[] { ESPADA, MAGO_CAOS, LUSTRO, RITUAL_LUSTRO });
            var p4 = brain.Decide(Idle(RITUAL_LUSTRO), 1);
            Check("par CONTROLE: com so' o ritual do Lustro, ele sai assim mesmo",
                  p4.Action == "activate", $"(veio {p4.Action} — {p4.Why})");
        }

        // ------------------------------------------------------- guarda-chuva

        static void OGuardaChuva(string sa)
        {
            using var db = new DatabaseManager(sa);
            var minhaMao = new List<uint>();
            var meuCampo = new List<uint>();
            int stEmCampo = 0;

            var brain = new NpcBrain(db,
                fieldOf: p => p == 1 ? meuCampo : new List<uint>(),
                log: _ => { },
                handOf: p => p == 1 ? minhaMao : new List<uint>(),
                stCountOf: _ => stEmCampo);

            InteractiveDuel.Question Idle(uint[] ativaveis, uint[] setaveis)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                int i = 0;
                foreach (var c in ativaveis)
                    q.activatable.Add(new InteractiveDuel.Act { code = c, index = i++, location = 0x2 });
                i = 0;
                foreach (var c in setaveis)
                    q.settableST.Add(new InteractiveDuel.Act { code = c, index = i++, location = 0x2 });
                return q;
            }

            bool Baixou(NpcBrain.Play p) =>
                p.Action == "setspell" && (p.Why ?? "").Contains(ESPADA.ToString());

            // Sem corpo em campo, a Espada nao esta' ativavel — e parada na mao ela
            // nao faz nada. Baixada, ela vira a armadilha que o texto dela promete.
            minhaMao.Clear(); minhaMao.Add(ESPADA);
            meuCampo.Clear(); stEmCampo = 0;
            var p1 = brain.Decide(Idle(Array.Empty<uint>(), new[] { ESPADA }), 1);
            Check("sem uso agora: BAIXA a Espada", Baixou(p1), $"(veio {p1.Action} — {p1.Why})");

            // PAR CONTROLE: com o corpo em campo ela ESTA' ativavel, e ativar (banir
            // 1 carta do campo dele, para sempre) vale mais que a espera.
            minhaMao.Clear(); minhaMao.Add(ESPADA);
            meuCampo.Clear(); meuCampo.Add(MAGO_CAOS); stEmCampo = 0;
            var p2 = brain.Decide(Idle(new[] { ESPADA }, new[] { ESPADA }), 1);
            Check("par CONTROLE: podendo ativar, NAO baixa", !Baixou(p2),
                  $"(veio {p2.Action} — {p2.Why})");

            // PAR CONTROLE: com as zonas cheias, baixar travaria o proprio jogo —
            // a mesma folga que a regra da armadilha respeita.
            minhaMao.Clear(); minhaMao.Add(ESPADA);
            meuCampo.Clear(); stEmCampo = 4;
            var p3 = brain.Decide(Idle(Array.Empty<uint>(), new[] { ESPADA }), 1);
            Check("par CONTROLE: com as zonas cheias, nao baixa", !Baixou(p3),
                  $"(veio {p3.Action} — {p3.Why})");

            // PAR CONTROLE: o Pote da Ganancia nao se salva se destruido — baixa-lo
            // seria so' adiar a compra.
            minhaMao.Clear(); minhaMao.Add(POT);
            meuCampo.Clear(); stEmCampo = 0;
            var p4 = brain.Decide(Idle(Array.Empty<uint>(), new[] { POT }), 1);
            Check("par CONTROLE: o Pote nao e' baixado por esta regra",
                  p4.Action != "setspell" || !(p4.Why ?? "").Contains("se ele a destruir"),
                  $"(veio {p4.Action} — {p4.Why})");
        }
    }
}
