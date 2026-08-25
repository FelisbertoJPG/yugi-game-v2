using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// **Com o que o NPC PAGA** — `--test-custo`.
    ///
    /// O relato: *"o oponente está tirando o único monstro que controla pra
    /// comprar 1 card, ficando com o campo aberto"*. A carta é a **Dark Factory
    /// of More Production**, cujo custo é "mande 1 monstro da MÃO **ou do CAMPO**
    /// ao cemitério; compre 1".
    ///
    /// Eram três defeitos no mesmo lugar, e nenhum dava erro:
    ///
    ///   1. **a escolha.** O motor manda as duas origens na MESMA lista, e o
    ///      critério geral do `DecideSelect` olhava só o `location` da PRIMEIRA
    ///      opção. Vindo um monstro do campo na frente, ele ordenava por MAIOR
    ///      ATK e pagava com o melhor corpo da mesa — que num campo de um monstro
    ///      só é o único;
    ///   2. **a decisão do Main Phase.** O perfil dizia "compra com descarte", e
    ///      isso é meia verdade: sem monstro na mão o preço sai do CAMPO. Sem essa
    ///      distinção, comprar 1 carta custava o corpo que segurava o turno;
    ///   3. **a corrente.** A carta é quick e `EVENT_FREE_CHAIN`: aparece em TODA
    ///      janela, e a regra genérica do `DecideChain` a ativava em todas. No log
    ///      do duelo relatado, três vezes na mesma partida.
    ///
    /// A regra 1 é de FORMA, não de carta — uma lista que só tem coisa minha e
    /// mistura mão com campo é um custo, e custo se paga com o que ainda não está
    /// em jogo. Por isso vale para as 142 cartas do banco com esse mesmo custo, e
    /// não só para esta.
    /// </summary>
    public static class TestCusto
    {
        const uint DARK_FACTORY = 9064354;     // custo: 1 monstro da MAO OU DO CAMPO
        const uint GRACEFUL = 79571449;        // par controle: descarte que so' vem da MAO
        const uint POT = 55144522;             // compra LIMPA, sem custo nenhum

        const uint PETIT_MOTH = 58192742;      // Nv1 300/200   — o corpo barato
        const uint METAL_GUARDIAN = 68339286;  // Nv5 1150/2150 — a parede
        const uint GAIA_NV7 = 6368038;         // Nv7 2300/2100 — o gordo da mao
        const uint BATTLE_OX = 5053103;
        const uint PREMATURE = 70828912;       // reanimacao

        const byte HAND = 0x2, MZONE = 0x4, SZONE = 0x8;

        static int _pass, _fail;

        static void Check(string oque, bool ok, string detalhe = "")
        {
            if (ok) { Log.Info($"  OK    {oque}"); _pass++; }
            else { Log.Err($"  FALHA {oque} {detalhe}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== o que o banco e o Lua dizem do custo ===\n");
            OReconhecimento(sa);

            Log.Info("\n=== com o que ele PAGA (a escolha) ===\n");
            AEscolha(sa);

            Log.Info("\n=== se vale ATIVAR (Main Phase) ===\n");
            ADecisao(sa);

            Log.Info("\n=== e na janela de corrente ===\n");
            NaCorrente(sa);

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------- reconhecimento

        static void OReconhecimento(string sa)
        {
            using var db = new DatabaseManager(sa);

            Check("Dark Factory COMPRA", db.Perfil(DARK_FACTORY).Compra);
            Check("...e cobra uma carta", db.Perfil(DARK_FACTORY).Descarta);
            Check("...e o custo pode vir do CAMPO (a metade que faltava)",
                  db.Perfil(DARK_FACTORY).CustoPodeVirDoCampo,
                  "(sem isto o cerebro trata o preco como se fosse so' da mao)");

            // O par controle e' o que separa "custo do campo" de "descarte
            // qualquer": a Graceful Charity cobra duas cartas da MAO e nunca
            // encosta no campo, entao a trava nova nao pode alcanca-la.
            Check("par CONTROLE: Graceful Charity cobra, mas so' da MAO",
                  db.Perfil(GRACEFUL).Descarta && !db.Perfil(GRACEFUL).CustoPodeVirDoCampo,
                  "(a trava do campo bloquearia uma carta que nunca custa campo)");
            Check("par CONTROLE: o Pote da Ganancia nao cobra nada",
                  !db.Perfil(POT).Descarta && !db.Perfil(POT).CustoPodeVirDoCampo);
        }

        // ------------------------------------------------------------- escolha

        /// <summary>
        /// O `DecideSelect` com a lista que o motor manda de verdade: monstros da
        /// MÃO e do CAMPO juntos, todos meus.
        /// </summary>
        static void AEscolha(string sa)
        {
            using var db = new DatabaseManager(sa);
            var brain = new NpcBrain(db, fieldOf: _ => new List<uint>(), log: _ => { });

            InteractiveDuel.Question Custo(params (uint code, byte loc)[] opcoes)
            {
                var q = new InteractiveDuel.Question { kind = "selectcard", player = 1, selMin = 1, selMax = 1 };
                int i = 0;
                foreach (var (code, loc) in opcoes)
                    q.choices.Add(new InteractiveDuel.Sel
                    {
                        code = code, index = i, location = loc, controller = 1, sequence = i++,
                    });
                return q;
            }

            // O CASO RELATADO, com a ordem que o produzia: o corpo do campo vem
            // PRIMEIRO na lista, entao o criterio antigo lia `location` dele e
            // ordenava por maior ATK.
            var q1 = Custo((METAL_GUARDIAN, MZONE), (PETIT_MOTH, HAND));
            var p1 = brain.DecideSelect(q1, 1);
            Check("paga com a carta da MAO, nao com o corpo do campo",
                  p1.Count == 1 && q1.choices[p1[0]].location == HAND,
                  $"(escolheu {q1.choices[p1[0]].code} em loc 0x{q1.choices[p1[0]].location:x})");

            // A ordem inversa nao pode mudar a resposta — se mudasse, a regra
            // estaria lendo a lista e nao a situacao.
            var q2 = Custo((PETIT_MOTH, HAND), (METAL_GUARDIAN, MZONE));
            var p2 = brain.DecideSelect(q2, 1);
            Check("e a ordem da lista nao muda a resposta",
                  p2.Count == 1 && q2.choices[p2[0]].location == HAND,
                  $"(escolheu {q2.choices[p2[0]].code} em loc 0x{q2.choices[p2[0]].location:x})");

            // Dentro da MAO, o maior monstro — o mesmo criterio do descarte de
            // sempre. Num deck com reanimacao (o do Panik tem tres Premature
            // Burial), mandar o grandao para o cemiterio e' meio caminho andado.
            var q3 = Custo((PETIT_MOTH, HAND), (GAIA_NV7, HAND), (METAL_GUARDIAN, MZONE));
            var p3 = brain.DecideSelect(q3, 1);
            Check("entre duas da mao, manda o MAIOR monstro (para reanimar depois)",
                  p3.Count == 1 && q3.choices[p3[0]].code == GAIA_NV7,
                  $"(escolheu {q3.choices[p3[0]].code})");

            // PAR CONTROLE: sem nada na mao, o custo TEM de sair do campo —
            // recusar aqui deixaria o motor esperando uma resposta que nao vem, e
            // o duelo travaria sem erro nenhum.
            var q4 = Custo((METAL_GUARDIAN, MZONE), (PETIT_MOTH, MZONE));
            var p4 = brain.DecideSelect(q4, 1);
            Check("par CONTROLE: so' com o campo na lista, ele responde assim mesmo",
                  p4.Count == 1,
                  "(nao responder trava o duelo — o motor repete a pergunta para sempre)");
        }

        // ------------------------------------------------------------- decisao

        static void ADecisao(string sa)
        {
            using var db = new DatabaseManager(sa);
            var meuCampo = new List<uint>();
            var minhaMao = new List<uint>();

            var minhasViradas = new List<uint>();   // monstros SETADOS (face para baixo)

            var brain = new NpcBrain(db,
                fieldOf: p => p == 1 ? meuCampo : new List<uint>(),
                log: _ => { },
                handOf: p => p == 1 ? minhaMao : new List<uint>(),
                todoFieldPosOf: p => p == 1
                    ? meuCampo.Select((c, i) => (c, 0x1, i))
                        .Concat(minhasViradas.Select((c, i) => (c, 0x8, meuCampo.Count + i))).ToList()
                    : new List<(uint, int, int)>());

            InteractiveDuel.Question Idle(uint code, byte onde = SZONE)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                q.activatable.Add(new InteractiveDuel.Act { code = code, index = 0, location = onde });
                return q;
            }

            bool Ativou(NpcBrain.Play p, uint code) =>
                p.Action == "activate" && (p.Why ?? "").Contains(code.ToString());

            // O CASO RELATADO: um corpo em campo, nenhum monstro na mao. Ativar
            // aqui significa pagar com o corpo — e ficar com o campo aberto.
            meuCampo.Clear(); meuCampo.Add(METAL_GUARDIAN);
            minhaMao.Clear(); minhaMao.Add(DARK_FACTORY);
            var p1 = brain.Decide(Idle(DARK_FACTORY), 1);
            Check("com corpo em campo e nenhum monstro na mao: GUARDA a carta",
                  !Ativou(p1, DARK_FACTORY), $"(veio {p1.Action} — {p1.Why})");

            // PAR CONTROLE 1: com monstro na MAO o custo nao encosta no campo.
            meuCampo.Clear(); meuCampo.Add(METAL_GUARDIAN);
            minhaMao.Clear(); minhaMao.Add(DARK_FACTORY); minhaMao.Add(GAIA_NV7);
            minhaMao.Add(PREMATURE);
            var p2 = brain.Decide(Idle(DARK_FACTORY), 1);
            Check("par CONTROLE: com o gordo na mao e reanimacao, ATIVA",
                  Ativou(p2, DARK_FACTORY), $"(veio {p2.Action} — {p2.Why})");

            // PAR CONTROLE 2: campo VAZIO. Nao ha' corpo a perder, e parado a mao
            // nao vale nada — a carta volta a ser a jogada certa.
            meuCampo.Clear(); minhasViradas.Clear();
            minhaMao.Clear(); minhaMao.Add(DARK_FACTORY);
            var p3 = brain.Decide(Idle(DARK_FACTORY), 1);
            Check("par CONTROLE: campo vazio, ATIVA (nao ha' corpo a perder)",
                  Ativou(p3, DARK_FACTORY), $"(veio {p3.Action} — {p3.Why})");

            // O CASO QUE MAIS DOI, e o que quase passou batido: o corpo esta'
            // SETADO. Para o resto do cerebro ele nem existe — `_fieldOf` so'
            // devolve o que esta' com a face para cima —, entao a regra lia "campo
            // vazio, nao tenho o que fazer" e ativava. O custo entao levava a
            // unica parede da mesa. Num deck que seta o tempo todo, como o do
            // Panik, este e' o caso COMUM.
            meuCampo.Clear();
            minhasViradas.Clear(); minhasViradas.Add(METAL_GUARDIAN);
            minhaMao.Clear(); minhaMao.Add(DARK_FACTORY);
            var p4 = brain.Decide(Idle(DARK_FACTORY), 1);
            Check("com a unica parede SETADA e nada na mao: GUARDA",
                  !Ativou(p4, DARK_FACTORY),
                  $"(veio {p4.Action} — {p4.Why}) — `QtdMonstros` nao ve' carta virada");
        }

        // ------------------------------------------------------------ corrente

        static void NaCorrente(string sa)
        {
            using var db = new DatabaseManager(sa);
            var brain = new NpcBrain(db, fieldOf: _ => new List<uint>(), log: _ => { });

            var q = new InteractiveDuel.Question { kind = "chain", player = 1 };
            q.choices.Add(new InteractiveDuel.Sel
            { code = DARK_FACTORY, index = 0, location = SZONE, controller = 1 });

            int escolha = brain.DecideChain(q, 1);
            Check("nao gasta a Dark Factory numa janela de corrente qualquer",
                  escolha < 0,
                  "(ela e' quick e free-chain: aparece em TODA janela, e era ativada em todas)");
        }
    }
}
