using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using DuelServer.Update;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste de aceitação do instalador/auto-updater — `--test-update`.
    ///
    /// Monta um "Release falso" numa pasta do %TEMP% e roda a engine INTEIRA por
    /// ela (<see cref="FonteLocal"/>), pelo mesmo caminho de código que o GitHub
    /// usa. Nenhuma rede, nenhum token, nada publicado — e ainda assim exercita
    /// load → plan → apply → re-scan.
    ///
    /// O motivo de isto existir antes de qualquer publicação real: um instalador
    /// só mostra que está errado NA MÁQUINA DO OUTRO, depois de já ter mexido nos
    /// arquivos dele. Aqui os casos de canto que dão mais medo (sha256 cortado,
    /// zip com `../`, um zip publicado por engano contendo a pasta de contas)
    /// falham de graça, no %TEMP%.
    /// </summary>
    public static class TestUpdate
    {
        static int _pass, _fail;

        static void Ok(string nome) { _pass++; Log.Info($"  ok   {nome}"); }
        static void Falha(string nome, string porque) { _fail++; Log.Err($"  FALHA {nome}: {porque}"); }
        static void Checa(bool cond, string nome, string porque = null)
        { if (cond) Ok(nome); else Falha(nome, porque ?? "condicao falsa"); }

        public static int Run()
        {
            Log.Info("=== teste: INSTALADOR / AUTO-UPDATER (Release falso em disco) ===\n");

            string bancada = Path.Combine(Path.GetTempPath(), "duelacademy-test-update-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            try
            {
                InstalacaoLimpaEIdempotencia(Sub(bancada, "1-limpa"));
                MarcadorIgualNaoRebaixa(Sub(bancada, "2-marcador"));
                ShaErradoAbortaSemEstragar(Sub(bancada, "3-sha"));
                ZipSlipRejeitado(Sub(bancada, "4-zipslip"));
                DadoDeContaIntocado(Sub(bancada, "5-conta"));
                OrfaoVaiParaBackupNaoParaOLixo(Sub(bancada, "6-orfao"));
                TabuleiroDoJogadorSobrevive(Sub(bancada, "6b-tabuleiro"));
                ManifestoComBomParseia();
                PacoteVolatilNaoArrastaOPesado(Sub(bancada, "7-volatilidade"));
                RaizesSobrepostasNaoSeApagam(Sub(bancada, "8-sobreposicao"));
                InstalacaoNovaNaoOfereceAtualizacaoFantasma(Sub(bancada, "9-fantasma"));
                InstalacaoComNomeAntigoEMigrada(Sub(bancada, "10-renomeacao"));
                MotorNovoFicaEmEstagio(Sub(bancada, "11-motor"));
                ExeVelhoNaoFicaCongelado(Sub(bancada, "12-exe-velho"));
            }
            finally
            {
                try { if (Directory.Exists(bancada)) Directory.Delete(bancada, true); } catch { }
            }

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------------ casos

        /// <summary>
        /// O básico: instalação do zero instala tudo; e rodar DE NOVO em cima não
        /// acha nada para fazer. Sem essa segunda metade, um updater "funciona" e
        /// mesmo assim re-baixa 47 MB toda vez que o jogo abre.
        /// </summary>
        static void InstalacaoLimpaEIdempotencia(string dir)
        {
            var (raiz, fonte) = Cenario(dir);

            var eng = NovaEngine(raiz, fonte);
            var m = eng.CarregarManifestoAsync().GetAwaiter().GetResult();
            Checa(m != null, "manifesto carrega da fonte");
            if (m == null) return;

            var plano = eng.Montar(m);
            Checa(plano.PayloadsPendentes.Count() == 2, "plano pede os 2 pacotes numa instalacao limpa",
                  $"pediu {plano.PayloadsPendentes.Count()}");
            Checa(plano.ABaixar.Count() == 2, "plano pede os avulsos (store/banlist.json, store/cardlists.json)",
                  $"pediu {plano.ABaixar.Count()}");

            bool aplicou = eng.AplicarAsync(plano).GetAwaiter().GetResult();
            Checa(aplicou, "apply devolve sucesso");

            Checa(File.Exists(Path.Combine(raiz, "web", "index.html")), "web/index.html instalado");
            Checa(File.Exists(Path.Combine(raiz, "ygo-data", "data", "cards.json")), "cards.json instalado");
            Checa(File.ReadAllText(Path.Combine(raiz, "store", "banlist.json")).Contains("v1"),
                  "store/banlist.json instalado com o conteudo certo");
            // Sem `store/cardlists.json` na lista de globais, isto some em
            // silencio: o WARN vai para o log e o jogador fica com a lista velha.
            Checa(File.Exists(Path.Combine(raiz, "store", "cardlists.json")),
                  "store/cardlists.json (pool permitido) instalado, nao recusado como dado de conta");

            // O re-scan é a prova real: mesma fonte, mesmo disco → plano vazio.
            var eng2 = NovaEngine(raiz, fonte);
            var plano2 = eng2.Montar(eng2.CarregarManifestoAsync().GetAwaiter().GetResult());
            Checa(plano2.NadaAFazer, "re-scan logo depois nao acha nada a fazer (idempotente)",
                  plano2.Resumo());
        }

        /// <summary>
        /// O marcador de versão é o que impede o download de 47 MB por nada. Se
        /// ele bater, o pacote nem é considerado — mesmo que os arquivos em disco
        /// estejam diferentes (é uma troca consciente: comparar 21 mil arquivos a
        /// cada boot custaria mais que o download).
        /// </summary>
        static void MarcadorIgualNaoRebaixa(string dir)
        {
            var (raiz, fonte) = Cenario(dir);
            var eng = NovaEngine(raiz, fonte);
            var m = eng.CarregarManifestoAsync().GetAwaiter().GetResult();
            eng.AplicarAsync(eng.Montar(m)).GetAwaiter().GetResult();

            var eng2 = NovaEngine(raiz, fonte);
            var plano = eng2.Montar(m);
            Checa(!plano.PayloadsPendentes.Any(), "marcador igual: nenhum pacote re-baixado");

            // E o contrário: mexer no marcador faz o pacote voltar a ser pedido.
            File.WriteAllText(Path.Combine(raiz, UpdateEngine.PastaMarcadores, "cards.version"), "cards-velho");
            var eng3 = NovaEngine(raiz, fonte);
            var plano3 = eng3.Montar(m);
            Checa(plano3.PayloadsPendentes.Count() == 1 && plano3.PayloadsPendentes.First().Fonte.Id == "cards",
                  "marcador diferente: so' o pacote 'cards' volta a ser pedido",
                  plano3.Resumo());
        }

        /// <summary>
        /// Download cortado/corrompido é comum. Se o sha256 não bate, o que estava
        /// instalado tem que continuar EXATAMENTE como estava.
        /// </summary>
        static void ShaErradoAbortaSemEstragar(string dir)
        {
            var (raiz, fonte) = Cenario(dir);
            var eng = NovaEngine(raiz, fonte);
            var m = eng.CarregarManifestoAsync().GetAwaiter().GetResult();
            eng.AplicarAsync(eng.Montar(m)).GetAwaiter().GetResult();

            string alvo = Path.Combine(raiz, "store", "banlist.json");
            string antes = File.ReadAllText(alvo);

            // Manifesto mentiroso: anuncia um conteúdo novo com um sha256 que não é
            // o do asset. É o que um upload cortado pela metade produz na prática.
            var f = m.Files.First(x => x.Path == "store/banlist.json");
            f.Sha256 = new string('0', 64);
            f.Size = 999;

            var plano = eng.Montar(m);
            Checa(plano.ABaixar.Any(), "manifesto adulterado gera um download");
            bool ok = eng.AplicarAsync(plano).GetAwaiter().GetResult();

            Checa(!ok, "apply devolve FALHA quando o sha256 nao confere");
            Checa(File.ReadAllText(alvo) == antes, "o arquivo bom antigo ficou intacto");
            Checa(!File.Exists(alvo + ".part"), "o .part foi apagado");
        }

        /// <summary>
        /// Um zip com `../../` escaparia da instalação e escreveria em qualquer
        /// lugar. Sem essa trava, um asset trocado no Release vira execução remota
        /// na máquina do jogador.
        /// </summary>
        static void ZipSlipRejeitado(string dir)
        {
            var (raiz, fonte) = Cenario(dir, zipMalicioso: true);
            var eng = NovaEngine(raiz, fonte);
            var m = eng.CarregarManifestoAsync().GetAwaiter().GetResult();
            eng.AplicarAsync(eng.Montar(m)).GetAwaiter().GetResult();

            string fugitivo = Path.Combine(Path.GetDirectoryName(raiz), "FUGIU.txt");
            Checa(!File.Exists(fugitivo), "entrada com '../' NAO escreveu fora da raiz");
            Checa(File.Exists(Path.Combine(raiz, "web", "index.html")),
                  "o resto do pacote foi instalado normalmente");
        }

        /// <summary>
        /// Desde que o login existe, `store/` e `decks/` guardam CONTA de gente.
        /// Um zip publicado por engano contendo `store/users/` não pode ter poder
        /// de sobrescrever a carteira de ninguém — a trava é do código, não do
        /// manifesto, justamente para um erro de publicação não alcançar isso.
        /// </summary>
        static void DadoDeContaIntocado(string dir)
        {
            var (raiz, fonte) = Cenario(dir, zipComDadoDeConta: true);

            string carteira = Path.Combine(raiz, "store", "users", "joao", "wallet.json");
            Directory.CreateDirectory(Path.GetDirectoryName(carteira));
            File.WriteAllText(carteira, "{\"dp\":99999}");
            string deck = Path.Combine(raiz, "decks", "users", "joao", "player", "meu.ydk");
            Directory.CreateDirectory(Path.GetDirectoryName(deck));
            File.WriteAllText(deck, "#created by joao");

            var eng = NovaEngine(raiz, fonte);
            var m = eng.CarregarManifestoAsync().GetAwaiter().GetResult();
            eng.AplicarAsync(eng.Montar(m)).GetAwaiter().GetResult();

            Checa(File.ReadAllText(carteira).Contains("99999"),
                  "store/users/joao/wallet.json intacto mesmo vindo no zip");
            Checa(File.ReadAllText(deck).Contains("joao"), "decks/users/joao/player/meu.ydk intacto");
            Checa(File.Exists(Path.Combine(raiz, "store", "banlist.json")),
                  "mas o conteudo GLOBAL (store/banlist.json) foi atualizado");
        }

        /// <summary>
        /// O tabuleiro que o JOGADOR criou no editor sobrevive à atualização.
        ///
        /// `boards/` entrou nas `roots` do pacote 'game' (para o inventário saber
        /// o que o pacote pôs lá), mas de propósito NÃO entrou em `managedRoots`:
        /// a varredura de órfãos só percorre managedRoots com `removeMode` != keep,
        /// e é ela que apagaria um arquivo que ninguém publicou.
        ///
        /// A diferença entre as duas listas é sutil e o custo de errar é o
        /// jogador perder um campo que ele desenhou — daí o teste.
        /// </summary>
        static void TabuleiroDoJogadorSobrevive(string dir)
        {
            var (raiz, fonte) = Cenario(dir);
            var eng = NovaEngine(raiz, fonte);
            var m = eng.CarregarManifestoAsync().GetAwaiter().GetResult();
            eng.AplicarAsync(eng.Montar(m)).GetAwaiter().GetResult();

            Checa(File.Exists(Path.Combine(raiz, "boards", "oficial.json")),
                  "o tabuleiro do PACOTE foi instalado");

            // O jogador desenha o dele no editor: vai para a mesma pasta, mas
            // nao esta' em manifesto nenhum.
            string meu = Path.Combine(raiz, "boards", "meu_campo.json");
            File.WriteAllText(meu, "{\"name\":\"Meu Campo\",\"fieldSpell\":87430998}");

            var eng2 = NovaEngine(raiz, fonte);
            var plano = eng2.Montar(m);
            Checa(!plano.Orfaos.Any(o => o.Path.EndsWith("meu_campo.json")),
                  "tabuleiro do jogador NAO e' tratado como orfao", plano.Resumo());

            eng2.AplicarAsync(plano).GetAwaiter().GetResult();
            Checa(File.Exists(meu), "e continua no disco depois da atualizacao");
            Checa(File.ReadAllText(meu).Contains("87430998"),
                  "com o Bonus de Campo intacto");
        }

        /// <summary>
        /// Órfão vai para a pasta de backup, nunca para o lixo — toda operação do
        /// instalador tem que ser reversível.
        ///
        /// Repare que o intruso está DENTRO de uma raiz de payload (`web/`). O molde
        /// original pula as raízes de payload na varredura, então não veria isto; o
        /// inventário por pacote deixa ver, porque sabemos exatamente o que o
        /// `game.zip` pôs ali.
        /// </summary>
        static void OrfaoVaiParaBackupNaoParaOLixo(string dir)
        {
            var (raiz, fonte) = Cenario(dir);
            var eng = NovaEngine(raiz, fonte);
            var m = eng.CarregarManifestoAsync().GetAwaiter().GetResult();
            eng.AplicarAsync(eng.Montar(m)).GetAwaiter().GetResult();

            string intruso = Path.Combine(raiz, "web", "js", "sobra-antiga.js");
            Directory.CreateDirectory(Path.GetDirectoryName(intruso));
            File.WriteAllText(intruso, "// versao velha");

            var eng2 = NovaEngine(raiz, fonte);
            var plano = eng2.Montar(m);
            Checa(plano.Orfaos.Any(o => o.Path == "web/js/sobra-antiga.js"),
                  "sobra dentro de uma raiz de payload e' detectada como orfa", plano.Resumo());

            eng2.AplicarAsync(plano).GetAwaiter().GetResult();
            Checa(!File.Exists(intruso), "a sobra saiu de web/js/");

            string backups = Path.Combine(Path.GetDirectoryName(raiz), "backups");
            bool achou = Directory.Exists(backups) &&
                         Directory.EnumerateFiles(backups, "sobra-antiga.js", SearchOption.AllDirectories).Any();
            Checa(achou, "e' recuperavel na pasta de backups (nao foi apagada)");

            Checa(File.Exists(Path.Combine(raiz, "web", "index.html")),
                  "e os arquivos legitimos do pacote NAO viraram orfaos");
        }

        /// <summary>
        /// REGRESSÃO. `game.zip` e `cards.zip` compartilham a pasta `ygo-data/data`
        /// (os 5 índices pequenos são voláteis, o `cards.json` de 14 MB é estável).
        /// Quando a limpeza pós-extração varria as `roots`, o segundo pacote apagava
        /// em silêncio o que o primeiro tinha acabado de instalar — o jogo instalava
        /// "com sucesso" e abria sem o `cards.index.json`.
        ///
        /// Este caso é o `--test-release` em miniatura: foi ele, contra os artefatos
        /// de verdade, que achou o bug. Aqui ele fica barato de rodar.
        /// </summary>
        static void RaizesSobrepostasNaoSeApagam(string dir)
        {
            var (raiz, fonte) = Cenario(dir);
            var eng = NovaEngine(raiz, fonte);
            var m = eng.CarregarManifestoAsync().GetAwaiter().GetResult();
            eng.AplicarAsync(eng.Montar(m)).GetAwaiter().GetResult();

            // 'game' põe o índice em ygo-data/data; 'cards' põe o cards.json na
            // MESMA pasta e é aplicado depois.
            Checa(File.Exists(Path.Combine(raiz, "ygo-data", "data", "cards.index.json")),
                  "indice do pacote 'game' sobrevive a' instalacao do pacote 'cards'");
            Checa(File.Exists(Path.Combine(raiz, "ygo-data", "data", "cards.json")),
                  "cards.json do pacote 'cards' tambem esta la'");
        }

        /// <summary>
        /// O `Set-Content` do PowerShell grava UTF-8 COM BOM. Um manifesto com BOM
        /// derrubaria o updater com "'<0xEF>' is an invalid start of a value" — erro
        /// que não diz nada a quem publicou.
        /// </summary>
        static void ManifestoComBomParseia()
        {
            string json = "﻿{\"gameVersion\":\"x\",\"displayName\":\"Classic Duels\"}";
            try
            {
                var m = Manifest.Parse(json);
                Checa(m.GameVersion == "x", "manifesto com BOM parseia mesmo assim");
            }
            catch (Exception e) { Falha("manifesto com BOM parseia mesmo assim", e.Message); }
        }

        /// <summary>
        /// A razão de existir da divisão em dois pacotes: publicar um ajuste no
        /// front NÃO pode fazer o jogador re-baixar os 47 MB de cartas. Se um dia
        /// alguém juntar tudo num zip só, este teste é que acusa.
        /// </summary>
        static void PacoteVolatilNaoArrastaOPesado(string dir)
        {
            var (raiz, fonte) = Cenario(dir);
            var eng = NovaEngine(raiz, fonte);
            var m = eng.CarregarManifestoAsync().GetAwaiter().GetResult();
            eng.AplicarAsync(eng.Montar(m)).GetAwaiter().GetResult();

            // "Nova versão" só do front: muda o zip 'game' e a versão dele.
            string novoGame = Path.Combine(dir, "release", "game.zip");
            var conteudo = new Dictionary<string, string>
            {
                ["web/index.html"] = "<h1>Classic Duels v2</h1>",
                ["web/js/deck.js"] = "// v2",
                ["ygo-data/src/ygodb.js"] = "// v2"
            };
            File.Delete(novoGame);
            CriarZip(novoGame, conteudo);
            var pg = m.Payloads.First(p => p.Id == "game");
            pg.Sha256 = HashCache.Computar(novoGame);
            pg.Size = new FileInfo(novoGame).Length;
            pg.Version = "game-" + pg.Sha256.Substring(0, 12);

            var eng2 = NovaEngine(raiz, fonte);
            var plano = eng2.Montar(m);

            var pendentes = plano.PayloadsPendentes.Select(p => p.Fonte.Id).ToList();
            Checa(pendentes.Count == 1 && pendentes[0] == "game",
                  "ajuste no front pede SO' o pacote 'game'", $"pediu: {string.Join(",", pendentes)}");

            long mb = plano.BytesTotais;
            Checa(mb < 1_000_000, "o download do ajuste e' pequeno (nao arrasta o pacote de cartas)",
                  $"{mb} bytes");

            eng2.AplicarAsync(plano).GetAwaiter().GetResult();
            Checa(File.ReadAllText(Path.Combine(raiz, "web", "index.html")).Contains("v2"),
                  "o front novo entrou");
            Checa(File.Exists(Path.Combine(raiz, "ygo-data", "data", "cards.json")),
                  "e o pacote de cartas continua instalado, sem ter sido tocado");
        }

        /// <summary>
        /// **A instalação que ficou com o nome antigo.**
        ///
        /// O jogo se chamava Duel Academy e instalava em
        /// `%LOCALAPPDATA%\DuelAcademy`. Dentro dessa pasta não mora só o jogo:
        /// moram os `decks/` e o `store/`, que são de quem joga e o instalador
        /// tem ordem de nunca tocar. Trocar o nome sem mais nada abandonaria
        /// tudo isso num canto do disco.
        ///
        /// Três regras, e as três importam: migra quando só existe a antiga,
        /// NÃO sobrescreve quando a nova já existe (aí uma instalação nova já
        /// aconteceu e é ela a verdade), e leva a pasta INTEIRA — inclusive os
        /// marcadores `.duelacademy/`, que continuam com o nome velho de
        /// propósito: renomeá-los faria todo cliente instalado rebaixar 28 MB à
        /// toa.
        /// </summary>
        static void InstalacaoComNomeAntigoEMigrada(string dir)
        {
            Directory.CreateDirectory(dir);
            string velha = Path.Combine(dir, "DuelAcademy");
            string nova = Path.Combine(dir, "ClassicDuels");

            // Uma instalacao "de verdade": o jogo, o deck do jogador e o marcador.
            Directory.CreateDirectory(Path.Combine(velha, "game", "web"));
            Directory.CreateDirectory(Path.Combine(velha, "game", "decks", "player"));
            Directory.CreateDirectory(Path.Combine(velha, "game", ".duelacademy"));
            File.WriteAllText(Path.Combine(velha, "game", "web", "index.html"), "<html>v1</html>");
            File.WriteAllText(Path.Combine(velha, "game", "decks", "player", "meu.ydk"), "#main\n5053103\n");
            File.WriteAllText(Path.Combine(velha, "game", ".duelacademy", "game.version"), "game-abc123");

            Checa(Payload.MigrarInstalacaoAntiga(velha, nova), "migra a instalacao com o nome antigo");
            Checa(!Directory.Exists(velha), "a pasta antiga deixa de existir (foi movida, nao copiada)");
            Checa(File.Exists(Path.Combine(nova, "game", "decks", "player", "meu.ydk")),
                  "o deck do jogador foi junto");
            Checa(File.ReadAllText(Path.Combine(nova, "game", ".duelacademy", "game.version")) == "game-abc123",
                  "o marcador do instalador foi junto (senao o cliente rebaixaria 28 MB)");

            // Segunda chamada: nao ha' mais o que migrar.
            Checa(!Payload.MigrarInstalacaoAntiga(velha, nova), "chamar de novo nao faz nada");

            // E com as DUAS existindo, a nova manda — nada e' sobrescrito.
            string dir2 = Path.Combine(dir, "convivendo");
            string velha2 = Path.Combine(dir2, "DuelAcademy");
            string nova2 = Path.Combine(dir2, "ClassicDuels");
            Directory.CreateDirectory(Path.Combine(velha2, "game"));
            Directory.CreateDirectory(Path.Combine(nova2, "game"));
            File.WriteAllText(Path.Combine(velha2, "game", "quem.txt"), "antiga");
            File.WriteAllText(Path.Combine(nova2, "game", "quem.txt"), "nova");

            Checa(!Payload.MigrarInstalacaoAntiga(velha2, nova2),
                  "com a pasta nova ja' existindo, nao migra");
            Checa(File.ReadAllText(Path.Combine(nova2, "game", "quem.txt")) == "nova",
                  "e a instalacao nova fica intacta");
            Checa(Directory.Exists(velha2), "a antiga tambem nao e' apagada (nada se perde)");
        }

        /// <summary>
        /// A "atualização fantasma" (INSTALADOR-PENDENCIAS.md §1): quem baixava o
        /// `ClassicDuels.exe` pela primeira vez recebia, no primeiro boot, uma oferta
        /// de ~26 MB — do conteúdo que o próprio exe acabara de instalar.
        ///
        /// O exe embute `payload.zip` e o `Payload` o descompacta, mas quem grava
        /// os marcadores `.duelacademy/&lt;id&gt;.version` era só o `UpdateEngine`. Sem
        /// marcador, o diff conclui — corretamente, pelo que sabe — que os dois
        /// pacotes faltam. E não dá para calcular o marcador por fora: dois
        /// `CreateFromDirectory` sobre o mesmo conteúdo não produzem bytes iguais
        /// (o zip guarda o timestamp de cada entrada). A saída foi o `pack.ps1`
        /// EMBUTIR os zips publicados mais um `payload.markers` com as versões.
        ///
        /// Este caso monta o payload como o `pack.ps1` monta e prova as duas metades:
        /// com os marcadores, a instalação nova nasce em dia; sem eles, volta a
        /// pedir os dois pacotes — que é o bug, aqui preso numa asserção para não
        /// voltar em silêncio se alguém "simplificar" o empacotamento.
        /// </summary>
        static void InstalacaoNovaNaoOfereceAtualizacaoFantasma(string dir)
        {
            var (raiz, fonte) = Cenario(dir);
            string release = Path.Combine(dir, "release");
            var m = Manifest.Parse(File.ReadAllText(Path.Combine(release, "manifest.json")));

            string payload = Path.Combine(dir, "payload.zip");
            MontarPayload(payload, release, m, comMarcadores: true);

            using (var s = File.OpenRead(payload))
                Payload.Instalar(s, raiz);

            Checa(File.Exists(Path.Combine(raiz, "web", "index.html")),
                  "payload embutido instalou o front");
            Checa(File.Exists(Path.Combine(raiz, "ygo-data", "data", "cards.json")),
                  "payload embutido instalou o pacote pesado");
            Checa(File.ReadAllText(Path.Combine(raiz, "store", "banlist.json")).Contains("v1"),
                  "payload embutido instalou a semente (store/banlist.json)");

            var eng = NovaEngine(raiz, fonte);
            var plano = eng.Montar(eng.CarregarManifestoAsync().GetAwaiter().GetResult());
            Checa(plano.NadaAFazer,
                  "instalacao nova NAO oferece atualizacao nenhuma (sem fantasma)", plano.Resumo());

            // A outra metade: sem o payload.markers o bug volta. Se esta asserção
            // um dia falhar é porque o marcador passou a vir de outro lugar — e aí
            // a de cima passaria por acidente, não por estar certa.
            var (raiz2, fonte2) = Cenario(Path.Combine(dir, "sem-marcadores"));
            string release2 = Path.Combine(dir, "sem-marcadores", "release");
            var m2 = Manifest.Parse(File.ReadAllText(Path.Combine(release2, "manifest.json")));
            string payload2 = Path.Combine(dir, "payload-sem-marcadores.zip");
            MontarPayload(payload2, release2, m2, comMarcadores: false);

            using (var s = File.OpenRead(payload2))
                Payload.Instalar(s, raiz2);

            var eng2 = NovaEngine(raiz2, fonte2);
            var plano2 = eng2.Montar(eng2.CarregarManifestoAsync().GetAwaiter().GetResult());
            Checa(plano2.PayloadsPendentes.Count() == 2,
                  "sem o payload.markers, o fantasma reaparece (é o marcador que resolve)",
                  plano2.Resumo());
        }

        /// <summary>Monta um `payload.zip` no mesmo formato que o `tools/pack.ps1` gera.</summary>
        /// <summary>
        /// O MOTOR nao pode ser trocado por baixo de quem esta' jogando.
        ///
        /// Quem baixa a atualizacao e' o proprio motor, e nesse instante ele e a
        /// `ocgcore.dll` estao carregados — o Windows recusa sobrescrever DLL em
        /// uso, e mesmo que deixasse, trocar o codigo debaixo de um duelo em
        /// andamento e' pior que esperar. Entao o pacote cai em `.staged/` e a
        /// casca (`host/Estagio.cs`) aplica no boot seguinte.
        ///
        /// O par CONTROLE e' a segunda metade: sem pacote de motor no plano,
        /// `TrocaMotor` tem de ser falso — senao o jogo pediria para reabrir a
        /// cada atualizacao de front, que e' o oposto do que esta mudanca existe
        /// para fazer.
        /// </summary>
        static void MotorNovoFicaEmEstagio(string dir)
        {
            var (raiz, fonte) = Cenario(dir, comMotor: true);
            var eng = NovaEngine(raiz, fonte);
            var m = eng.CarregarManifestoAsync().GetAwaiter().GetResult();

            var plano = eng.Montar(m);
            Checa(plano.TrocaMotor, "o plano avisa que ha' troca de motor");

            eng.AplicarAsync(plano).GetAwaiter().GetResult();

            Checa(File.Exists(Path.Combine(raiz, ".staged", "engine", "DuelServer.Engine.dll")),
                  "o motor novo ficou em .staged/");
            Checa(!File.Exists(Path.Combine(raiz, "engine", "DuelServer.Engine.dll")),
                  "o motor EM USO nao foi tocado (quem troca e' a casca, no boot)");

            // Segunda checagem: o marcador do pacote foi gravado, entao nao ha'
            // o que fazer. Sem isso o jogo ofereceria a mesma atualizacao a cada
            // boot, e o jogador ficaria num laco de "reabrir para aplicar".
            var plano2 = eng.Montar(m);
            Checa(plano2.NadaAFazer, "depois de aplicado, nao ha' mais o que baixar");
            Checa(!plano2.TrocaMotor, "e nao ha' mais troca de motor pendente");

            // CONTROLE: o mesmo cenario sem o pacote do motor.
            var (raiz2, fonte2) = Cenario(Path.Combine(dir, "controle"));
            var eng2 = NovaEngine(raiz2, fonte2);
            var m2 = eng2.CarregarManifestoAsync().GetAwaiter().GetResult();
            Checa(!eng2.Montar(m2).TrocaMotor,
                  "atualizacao so' de front NAO pede para reabrir o jogo");
        }

        /// <summary>
        /// O EXECUTAVEL velho nao pode ficar congelado para sempre.
        ///
        /// Quem troca o exe e' o `UpdateService`, e ele so' e' chamado DENTRO do
        /// `Aplicar` — que so' roda quando o boot decide que ha' atualizacao, isto
        /// e', quando o plano nao diz `NadaAFazer`. Enquanto `NadaAFazer` olhava
        /// so' arquivos, pacotes e orfaos, bastava o CONTEUDO ficar em dia para o
        /// jogo dizer "tudo em dia" com um exe de duas versoes atras — e nunca
        /// mais oferecer a troca.
        ///
        /// Isso e' pior do que parece: um exe anterior a 0.15.0 nao aplica o
        /// pacote `engine` (ele cai em `.staged/`, e quem aplica e' a casca).
        /// Entao o motor congelava junto, para sempre, enquanto o front continuava
        /// chegando todo dia. Do lado de quem joga: "atualizei duas vezes e
        /// continuo com o cliente velho", sem nenhum erro em lugar nenhum.
        ///
        /// O par CONTROLE e' a outra metade: com o exe EM DIA e o conteudo em dia,
        /// `NadaAFazer` tem de continuar verdadeiro — senao a tela de atualizacao
        /// abriria a cada boot para nao fazer nada.
        /// </summary>
        static void ExeVelhoNaoFicaCongelado(string dir)
        {
            var (raiz, fonte) = Cenario(dir, comMotor: true);
            var eng = NovaEngine(raiz, fonte);
            var m = eng.CarregarManifestoAsync().GetAwaiter().GetResult();

            // Primeiro boot: instala o conteudo todo, com um exe VELHO (0.0.5).
            eng.AplicarAsync(eng.Montar(m, "0.0.5")).GetAwaiter().GetResult();

            // Segundo boot: o conteudo esta' em dia, o exe continua velho.
            var plano = eng.Montar(m, "0.0.5");
            Checa(plano.SemConteudo, "o conteudo ficou em dia (nao ha' arquivo a trocar)",
                  plano.Resumo());
            Checa(plano.InstaladorDesatualizado, "o plano ve' que o exe esta' velho");
            Checa(!plano.NadaAFazer,
                  "com o exe velho, o boot AINDA oferece atualizacao (era aqui que congelava)",
                  plano.Resumo());
            Checa(plano.Resumo().Contains("Classic Duels"),
                  "e a tela diz que o que falta e' o proprio executavel", plano.Resumo());
            Checa(plano.BytesTotais >= 66_000_000,
                  "o total prometido inclui os bytes do exe", $"{plano.BytesTotais} bytes");

            // Aplicar um plano so'-exe nao pode mexer em arquivo nenhum — nem
            // abrir uma pasta de backup vazia a cada boot. Quem baixa o exe e' o
            // UpdateService, DEPOIS desta chamada devolver true.
            string backups = Path.Combine(dir, "backups");
            bool tinhaBackup = Directory.Exists(backups);
            int antes = tinhaBackup ? Directory.GetDirectories(backups).Length : 0;

            Checa(eng.AplicarAsync(plano).GetAwaiter().GetResult(),
                  "aplicar um plano so'-exe termina bem");
            int depois = Directory.Exists(backups) ? Directory.GetDirectories(backups).Length : 0;
            Checa(depois == antes, "e nao criou pasta de backup nenhuma", $"{antes} -> {depois}");

            // CONTROLE: exe em dia, conteudo em dia. Nada a fazer de verdade.
            var emDia = eng.Montar(m, "0.1.0");
            Checa(emDia.NadaAFazer, "com o exe EM DIA, o boot nao oferece nada", emDia.Resumo());
            Checa(emDia.Resumo() == "tudo em dia", "e o resumo diz 'tudo em dia'", emDia.Resumo());
        }

        static void MontarPayload(string destino, string release, Manifest m, bool comMarcadores)
        {
            using var fs = File.Create(destino);
            using var zip = new ZipArchive(fs, ZipArchiveMode.Create);

            // TODOS os pacotes do manifesto, e nao uma lista escrita a mao: e'
            // assim que o pack.ps1 monta o payload de verdade. Com a lista fixa,
            // o dia em que um pacote novo apareceu (o `engine`, com o motor em
            // C#) a semente sairia sem ele — e a instalacao recem-feita ja'
            // ofereceria um download do que acabou de instalar.
            foreach (var pacote in m.Payloads)
            {
                string arquivo = Path.Combine(release, pacote.Asset ?? (pacote.Id + ".zip"));
                if (!File.Exists(arquivo)) continue;
                var e = zip.CreateEntry(Path.GetFileName(arquivo), CompressionLevel.NoCompression);
                using var saida = e.Open();
                using var origem = File.OpenRead(arquivo);
                origem.CopyTo(saida);
            }

            if (comMarcadores)
            {
                var e = zip.CreateEntry("payload.markers", CompressionLevel.Optimal);
                using var w = new StreamWriter(e.Open());
                foreach (var p in m.Payloads) w.WriteLine($"{p.Id}={p.Version}");
            }

            // A semente: o que os dois pacotes não trazem. TODO avulso do
            // manifesto precisa estar aqui — o que falta na semente vira
            // "atualização fantasma": a instalação recém-feita já oferece um
            // download na primeira checagem.
            foreach (var nome in new[] { "banlist.json", "cardlists.json" })
            {
                var seed = zip.CreateEntry($"seed/store/{nome}", CompressionLevel.Optimal);
                using var w = new StreamWriter(seed.Open());
                w.Write(File.ReadAllText(Path.Combine(release, nome)));
            }
        }

        /// <summary>
        /// `--test-release &lt;pasta&gt;` — instala um Release REAL (o que o
        /// `publish-release.ps1` acabou de gerar em `dist\release\`) numa raiz
        /// descartável do %TEMP% e confere que o re-scan fica vazio.
        ///
        /// O `--test-update` prova a ENGINE com zips de brinquedo; este prova os
        /// ARQUIVOS que você está prestes a publicar. São falhas diferentes: um
        /// `roots` errado ou um asset esquecido no manifesto passa liso pelo
        /// primeiro e só aparece na máquina do jogador.
        /// </summary>
        public static int RunRelease(string pastaRelease)
        {
            Log.Info($"=== teste: RELEASE REAL ({pastaRelease}) ===\n");

            if (!File.Exists(Path.Combine(pastaRelease, "manifest.json")))
            { Log.Err($"nao achei manifest.json em {pastaRelease}"); return 1; }

            string bancada = Path.Combine(Path.GetTempPath(),
                "duelacademy-test-release-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            string raiz = Path.Combine(bancada, "game");
            Directory.CreateDirectory(raiz);

            try
            {
                var fonte = new FonteLocal(pastaRelease);
                var eng = NovaEngine(raiz, fonte);
                var m = eng.CarregarManifestoAsync().GetAwaiter().GetResult();
                Checa(m != null, "manifesto do release carrega");
                if (m == null) return 1;

                var plano = eng.Montar(m);
                Log.Info($"  plano: {plano.Resumo()}");

                var relogio = System.Diagnostics.Stopwatch.StartNew();
                Checa(eng.AplicarAsync(plano).GetAwaiter().GetResult(), "instalacao completa");
                Log.Info($"  instalou em {relogio.Elapsed.TotalSeconds:0.0}s");

                // Os arquivos que o jogo REALMENTE precisa para bootar.
                Checa(File.Exists(Path.Combine(raiz, "web", "index.html")), "web/index.html presente");
                Checa(File.Exists(Path.Combine(raiz, "web", "duel.html")), "web/duel.html presente");
                Checa(File.Exists(Path.Combine(raiz, "ygo-data", "data", "cards.index.json")),
                      "ygo-data/data/cards.index.json presente");
                Checa(File.Exists(Path.Combine(raiz, "duel_academy", "Assets", "StreamingAssets",
                                               "YGODemo", "cards.cdb")), "cards.cdb presente");

                int luas = Directory.Exists(Path.Combine(raiz, "duel_academy", "Assets",
                                                         "StreamingAssets", "YGODemo", "script"))
                    ? Directory.GetFiles(Path.Combine(raiz, "duel_academy", "Assets", "StreamingAssets",
                                                      "YGODemo", "script"), "*.lua", SearchOption.AllDirectories).Length
                    : 0;
                Checa(luas > 20000, $"scripts lua instalados ({luas})");

                // Os tabuleiros nao viajavam, e o sintoma nao parecia falta de
                // arquivo: o duelo simplesmente abria no layout padrao, sem o
                // Bonus de Campo do adversario. Sem `boards/`, `/__boards/list`
                // volta vazio e o `duel.html` nao tem o que sobrepor.
                string tabuleiros = Path.Combine(raiz, "boards");
                int quantos = Directory.Exists(tabuleiros)
                    ? Directory.GetFiles(tabuleiros, "*.json").Length : 0;
                Checa(quantos > 0, $"boards/*.json instalados ({quantos})");

                var eng2 = NovaEngine(raiz, fonte);
                var plano2 = eng2.Montar(eng2.CarregarManifestoAsync().GetAwaiter().GetResult());
                Checa(plano2.NadaAFazer, "re-scan nao acha nada a fazer", plano2.Resumo());

                PayloadDestesArtefatosNasceEmDia(bancada, pastaRelease, m);
            }
            finally
            {
                try { if (Directory.Exists(bancada)) Directory.Delete(bancada, true); } catch { }
            }

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        /// <summary>
        /// A metade que o `--test-update` prova com zips de brinquedo, aqui com os
        /// 25 MB de verdade: monta o `payload.zip` como o `tools/pack.ps1` monta,
        /// instala pelo <see cref="Payload"/> e exige que o diff contra ESTE Release
        /// não peça nada.
        ///
        /// É o teste que teria pego a atualização fantasma antes de ela chegar ao
        /// primeiro jogador — e é o único ponto onde o formato do payload e o
        /// formato do manifesto se encontram sobre os arquivos reais. Um
        /// `pack.ps1` que volte a montar a própria árvore falha aqui, mesmo
        /// continuando a produzir um exe que abre e joga.
        /// </summary>
        static void PayloadDestesArtefatosNasceEmDia(string bancada, string pastaRelease, Manifest m)
        {
            string raiz = Path.Combine(bancada, "via-payload");
            Directory.CreateDirectory(raiz);
            string payload = Path.Combine(bancada, "payload.zip");

            var relogio = System.Diagnostics.Stopwatch.StartNew();
            MontarPayload(payload, pastaRelease, m, comMarcadores: true);
            using (var s = File.OpenRead(payload))
                Payload.Instalar(s, raiz);
            Log.Info($"  payload embutido instalou em {relogio.Elapsed.TotalSeconds:0.0}s");

            Checa(File.Exists(Path.Combine(raiz, "web", "duel.html")),
                  "payload: web/duel.html presente");
            Checa(File.Exists(Path.Combine(raiz, "duel_academy", "Assets", "StreamingAssets",
                                           "YGODemo", "cards.cdb")), "payload: cards.cdb presente");

            var eng = NovaEngine(raiz, new FonteLocal(pastaRelease));
            var plano = eng.Montar(eng.CarregarManifestoAsync().GetAwaiter().GetResult());

            // Os `files[]` avulsos (store/*.json) SÃO esperados aqui: o payload de
            // verdade os traz na semente, mas montar a semente inteira exigiria
            // reimplementar o pack.ps1 dentro do teste. O que importa é que os dois
            // PACOTES — os 25,7 MB — não sejam pedidos.
            Checa(!plano.PayloadsPendentes.Any(),
                  "instalado pelo payload, o Release nao pede pacote nenhum (sem fantasma)",
                  plano.Resumo());
        }

        /// <summary>
        /// `--test-remote` — instala o Release DE VERDADE, pela rede, com o token
        /// embutido. É o único teste que exercita as três armadilhas do repositório
        /// privado ao mesmo tempo (MECANISMO-INSTALADOR.md §4):
        ///
        ///   1. o endpoint da API do asset em vez do `browser_download_url` (que
        ///      ignora o token em repo privado e dá 404);
        ///   2. o header `Accept: application/octet-stream` (sem ele vem o JSON de
        ///      metadados, e o sintoma é um "sha256 não confere" sem explicação);
        ///   3. o redirect para o CDN, em que o HttpClient tira o Authorization —
        ///      comportamento correto, que quebraria se alguém "consertasse".
        ///
        /// O `--test-release` prova os arquivos; este prova o TRANSPORTE. Um
        /// Accept esquecido passa liso por todos os outros testes.
        /// </summary>
        public static int RunRemote()
        {
            Log.Info($"=== teste: RELEASE REMOTO ({BuildConfig.Owner}/{BuildConfig.Repo}) ===\n");

            Checa(BuildConfig.Token != null,
                  "token de distribuicao embutido no executavel",
                  "sem duel-server/token.txt nem DUELACADEMY_TOKEN — recompile com o token no lugar");

            string bancada = Path.Combine(Path.GetTempPath(),
                "duelacademy-test-remote-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            string raiz = Path.Combine(bancada, "game");
            Directory.CreateDirectory(raiz);

            try
            {
                var fonte = new FonteGitHub(BuildConfig.Owner, BuildConfig.Repo,
                                            BuildConfig.Tag, BuildConfig.Token);
                var eng = NovaEngine(raiz, fonte);

                var m = eng.CarregarManifestoAsync().GetAwaiter().GetResult();
                Checa(m != null, "manifest.json baixado do Release");
                if (m == null) return 1;
                Log.Info($"  versao publicada: {m.GameVersion}");

                var plano = eng.Montar(m);
                Log.Info($"  plano: {plano.Resumo()}");
                Checa(plano.PayloadsPendentes.Count() == 2, "instalacao limpa pede os 2 pacotes");

                var relogio = System.Diagnostics.Stopwatch.StartNew();
                Checa(eng.AplicarAsync(plano).GetAwaiter().GetResult(), "instalacao pela rede completa");
                Log.Info($"  baixou e instalou em {relogio.Elapsed.TotalSeconds:0.0}s");

                Checa(File.Exists(Path.Combine(raiz, "web", "index.html")), "web/index.html presente");
                Checa(File.Exists(Path.Combine(raiz, "ygo-data", "data", "cards.index.json")),
                      "ygo-data/data/cards.index.json presente");
                Checa(File.Exists(Path.Combine(raiz, "duel_academy", "Assets", "StreamingAssets",
                                               "YGODemo", "cards.cdb")), "cards.cdb presente");
                Checa(File.Exists(Path.Combine(raiz, "store", "banlist.json")),
                      "store/banlist.json (arquivo avulso) presente");

                // Se o Accept: octet-stream faltasse, o zip seria o JSON de
                // metadados do asset — o sha256 falharia antes daqui. Chegar
                // inteiro ate' a contagem dos lua e' a prova de que veio binario.
                string scripts = Path.Combine(raiz, "duel_academy", "Assets", "StreamingAssets",
                                              "YGODemo", "script");
                int luas = Directory.Exists(scripts)
                    ? Directory.GetFiles(scripts, "*.lua", SearchOption.AllDirectories).Length : 0;
                Checa(luas > 20000, $"scripts lua instalados ({luas})");

                var eng2 = NovaEngine(raiz, fonte);
                var plano2 = eng2.Montar(eng2.CarregarManifestoAsync().GetAwaiter().GetResult());
                Checa(plano2.NadaAFazer, "re-scan nao acha nada a fazer", plano2.Resumo());
            }
            catch (Exception e)
            {
                Falha("instalacao remota", e.Message);
            }
            finally
            {
                try { if (Directory.Exists(bancada)) Directory.Delete(bancada, true); } catch { }
            }

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------- a bancada

        static string Sub(string bancada, string nome)
        {
            string d = Path.Combine(bancada, nome);
            Directory.CreateDirectory(d);
            return d;
        }

        static UpdateEngine NovaEngine(string raiz, FonteDeAssets fonte)
        {
            string pai = Path.GetDirectoryName(raiz);
            return new UpdateEngine(raiz, fonte,
                onProgresso: _ => { },                       // silencioso no teste
                pastaBackups: Path.Combine(pai, "backups"),
                arquivoCache: Path.Combine(pai, "cache", "hashes.tsv"));
        }

        /// <summary>Monta uma raiz de instalação vazia + um Release falso ao lado dela.</summary>
        static (string raiz, FonteDeAssets fonte) Cenario(
            string dir, bool zipMalicioso = false, bool zipComDadoDeConta = false,
            bool comMotor = false)
        {
            string raiz = Path.Combine(dir, "game");
            string release = Path.Combine(dir, "release");
            Directory.CreateDirectory(raiz);
            Directory.CreateDirectory(release);

            // --- pacote 'game': o front, leve e volátil
            var game = new Dictionary<string, string>
            {
                ["web/index.html"] = "<h1>Classic Duels</h1>",
                ["web/js/deck.js"] = "// regras de construcao",
                ["ygo-data/src/ygodb.js"] = "// api de consulta",
                // De propósito na MESMA pasta que o pacote 'cards' usa: é a
                // sobreposição de raízes que quebrou de verdade (ver
                // RaizesSobrepostasNaoSeApagam).
                ["ygo-data/data/cards.index.json"] = "[]",
                // Tabuleiro que VEM no pacote. Ele e o de baixo (criado pelo
                // jogador) tem destinos opostos numa atualizacao, e e' isso que
                // TabuleiroDoJogadorSobrevive prova.
                ["boards/oficial.json"] = "{\"name\":\"Oficial\"}"
            };
            if (zipMalicioso) game["../FUGIU.txt"] = "escapei da raiz";
            if (zipComDadoDeConta)
            {
                game["store/users/joao/wallet.json"] = "{\"dp\":0}";
                game["decks/users/joao/player/meu.ydk"] = "#zerado";
            }
            string zipGame = Path.Combine(release, "game.zip");
            CriarZip(zipGame, game);

            // --- pacote 'cards': o pesado e estável
            var cards = new Dictionary<string, string>
            {
                ["ygo-data/data/cards.json"] = "[{\"id\":46986414,\"name\":\"Dark Magician\"}]",
                ["duel_academy/Assets/StreamingAssets/YGODemo/script/c46986414.lua"] = "-- lua"
            };
            string zipCards = Path.Combine(release, "cards.zip");
            CriarZip(zipCards, cards);

            // --- pacote 'engine': o MOTOR em C#, que nao pode ser trocado com o
            // jogo aberto (a ocgcore.dll esta carregada). Ele cai em `.staged/` e
            // a casca aplica no boot seguinte. So' entra quando o caso pede, para
            // nao mudar a conta dos outros testes.
            string zipEngine = null;
            if (comMotor)
            {
                zipEngine = Path.Combine(release, "engine.zip");
                CriarZip(zipEngine, new Dictionary<string, string>
                {
                    [".staged/engine/DuelServer.Engine.dll"] = "sou o motor NOVO"
                });
            }

            // --- arquivos avulsos: conteúdo GLOBAL do jogo
            string banlist = Path.Combine(release, "banlist.json");
            File.WriteAllText(banlist, "{\"listId\":\"lista1\",\"v\":\"v1\"}");
            // O pool permitido (editor web/listas.html). Mora em store/, que é
            // intocável por padrão, então precisa estar na lista de globais —
            // sem isso o manifesto o carrega e o cliente o recusa em silêncio.
            string cardlists = Path.Combine(release, "cardlists.json");
            File.WriteAllText(cardlists, "{\"listas\":[{\"id\":\"lista1\",\"tipos\":[],\"ids\":[1]}]}");

            var m = new Manifest
            {
                GameVersion = "teste-1",
                DisplayName = "Classic Duels",
                // O `Size` importa: e' ele que faz o exe aparecer no total que a
                // tela promete ao jogador (ver ExeVelhoNaoFicaCongelado).
                Installer = new InstaladorInfo
                {
                    Version = "0.1.0", Asset = "ClassicDuels.exe", Size = 66_000_000
                },
                ManagedRoots = new List<RaizGerenciada>
                {
                    new() { Path = "web", RemoveMode = "backup" },
                    new() { Path = "ygo-data", RemoveMode = "keep" }
                },
                // 'game' e 'cards' dividem ygo-data/data de propósito.
                Files = new List<ArquivoManifesto>
                {
                    new()
                    {
                        Path = "store/banlist.json", Asset = "banlist.json",
                        Sha256 = HashCache.Computar(banlist),
                        Size = new FileInfo(banlist).Length
                    },
                    new()
                    {
                        Path = "store/cardlists.json", Asset = "cardlists.json",
                        Sha256 = HashCache.Computar(cardlists),
                        Size = new FileInfo(cardlists).Length
                    }
                },
                Payloads = new List<PayloadManifesto>
                {
                    NovoPayload("game", zipGame, "web", "ygo-data/src", "ygo-data/data"),
                    NovoPayload("cards", zipCards, "ygo-data/data",
                                "duel_academy/Assets/StreamingAssets/YGODemo")
                }
            };
            if (comMotor) m.Payloads.Add(NovoPayload("engine", zipEngine, ".staged/engine"));

            // sem BOM, de propósito — é o que o publish-release.ps1 faz
            File.WriteAllText(Path.Combine(release, "manifest.json"), m.ToJson(),
                              new UTF8Encoding(false));

            return (raiz, new FonteLocal(release));
        }

        static PayloadManifesto NovoPayload(string id, string zip, params string[] roots)
        {
            string sha = HashCache.Computar(zip);
            return new PayloadManifesto
            {
                Id = id,
                Asset = Path.GetFileName(zip),
                Sha256 = sha,
                Size = new FileInfo(zip).Length,
                Version = $"{id}-{sha.Substring(0, 12)}",
                Roots = roots.ToList()
            };
        }

        static void CriarZip(string caminho, Dictionary<string, string> conteudo)
        {
            using var fs = File.Create(caminho);
            using var zip = new ZipArchive(fs, ZipArchiveMode.Create);
            foreach (var kv in conteudo)
            {
                var e = zip.CreateEntry(kv.Key, CompressionLevel.Optimal);
                using var w = new StreamWriter(e.Open());
                w.Write(kv.Value);
            }
        }
    }
}
