/// Reconstrói o tabuleiro a partir dos eventos que `duel-server` manda —
/// mesmo protocolo que `web/duel.html` consome (ver `ocgcore-protocolo` nas
/// memórias do projeto). Nenhuma regra mora aqui, só contabilidade de "o que
/// está em que zona agora", pra desenhar a tela.
class FieldCard {
  final int code; // 0 = carta oculta (do oponente, virada)
  final int pos;
  FieldCard(this.code, this.pos);

  bool get faceDown => (pos & 0xa) != 0; // 0x2 (atk virada, raro) | 0x8 (def virada = Set)
  bool get defense => (pos & 0xc) != 0; // 0x4 (def) | 0x8 (def virada)
}

class DuelState {
  static const locDeck = 0x1, locHand = 0x2, locMzone = 0x4, locSzone = 0x8, locGrave = 0x10, locExtra = 0x40;

  int lp0 = 8000, lp1 = 8000;
  final List<int> hand0 = [];
  int handCount1 = 0;
  final Map<int, FieldCard> monster0 = {}, monster1 = {};
  final Map<int, FieldCard> spell0 = {}, spell1 = {}; // seq 5 = zona de campo
  int grave0 = 0, grave1 = 0;
  int extra0 = 0, extra1 = 0;
  int turnPlayer = 0;
  bool ended = false;
  int? winner;
  final List<String> log = [];

  void applyEvents(List<dynamic> events) {
    for (final raw in events) {
      final m = Map<String, dynamic>.from(raw as Map);
      switch (m['type']) {
        case 'lp':
          final p = m['player'] as int;
          final lp = (m['lp'] as num).toInt();
          if (p == 0) {
            lp0 = lp;
          } else {
            lp1 = lp;
          }
          break;
        case 'move':
          _applyMove(m);
          break;
        case 'draw':
          final p = m['player'] as int;
          final n = (m['cards'] as List).length;
          if (p == 0) {
            hand0.addAll((m['cards'] as List).map((c) => (c as num).toInt()));
          } else {
            handCount1 += n;
          }
          break;
        case 'turn':
          turnPlayer = m['player'] as int;
          log.add(turnPlayer == 0 ? '— seu turno —' : '— turno do adversário —');
          break;
        case 'end':
          ended = true;
          winner = m['winner'] == null ? null : (m['winner'] as num).toInt();
          log.add(ended ? (winner == 0 ? 'Você venceu!' : winner == 1 ? 'Você perdeu.' : 'Empate.') : '');
          break;
        case 'npc':
          log.add('IA: ${m['action']} — ${m['why'] ?? ''}');
          break;
        case 'coin':
          log.add('moeda: ${(m['results'] as List).join(', ')}');
          break;
      }
    }
  }

  void _applyMove(Map<String, dynamic> m) {
    final code = (m['code'] as num).toInt();
    final fromLoc = (m['fromLoc'] as num).toInt();
    final fromSeq = (m['fromSeq'] as num).toInt();
    final fromCtrl = (m['fromCtrl'] as num).toInt();
    final loc = (m['loc'] as num).toInt();
    final seq = (m['seq'] as num).toInt();
    final ctrl = (m['controller'] as num).toInt();
    final pos = (m['pos'] as num).toInt();

    if (fromLoc != 0) _removeFrom(fromCtrl, fromLoc, fromSeq, code);
    _addTo(ctrl, loc, seq, code, pos);
  }

  void _removeFrom(int ctrl, int loc, int seq, int code) {
    switch (loc) {
      case locHand:
        if (ctrl == 0) {
          hand0.remove(code);
        } else if (handCount1 > 0) {
          handCount1--;
        }
        break;
      case locMzone:
        (ctrl == 0 ? monster0 : monster1).remove(seq);
        break;
      case locSzone:
        (ctrl == 0 ? spell0 : spell1).remove(seq);
        break;
      case locGrave:
        if (ctrl == 0) {
          if (grave0 > 0) grave0--;
        } else if (grave1 > 0) {
          grave1--;
        }
        break;
      case locExtra:
        if (ctrl == 0) {
          if (extra0 > 0) extra0--;
        } else if (extra1 > 0) {
          extra1--;
        }
        break;
    }
  }

  void _addTo(int ctrl, int loc, int seq, int code, int pos) {
    switch (loc) {
      case locHand:
        if (ctrl == 0) hand0.add(code);
        break;
      case locMzone:
        (ctrl == 0 ? monster0 : monster1)[seq] = FieldCard(code, pos);
        break;
      case locSzone:
        (ctrl == 0 ? spell0 : spell1)[seq] = FieldCard(code, pos);
        break;
      case locGrave:
        if (ctrl == 0) {
          grave0++;
        } else {
          grave1++;
        }
        break;
      case locExtra:
        if (ctrl == 0) {
          extra0++;
        } else {
          extra1++;
        }
        break;
    }
  }
}
