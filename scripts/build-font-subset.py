#!/usr/bin/env python3
"""Regenerate the content-derived Space Grotesk variable-font subset."""

from __future__ import annotations

import subprocess
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "fonts" / "SpaceGrotesk[wght].woff2"
OUTPUT = ROOT / "src" / "assets" / "space-grotesk-subset.woff2"


def extracted_characters() -> str:
    result = subprocess.run(
        ["node", "scripts/font-glyphs.mjs", "--characters"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


def main() -> None:
    characters = extracted_characters()
    font = TTFont(SOURCE, recalcTimestamp=False)
    cmap = font.getBestCmap()
    missing = [character for character in characters if ord(character) not in cmap]
    if missing:
        raise RuntimeError(f"source font is missing extracted character(s): {missing!r}")

    # The site only uses 400–700. Trimming the unused 300–399 variation space
    # before glyph subsetting keeps one variable file without shipping deltas
    # the CSS can never select.
    instantiateVariableFont(font, {"wght": (400, 700)}, inplace=True)

    options = subset.Options()
    options.flavor = "woff2"
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]

    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text=characters)
    subsetter.subset(font)

    font.flavor = "woff2"
    font.save(OUTPUT, reorderTables=True)

    subprocess.run(
        ["node", "scripts/font-glyphs.mjs", "--write"],
        cwd=ROOT,
        check=True,
    )
    print(f"wrote {OUTPUT} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
