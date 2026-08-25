using System;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// **Quando o jogo se fecha sozinho** — `--test-vivo`.
    ///
    /// O `ClassicDuels.exe` deixou de abrir janela de terminal (23/08/2026), e era
    /// ela o botão de fechar: dizia "DEIXE ESTA JANELA ABERTA" e fechá-la
    /// encerrava o servidor. Quem diz agora que o jogo está na tela é a batida das
    /// páginas (`web/js/vivo.js` → `POST /__vivo`), e o servidor se encerra depois
    /// de <see cref="WebServer.JANELA_VIVO"/> sem nenhuma.
    ///
    /// A decisão erra CALADA nas duas direções, e é por isso que ela mora numa
    /// função sozinha em vez de dentro do relógio:
    ///
    ///   • cedo demais — o jogo se fecha na cara de quem está jogando, sem erro
    ///     nenhum, e quem testar clicando não vai ver (só quem ficar parado numa
    ///     tela um pouco mais);
    ///   • tarde demais, ou nunca — fica um processo INVISÍVEL segurando a porta e
    ///     o `cards.cdb`, que é exatamente o defeito que tirar o terminal poderia
    ///     ter criado.
    ///
    /// O caso do BOOT é o que mais importa aqui: entre subir o servidor e o
    /// navegador terminar de abrir passam segundos (mais a checagem de
    /// atualização, que tem 8s de timeout). Um relógio que começasse a contar do
    /// zero encerraria o jogo antes de ele aparecer.
    /// </summary>
    public static class TestVivo
    {
        static int _pass, _fail;

        static void Check(string oque, bool ok, string detalhe = "")
        {
            if (ok) { Log.Info($"  OK    {oque}"); _pass++; }
            else { Log.Err($"  FALHA {oque} {detalhe}"); _fail++; }
        }

        public static int Run()
        {
            Log.Info("=== quando o jogo se fecha sozinho ===\n");

            var janela = WebServer.JANELA_VIVO;
            var agora = new DateTime(2026, 8, 23, 20, 0, 0, DateTimeKind.Utc);

            // O BOOT. Ninguem bateu ainda — e isso NAO e' "faz muito tempo que nao
            // batem". Sem esta distincao o jogo se encerraria antes de aparecer.
            Check("ninguem bateu ainda (boot): NAO encerra",
                  !WebServer.DeveEncerrar(DateTime.MinValue, agora, janela),
                  "(o jogo se fecharia entre subir o servidor e o navegador abrir)");

            // ...e continua nao encerrando por mais que o boot demore. A checagem
            // de atualizacao sozinha tem 8s de timeout, e um Release grande passa
            // disso.
            Check("boot demorado (5 minutos sem ninguem): ainda NAO encerra",
                  !WebServer.DeveEncerrar(DateTime.MinValue, agora.AddMinutes(5), janela));

            // Jogando: a batida acabou de chegar.
            Check("batida agora: NAO encerra",
                  !WebServer.DeveEncerrar(agora, agora, janela));

            // Uma batida perdida nao pode fechar o jogo — e' por isso que a janela
            // cabe tres batidas.
            Check("uma batida atrasada (metade da janela): NAO encerra",
                  !WebServer.DeveEncerrar(agora, agora + janela / 2, janela),
                  "(um pacote perdido, ou uma navegacao entre telas, encerraria o jogo)");

            // A janela inteira sem nada: a janela do navegador fechou.
            Check("a janela inteira sem batida: ENCERRA",
                  WebServer.DeveEncerrar(agora, agora + janela, janela),
                  "(o processo ficaria invisivel segurando a porta e o cards.cdb)");

            Check("bem depois da janela: ENCERRA",
                  WebServer.DeveEncerrar(agora, agora + janela + TimeSpan.FromMinutes(1), janela));

            // O relogio do sistema pode andar para tras (ajuste de horario, NTP).
            // Uma batida "no futuro" nao pode virar encerramento.
            Check("batida no futuro (relogio ajustado): NAO encerra",
                  !WebServer.DeveEncerrar(agora + TimeSpan.FromMinutes(1), agora, janela));

            // E a janela em si: um numero que caiba menos de tres batidas de 5s
            // deixaria um pacote perdido fechar o jogo. `web/js/vivo.test.mjs`
            // guarda o outro lado do par (ele LE' esta constante do fonte).
            Check($"a janela ({janela.TotalSeconds:0}s) cabe pelo menos 3 batidas de 5s",
                  janela.TotalSeconds >= 15);

            // ---- a PAGINA OCULTA (o jogo minimizado) ----
            //
            // O navegador ESTRANGULA `setInterval` em pagina oculta: o Chrome
            // derruba para cerca de uma batida por minuto. Com os 15s valendo ali,
            // minimizar o jogo por um minuto o encerraria — e o jogador voltaria
            // para uma janela morta sem ter fechado nada. Era o pior defeito
            // possivel deste mecanismo, e o mais facil de nao ver: quem testa
            // minimiza por dois segundos.
            var oculta = WebServer.JANELA_VIVO_OCULTO;
            Check($"a janela oculta ({oculta.TotalMinutes:0} min) cabe varias batidas de 1/minuto",
                  oculta.TotalMinutes >= 5,
                  "(minimizar o jogo o encerraria)");

            Check("minimizado por 2 minutos: NAO encerra",
                  !WebServer.DeveEncerrar(agora, agora.AddMinutes(2), oculta),
                  "(e' exatamente o que uma batida estrangulada produz)");

            // Mas ela nao pode ser eterna: o navegador MORTO enquanto minimizado
            // nao manda `pagehide`, e sem um teto o processo invisivel ficaria de
            // pe' para sempre segurando a porta.
            Check("mas oculto nao e' para sempre: passada a janela, ENCERRA",
                  WebServer.DeveEncerrar(agora, agora + oculta, oculta));

            // E o par CONTROLE: a janela CURTA continua curta. Se as duas fossem
            // iguais, fechar o jogo custaria dez minutos de processo invisivel.
            Check("par CONTROLE: com a pagina VISIVEL a janela continua a curta",
                  janela < oculta && WebServer.DeveEncerrar(agora, agora.AddMinutes(1), janela),
                  "(fechar o jogo deixaria um processo invisivel por minutos)");

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }
    }
}
