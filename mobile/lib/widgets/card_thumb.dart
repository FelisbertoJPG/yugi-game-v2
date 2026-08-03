import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../models/card_db.dart';

/// Miniatura de carta — mesma proporção 59:86 usada no web (`.thumb`), arte
/// do mesmo CDN (ygoprodeck.com). `code == 0` = carta oculta (do oponente).
class CardThumb extends StatelessWidget {
  final int code;
  final double width;
  final VoidCallback? onTap;
  final bool selected;
  final bool small;

  const CardThumb({
    super.key,
    required this.code,
    this.width = 56,
    this.onTap,
    this.selected = false,
    this.small = true,
  });

  @override
  Widget build(BuildContext context) {
    final h = width * 86 / 59;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: width,
        height: h,
        decoration: BoxDecoration(
          color: const Color(0xFF121724),
          border: Border.all(color: selected ? const Color(0xFFE8C46A) : const Color(0xFF38425F), width: selected ? 2 : 1),
        ),
        clipBehavior: Clip.hardEdge,
        child: code == 0
            ? const Center(
                child: Icon(Icons.help_outline, color: Color(0xFF8B95AE), size: 18),
              )
            : CachedNetworkImage(
                imageUrl: CardDb.artUrl(code, small: small),
                fit: BoxFit.cover,
                placeholder: (c, u) => const Center(
                  child: SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
                errorWidget: (c, u, e) => const Center(child: Icon(Icons.broken_image, size: 16, color: Colors.white24)),
              ),
      ),
    );
  }
}
