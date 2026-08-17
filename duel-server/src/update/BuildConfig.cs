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
        //
        // 0.6.0 (16/08/2026): o ATK/DEF novo passou a chegar na resposta em que o
        // efeito resolve, e não uma interação depois. A `VarrerStats` só rodava
        // quando a volta do laço trazia mensagem — e a volta que POSA a pergunta
        // não traz nenhuma, que é justamente quando o campo já está no estado
        // final. O jogador equipava e o número só subia ao ir para a Battle
        // Phase. É decisão do motor: sem trocar o exe, a tela continua atrasada.
        //
        // 0.7.0 (17/08/2026): o NpcBrain aprendeu o pacote Para & Dox (Tribute
        // Doll, Monster Gate, Metamorphosis, Magical Labyrinth) e ganhou a
        // Invocação Especial GENÉRICA — a que traz o Gate Guardian de 3750 e
        // qualquer outro corpo que o motor ofereça. É cérebro, viaja só no exe:
        // com o motor velho, o adversário do labirinto entra em campo com a mão
        // cheia de Nv7 que ele não sabe invocar.
        //
        // 0.8.0 (17/08/2026): tres coisas de motor. O drop por vitoria virou
        // sorteio POR RARIDADE no `premiar_vitoria`; o NpcBrain aprendeu a nao
        // desperdicar quem vale 2 tributos (Double Coston, Kaiser Sea Horse,
        // os Effigy); e o servidor passou a ANDAR para a proxima porta livre
        // quando a 8080/8770 esta ocupada por outro programa, em vez de nao
        // abrir. Sem o exe novo, o jogo continua morrendo com a porta ocupada.
        //
        // 0.9.0 (17/08/2026): o Para & Dox parou de jogar fora o proprio deck. O
        // Gate Guardian nao volta do cemiterio (precisa ter sido corretamente
        // invocado antes) e a regra de descarte, que joga fora o MAIOR monstro
        // da mao, rasgava a carta toda vez; agora ele e as tres pecas ficam no
        // fim da fila, e os atalhos que cobram um tributo se recusam a sair com
        // o campo so' de pecas. Junto veio o Mausoleu do Imperador (paga LP no
        // lugar dos tributos) e a correcao do SELECT_OPTION, que lia 4 bytes por
        // opcao onde o motor manda 8 — com duas opcoes a segunda sumia, e a
        // moeda do Mago do Tempo mostrava "Cara" e "Opcao 2" em vez de "Coroa".
        // Tudo isto e' motor: sem o exe novo, nada disso existe para quem joga.
        //
        // 0.9.1 (17/08/2026): o preco de um tributo passou a ser o que o corpo
        // FAZ, e nao o ATK impresso — um Labyrinth Wall de 0/3000 deitado era o
        // corpo "mais barato" do campo e virava tributo de qualquer coisa,
        // trocando a parede que segurava o duelo por um corpo de 2400. Junto,
        // o Tribute Doll voltou a trazer o Nv7 que a regra escolheu: a pergunta
        // "escolha uma carta da mao" e' a mesma de um custo de descarte, e a
        // fila do descarte (0.9.0) passou a jogar as pecas para o fim.
        //
        // 0.10.0 (17/08/2026): o NPC aprendeu CARTAS DE COMPRA pelo efeito, e nao
        // por id. Antes ele conhecia so' o Pote da Ganancia; Graceful Charity,
        // Dark World Dealings, Trade-In e Jar of Greed ficavam paradas na mao o
        // duelo inteiro. Quem responde "esta carta compra?" agora e' o proprio
        // jogo — a `category` do cards.cdb mais o Lua da carta —, entao toda
        // carta de compra que entrar em qualquer deck ja' nasce sendo usada.
        // Compra limpa vem antes de tudo; compra com descarte so' quando nao ha'
        // jogada ou quando encher o cemiterio e' o plano (corpo grande na mao +
        // reanimacao).
        //
        // 0.11.0 (17/08/2026): o jogo virou CLASSIC DUELS. O exe passou a se
        // chamar ClassicDuels.exe e a instalacao mudou de
        // %LOCALAPPDATA%\DuelAcademy para %LOCALAPPDATA%\ClassicDuels — com
        // migracao, porque dentro dessa pasta moram os decks e o store de quem
        // joga. Quem ja' tem o jogo instalado precisa DESTE exe para a pasta ser
        // movida: um exe antigo continuaria escrevendo no caminho velho.
        public const string InstallerVersion = "0.11.0";

        public const string UserAgent = "ClassicDuels-Updater/" + InstallerVersion;

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
