using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace DuelServer.Update
{
    /// <summary>
    /// O manifesto é a FONTE DA VERDADE do estado desejado da instalação. O cliente
    /// nunca adivinha o que precisa baixar: ele compara o disco com isto.
    ///
    /// Quem publica uma versão nova regenera o manifesto (tools/publish-release.ps1)
    /// e sobe só os assets que mudaram.
    ///
    /// Diferença proposital em relação ao molde original (MECANISMO-INSTALADOR.md §5):
    /// lá havia UM `payload`; aqui é uma LISTA. O conteúdo do Classic Duels tem dois
    /// ritmos muito diferentes — `web/` muda quase todo dia e pesa ~3 MB, enquanto
    /// `cards.cdb` + os ~21 mil scripts Lua pesam ~47 MB e só mudam quando roda o
    /// `npm run data:build`. Com um zip só, um ajuste de 1 KB no front custaria 50 MB
    /// de download ao jogador; era exatamente a "lição não-resolvida" do documento.
    /// </summary>
    public sealed class Manifest
    {
        [JsonPropertyName("gameVersion")] public string GameVersion { get; set; } = "";
        [JsonPropertyName("displayName")] public string DisplayName { get; set; } = "Classic Duels";
        [JsonPropertyName("installer")] public InstaladorInfo Installer { get; set; }
        [JsonPropertyName("managedRoots")] public List<RaizGerenciada> ManagedRoots { get; set; } = new();
        [JsonPropertyName("files")] public List<ArquivoManifesto> Files { get; set; } = new();
        [JsonPropertyName("payloads")] public List<PayloadManifesto> Payloads { get; set; } = new();

        static readonly JsonSerializerOptions Opts = new()
        {
            PropertyNameCaseInsensitive = true,
            ReadCommentHandling = JsonCommentHandling.Skip,
            AllowTrailingCommas = true,
            WriteIndented = true,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };

        /// <summary>
        /// O `Set-Content` do PowerShell grava UTF-8 COM BOM por padrão, e o
        /// System.Text.Json engasga com ele. O gerador já grava sem BOM, mas um
        /// manifesto editado à mão no Bloco de Notas volta com BOM e o updater
        /// morreria com "'<0xEF>' is an invalid start of a value" — erro que não
        /// diz nada a quem publicou. Toleramos nas duas pontas.
        /// </summary>
        public static Manifest Parse(string json)
        {
            if (json == null) throw new ArgumentNullException(nameof(json));
            json = json.TrimStart('﻿', '​').Trim();
            var m = JsonSerializer.Deserialize<Manifest>(json, Opts)
                    ?? throw new InvalidOperationException("manifesto vazio");
            m.Files ??= new();
            m.Payloads ??= new();
            m.ManagedRoots ??= new();
            return m;
        }

        public string ToJson() => JsonSerializer.Serialize(this, Opts);
    }

    public sealed class InstaladorInfo
    {
        [JsonPropertyName("version")] public string Version { get; set; } = "0.0.0";
        [JsonPropertyName("asset")] public string Asset { get; set; }
        [JsonPropertyName("url")] public string Url { get; set; }
        [JsonPropertyName("sha256")] public string Sha256 { get; set; }
        [JsonPropertyName("size")] public long Size { get; set; }
    }

    /// <summary>
    /// Pasta que o instalador GOVERNA: o que estiver lá dentro e não estiver no
    /// manifesto é "órfão". <see cref="RemoveMode"/> decide o destino do órfão.
    ///
    /// `store/` e `decks/` JAMAIS entram aqui — desde que o login existe, eles
    /// guardam conta de gente (`store/accounts/`, `store/users/`, `sessions.json`,
    /// `decks/users/`). Um órfão apagado ali não perde um save: desloga o jogador
    /// e some com a coleção dele.
    /// </summary>
    public sealed class RaizGerenciada
    {
        [JsonPropertyName("path")] public string Path { get; set; } = "";
        /// <summary>"keep" (não mexe), "backup" (move para a pasta de backup) ou "delete".</summary>
        [JsonPropertyName("removeMode")] public string RemoveMode { get; set; } = "keep";
    }

    public sealed class ArquivoManifesto
    {
        /// <summary>Relativo à raiz da instalação, com "/".</summary>
        [JsonPropertyName("path")] public string Path { get; set; } = "";
        [JsonPropertyName("sha256")] public string Sha256 { get; set; } = "";
        [JsonPropertyName("size")] public long Size { get; set; }
        /// <summary>Nome do asset no Release (repo privado).</summary>
        [JsonPropertyName("asset")] public string Asset { get; set; }
        /// <summary>OU uma URL http/https/file direta.</summary>
        [JsonPropertyName("url")] public string Url { get; set; }
        [JsonPropertyName("policy")] public string Policy { get; set; } = "required";
    }

    /// <summary>
    /// Um .zip inteiro versionado por marcador. Serve para diretórios com MUITOS
    /// arquivos: listar os 12.734 JSON do `ygo-data/data` ou os ~21 mil `.lua`
    /// um a um no manifesto seria inviável.
    /// </summary>
    public sealed class PayloadManifesto
    {
        /// <summary>"game", "cards", … — vira o nome do marcador em disco.</summary>
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        /// <summary>Se igual ao marcador salvo no disco, NÃO re-baixa.</summary>
        [JsonPropertyName("version")] public string Version { get; set; } = "";
        [JsonPropertyName("asset")] public string Asset { get; set; }
        [JsonPropertyName("url")] public string Url { get; set; }
        [JsonPropertyName("sha256")] public string Sha256 { get; set; } = "";
        [JsonPropertyName("size")] public long Size { get; set; }
        /// <summary>Pastas que este zip preenche (usadas na limpeza pós-extração).</summary>
        [JsonPropertyName("roots")] public List<string> Roots { get; set; } = new();

        /// <summary>
        /// O pacote cai em `.staged/` e NÃO vale enquanto o jogo não reabrir.
        ///
        /// É o caso do `engine`/`native`: quem baixa a atualização é o próprio
        /// motor, e nesse instante ele e a `ocgcore.dll` estão carregados — o
        /// Windows não deixa sobrescrever DLL em uso. Então o pacote fica em
        /// estágio e a casca (`host/Estagio.cs`) troca no boot seguinte.
        ///
        /// Não é um campo do manifesto: é lido das próprias `roots`, para não
        /// haver como publicar um zip que cai em `.staged/` sem o cliente saber
        /// que precisa reabrir — nem o contrário.
        /// </summary>
        [JsonIgnore]
        public bool EmEstagio =>
            (Roots ?? new List<string>()).Exists(r =>
                (r ?? "").Replace('\\', '/').TrimStart('/')
                         .StartsWith(".staged", StringComparison.OrdinalIgnoreCase));
    }
}
