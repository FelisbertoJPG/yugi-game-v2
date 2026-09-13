using System;
using System.Collections.Generic;
using System.Text.Json;
using DuelServer;
using YGO;

/// <summary>
/// Uma carta do **Card Builder** (`web/cardbuilder.html`, tabela
/// `cartas_custom`, migration 0058), do jeito que o motor precisa dela: a linha
/// que o `cards.cdb` teria (`datas`) mais o `c&lt;id&gt;.lua`.
///
/// Essas cartas NÃO moram no `cards.cdb` nem na pasta de scripts — nascem no
/// banco e mudam sem Release nenhum. Quem as traz é o navegador, que já lê o
/// Supabase: o `/start` chega com `customCards`, e o `DatabaseManager` e o
/// `ScriptManager` do duelo passam a responder por elas.
///
/// Três travas, e cada uma fecha uma porta diferente:
///
///   • **só a faixa do builder** (<see cref="ID_MIN"/>–<see cref="ID_MAX"/>, a
///     mesma CHECK da 0058): uma entrada com o id do Pote da Ganância não pode
///     trocar o script oficial por outro no meio do duelo;
///   • **só de quem chama da própria máquina** — é o `WebServer` que decide, pelo
///     `req.IsLocal`. Com `--lan` a porta 8770 é alcançável pela rede, e Lua vindo
///     de outro aparelho rodaria dentro do motor;
///   • **tetos** de tamanho e de quantidade, para um corpo torto não virar memória
///     presa pela duração do duelo.
/// </summary>
public sealed class CartaCustom
{
    public const uint ID_MIN = 950000000;
    public const uint ID_MAX = 999999999;
    public const int TETO_LUA = 65536;
    public const int TETO_CARTAS = 60;

    public uint Code { get; init; }
    public string Nome { get; init; } = "";
    public uint Type { get; init; }
    public uint Level { get; init; }
    public uint Attribute { get; init; }
    public ulong Race { get; init; }
    public int Atk { get; init; }
    public int Def { get; init; }
    public string Lua { get; init; } = "";

    public static bool EhDoBuilder(uint code) => code >= ID_MIN && code <= ID_MAX;

    /// <summary>
    /// Lê o `customCards` do corpo do `/start`. Entrada fora de forma é
    /// DESCARTADA com uma linha no log, nunca vira exceção: um duelo que não sobe
    /// por causa de uma carta torta é pior que um que sobe sem ela — e aí é o
    /// próprio motor que diz "carta desconhecida" no lugar certo.
    /// </summary>
    public static CartaCustom[] Ler(JsonElement body)
    {
        if (body.ValueKind != JsonValueKind.Object
            || !body.TryGetProperty("customCards", out var lista)
            || lista.ValueKind != JsonValueKind.Array)
            return Array.Empty<CartaCustom>();

        var fora = new List<CartaCustom>();
        var vistos = new HashSet<uint>();
        foreach (var el in lista.EnumerateArray())
        {
            if (fora.Count >= TETO_CARTAS)
            {
                Log.Warn($"[card-builder] mais de {TETO_CARTAS} cartas no /start — o resto foi ignorado");
                break;
            }
            if (el.ValueKind != JsonValueKind.Object) continue;

            long bruto = Num(el, "id");
            uint code = bruto > 0 && bruto <= uint.MaxValue ? (uint)bruto : 0;
            string lua = Texto(el, "lua");
            uint type = (uint)Math.Max(0, Num(el, "type"));

            if (!EhDoBuilder(code))
            {
                Log.Warn($"[card-builder] id {bruto} fora da faixa do Card Builder — ignorado");
                continue;
            }
            if (type == 0 || string.IsNullOrWhiteSpace(lua) || lua.Length > TETO_LUA)
            {
                Log.Warn($"[card-builder] carta {code} sem tipo ou sem Lua (ou Lua grande demais) — ignorada");
                continue;
            }
            if (!vistos.Add(code)) continue;

            fora.Add(new CartaCustom
            {
                Code = code,
                Nome = Texto(el, "nome"),
                Type = type,
                Level = (uint)Math.Clamp(Num(el, "level"), 0, 13),
                Attribute = (uint)Math.Max(0, Num(el, "attribute")),
                Race = (ulong)Math.Max(0, Num(el, "race")),
                Atk = (int)Math.Clamp(Num(el, "atk"), -2, 99999),
                Def = (int)Math.Clamp(Num(el, "def"), -2, 99999),
                Lua = lua,
            });
        }
        return fora.ToArray();
    }

    static long Num(JsonElement el, string prop) =>
        el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out long n)
            ? n : 0;

    static string Texto(JsonElement el, string prop) =>
        el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? (v.GetString() ?? "") : "";
}
