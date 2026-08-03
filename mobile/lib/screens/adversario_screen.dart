import 'package:flutter/material.dart';
import '../api/api_client.dart';
import '../api/game_repository.dart';
import '../models/npc.dart';
import '../models/card_db.dart';
import 'duel_screen.dart';

/// Escolher o adversário e disparar o duelo — espelha `web/adversario.html`,
/// organizado por campanha (mesma regra: sem campanha nenhuma cadastrada,
/// cai numa seção "Sem campanha" pra não sumir da tela).
class AdversarioScreen extends StatefulWidget {
  final ApiClient api;
  final CardDb cardDb;
  const AdversarioScreen({super.key, required this.api, required this.cardDb});

  @override
  State<AdversarioScreen> createState() => _AdversarioScreenState();
}

class _AdversarioScreenState extends State<AdversarioScreen> {
  late final GameRepository _repo = GameRepository(widget.api);
  List<Npc>? _npcs;
  List<SavedDeck>? _playerDecks;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final npcs = await _repo.loadNpcs(force: true);
      final decks = await _repo.playerDecks(force: true);
      setState(() {
        _npcs = npcs;
        _playerDecks = decks;
      });
    } catch (e) {
      setState(() => _error = 'não consegui falar com o servidor: $e');
    }
  }

  Future<void> _escolherAdversario(Npc npc) async {
    if (_playerDecks == null || _playerDecks!.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('você não tem nenhum deck salvo (monte um no PC primeiro)')),
      );
      return;
    }
    final npcDeck = await _repo.npcDeck(npc.id);
    if (!mounted) return;
    if (npcDeck == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${npc.name} ainda não tem deck montado')),
      );
      return;
    }

    SavedDeck? chosen = _playerDecks!.length == 1 ? _playerDecks!.first : null;
    chosen ??= await showModalBottomSheet<SavedDeck>(
      context: context,
      builder: (ctx) => ListView(
        shrinkWrap: true,
        children: _playerDecks!
            .map((d) => ListTile(
                  title: Text(d.deck.name),
                  subtitle: Text('Main ${d.deck.main.length} · Extra ${d.deck.extra.length}'),
                  onTap: () => Navigator.of(ctx).pop(d),
                ))
            .toList(),
      ),
    );
    if (chosen == null || !mounted) return;

    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => DuelScreen(
        api: widget.api,
        cardDb: widget.cardDb,
        playerDeck: chosen!.deck,
        npc: npc,
        npcDeck: npcDeck.deck,
      ),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Adversário'), actions: [
        IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
      ]),
      body: _error != null
          ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!, textAlign: TextAlign.center)))
          : _npcs == null
              ? const Center(child: CircularProgressIndicator())
              : _buildList(),
    );
  }

  Widget _buildList() {
    final campanhas = <String>[];
    for (final n in _npcs!) {
      if (n.campaign != null && n.campaign!.isNotEmpty && !campanhas.contains(n.campaign)) {
        campanhas.add(n.campaign!);
      }
    }
    final soltos = _npcs!.where((n) => n.campaign == null || n.campaign!.isEmpty).toList();

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          for (final camp in campanhas) ..._section(camp, _npcs!.where((n) => n.campaign == camp).toList()),
          if (soltos.isNotEmpty) ..._section('Sem campanha', soltos),
        ],
      ),
    );
  }

  List<Widget> _section(String title, List<Npc> npcs) => [
        Padding(
          padding: const EdgeInsets.only(top: 8, bottom: 6),
          child: Text(title, style: const TextStyle(color: Color(0xFFE8C46A), fontWeight: FontWeight.bold, letterSpacing: 1)),
        ),
        ...npcs.map(_npcCard),
        const SizedBox(height: 10),
      ];

  Widget _npcCard(Npc npc) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        title: Text(npc.name),
        subtitle: Text(npc.theme),
        trailing: FilledButton(onPressed: () => _escolherAdversario(npc), child: const Text('duelar')),
      ),
    );
  }
}
