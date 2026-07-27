#!/usr/bin/env python3
"""
Gerador do banco local de dados de Yu-Gi-Oh!.

Le o cards.cdb e os scripts .lua extraidos do ygopro (pasta StreamingAssets do
projeto Unity) e emite um dataset decodificado, pronto para ser consumido por
uma aplicacao web sem Unity, sem ocgcore.dll e sem SQLite.

As constantes NAO sao hardcoded: elas sao parseadas de constant.lua e de
archetype_setcode_constants.lua, que sao a fonte de verdade do proprio motor.

Uso:
    python tools/build.py [--source <pasta YGODemo>] [--out <pasta data>]

Requer apenas a stdlib do Python 3.
"""

import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)

DEFAULT_SOURCE = os.path.normpath(os.path.join(
    PROJECT, "..", "duel_academy", "Assets", "StreamingAssets", "YGODemo"))
DEFAULT_OUT = os.path.join(PROJECT, "data")

# Valor sentinela do ygopro para ATK/DEF "?"
UNKNOWN_STAT = -2


# ---------------------------------------------------------------------------
# Parsing das constantes direto do Lua (fonte de verdade do motor)
# ---------------------------------------------------------------------------

CONST_RE = re.compile(
    r"^([A-Z][A-Z0-9_]*)\s*=\s*(0x[0-9a-fA-F]+|\d+)\s*(?:--.*)?$", re.M)


def parse_lua_constants(path):
    """Extrai `NOME = <numero>` de um arquivo .lua. Ignora expressoes (A|B)."""
    with open(path, encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    out = {}
    for name, raw in CONST_RE.findall(text):
        out[name] = int(raw, 16) if raw.lower().startswith("0x") else int(raw)
    return out


def group_by_prefix(constants, prefix):
    """Retorna {valor: sufixo} para constantes com um dado prefixo.

    Descarta valores que nao sao potencia de dois (agregados como
    TYPE_EXTRA ou RACE_ALL) para que a decodificacao de flags fique limpa.
    """
    out = {}
    for name, value in constants.items():
        if not name.startswith(prefix + "_"):
            continue
        if value <= 0 or (value & (value - 1)) != 0:
            continue  # nao e' bit unico
        out[value] = name[len(prefix) + 1:]
    return out


# ---------------------------------------------------------------------------
# Rotulos legiveis
# ---------------------------------------------------------------------------

RACE_LABELS = {
    "WARRIOR": "Warrior", "SPELLCASTER": "Spellcaster", "FAIRY": "Fairy",
    "FIEND": "Fiend", "ZOMBIE": "Zombie", "MACHINE": "Machine", "AQUA": "Aqua",
    "PYRO": "Pyro", "ROCK": "Rock", "WINGEDBEAST": "Winged Beast",
    "PLANT": "Plant", "INSECT": "Insect", "THUNDER": "Thunder",
    "DRAGON": "Dragon", "BEAST": "Beast", "BEASTWARRIOR": "Beast-Warrior",
    "DINOSAUR": "Dinosaur", "FISH": "Fish", "SEASERPENT": "Sea Serpent",
    "REPTILE": "Reptile", "PSYCHIC": "Psychic", "DIVINE": "Divine-Beast",
    "CREATORGOD": "Creator God", "WYRM": "Wyrm", "CYBERSE": "Cyberse",
    "ILLUSION": "Illusion", "CYBORG": "Cyborg",
    "MAGICALKNIGHT": "Magical Knight", "HIGHDRAGON": "High Dragon",
    "OMEGAPSYCHIC": "Omega Psychic", "CELESTIALWARRIOR": "Celestial Warrior",
    "GALAXY": "Galaxy", "YOKAI": "Yokai",
}

ATTRIBUTE_LABELS = {
    "EARTH": "EARTH", "WATER": "WATER", "FIRE": "FIRE", "WIND": "WIND",
    "LIGHT": "LIGHT", "DARK": "DARK", "DIVINE": "DIVINE",
}

# Ordem canonica em que os subtipos de monstro aparecem no card text
MONSTER_TYPE_ORDER = [
    "RITUAL", "FUSION", "SYNCHRO", "XYZ", "LINK", "PENDULUM", "MAXIMUM",
    "TOON", "SPIRIT", "UNION", "GEMINI", "FLIP", "TUNER", "NORMAL", "EFFECT",
]
MONSTER_TYPE_LABELS = {
    "RITUAL": "Ritual", "FUSION": "Fusion", "SYNCHRO": "Synchro", "XYZ": "Xyz",
    "LINK": "Link", "PENDULUM": "Pendulum", "MAXIMUM": "Maximum",
    "TOON": "Toon", "SPIRIT": "Spirit", "UNION": "Union", "GEMINI": "Gemini",
    "FLIP": "Flip", "TUNER": "Tuner", "NORMAL": "Normal", "EFFECT": "Effect",
}

SPELL_SUBTYPE_LABELS = [
    ("QUICKPLAY", "Quick-Play"), ("CONTINUOUS", "Continuous"),
    ("EQUIP", "Equip"), ("FIELD", "Field"), ("RITUAL", "Ritual"),
]
TRAP_SUBTYPE_LABELS = [("COUNTER", "Counter"), ("CONTINUOUS", "Continuous")]

# Ordem visual dos link markers (grid 3x3, de cima para baixo)
LINK_MARKER_ORDER = [
    "TOP_LEFT", "TOP", "TOP_RIGHT", "LEFT", "RIGHT",
    "BOTTOM_LEFT", "BOTTOM", "BOTTOM_RIGHT",
]
LINK_MARKER_LABELS = {
    "TOP_LEFT": "↖", "TOP": "↑", "TOP_RIGHT": "↗", "LEFT": "←",
    "RIGHT": "→", "BOTTOM_LEFT": "↙", "BOTTOM": "↓", "BOTTOM_RIGHT": "↘",
}


def archetype_label(const_name):
    """SET_BLUE_EYES -> 'Blue-Eyes' nao e' recuperavel; usa Title Case simples."""
    return const_name.replace("_", " ").title()


def decode_flags(value, table):
    """Retorna a lista de nomes de flags ativas em `value`."""
    return [name for bit, name in sorted(table.items()) if value & bit]


# ---------------------------------------------------------------------------
# Decodificacao de uma carta
# ---------------------------------------------------------------------------

def build_type_label(type_flags, TYPE):
    if "MONSTER" in type_flags:
        parts = [MONSTER_TYPE_LABELS[t] for t in MONSTER_TYPE_ORDER
                 if t in type_flags]
        if not parts:
            parts = ["Normal"]
        return "/".join(parts) + " Monster"
    if "SPELL" in type_flags:
        for flag, label in SPELL_SUBTYPE_LABELS:
            if flag in type_flags:
                return f"{label} Spell"
        return "Normal Spell"
    if "TRAP" in type_flags:
        for flag, label in TRAP_SUBTYPE_LABELS:
            if flag in type_flags:
                return f"{label} Trap"
        return "Normal Trap"
    return "Unknown"


def decode_card(row, tables, archetypes, script_index):
    (cid, ot, alias, setcode, ctype, atk, cdef, level, race, attribute,
     category, name, *strs) = row

    TYPE = tables["TYPE"]
    type_flags = decode_flags(ctype, TYPE)
    is_monster = "MONSTER" in type_flags
    is_link = "LINK" in type_flags
    is_pendulum = "PENDULUM" in type_flags
    is_xyz = "XYZ" in type_flags

    desc = strs[0]
    extra_strings = [s for s in strs[1:] if s]

    # --- nivel / rank / rating + escalas de pendulo ---------------------
    lvl = level & 0xFF
    if is_link:
        level_label = "Link"
    elif is_xyz:
        level_label = "Rank"
    else:
        level_label = "Level"

    scales = None
    if is_pendulum:
        # Convencao do ygopro: lscale nos bits 24-31, rscale nos bits 16-23.
        # Neste dataset as duas escalas sao sempre iguais, entao a ordem nao
        # e' observavel aqui — mantida a convencao do motor.
        scales = {"left": (level >> 24) & 0xFF, "right": (level >> 16) & 0xFF}

    # --- link markers: ficam no campo `def` de monstros Link -------------
    link_markers = None
    real_def = cdef
    if is_link:
        flags = decode_flags(cdef, tables["LINK_MARKER"])
        link_markers = [m for m in LINK_MARKER_ORDER if m in flags]
        real_def = None  # monstro Link nao tem DEF

    # --- arquetipos (setcode empacota ate 4 codigos de 16 bits) ----------
    card_archetypes = []
    for i in range(4):
        part = (setcode >> (16 * i)) & 0xFFFF
        if part:
            card_archetypes.append({
                "code": part,
                "hex": f"0x{part:x}",
                "name": archetypes.get(part),
            })

    legal = []
    if ot & 0x1:
        legal.append("OCG")
    if ot & 0x2:
        legal.append("TCG")

    if is_monster:
        card_type = "Monster"
    elif "SPELL" in type_flags:
        card_type = "Spell"
    elif "TRAP" in type_flags:
        card_type = "Trap"
    else:
        card_type = "Unknown"

    script_path = script_index.get(cid)

    card = {
        "id": cid,
        "name": name,
        "desc": desc,
        "cardType": card_type,
        "typeLabel": build_type_label(type_flags, TYPE),
        "types": type_flags,
        "typeRaw": ctype,
        "legal": legal,
        "otRaw": ot,
        "alias": alias,
        "isAlternateArt": alias != 0,
        "archetypes": card_archetypes,
        "categories": decode_flags(category, tables["CATEGORY"]),
        "categoryRaw": category,
        "hasScript": script_path is not None,
        "script": script_path,
    }

    if is_monster:
        card.update({
            "atk": atk,
            "atkLabel": "?" if atk == UNKNOWN_STAT else str(atk),
            "def": real_def,
            "defLabel": (None if real_def is None else
                         ("?" if real_def == UNKNOWN_STAT else str(real_def))),
            "level": lvl,
            "levelLabel": level_label,
            "attribute": (decode_flags(attribute, tables["ATTRIBUTE"]) or [None])[0],
            "race": next((RACE_LABELS.get(r, r.title())
                          for r in decode_flags(race, tables["RACE"])), None),
            "raceRaw": race,
            "attributeRaw": attribute,
            "scales": scales,
            "linkMarkers": link_markers,
            "linkArrows": ([LINK_MARKER_LABELS[m] for m in link_markers]
                           if link_markers else None),
        })

    if extra_strings:
        card["strings"] = extra_strings

    return card


# ---------------------------------------------------------------------------
# Copia dos scripts Lua
# ---------------------------------------------------------------------------

def copy_scripts(source, out_dir):
    """Copia os .lua oficiais + utilitarios da raiz. Retorna (index, stats)."""
    src_script = os.path.join(source, "script")
    dst_root = os.path.join(out_dir, "scripts")

    if os.path.isdir(dst_root):
        shutil.rmtree(dst_root)
    os.makedirs(os.path.join(dst_root, "official"), exist_ok=True)
    os.makedirs(os.path.join(dst_root, "core"), exist_ok=True)

    index = {}
    n_official = 0
    src_official = os.path.join(src_script, "official")
    if os.path.isdir(src_official):
        for fname in os.listdir(src_official):
            if not fname.endswith(".lua"):
                continue
            shutil.copy2(os.path.join(src_official, fname),
                         os.path.join(dst_root, "official", fname))
            n_official += 1
            m = re.fullmatch(r"c(\d+)\.lua", fname)
            if m:
                index[int(m.group(1))] = f"scripts/official/{fname}"

    core_files = []
    for fname in sorted(os.listdir(src_script)):
        full = os.path.join(src_script, fname)
        if os.path.isfile(full) and fname.endswith(".lua"):
            shutil.copy2(full, os.path.join(dst_root, "core", fname))
            core_files.append(fname)

    # COPYING.txt: licenca dos scripts, vem junto
    copying = os.path.join(src_script, "COPYING.txt")
    if os.path.isfile(copying):
        shutil.copy2(copying, os.path.join(dst_root, "COPYING.txt"))

    return index, {"official": n_official, "core": len(core_files),
                   "coreFiles": core_files}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def write_json(path, payload, compact=False):
    with open(path, "w", encoding="utf-8") as fh:
        if compact:
            json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(payload, fh, ensure_ascii=False, indent=1)
    return os.path.getsize(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=DEFAULT_SOURCE,
                    help="pasta YGODemo (contem cards.cdb e script/)")
    ap.add_argument("--out", default=DEFAULT_OUT, help="pasta de saida")
    ap.add_argument("--skip-scripts", action="store_true",
                    help="nao copia os arquivos .lua")
    args = ap.parse_args()

    source = os.path.abspath(args.source)
    out_dir = os.path.abspath(args.out)
    cdb = os.path.join(source, "cards.cdb")

    if not os.path.isfile(cdb):
        sys.exit(f"ERRO: cards.cdb nao encontrado em {source}")

    os.makedirs(out_dir, exist_ok=True)
    print(f"origem : {source}")
    print(f"destino: {out_dir}\n")

    # --- 1. constantes -------------------------------------------------
    script_dir = os.path.join(source, "script")
    constants = parse_lua_constants(os.path.join(script_dir, "constant.lua"))
    tables = {p: group_by_prefix(constants, p) for p in
              ("TYPE", "RACE", "ATTRIBUTE", "CATEGORY", "LINK_MARKER",
               "LOCATION", "POS", "PHASE", "REASON")}
    print(f"[1/6] constant.lua        -> {len(constants)} constantes, "
          f"{sum(len(v) for v in tables.values())} flags em "
          f"{len(tables)} grupos")

    # --- 2. arquetipos --------------------------------------------------
    arch_path = os.path.join(script_dir, "archetype_setcode_constants.lua")
    archetypes = {}
    if os.path.isfile(arch_path):
        for name, value in parse_lua_constants(arch_path).items():
            if name.startswith("SET_"):
                archetypes[value] = archetype_label(name[4:])
    print(f"[2/6] arquetipos          -> {len(archetypes)} setcodes nomeados")

    # --- 3. scripts lua -------------------------------------------------
    if args.skip_scripts:
        # Nao recopia os .lua, mas reaproveita o indice ja gerado antes para
        # nao perder a associacao carta -> script.
        prev = os.path.join(out_dir, "scripts.index.json")
        script_index = {}
        if os.path.isfile(prev):
            with open(prev, encoding="utf-8") as fh:
                script_index = {int(k): v for k, v in json.load(fh).items()}
        script_stats = {"official": 0, "core": 0, "coreFiles": [],
                        "reusedIndex": len(script_index)}
        print(f"[3/6] scripts lua         -> pulado, indice reaproveitado "
              f"({len(script_index)} entradas)")
    else:
        script_index, script_stats = copy_scripts(source, out_dir)
        print(f"[3/6] scripts lua         -> {script_stats['official']} oficiais "
              f"+ {script_stats['core']} utilitarios copiados")

    # --- 4. cartas ------------------------------------------------------
    db = sqlite3.connect(cdb)
    cur = db.cursor()
    rows = cur.execute("""
        SELECT d.id, d.ot, d.alias, d.setcode, d.type, d.atk, d.def, d.level,
               d.race, d.attribute, d.category,
               t.name, t.desc,
               t.str1,  t.str2,  t.str3,  t.str4,  t.str5,  t.str6,
               t.str7,  t.str8,  t.str9,  t.str10, t.str11, t.str12,
               t.str13, t.str14, t.str15, t.str16
        FROM datas d JOIN texts t ON t.id = d.id
        ORDER BY d.id
    """).fetchall()

    cards = [decode_card(r, tables, archetypes, script_index) for r in rows]
    db.close()
    print(f"[4/6] cards.cdb           -> {len(cards)} cartas decodificadas")

    # --- 5. arquivos de saida -------------------------------------------
    shutil.copy2(cdb, os.path.join(out_dir, "cards.cdb"))

    size_full = write_json(os.path.join(out_dir, "cards.json"), cards)

    # Indice enxuto: o suficiente para listar, buscar e filtrar no browser
    index = [{
        "id": c["id"],
        "name": c["name"],
        "t": c["cardType"][0],           # M / S / T
        "tl": c["typeLabel"],
        "atk": c.get("atk"),
        "def": c.get("def"),
        "lv": c.get("level"),
        "at": c.get("attribute"),
        "r": c.get("race"),
        "a": [a["name"] or a["hex"] for a in c["archetypes"]],
        # arte alternativa: mesmo nome, id diferente, sem script proprio.
        # A UI normalmente deve esconder essas para nao duplicar a listagem.
        "alt": 1 if c["isAlternateArt"] else 0,
    } for c in cards]
    size_index = write_json(os.path.join(out_dir, "cards.index.json"),
                            index, compact=True)

    size_const = write_json(os.path.join(out_dir, "constants.json"), {
        "raw": constants,
        "flags": {k: {str(bit): nm for bit, nm in v.items()}
                  for k, v in tables.items()},
    })
    write_json(os.path.join(out_dir, "archetypes.json"),
               {str(k): v for k, v in sorted(archetypes.items())})
    write_json(os.path.join(out_dir, "scripts.index.json"),
               {str(k): v for k, v in sorted(script_index.items())},
               compact=True)

    # --- 6. metadados ---------------------------------------------------
    by_type = {}
    for c in cards:
        by_type[c["cardType"]] = by_type.get(c["cardType"], 0) + 1

    meta = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "path": source,
            "note": "cards.cdb e scripts .lua extraidos do ygopro/ocgcore "
                    "(edo9300), via projeto Unity duel_academy",
        },
        "counts": {
            "cards": len(cards),
            "byCardType": by_type,
            "withScript": sum(1 for c in cards if c["hasScript"]),
            "alternateArt": sum(1 for c in cards if c["isAlternateArt"]),
            "archetypesNamed": len(archetypes),
            "scripts": script_stats,
        },
        "language": "en",
        "files": {
            "cards.json": "dataset completo decodificado",
            "cards.index.json": "indice enxuto para busca no browser",
            "constants.json": "constantes do motor (parseadas de constant.lua)",
            "archetypes.json": "setcode -> nome do arquetipo",
            "scripts.index.json": "id da carta -> caminho do script lua",
            "cards.cdb": "SQLite original, intocado",
        },
    }
    write_json(os.path.join(out_dir, "meta.json"), meta)

    print(f"[5/6] arquivos escritos")
    print(f"[6/6] pronto\n")
    print(f"  cards.json        {human(size_full)}")
    print(f"  cards.index.json  {human(size_index)}")
    print(f"  constants.json    {human(size_const)}")
    print(f"  cards.cdb         {human(os.path.getsize(cdb))}")
    print(f"\n  cartas: {len(cards)}  ({by_type})")
    print(f"  com script lua: {meta['counts']['withScript']}")


if __name__ == "__main__":
    main()
