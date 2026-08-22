using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// **Qual efeito da carta esta' sendo oferecido** — `--test-efeitos`.
    ///
    /// O relato: "tem o caso do Forgotten Temple of the Deep, que possui 2
    /// efeitos diferentes, e as vezes tu ativa ela achando que o efeito 2 vai
    /// resolver, mas quem resolve e' o efeito 1". Na tela as duas ofertas sao
    /// identicas — mesmo nome, mesma arte —, entao escolher e' adivinhar.
    ///
    /// Toda pergunta do motor que envolve UM efeito carrega a `description`
    /// dele, montada pelo proprio script em `aux.Stringid(code, i)`:
    ///
    ///     (i &amp; 0xfffff) | code &lt;&lt; 20
    ///
    /// ou seja, QUAL carta e QUAL das descricoes dela (`str1`..`str16` da tabela
    /// `texts`, com `i = 0` sendo a `str1`). Este arquivo guarda as duas metades
    /// desse caminho, porque as duas erram em SILENCIO:
    ///
    ///   1. a decodificacao (`DatabaseManager.TextoDoEfeito`). Trocar o
    ///      deslocamento ou somar 1 no indice nao derruba duelo nenhum: a tela
    ///      passa a prometer o efeito ERRADO, que e' pior do que nao prometer
    ///      nada — e e' exatamente o problema que este campo veio resolver;
    ///
    ///   2. o OFFSET da descricao dentro da mensagem. A entrada do SELECT_CHAIN
    ///      tem 23 bytes e a do idle 19; ler os 8 bytes do lugar errado devolve
    ///      lixo, que vira "sem texto" na tela — o silencio de sempre, sem erro
    ///      no servidor. Por isso o duelo real no fim: ele exige que a frase
    ///      chegue INTEIRA e IGUAL a' `str1` do banco.
    /// </summary>
    public static class TestEfeitos
    {
        const uint TEMPLO = 43889633;      // Forgotten Temple of the Deep (Armadilha Continua)
        const uint JELLYFISH = 14851496;   // Nv4 Aqua 1200/1500 — alvo valido do Templo
        const uint BATTLE_OX = 5053103;    // corpo Normal Nv4, so' para encher o deck
        const uint POT_OF_GREED = 55144522;// pede `Stringid(id,0)` com a coluna VAZIA no banco

        const byte LOC_SZONE = 0x8;

        // As duas descricoes do Templo, como estao no cards.cdb. Escritas aqui
        // por extenso de proposito: e' a frase que o jogador le' antes de
        // decidir, e trocar uma pela outra e' justamente o defeito relatado.
        const string EFEITO_1 = "Banish 1 Fish, Sea Serpent, or Aqua you control";
        const string EFEITO_2 = "Special Summon the monster(s) banished by this card";

        static int _pass, _fail;

        static void Check(string oque, bool ok, string detalhe = "")
        {
            if (ok) { Log.Info($"  OK    {oque}"); _pass++; }
            else { Log.Err($"  FALHA {oque} {detalhe}"); _fail++; }
        }

        /// <summary>O mesmo `aux.Stringid` do utility.lua — a conta que se prova aqui.</summary>
        static ulong Stringid(uint code, int i) => ((ulong)i & 0xfffff) | ((ulong)code << 20);

        public static int Run(string sa)
        {
            Log.Info("=== a descricao decodificada (o que cada efeito diz) ===\n");
            ADecodificacao(sa);
            Log.Info("\n=== e o que ela NAO inventa ===\n");
            OSilencio(sa);
            Log.Info("\n=== duelo real: a frase chega na pergunta ===\n");
            NoDuelo(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------- decodificacao

        static void ADecodificacao(string sa)
        {
            using var db = new DatabaseManager(sa);

            string um = db.TextoDoEfeito(Stringid(TEMPLO, 0));
            string dois = db.TextoDoEfeito(Stringid(TEMPLO, 1));

            Log.Info($"  > efeito 0: {um ?? "(null)"}");
            Log.Info($"  > efeito 1: {dois ?? "(null)"}");

            // O indice 0 e' a `str1`. Somar 1 aqui faria o Templo prometer
            // "Invocar Especialmente" na hora de BANIR — o defeito relatado, so'
            // que com a tela ajudando a errar.
            Check("o indice 0 e' a str1 (banir)", um == EFEITO_1, $"(veio: {um ?? "(null)"})");
            Check("o indice 1 e' a str2 (Invocar Especialmente de volta)", dois == EFEITO_2,
                  $"(veio: {dois ?? "(null)"})");
            Check("as duas descricoes sao DIFERENTES — e' o que separa os dois efeitos",
                  um != null && um != dois);

            // A prova de que o deslocamento e' 20, e nao qualquer outro: com
            // `code << 4` (o formato antigo do ygopro) o mesmo numero apontaria
            // para outra carta, e o texto sairia de outro lugar.
            Check("com o deslocamento errado (<< 4) o texto NAO e' o mesmo",
                  db.TextoDoEfeito(((ulong)TEMPLO << 4) | 0UL) != um);
        }

        // ----------------------------------------------------------- o silencio

        /// <summary>
        /// Onde nao da' para saber, a resposta e' `null` — e a tela nao mostra
        /// frase nenhuma. Uma descricao inventada aqui seria pior que o problema
        /// original: hoje o jogador nao sabe qual efeito e'; ali ele acharia que
        /// sabe.
        /// </summary>
        static void OSilencio(string sa)
        {
            using var db = new DatabaseManager(sa);

            Check("descricao vazia (efeito sem texto proprio) -> null",
                  db.TextoDoEfeito(0) == null);
            // Texto de SISTEMA: o motor tem uma tabela propria de frases
            // genericas, que nao mora no cards.cdb. Sai com `code == 0`.
            Check("texto de sistema (numero pequeno) -> null",
                  db.TextoDoEfeito(1150) == null);
            Check("indice fora das 16 colunas -> null",
                  db.TextoDoEfeito(Stringid(TEMPLO, 16)) == null);
            // Carta que existe mas nao tem aquela `str` preenchida.
            Check("coluna vazia no banco -> null (e nao uma frase em branco)",
                  db.TextoDoEfeito(Stringid(POT_OF_GREED, 0)) == null);
        }

        // -------------------------------------------------------- o duelo real

        /// <summary>
        /// O caminho inteiro, do buffer binario ate' a `Question` que o front
        /// recebe: Templo setado, ativado do campo, e um Aqua Nv4 em campo para
        /// dar alvo ao efeito de banir. A partir dai' o motor passa a oferecer o
        /// Templo COM descricao — no idle (entrada de 19 bytes) e na janela de
        /// corrente (entrada de 23), que sao os dois offsets que este teste
        /// existe para segurar.
        ///
        /// Sem oponente (`npc: false`): o duelo fica deterministico e o unico
        /// que joga sou eu.
        /// </summary>
        static void NoDuelo(string sa)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 12; i++) deck.Add(TEMPLO);
            for (int i = 0; i < 16; i++) deck.Add(JELLYFISH);
            while (deck.Count < 40) deck.Add(BATTLE_OX);

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 31337UL, 0x1000000UL, npc: false);
            var r = duel.Advance();

            bool ativouTemplo = false;
            string textoNoIdle = null, textoNaCorrente = null;
            int ofertasNoIdle = 0;

            for (int guard = 0; guard < 400 && !r.ended; guard++)
            {
                var q = r.question;
                if (q == null) break;

                if (q.kind == "chain")
                {
                    var templo = q.choices.FirstOrDefault(c => c.code == TEMPLO && c.desc != 0);
                    if (templo.code == TEMPLO && textoNaCorrente == null)
                    {
                        textoNaCorrente = templo.descText;
                        Log.Info($"  > corrente: Templo com descricao {templo.desc} -> " +
                                 $"{templo.descText ?? "(null)"}");
                    }
                    r = duel.Respond("chain", -1);
                    if (textoNoIdle != null && textoNaCorrente != null) break;
                    continue;
                }

                if (q.kind == "idle")
                {
                    // O Templo ja' com a face para cima e com alvo: a oferta vem
                    // COM descricao (o efeito de banir). Antes dela, a unica
                    // oferta e' a ATIVACAO da armadilha continua, que nao tem
                    // texto proprio (desc 0) — e as duas se distinguem por isso.
                    var comTexto = q.activatable.FirstOrDefault(a => a.code == TEMPLO && a.desc != 0);
                    if (comTexto.code == TEMPLO)
                    {
                        ofertasNoIdle++;
                        if (textoNoIdle == null)
                        {
                            textoNoIdle = comTexto.descText;
                            Log.Info($"  > idle: Templo com descricao {comTexto.desc} -> " +
                                     $"{comTexto.descText ?? "(null)"}");
                        }
                    }

                    var ativar = q.activatable.FirstOrDefault(
                        a => a.code == TEMPLO && a.location == LOC_SZONE && a.desc == 0);
                    var setar = q.settableST.FirstOrDefault(a => a.code == TEMPLO);
                    var invocar = q.summonable.FirstOrDefault(a => a.code == JELLYFISH);

                    if (!ativouTemplo && ativar.code == TEMPLO)
                    {
                        ativouTemplo = true;
                        Log.Info("  > ativando o Templo do campo (a armadilha continua sobe)");
                        r = duel.Respond("activate", ativar.index);
                    }
                    else if (invocar.code == JELLYFISH) r = duel.Respond("summon", invocar.index);
                    else if (!ativouTemplo && setar.code == TEMPLO) r = duel.Respond("setspell", setar.index);
                    else r = duel.Respond("endturn", 0);

                    if (textoNoIdle != null && textoNaCorrente != null) break;
                    continue;
                }

                r = Padrao(duel, q);
            }

            Check("o Templo foi ativado e ficou com a face para cima", ativouTemplo);
            Check("o motor ofereceu o efeito COM descricao no idle", ofertasNoIdle > 0,
                  "(nenhuma oferta com desc != 0 — o offset da entrada de 19 bytes mudou?)");
            Check("a descricao do idle e' a str1, inteira", textoNoIdle == EFEITO_1,
                  $"(veio: {textoNoIdle ?? "(null)"})");
            Check("a mesma descricao chega na janela de corrente", textoNaCorrente == EFEITO_1,
                  $"(veio: {textoNaCorrente ?? "(null)"} — o offset da entrada de 23 bytes mudou?)");
        }

        static InteractiveDuel.Result Padrao(InteractiveDuel duel, InteractiveDuel.Question q)
        {
            switch (q.kind)
            {
                case "place": return duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0);
                case "position": return duel.Respond("position", 0x1);
                case "yesno": return duel.Respond("yesno", 0);
                case "option": return duel.Respond("option", 0);
                case "battle": return duel.Respond("endbattle", 0);
                case "chain": return duel.Respond("chain", -1);
                case "selectcard":
                case "selecttribute":
                case "selectsum":
                    return duel.Respond("select", 0,
                        q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList());
                case "selectunselect":
                    return q.canFinish && q.choices.Count == 0
                        ? duel.Respond("finishselect", 0)
                        : duel.Respond("pick", q.choices[0].index);
                case "unsupported":
                    Log.Err($"  > MENSAGEM NAO SUPORTADA: tipo bruto {q.rawType}");
                    return duel.Respond("endturn", 0);
                default: return duel.Respond("endturn", 0);
            }
        }
    }
}
