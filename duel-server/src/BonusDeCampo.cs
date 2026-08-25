using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace DuelServer
{
    /// <summary>
    /// **Quem uma Magia de Campo reforça, e quanto** — lido do Lua da carta.
    ///
    /// Isto existia como uma tabela escrita à mão (`NpcBrain.CAMPOS`) com TRÊS
    /// entradas: Mountain, Umi e A Legendary Ocean. Carta fora dela nunca era
    /// ativada — e isso não era descuido: magia de campo é GLOBAL, vale para os
    /// dois lados, então ativar uma sem saber quem ganha reforça o adversário
    /// junto. Na dúvida, o certo era não ativar.
    ///
    /// O preço da tabela apareceu na pergunta *"o NPC sabe posicionar magia de
    /// campo?"*: dos seis campos básicos da Lista 1, ele usava dois. Forest,
    /// Yami, Sogen e Wasteland ficavam mortos na mão para sempre, sem um aviso.
    ///
    /// O bônus está no Lua, e os scripts deste pool são formulaicos o bastante
    /// para serem lidos. Duas formas, e as duas aparecem entre os seis:
    ///
    ///   FILTRO LITERAL — Mountain, Forest, Sogen, Wasteland, A Legendary Ocean:
    ///     e2:SetTarget(aux.TargetBoolFunction(Card.IsRace,RACE_DRAGON|RACE_THUNDER))
    ///     e2:SetValue(200)
    ///
    ///   FUNÇÃO DE VALOR — Umi, Yami:
    ///     e2:SetValue(s.val)
    ///     function s.val(e,c) local r=c:GetRace()
    ///       if r&(RACE_FISH|RACE_AQUA)&gt;0 then return 200
    ///       elseif r&(RACE_MACHINE|RACE_PYRO)&gt;0 then return -200
    ///       else return 0 end end
    ///
    /// A segunda forma é a que torna isto melhor que a tabela antiga, e não só
    /// mais curto: ela traz a **PENALIDADE** junto. A Umi tira 200 de Máquina e
    /// Piro, o Yami tira 200 de Fada — a tabela só sabia dizer quem ganhava, e
    /// por isso o NPC não conseguia perceber que ativar aquilo enfraqueceria o
    /// próprio campo.
    ///
    /// **Não é um interpretador de Lua**, e não tenta ser: ele agrupa as chamadas
    /// por variável de efeito (`e2:`, `e3:`), resolve `Clone()` herdando do pai, e
    /// só olha o efeito cujo `Code` é `EFFECT_UPDATE_ATTACK`. Script fora dessas
    /// formas devolve "não sei ler" — e aí a carta simplesmente não é ativada,
    /// que é o mesmo silêncio seguro de antes. Errar para menos aqui custa uma
    /// carta parada; errar para mais reforça o adversário.
    ///
    /// O `Clone()` não é detalhe: em `A Legendary Ocean` o PRIMEIRO efeito é um
    /// `EFFECT_UPDATE_LEVEL` de −1 (ela baixa o nível dos WATER), e o de ATK é o
    /// clone seguinte. Um leitor que casasse "o primeiro SetTarget com o primeiro
    /// SetValue" leria −1 de bônus e concluiria que a carta PIORA o próprio
    /// campo — exatamente ao contrário.
    /// </summary>
    public sealed class BonusDeCampo
    {
        /// <summary>Uma cláusula: quem casa (raça e/ou atributo) e quanto ganha.</summary>
        public readonly struct Clausula
        {
            public readonly uint Racas, Atributos;
            public readonly int Valor;
            public Clausula(uint racas, uint atributos, int valor)
            { Racas = racas; Atributos = atributos; Valor = valor; }

            /// <summary>Cláusula sem filtro nenhum é o `else` da cadeia.</summary>
            public bool EhElse => Racas == 0 && Atributos == 0;
        }

        public IReadOnlyList<Clausula> Clausulas { get; }

        /// <summary>Deu para ler o Lua? Falso = a carta não deve ser ativada.</summary>
        public bool Conhecido => Clausulas.Count > 0;

        BonusDeCampo(List<Clausula> c) { Clausulas = c; }

        static readonly BonusDeCampo Nenhum = new(new List<Clausula>());

        /// <summary>
        /// Quanto ESTE monstro ganha (ou perde) com a carta em campo.
        ///
        /// A ordem importa e é a do `if/elseif` do script: a primeira cláusula que
        /// casa vence. Somar todas daria +200 −200 = 0 para um monstro que casa em
        /// duas, quando o Lua devolve a primeira e para.
        /// </summary>
        public int Para(DatabaseManager.CardStats st)
        {
            foreach (var c in Clausulas)
            {
                if (c.EhElse) return c.Valor;
                if ((c.Racas != 0 && (st.Race & c.Racas) != 0)
                    || (c.Atributos != 0 && (st.Attribute & c.Atributos) != 0))
                    return c.Valor;
            }
            return 0;
        }

        // ------------------------------------------------------------- leitura

        static readonly Regex CRIA = new(@"local\s+(e\d+)\s*=\s*Effect\.CreateEffect", RegexOptions.Compiled);
        static readonly Regex CLONE = new(@"local\s+(e\d+)\s*=\s*(e\d+):Clone\(\)", RegexOptions.Compiled);
        static readonly Regex SETA = new(@"(e\d+):Set(\w+)\(([^\r\n]*)\)", RegexOptions.Compiled);

        /// <summary>
        /// Lê o Lua da carta. Devolve `Conhecido == false` quando o script não
        /// está numa das duas formas — nunca um palpite.
        /// </summary>
        public static BonusDeCampo Ler(string lua)
        {
            if (string.IsNullOrEmpty(lua)) return Nenhum;

            // 1. As propriedades de cada efeito, na ordem em que o script as
            //    escreve. `Clone()` copia o que o pai tinha ATE' AQUI.
            var props = new Dictionary<string, Dictionary<string, string>>();
            var ordem = new List<string>();

            foreach (string linha in lua.Split('\n'))
            {
                var cria = CRIA.Match(linha);
                if (cria.Success)
                {
                    props[cria.Groups[1].Value] = new Dictionary<string, string>();
                    ordem.Add(cria.Groups[1].Value);
                    continue;
                }
                var clone = CLONE.Match(linha);
                if (clone.Success)
                {
                    string filho = clone.Groups[1].Value, pai = clone.Groups[2].Value;
                    props[filho] = props.TryGetValue(pai, out var p)
                        ? new Dictionary<string, string>(p)
                        : new Dictionary<string, string>();
                    ordem.Add(filho);
                    continue;
                }
                var seta = SETA.Match(linha);
                if (seta.Success && props.TryGetValue(seta.Groups[1].Value, out var alvo))
                    alvo[seta.Groups[2].Value] = seta.Groups[3].Value.Trim();
            }

            // 2. O efeito que mexe no ATK, em campo. DEF vem sempre junto nestes
            //    scripts (um clone), então ler o de ATK basta — e é o número que
            //    a decisão de batalha usa.
            foreach (string nome in ordem)
            {
                var e = props[nome];
                if (!e.TryGetValue("Code", out string code) || !code.Contains("EFFECT_UPDATE_ATTACK")) continue;
                if (!e.TryGetValue("Value", out string valor)) continue;

                var lidas = DoFiltroLiteral(e, valor) ?? DaFuncaoDeValor(lua, valor);
                if (lidas != null && lidas.Count > 0) return new BonusDeCampo(lidas);
            }
            return Nenhum;
        }

        /// <summary>
        /// FORMA A: `SetTarget(aux.TargetBoolFunction(Card.IsRace, MASK))` com um
        /// `SetValue(&lt;numero&gt;)`. Uma cláusula só, positiva.
        /// </summary>
        static List<Clausula> DoFiltroLiteral(Dictionary<string, string> e, string valor)
        {
            if (!int.TryParse(valor, out int n) || n == 0) return null;
            if (!e.TryGetValue("Target", out string alvo)) return null;

            var m = Regex.Match(alvo, @"Card\.Is(Race|Attribute)\s*,\s*([^)]+)\)");
            if (!m.Success) return null;

            uint mask = Mascara(m.Groups[2].Value);
            if (mask == 0) return null;
            bool porRaca = m.Groups[1].Value == "Race";
            return new List<Clausula> { new(porRaca ? mask : 0, porRaca ? 0 : mask, n) };
        }

        /// <summary>
        /// FORMA B: `SetValue(s.val)`, com a cadeia `if r&amp;(MASK)&gt;0 then return N`.
        /// Cada ramo vira uma cláusula, NA ORDEM — é o que traz a penalidade.
        /// </summary>
        static List<Clausula> DaFuncaoDeValor(string lua, string valor)
        {
            string nome = valor.Trim();
            if (!Regex.IsMatch(nome, @"^s\.\w+$")) return null;

            var corpo = Regex.Match(lua,
                $@"function\s+{Regex.Escape(nome)}\s*\([^)]*\)(.*?)\nend",
                RegexOptions.Singleline);
            if (!corpo.Success) return null;

            // Por RAÇA ou por ATRIBUTO: o script diz qual no `GetRace()`/
            // `GetAttribute()` que abre a funcao.
            bool porRaca = corpo.Value.Contains("GetRace");
            bool porAtributo = corpo.Value.Contains("GetAttribute");
            if (!porRaca && !porAtributo) return null;

            var lidas = new List<Clausula>();
            foreach (Match m in Regex.Matches(corpo.Groups[1].Value,
                         @"(?:if|elseif)\s*\(?\s*\w+\s*&\s*\(?([^)]*?)\)?\s*\)?\s*>\s*0\s*then\s*return\s*(-?\d+)"))
            {
                uint mask = Mascara(m.Groups[1].Value);
                if (mask == 0) continue;
                lidas.Add(new Clausula(porRaca ? mask : 0, porRaca ? 0 : mask,
                                       int.Parse(m.Groups[2].Value)));
            }
            return lidas.Count > 0 ? lidas : null;
        }

        /// <summary>`RACE_A|RACE_B` → a máscara somada. Nome desconhecido zera tudo:
        /// meia máscara é pior que máscara nenhuma, porque parece certa.</summary>
        /// <summary>Uma constante do ocgcore pelo nome — usada tambem pelo
        /// `DatabaseManager.ExigeCorpo`, que le' raca do Lua pelo mesmo caminho.</summary>
        internal static uint Constante(string nome) =>
            CONSTANTES.TryGetValue(nome ?? "", out uint v) ? v : 0;

        static uint Mascara(string texto)
        {
            uint mask = 0;
            foreach (string parte in texto.Split('|'))
            {
                string nome = parte.Trim();
                if (nome.Length == 0) continue;
                if (!CONSTANTES.TryGetValue(nome, out uint v)) return 0;
                mask |= v;
            }
            return mask;
        }

        /// <summary>
        /// As constantes do ocgcore. Ficam aqui escritas porque são do FORMATO do
        /// motor (nunca mudam), e não conteúdo de carta — a mesma razão de
        /// `LOCATION_*` e `POS_*` morarem no código.
        /// </summary>
        static readonly Dictionary<string, uint> CONSTANTES = new()
        {
            ["RACE_WARRIOR"] = 0x1,       ["RACE_SPELLCASTER"] = 0x2,
            ["RACE_FAIRY"] = 0x4,         ["RACE_FIEND"] = 0x8,
            ["RACE_ZOMBIE"] = 0x10,       ["RACE_MACHINE"] = 0x20,
            ["RACE_AQUA"] = 0x40,         ["RACE_PYRO"] = 0x80,
            ["RACE_ROCK"] = 0x100,        ["RACE_WINGEDBEAST"] = 0x200,
            ["RACE_WINDBEAST"] = 0x200,   ["RACE_PLANT"] = 0x400,
            ["RACE_INSECT"] = 0x800,      ["RACE_THUNDER"] = 0x1000,
            ["RACE_DRAGON"] = 0x2000,     ["RACE_BEAST"] = 0x4000,
            ["RACE_BEASTWARRIOR"] = 0x8000, ["RACE_DINOSAUR"] = 0x10000,
            ["RACE_FISH"] = 0x20000,      ["RACE_SEASERPENT"] = 0x40000,
            ["RACE_REPTILE"] = 0x80000,   ["RACE_PSYCHIC"] = 0x100000,
            ["RACE_DIVINE"] = 0x200000,   ["RACE_CREATORGOD"] = 0x400000,
            ["RACE_WYRM"] = 0x800000,     ["RACE_CYBERSE"] = 0x1000000,
            ["RACE_ILLUSION"] = 0x2000000,

            ["ATTRIBUTE_EARTH"] = 0x1,    ["ATTRIBUTE_WATER"] = 0x2,
            ["ATTRIBUTE_FIRE"] = 0x4,     ["ATTRIBUTE_WIND"] = 0x8,
            ["ATTRIBUTE_LIGHT"] = 0x10,   ["ATTRIBUTE_DARK"] = 0x20,
            ["ATTRIBUTE_DIVINE"] = 0x40,
        };
    }
}
