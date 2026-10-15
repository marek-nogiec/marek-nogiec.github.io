#!/usr/bin/env python3
"""Build or verify the Space Grotesk subset from the static content catalog."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "src" / "content" / "en.json"
SOURCE = ROOT / "fonts" / "SpaceGrotesk[wght].woff2"
OUTPUT = ROOT / "src" / "assets" / "space-grotesk-subset.woff2"
MANIFEST = ROOT / "fonts" / "space-grotesk-subset.json"
FONT_LICENSE = ROOT / "fonts" / "OFL.txt"
RETAINED_NAME_IDS = (0, 1, 2, 3, 4, 5, 6, 13, 14)
REQUIRED_LICENSE_NAME_IDS = frozenset((0, 13, 14))

# Only these semantic fields render in Space Grotesk. Everything else uses
# system monospace or exists only in document metadata. This replaces the old
# HTML parser, CSS selector inference, and DOM-family tracking.
SPACE_FONT_FIELDS = (
    ("hero", "name"),
    ("hero", "subtitle"),
    ("hero", "bio"),
    ("projects", "dropcast", "title"),
    ("projects", "dropcast", "description"),
    ("projects", "barkley", "title"),
    ("projects", "barkley", "description"),
    ("symbols", "arrow"),
)

# Space Grotesk 2.0 has no U+2011 or U+2318 mapping. The Wi‑Fi hyphen and the
# ⌘ key symbol therefore use the sans-serif fallback; descriptions sit on fixed
# 32px line boxes, so the fallback glyphs cannot change layout.
INTENTIONAL_FALLBACKS = frozenset("‑⌘")


def load_content() -> dict[str, Any]:
    return json.loads(CONTENT.read_text(encoding="utf-8"))


def value_at(content: dict[str, Any], path: tuple[str, ...]) -> str:
    value: Any = content
    for key in path:
        value = value[key]
    if not isinstance(value, str):
        raise TypeError(f"font field {'.'.join(path)} must be a string")
    return value


def extracted_characters() -> tuple[str, str]:
    content = load_content()
    text = " ".join(value_at(content, path) for path in SPACE_FONT_FIELDS)
    characters = "".join(sorted(
        set(text) - INTENTIONAL_FALLBACKS,
        key=ord,
    ))
    fallbacks = "".join(sorted(set(text) & INTENTIONAL_FALLBACKS, key=ord))
    return characters, fallbacks


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def current_manifest() -> dict[str, Any]:
    characters, fallbacks = extracted_characters()
    return {
        "family": "Space Grotesk",
        "source": {
            "version": "2.0.0",
            "url": "https://github.com/floriankarsten/space-grotesk/releases/tag/2.0.0",
            "sha256": sha256(SOURCE),
            "license": "OFL-1.1",
            "licenseFile": "fonts/OFL.txt",
            "licenseSha256": sha256(FONT_LICENSE),
        },
        "subset": {
            "weights": "400 700",
            "format": "woff2",
            "bytes": OUTPUT.stat().st_size,
            "sha256": sha256(OUTPUT),
            "retainedNameIds": list(RETAINED_NAME_IDS),
        },
        "fallbackCharacters": fallbacks,
        "characters": characters,
        "codepoints": [f"U+{ord(character):04X}" for character in characters],
    }


def verify() -> None:
    expected = json.loads(MANIFEST.read_text(encoding="utf-8"))
    actual = current_manifest()
    if actual != expected:
        raise RuntimeError(
            "Space Grotesk content or font artifact changed; install "
            "requirements-fonts.txt and run `npm run fonts:build`"
        )
    print(
        f"font subset verified ({len(actual['characters'])} subset characters, "
        f"{actual['subset']['bytes']} bytes)"
    )


def build() -> None:
    # FontTools is deliberately needed only for regeneration. Routine builds
    # and CI verification use Python's standard library.
    from fontTools import subset
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont

    characters, _ = extracted_characters()
    font = TTFont(SOURCE, recalcTimestamp=False)
    cmap = font.getBestCmap()
    missing = [character for character in characters if ord(character) not in cmap]
    if missing:
        raise RuntimeError(f"source font is missing extracted character(s): {missing!r}")

    # The site only uses 400–700. Trim the unused 300–399 variation space
    # before glyph subsetting so those deltas never ship.
    instantiateVariableFont(font, {"wght": (400, 700)}, inplace=True)

    options = subset.Options()
    options.flavor = "woff2"
    options.name_IDs = list(RETAINED_NAME_IDS)

    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text=characters)
    subsetter.subset(font)

    font.flavor = "woff2"
    font.save(OUTPUT, reorderTables=True)

    emitted = TTFont(OUTPUT)
    emitted_name_ids = {record.nameID for record in emitted["name"].names}
    missing_name_ids = REQUIRED_LICENSE_NAME_IDS - emitted_name_ids
    if missing_name_ids:
        raise RuntimeError(
            "subset is missing required copyright/license name IDs: "
            f"{sorted(missing_name_ids)}"
        )
    license_descriptions = {
        record.toUnicode()
        for record in emitted["name"].names
        if record.nameID == 13
    }
    if not any("Open Font License" in text for text in license_descriptions):
        raise RuntimeError("subset does not retain its Open Font License metadata")
    emitted.close()

    MANIFEST.write_text(
        json.dumps(current_manifest(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {OUTPUT} ({OUTPUT.stat().st_size} bytes)")
    print(f"wrote {MANIFEST}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify content, manifest, and committed subset without FontTools",
    )
    args = parser.parse_args()
    verify() if args.check else build()


if __name__ == "__main__":
    main()
