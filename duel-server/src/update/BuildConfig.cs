using System;
using System.IO;
using System.Reflection;

namespace DuelServer.Update
{
    /// <summary>
    /// Coordenadas de distribuição, fixas no build.
    ///
    /// O TOKEN não mora aqui. Ele entra como recurso embutido a partir de
    /// `duel-server/token.txt` — mesmo padrão condicional que o `payload.zip` já
    /// usa no .csproj: se o arquivo existe, vira recurso; se não existe (o dia a
    /// dia do desenvolvimento), a condição não bate e o build sai igual ao de
    /// sempre. Assim o segredo nunca passa por um arquivo .cs que alguém commita
    /// por distração.
    /// </summary>
    public static class BuildConfig
    {
        /// <summary>Repositório PRIVADO só de distribuição — não tem código, só Releases.</summary>
        public const string Owner = "FelisbertoJPG";
        public const string Repo = "yugi-server-";

        /// <summary>Vazio = pega o Release mais recente (`/releases/latest`).</summary>
        public const string Tag = "";

        /// <summary>
        /// Versão DESTE executável. É o que o auto-update compara com
        /// `manifest.installer.version`. Suba a cada Release que troque o exe.
        /// </summary>
        // 0.2.0 (14/08/2026): o PRIMEIRO Release a subir o exe (`-ComExe`). Até
        // aqui o manifesto saía com `"installer": null` e o auto-update do próprio
        // executável nunca rodou em produção — o que significa que TODA mudança no
        // duel-server (C#) só chegava ao jogador por um exe entregue na mão. Foi
        // assim que a varredura de ATK/DEF ficou publicada no front e ausente no
        // motor: a magia de campo continuava sem efeito visível na tela de quem
        // jogava com o exe antigo.
        //
        // 0.3.0 (15/08/2026): o NpcBrain passou a decidir pelo ATK/DEF DE AGORA
        // (`InteractiveDuel.StatsEmCampo`) em vez do statline impresso no
        // `cards.cdb`, e o Bônus de Campo do tabuleiro do adversário passou a ser
        // carta DELE (`fieldSpellController`). As duas são motor: sem trocar o
        // exe, o `duel.html` novo mandaria `fieldSpellOwner` para um servidor que
        // ignora o campo, e o NPC continuaria atacando monstro equipado.
        //
        // 0.4.0 (15/08/2026): o NpcBrain deixou de setar um corpo que atropela o
        // campo do outro lado. O statline (DEF > ATK ⇒ parede) passou a poder ser
        // desmentido pelo campo à vista — era o que fazia um Ryu-Ran (2200/2600)
        // recém-tributado nascer deitado diante de dois monstros que ele vencia,
        // e virarem tributo de algo maior no turno seguinte. Vale nos DOIS
        // caminhos (invocação normal e MSG_SELECT_POSITION das especiais), e é
        // decisão do motor: sem trocar o exe, nada disso chega a quem joga.
        //
        // 0.5.0 (15/08/2026): o MSG_CHAINING virou evento de tela
        // (`{type:"chaining"}`), que é o que permite ao `duel.html` mostrar a
        // carta ativada grande no meio do campo antes de o efeito resolver. O
        // front novo escuta um evento que o motor velho não emite: sem trocar o
        // exe, a revelação simplesmente nunca aparece — e nada acusa.
        public const string InstallerVersion = "0.5.0";

        public const string UserAgent = "DuelAcademy-Updater/" + InstallerVersion;

        const string RecursoToken = "token.txt";

        static string _token;
        static bool _tokenLido;

        /// <summary>
        /// PAT fine-grained, `Contents: Read-only`, escopado SÓ no repo de
        /// distribuição. Null quando não foi embutido — aí o updater tenta sem
        /// autenticação (funciona se o repo for público) e diz isso no log, em vez
        /// de morrer com um 404 que parece "release não existe".
        ///
        /// Ordem: recurso embutido → variável de ambiente (para depurar sem
        /// recompilar) → null.
        ///
        /// O token É EXTRAÍVEL de dentro do exe por qualquer um. Isso é aceito e o
        /// dano é limitado pelo escopo: o pior caso é alguém baixar o que já ia ser
        /// distribuído. NUNCA embuta um token amplo — o `gho_…` do `gh` CLI tem
        /// escopo `repo`+`workflow` e daria poder de ESCRITA no repositório.
        /// </summary>
        public static string Token
        {
            get
            {
                if (_tokenLido) return _token;
                _tokenLido = true;

                try
                {
                    var asm = typeof(BuildConfig).Assembly;
                    using var s = asm.GetManifestResourceStream(RecursoToken);
                    if (s != null)
                    {
                        using var r = new StreamReader(s);
                        _token = r.ReadToEnd().Trim();
                    }
                }
                catch { }

                if (string.IsNullOrEmpty(_token))
                    _token = Environment.GetEnvironmentVariable("DUELACADEMY_TOKEN");

                if (string.IsNullOrWhiteSpace(_token)) _token = null;
                return _token;
            }
        }
    }
}
