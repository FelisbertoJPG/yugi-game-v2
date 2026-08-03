import 'package:flutter/material.dart';
import '../api/api_client.dart';
import '../models/card_db.dart';
import '../models/duel_state.dart';
import '../models/npc.dart';
import '../models/ydk.dart';
import '../widgets/card_thumb.dart';

/// A tela do duelo — cliente fino do MESMO protocolo RPC que `web/duel.html`
/// usa (`/start`, `/respond`). Nenhuma regra mora aqui: cada toque manda uma
/// ação pro servidor e a tela só redesenha o que ele mandar de volta.
///
/// Simplificações de propósito (v1, tela pequena): a zona (`place`) é
/// sempre a primeira livre — sem escolher manualmente onde a carta cai — e
/// não existe layout de tabuleiro customizado (isso é só do editor de campo
/// no PC). O resto (invocar, atacar, corrente, seleção, sim/não) é real.
class DuelScreen extends StatefulWidget {
  final ApiClient api;
  final CardDb cardDb;
  final ParsedDeck playerDeck;
  final Npc npc;
  final ParsedDeck npcDeck;

  const DuelScreen({
    super.key,
    required this.api,
    required this.cardDb,
    required this.playerDeck,
    required this.npc,
    required this.npcDeck,
  });

  @override
  State<DuelScreen> createState() => _DuelScreenState();
}

class _DuelScreenState extends State<DuelScreen> {
  final DuelState state = DuelState();
  Map<String, dynamic>? question;
  bool loading = true;
  String? error;
  final Set<int> _selected = {};
  final List<Map<String, dynamic>> _pickedIncremental = [];

  @override
  void initState() {
    super.initState();
    _start();
  }

  Future<void> _start() async {
    try {
      final r = await widget.api.start(
        deck: widget.playerDeck.main,
        extra: widget.playerDeck.extra,
        npcDeck: widget.npcDeck.main,
        npcExtra: widget.npcDeck.extra,
      );
      await _consume(r);
    } catch (e) {
      setState(() {
        error = '$e';
        loading = false;
      });
    }
  }

  Future<void> _consume(Map<String, dynamic> r) async {
    final events = (r['events'] as List?) ?? const [];
    state.applyEvents(events);
    final q = r['question'] as Map<String, dynamic>?;
    final ended = r['ended'] == true;

    if (ended || q == null) {
      setState(() {
        question = null;
        loading = false;
      });
      return;
    }

    // "place" nunca vira tela: sempre a primeira zona livre.
    if (q['kind'] == 'place') {
      final zones = ((q['zones'] as List?) ?? const []).map((z) => (z as num).toInt()).toList();
      final zone = zones.isNotEmpty ? zones.first : 0;
      final next = await widget.api.respond('place', arg: zone);
      return _consume(next);
    }

    _selected.clear();
    _pickedIncremental.clear();
    setState(() {
      question = q;
      loading = false;
    });
  }

  Future<void> _respond(String action, {int arg = 0, List<int>? args}) async {
    setState(() => loading = true);
    try {
      final r = await widget.api.respond(action, arg: arg, args: args);
      await _consume(r);
    } catch (e) {
      setState(() {
        error = '$e';
        loading = false;
      });
    }
  }

  List<Map<String, dynamic>> _acts(String key) =>
      ((question?[key] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();

  List<Map<String, dynamic>> _choices() =>
      ((question?['choices'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();

  // ---------------------------------------------------------------- ações

  void _onTapHand(int code) {
    if (question?['kind'] != 'idle') return;
    final opcoes = <(String, String, int)>[];
    for (final (key, label, action) in const [
      ('summonable', 'Invocar', 'summon'),
      ('spSummonable', 'Invocação Especial', 'spsummon'),
      ('settable', 'Setar (monstro)', 'setmonster'),
      ('settableST', 'Setar (magia/armadilha)', 'setspell'),
      ('activatable', 'Ativar', 'activate'),
    ]) {
      final act = _acts(key).where((a) => a['location'] == 2 && a['code'] == code);
      if (act.isNotEmpty) opcoes.add((label, action, act.first['index'] as int));
    }
    if (opcoes.isEmpty) return;
    if (opcoes.length == 1) {
      _respond(opcoes.first.$2, arg: opcoes.first.$3);
      return;
    }
    _showSheet(opcoes.map((o) => ListTile(title: Text(o.$1), onTap: () {
          Navigator.of(context).pop();
          _respond(o.$2, arg: o.$3);
        })).toList());
  }

  void _onTapField({required bool mine, required bool monster, required int seq}) {
    final kind = question?['kind'];
    final loc = monster ? 4 : 8;
    if (kind == 'battle' && mine) {
      final atk = _acts('attackers').where((a) => a['location'] == loc && a['sequence'] == seq);
      if (atk.isNotEmpty) {
        _respond('attack', arg: atk.first['index'] as int);
        return;
      }
      final act = _acts('activatable').where((a) => a['location'] == loc && a['sequence'] == seq);
      if (act.isNotEmpty) _respond('battleactivate', arg: act.first['index'] as int);
      return;
    }
    if (kind != 'idle' || !mine) return;
    final opcoes = <(String, String, int)>[];
    final repo = _acts('repositionable').where((a) => a['location'] == loc && a['sequence'] == seq);
    if (repo.isNotEmpty) opcoes.add(('Mudar posição', 'reposition', repo.first['index'] as int));
    final act = _acts('activatable').where((a) => a['location'] == loc && a['sequence'] == seq);
    if (act.isNotEmpty) opcoes.add(('Ativar', 'activate', act.first['index'] as int));
    if (opcoes.isEmpty) return;
    if (opcoes.length == 1) {
      _respond(opcoes.first.$2, arg: opcoes.first.$3);
      return;
    }
    _showSheet(opcoes.map((o) => ListTile(title: Text(o.$1), onTap: () {
          Navigator.of(context).pop();
          _respond(o.$2, arg: o.$3);
        })).toList());
  }

  void _showSheet(List<Widget> children) {
    showModalBottomSheet(context: context, builder: (_) => ListView(shrinkWrap: true, children: children));
  }

  Future<void> _position() async {
    final mask = (question!['posMask'] as num).toInt();
    final podeAtaque = (mask & 0x1) != 0;
    final podeDefesa = (mask & 0x4) != 0;
    if (podeAtaque && !podeDefesa) return _respond('position', arg: 0x1);
    if (podeDefesa && !podeAtaque) return _respond('position', arg: 0x4);
    final escolha = await showDialog<int>(
      context: context,
      barrierDismissible: false,
      builder: (_) => AlertDialog(
        title: const Text('Posição'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(0x1), child: const Text('Ataque')),
          TextButton(onPressed: () => Navigator.of(context).pop(0x4), child: const Text('Defesa')),
        ],
      ),
    );
    if (escolha != null) _respond('position', arg: escolha);
  }

  Future<void> _yesno() async {
    final ok = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => AlertDialog(
        title: const Text('Ativar efeito?'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Não')),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Sim')),
        ],
      ),
    );
    _respond('yesno', arg: (ok ?? false) ? 1 : 0);
  }

  // ---------------------------------------------------------------- build

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('vs ${widget.npc.name}')),
      body: error != null
          ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!)))
          : Column(
              children: [
                _lpBar(),
                Expanded(child: _board()),
                _log(),
                _handRow(),
                _actionBar(),
              ],
            ),
    );
  }

  Widget _lpBar() => Container(
        padding: const EdgeInsets.all(8),
        color: const Color(0xFF1A2032),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('Você: ${state.lp0} LP', style: const TextStyle(color: Color(0xFF6FCE9F), fontWeight: FontWeight.bold)),
            if (loading) const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
            Text('${widget.npc.name}: ${state.lp1} LP', style: const TextStyle(color: Color(0xFFE2707A), fontWeight: FontWeight.bold)),
          ],
        ),
      );

  Widget _board() {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        children: [
          _zoneRow(mine: false, monster: false, count: 6),
          const SizedBox(height: 4),
          _zoneRow(mine: false, monster: true, count: 5),
          const Divider(height: 18),
          _zoneRow(mine: true, monster: true, count: 5),
          const SizedBox(height: 4),
          _zoneRow(mine: true, monster: false, count: 6),
        ],
      ),
    );
  }

  Widget _zoneRow({required bool mine, required bool monster, required int count}) {
    final map = monster ? (mine ? state.monster0 : state.monster1) : (mine ? state.spell0 : state.spell1);
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List.generate(count, (seq) {
        final c = map[seq];
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 2),
          child: GestureDetector(
            onTap: () => _onTapField(mine: mine, monster: monster, seq: seq),
            child: c == null
                ? Container(
                    width: 40,
                    height: 40 * 86 / 59,
                    decoration: BoxDecoration(border: Border.all(color: const Color(0xFF38425F)), color: const Color(0xFF121724)),
                    child: seq == 5 && !monster ? const Icon(Icons.terrain, size: 14, color: Color(0xFF444C63)) : null,
                  )
                : CardThumb(code: c.faceDown ? 0 : c.code, width: 40),
          ),
        );
      }),
    );
  }

  Widget _log() {
    if (state.log.isEmpty) return const SizedBox.shrink();
    final last = state.log.reversed.take(3).toList().reversed;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      color: const Color(0xFF0F1420),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [for (final l in last) Text(l, style: const TextStyle(fontSize: 10, color: Colors.white54))],
      ),
    );
  }

  Widget _handRow() {
    return Container(
      height: 78,
      color: const Color(0xFF16273A),
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
        children: state.hand0
            .map((code) => Padding(
                  padding: const EdgeInsets.only(right: 4),
                  child: CardThumb(code: code, width: 44, onTap: () => _onTapHand(code)),
                ))
            .toList(),
      ),
    );
  }

  Widget _actionBar() {
    final kind = question?['kind'];
    if (question == null) {
      return Padding(
        padding: const EdgeInsets.all(12),
        child: Text(state.ended
            ? (state.winner == 0 ? 'Você venceu!' : state.winner == 1 ? 'Você perdeu.' : 'Fim de duelo.')
            : 'aguardando…'),
      );
    }
    switch (kind) {
      case 'idle':
        return Padding(
          padding: const EdgeInsets.all(8),
          child: Wrap(spacing: 8, children: [
            if (question!['canBattle'] == true)
              FilledButton(onPressed: () => _respond('battle'), child: const Text('Batalha')),
            OutlinedButton(onPressed: () => _respond('endturn'), child: const Text('Encerrar turno')),
          ]),
        );
      case 'battle':
        return Padding(
          padding: const EdgeInsets.all(8),
          child: Wrap(spacing: 8, children: [
            OutlinedButton(onPressed: () => _respond('endbattle'), child: const Text('Encerrar combate')),
          ]),
        );
      case 'position':
        WidgetsBinding.instance.addPostFrameCallback((_) => _position());
        return const Padding(padding: EdgeInsets.all(12), child: Text('escolhendo posição…'));
      case 'yesno':
        WidgetsBinding.instance.addPostFrameCallback((_) => _yesno());
        return const Padding(padding: EdgeInsets.all(12), child: Text('efeito opcional…'));
      case 'chain':
        return _chainBar();
      case 'selectcard':
      case 'selecttribute':
      case 'selectsum':
        return _selectBar();
      case 'selectunselect':
        return _selectUnselectBar();
      case 'option':
        return _optionBar();
      default:
        return Padding(
          padding: const EdgeInsets.all(12),
          child: Text('pergunta não suportada neste app: ${kind ?? '?'}'),
        );
    }
  }

  Widget _chainBar() {
    final choices = _choices();
    return Padding(
      padding: const EdgeInsets.all(8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Ativar em resposta?', style: TextStyle(color: Colors.white70, fontSize: 12)),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            children: [
              ...choices.map((c) => ActionChip(
                    label: Text(widget.cardDb.nameOf(c['code'] as int)),
                    onPressed: () => _respond('chain', arg: c['index'] as int),
                  )),
              if (question!['chainForced'] != true)
                ActionChip(label: const Text('não ativar'), onPressed: () => _respond('chain', arg: -1)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _optionBar() {
    final options = ((question!['options'] as List?) ?? const []);
    return Padding(
      padding: const EdgeInsets.all(8),
      child: Wrap(
        spacing: 6,
        children: List.generate(options.length, (i) => ActionChip(
              label: Text('Opção ${i + 1}'),
              onPressed: () => _respond('option', arg: i),
            )),
      ),
    );
  }

  Widget _selectBar() {
    final choices = _choices();
    final selMin = (question!['selMin'] as num?)?.toInt() ?? 1;
    final selMax = (question!['selMax'] as num?)?.toInt() ?? 1;
    return Padding(
      padding: const EdgeInsets.all(8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('escolha $selMin a $selMax', style: const TextStyle(color: Colors.white70, fontSize: 12)),
          const SizedBox(height: 6),
          SizedBox(
            height: 70,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: choices.map((c) {
                final idx = c['index'] as int;
                final sel = _selected.contains(idx);
                return Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: CardThumb(
                    code: (c['code'] as num).toInt(),
                    width: 44,
                    selected: sel,
                    onTap: () => setState(() {
                      if (sel) {
                        _selected.remove(idx);
                      } else if (_selected.length < selMax) {
                        _selected.add(idx);
                      }
                    }),
                  ),
                );
              }).toList(),
            ),
          ),
          const SizedBox(height: 6),
          FilledButton(
            onPressed: _selected.length >= selMin ? () => _respond('select', args: _selected.toList()) : null,
            child: const Text('confirmar'),
          ),
        ],
      ),
    );
  }

  Widget _selectUnselectBar() {
    final choices = _choices();
    final canFinish = question!['canFinish'] == true;
    return Padding(
      padding: const EdgeInsets.all(8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            height: 70,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: choices
                  .map((c) => Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: CardThumb(code: (c['code'] as num).toInt(), width: 44, onTap: () => _respond('pick', arg: c['index'] as int)),
                      ))
                  .toList(),
            ),
          ),
          if (canFinish)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: OutlinedButton(onPressed: () => _respond('finishselect'), child: const Text('concluir')),
            ),
        ],
      ),
    );
  }
}
