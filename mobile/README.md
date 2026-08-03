# mobile/ — Duel Academy no celular

App Flutter **cliente fino** do `duel-server` — não reimplementa NENHUMA
regra de duelo. Fala o mesmo protocolo RPC (`POST /start`, `POST /respond`)
que `web/duel.html` já usa, e lê os mesmos dados (`ygo-data/`, `decks/`,
`store/npcs.json`) direto do servidor pela rede. `web/` continua existindo
exatamente como estava — este app é uma segunda "casca" por cima da mesma
engine, não uma reescrita.

## Por que cliente fino (e não o motor rodando no celular)

O `ocgcore` (o motor de verdade) só existe como DLL nativa **Windows x64**
(`duel-server/native/ocgcore.dll`). Recompilar isso pra Android/iOS seria um
projeto C++ à parte, arriscado e fora do escopo desta entrega. Em vez disso,
o duel-server continua rodando no PC — o celular só manda toques e desenha o
que volta.

## Pré-requisito no PC: ligar o servidor pra rede (`--lan`)

Por padrão o `duel-server` só aceita `localhost` (ninguém de fora alcança —
proteção de propósito). Pra o celular enxergar:

```bash
# executável empacotado (o mesmo de sempre, só com --lan a mais)
duel-academy.exe --app --lan

# rodando do repositório (dev)
cd duel-server && dotnet run -- --app --lan
```

O console imprime os IPs da rede local, tipo:

```
--lan ligado: escutando em todas as interfaces de rede.
  no app mobile, servidor: 192.168.0.10:8770
```

Esse é o endereço que você digita nas **Configurações** do app.

**Só na primeira vez**, o Windows pode recusar escutar em todas as
interfaces sem uma reserva de URL (erro "Acesso negado"). Resolve com UM
comando, num terminal **como administrador**.

No **PowerShell** (padrão do Windows 10/11 — `%USERNAME%` é sintaxe de
`cmd.exe` e não expande aqui; usar isso dá "Falha ao criar SDDL. Erro: 1332"):

```powershell
netsh http add urlacl url=http://+:8770/ user=$env:USERNAME
netsh http add urlacl url=http://+:8080/ user=$env:USERNAME
```

Se mesmo assim der erro de SDDL, tenta com o nome qualificado pela máquina:

```powershell
netsh http add urlacl url=http://+:8770/ user="$env:COMPUTERNAME\$env:USERNAME"
netsh http add urlacl url=http://+:8080/ user="$env:COMPUTERNAME\$env:USERNAME"
```

No **cmd.exe** (`%USERNAME%` funciona normalmente):

```bat
netsh http add urlacl url=http://+:8770/ user=%USERNAME%
netsh http add urlacl url=http://+:8080/ user=%USERNAME%
```

Se mesmo assim der erro 1332 de novo ("Falha ao criar SDDL"), a resolução de
nome do `netsh` pode estar quebrando — pula ela de vez com o SDDL pronto
(troque o SID pelo seu, `([System.Security.Principal.WindowsIdentity]::
GetCurrent()).User.Value`; **as aspas em volta do `sddl=...` são
obrigatórias no PowerShell**, senão ele tenta interpretar os parênteses):

```powershell
netsh http add urlacl url=http://+:8770/ "sddl=D:(A;;GX;;;SEU-SID-AQUI)"
netsh http add urlacl url=http://+:8080/ "sddl=D:(A;;GX;;;SEU-SID-AQUI)"
```

Sem `--lan`, nada muda: o jogo no PC continua exatamente como sempre foi
(só localhost).

### Firewall do Windows

Além da reserva de URL acima, o **Firewall do Windows** também precisa
liberar a entrada nas portas — sem isso o servidor sobe normalmente, mas
ninguém de fora alcança (timeout, não "recusado"). Num terminal
administrador:

```powershell
New-NetFirewallRule -DisplayName "Duel Academy (8770 RPC)" -Direction Inbound -Protocol TCP -LocalPort 8770 -Profile Domain,Private,Public -Action Allow
New-NetFirewallRule -DisplayName "Duel Academy (8080 front)" -Direction Inbound -Protocol TCP -LocalPort 8080 -Profile Domain,Private,Public -Action Allow
```

Testado restringir a regra por programa (`-Program "caminho\do\duel-server.exe"`,
mais preciso — só aquele executável recebe conexão) mas o Firewall do
Windows seguiu **dropando** o tráfego mesmo com o caminho batendo
exatamente (visto no log, `netsh advfirewall set allprofiles logging
droppedconnections enable` + ler
`C:\Windows\System32\LogFiles\Firewall\pfirewall.log`) — parece uma
limitação/bug do motor de correspondência por programa. Regra só por porta,
sem `-Program`, é o que funciona de verdade hoje.

Se tiver **outro firewall/antivírus** instalado (Kaspersky, Norton, etc.),
ele pode ter o PRÓPRIO firewall, separado do Windows — `New-NetFirewallRule`
não mexe nele. Sintoma: tudo acima parece certo, mas a conexão do celular
ainda não chega. Precisa liberar a exceção dentro das configurações
daquele programa também (ou desativar o firewall dele).

### Leitura sim, escrita não

`/__decks/*` e `/__store/*` (que hoje só aceitavam localhost) agora liberam
**GET** de qualquer IP da rede — é o que deixa o app listar os NPCs e ler
decks salvos. **POST continua bloqueado fora do PC** (`StaticServer.cs`) —
criar NPC, montar/editar deck ou mexer na banlist continua exclusivo do PC.
O celular só duela com o que já existe.

## O que o app faz hoje (v1)

- Configurar o servidor (IP:porta, testar conexão).
- **Adversário**: lista os NPCs (fixos + customizados, agrupados por
  campanha — mesmo `web/adversario.html`), escolhe um dos SEUS decks
  salvos, dispara o duelo.
- **Duelo**: mão, campo (monstro + magia/armadilha dos dois lados, LP),
  e toda a interação real — invocar, setar, atacar, corrente, posição,
  sim/não, seleção de alvo/tributo. A zona onde uma carta cai é sempre a
  primeira livre (sem escolher manualmente — tela pequena demais pra isso).

## O que NÃO está aqui (de propósito, por enquanto)

- Deck Builder, Booster Builder, Loja, Inventário, editor de NPC/banlist/
  tabuleiro — tudo isso continua sendo trabalho de PC (`web/`). O celular é
  só **jogar**, não **montar**.
- Nenhum layout de tabuleiro customizado (`web/campo.html`) — o campo no
  celular é sempre o layout padrão simplificado.
- Efeitos com texto de escolha (`SELECT_OPTION`) aparecem como "Opção 1/2/3"
  — o motor não manda o texto, só os ids (mesma limitação que `AutoPass` já
  tinha no `duel-server`).

## Rodar em desenvolvimento

```bash
cd mobile
flutter pub get
flutter run                 # dispositivo/emulador conectado
flutter run -d chrome        # rápido, só pra ver a UI (o duel-server precisa
                              # estar acessível pelo navegador também)
```

## Estrutura

```
mobile/lib/
  config/server_config.dart   IP:porta persistido (shared_preferences)
  api/api_client.dart         POST /start,/respond · GET /__decks,/__store
  api/game_repository.dart    junta NPCs + decks salvos
  models/                     ydk.dart (parser .ydk), npc.dart, card_db.dart,
                               duel_state.dart (reconstrói o tabuleiro dos eventos)
  screens/                    settings, home, adversario, duel
  widgets/card_thumb.dart     miniatura de carta (mesmo CDN do ygoprodeck.com)
```
