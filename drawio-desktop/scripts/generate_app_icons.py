#!/usr/bin/env python3
"""Generate Trellis application identity assets from checked-in raster masters.

The script intentionally keeps semantic Draw.io command icons out of scope. It
only generates product marks, package icons, favicons, wordmarks, and the
existing embed-logo composition. Run without arguments to write assets or with
``--check`` to verify that checked-in outputs match the canonical masters.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import math
import re
import struct
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
BRANDING_DIR = ROOT / "build" / "branding"
FULL_MASTER_PATH = BRANDING_DIR / "trellis-mark-full.png"
SMALL_MASTER_PATH = BRANDING_DIR / "trellis-mark-small.png"
WORDMARK_PATH = BRANDING_DIR / "trellis-wordmark-text.png"
WEB_ROOT = ROOT / "drawio" / "src" / "main" / "webapp"
IMAGES_DIR = WEB_ROOT / "images"
BUILD_DIR = ROOT / "build"
APPX_DIR = BUILD_DIR / "appx"

TILE_COLOR = (251, 254, 189, 255)
TRANSPARENT = (0, 0, 0, 0)
SMALL_MARK_MAX_SIZE = 48
SOURCE_MIN_SIZE = 800
SOURCE_MAX_ASPECT_DELTA = 0.05
ALPHA_FRINGE_MAX = 8
NORMALIZED_MASTER_SIZE = (1024, 1024)
BUILD_PNG_SIZES = (16, 32, 48, 64, 96, 128, 192, 256, 512, 720, 1024)
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
FAVICON_SIZES = (16, 32, 48)
COMPACT_ICON_FILL_RATIO = 1.00  # Trellis change: compact marks use the full canvas without generator padding.
LARGE_TRANSPARENT_ICON_FILL_RATIO = 0.90  # Trellis change: larger marks retain a 5% margin on each edge.
GENERATED_BRANDING_CACHE_URLS = (
    "images/header-icon.png",
    "images/window-icon.png",
)
BRANDING_CACHE_URLS = (
    "js/bootstrap.js",
    "styles/grapheditor.css",
    *GENERATED_BRANDING_CACHE_URLS,
    "images/manifest.json",
)


@dataclass(frozen=True)
class Masters:
    """Validated canonical image inputs used by every generated derivative."""

    full: Image.Image
    small: Image.Image
    wordmark: Image.Image


def parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse the intentionally small generator command line."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify generated assets without rewriting the working tree",
    )
    return parser.parse_args(argv)


def load_rgba(path: Path) -> Image.Image:
    """Load an image eagerly and normalize it to non-premultiplied RGBA."""

    with Image.open(path) as image:
        return image.convert("RGBA")


def validate_alpha_range(name: str, image: Image.Image) -> None:
    """Require both transparent and opaque pixels in a canonical source."""

    alpha = image.getchannel("A")
    alpha_min, alpha_max = alpha.getextrema()
    if alpha_min != 0 or alpha_max != 255:
        raise ValueError(f"{name} source must contain transparent and opaque pixels")

    if alpha.getbbox() is None:
        raise ValueError(f"{name} source is fully transparent")


def validate_no_chroma_fringe(name: str, image: Image.Image) -> None:
    """Reject visible remnants of the previous magenta extraction workflow."""

    red, green, blue, alpha = image.split()
    minimum_red_blue = ImageChops.darker(red, blue)
    magenta_dominance = ImageChops.subtract(minimum_red_blue, green)
    masks = (
        alpha.point(lambda value: 255 if value >= 16 else 0),
        red.point(lambda value: 255 if value >= 120 else 0),
        blue.point(lambda value: 255 if value >= 120 else 0),
        magenta_dominance.point(lambda value: 255 if value >= 60 else 0),
    )
    chroma_mask = masks[0]
    for mask in masks[1:]:
        chroma_mask = ImageChops.multiply(chroma_mask, mask)
    chroma_pixels = chroma_mask.histogram()[255]
    if chroma_pixels:
        raise ValueError(f"{name} source contains {chroma_pixels} visible magenta-key pixels")


def validate_icon_source(name: str, image: Image.Image) -> None:
    """Validate a near-square integrated-background icon source."""

    width, height = image.size
    if min(width, height) < SOURCE_MIN_SIZE:
        raise ValueError(f"{name} source must be at least {SOURCE_MIN_SIZE} px on its short axis")

    aspect_delta = abs(width - height) / max(width, height)
    if aspect_delta > SOURCE_MAX_ASPECT_DELTA:
        raise ValueError(
            f"{name} source must be within {SOURCE_MAX_ASPECT_DELTA:.0%} of square, got {width}x{height}"
        )

    validate_alpha_range(name, image)
    validate_no_chroma_fringe(name, image)


def validate_wordmark(image: Image.Image) -> None:
    """Validate the independent text-only wordmark source."""

    width, height = image.size
    if width < 1024 or height < 256:
        raise ValueError(f"wordmark source must be at least 1024x256, got {width}x{height}")

    validate_alpha_range("wordmark", image)
    validate_no_chroma_fringe("wordmark", image)


def center_square_crop(image: Image.Image) -> Image.Image:
    """Remove equal background-only strips from the source's long axis."""

    width, height = image.size
    side = min(width, height)
    left = (width - side) // 2
    top = (height - side) // 2
    return image.crop((left, top, left + side, top + side))


def clear_alpha_fringe(image: Image.Image) -> Image.Image:
    """Clear only nearly invisible edge pixels without recoloring artwork."""

    cleaned = image.copy()
    alpha = cleaned.getchannel("A").point(
        lambda value: 0 if value <= ALPHA_FRINGE_MAX else value
    )
    cleaned.putalpha(alpha)
    return cleaned


def normalize_icon_source(name: str, image: Image.Image) -> Image.Image:
    """Center-crop, minimally clean, and normalize an icon source to 1024 px."""

    validate_icon_source(name, image)
    cropped = center_square_crop(image)
    cleaned = clear_alpha_fringe(cropped)
    normalized = cleaned.resize(NORMALIZED_MASTER_SIZE, Image.Resampling.LANCZOS)
    if normalized.size != NORMALIZED_MASTER_SIZE or normalized.mode != "RGBA":
        raise ValueError(f"{name} source normalization did not produce a 1024 px RGBA master")
    return normalized


def load_masters() -> Masters:
    """Load and normalize the three checked-in canonical raster inputs."""

    full = normalize_icon_source("full", load_rgba(FULL_MASTER_PATH))
    small = normalize_icon_source("small", load_rgba(SMALL_MASTER_PATH))
    wordmark = load_rgba(WORDMARK_PATH)
    validate_wordmark(wordmark)
    return Masters(full=full, small=small, wordmark=wordmark)


def alpha_crop(image: Image.Image) -> Image.Image:
    """Return the visible bounds of an RGBA image without altering its colors."""

    bbox = image.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("cannot crop a fully transparent image")
    return image.crop(bbox)


def fit_image(image: Image.Image, size: tuple[int, int], fill_ratio: float) -> Image.Image:
    """Center visible image content on a transparent canvas at a stable scale."""

    if not 0 < fill_ratio <= 1:
        raise ValueError("fill_ratio must be between zero and one")

    source = alpha_crop(image)
    canvas_width, canvas_height = size
    max_width = max(1, round(canvas_width * fill_ratio))
    max_height = max(1, round(canvas_height * fill_ratio))
    scale = min(max_width / source.width, max_height / source.height)
    round_dimension = math.ceil if fill_ratio == COMPACT_ICON_FILL_RATIO else round
    output_size = (
        max(1, round_dimension(source.width * scale)),
        max(1, round_dimension(source.height * scale)),
    )
    resized = source.resize(output_size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, TRANSPARENT)
    position = (
        (canvas_width - resized.width) // 2,
        (canvas_height - resized.height) // 2,
    )
    canvas.alpha_composite(resized, position)
    return canvas


def choose_mark(masters: Masters, display_size: int) -> Image.Image:
    """Select the simplified mark for small outputs and full mark otherwise."""

    return masters.small if display_size <= SMALL_MARK_MAX_SIZE else masters.full


def transparent_icon(
    masters: Masters,
    size: tuple[int, int],
    fill_ratio: float | None = None,
) -> Image.Image:
    """Place the selected integrated-background mark on a transparent canvas."""

    display_size = min(size)
    mark = choose_mark(masters, display_size)
    if fill_ratio is None:
        fill_ratio = (
            COMPACT_ICON_FILL_RATIO
            if display_size <= SMALL_MARK_MAX_SIZE
            else LARGE_TRANSPARENT_ICON_FILL_RATIO
        )
    return fit_image(mark, size, fill_ratio)


def contained_icon(
    masters: Masters,
    size: tuple[int, int],
    *,
    fill_ratio: float,
    rounded: bool = False,
) -> Image.Image:
    """Place the mark on the agreed light-yellow platform tile."""

    width, height = size
    canvas = Image.new("RGBA", size, TRANSPARENT if rounded else TILE_COLOR)
    if rounded:
        radius = round(min(width, height) * 0.228)
        mask = Image.new("L", size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, width - 1, height - 1), radius, fill=255)
        tile = Image.new("RGBA", size, TILE_COLOR)
        canvas.alpha_composite(Image.composite(tile, Image.new("RGBA", size), mask))

    mark = fit_image(choose_mark(masters, min(size)), size, fill_ratio)
    validate_safe_area(mark, size)
    canvas.alpha_composite(mark)
    expected_corner = TRANSPARENT if rounded else TILE_COLOR
    if any(canvas.getpixel(corner) != expected_corner for corner in ((0, 0), (width - 1, height - 1))):
        raise ValueError("platform container corner color does not match its native treatment")
    return canvas


def validate_safe_area(image: Image.Image, size: tuple[int, int], minimum_ratio: float = 0.10) -> None:
    """Reject a contained mark that can be clipped by maskable or platform crops."""

    bbox = image.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("platform container mark is fully transparent")

    width, height = size
    left, top, right, bottom = bbox
    minimum_margin = round(min(width, height) * minimum_ratio)
    if min(left, top, width - right, height - bottom) < minimum_margin:
        raise ValueError(f"platform container mark violates its {minimum_ratio:.0%} safe area")


def stacked_wordmark(masters: Masters, size: tuple[int, int]) -> Image.Image:
    """Compose a mark-over-name lockup for legacy vertical wordmark slots."""

    width, height = size
    mark_height = round(height * 0.72)
    mark = fit_image(masters.full, (width, mark_height), 0.88)
    text_height = height - mark_height
    text = fit_image(masters.wordmark, (width, text_height), 0.94)
    canvas = Image.new("RGBA", size, TRANSPARENT)
    canvas.alpha_composite(mark, (0, 0))
    canvas.alpha_composite(text, (0, mark_height))
    return canvas


def wide_wordmark(masters: Masters, size: tuple[int, int]) -> Image.Image:
    """Compose a horizontal mark-and-name lockup for branding previews."""

    width, height = size
    mark_width = round(width * 0.30)
    mark = fit_image(masters.full, (mark_width, height), 0.88)
    text = fit_image(masters.wordmark, (width - mark_width, height), 0.80)
    canvas = Image.new("RGBA", size, TRANSPARENT)
    canvas.alpha_composite(mark, (0, 0))
    canvas.alpha_composite(text, (mark_width, 0))
    return canvas


def embed_icon(masters: Masters, size: int = 48) -> Image.Image:
    """Preserve the existing green-arrow semantic overlay on the Trellis mark."""

    canvas = transparent_icon(masters, (size, size), 0.88)
    draw = ImageDraw.Draw(canvas)
    diameter = round(size * 0.42)
    stroke = max(1, round(size * 0.035))
    left = 0
    top = size - diameter
    right = diameter
    bottom = size
    draw.ellipse((left, top, right, bottom), fill="#58B52E", outline="#1F5E16", width=stroke)

    center_y = top + diameter // 2
    shaft_left = round(diameter * 0.24)
    shaft_right = round(diameter * 0.61)
    shaft_half_height = max(1, round(diameter * 0.08))
    tip_x = round(diameter * 0.78)
    arrow = [
        (shaft_left, center_y - shaft_half_height),
        (shaft_right, center_y - shaft_half_height),
        (shaft_right, round(top + diameter * 0.30)),
        (tip_x, center_y),
        (shaft_right, round(top + diameter * 0.70)),
        (shaft_right, center_y + shaft_half_height),
        (shaft_left, center_y + shaft_half_height),
    ]
    draw.polygon(arrow, fill="white")
    return canvas


def output_path(output_root: Path, relative_path: str) -> Path:
    """Resolve a generated target under either the project or a check staging root."""

    return output_root / Path(relative_path)


def save_png(image: Image.Image, path: Path) -> None:
    """Write a deterministic RGBA PNG."""

    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGBA").save(path, format="PNG", optimize=False, compress_level=9)


def save_gif(image: Image.Image, path: Path) -> None:
    """Write a one-frame transparent GIF for the legacy small-logo URL."""

    path.parent.mkdir(parents=True, exist_ok=True)
    rgba = image.convert("RGBA")
    palette_image = rgba.convert("RGB").quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    transparent_mask = rgba.getchannel("A").point(lambda alpha: 255 if alpha < 128 else 0)
    palette_image.paste(255, mask=transparent_mask)
    palette_image.save(path, format="GIF", transparency=255, optimize=False)


def png_bytes(image: Image.Image) -> bytes:
    """Encode an image exactly as generated PNG outputs are encoded."""

    buffer = io.BytesIO()
    image.convert("RGBA").save(buffer, format="PNG", optimize=False, compress_level=9)
    return buffer.getvalue()


def save_embedded_svg(image: Image.Image, path: Path, size: tuple[int, int]) -> None:
    """Preserve an SVG compatibility URL while keeping PNG as the source of truth."""

    width, height = size
    encoded = base64.b64encode(png_bytes(image)).decode("ascii")
    svg = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!-- Generated by scripts/generate_app_icons.py; raster compatibility container. -->\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">\n'
        f'  <image width="{width}" height="{height}" href="data:image/png;base64,{encoded}"/>\n'
        '</svg>\n'
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(svg, encoding="utf-8", newline="\n")


def save_ico(images_by_size: dict[int, Image.Image], path: Path) -> None:
    """Write an ICO whose small frames use the dedicated simplified master."""

    frames = [(size, png_bytes(images_by_size[size])) for size in sorted(images_by_size)]
    header_size = 6 + 16 * len(frames)
    offset = header_size
    directory = io.BytesIO()
    directory.write(struct.pack("<HHH", 0, 1, len(frames)))
    for size, data in frames:
        encoded_dimension = 0 if size == 256 else size
        directory.write(
            struct.pack(
                "<BBBBHHII",
                encoded_dimension,
                encoded_dimension,
                0,
                0,
                1,
                32,
                len(data),
                offset,
            )
        )
        offset += len(data)

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(directory.getvalue() + b"".join(data for _, data in frames))


def generate_build_assets(masters: Masters, output_root: Path) -> list[str]:
    """Generate desktop package icons for Windows, macOS, and Linux."""

    generated: list[str] = []
    for size in BUILD_PNG_SIZES:
        relative = f"build/{size}x{size}.png"
        save_png(transparent_icon(masters, (size, size)), output_path(output_root, relative))
        generated.append(relative)

    icon_1024 = transparent_icon(masters, (1024, 1024))
    save_png(icon_1024, output_path(output_root, "build/icon.png"))
    generated.append("build/icon.png")

    ico_frames = {
        size: transparent_icon(masters, (size, size))
        for size in ICO_SIZES
    }
    save_ico(ico_frames, output_path(output_root, "build/icon.ico"))
    generated.append("build/icon.ico")

    mac_icon = contained_icon(masters, (1024, 1024), fill_ratio=0.70, rounded=True)
    icns_path = output_path(output_root, "build/icon.icns")
    icns_path.parent.mkdir(parents=True, exist_ok=True)
    mac_icon.save(icns_path, format="ICNS")
    generated.append("build/icon.icns")

    save_embedded_svg(icon_1024, output_path(output_root, "build/icon.svg"), (1024, 1024))
    generated.append("build/icon.svg")
    return generated


def generate_appx_assets(masters: Masters, output_root: Path) -> list[str]:
    """Generate light-tile AppX images at the repository's existing dimensions."""

    dimensions = {
        "BadgeLogo.png": (512, 512),
        "LargeTile.png": (310, 310),
        "SmallTile.png": (71, 71),
        "Square150x150Logo.png": (150, 150),
        "Square44x44Logo.png": (44, 44),
        "StoreLogo.png": (64, 64),
        "Wide310x150Logo.png": (310, 150),
    }
    generated: list[str] = []
    for name, size in dimensions.items():
        relative = f"build/appx/{name}"
        fill_ratio = 0.66 if name == "Wide310x150Logo.png" else 0.70
        image = contained_icon(masters, size, fill_ratio=fill_ratio)
        save_png(image, output_path(output_root, relative))
        generated.append(relative)
    return generated


def generate_web_assets(masters: Masters, output_root: Path) -> list[str]:
    """Generate web, PWA, viewer, and in-app identity images."""

    generated: list[str] = []

    transparent_specs = {
        "images/logo.png": (150, 150),
        "images/logo-white.png": (32, 24),
        "images/logo-flat-small.png": (16, 16),
        "images/drawlogo48.png": (48, 48),
        "images/drawlogo48-gray.png": (48, 48),
        "images/drawlogo80.png": (80, 80),
        "images/drawlogo128.png": (128, 128),
        "images/drawlogo144.png": (144, 144),
        "images/drawlogo256.png": (256, 256),
        "images/favicon-16x16.png": (16, 16),
        "images/favicon-32x32.png": (32, 32),
        "images/icon-192.png": (192, 192),
        "images/icon-512.png": (512, 512),
    }
    for relative, size in transparent_specs.items():
        save_png(transparent_icon(masters, size), output_path(output_root, f"drawio/src/main/webapp/{relative}"))
        generated.append(f"drawio/src/main/webapp/{relative}")

    window_icon_relative = "drawio/src/main/webapp/images/window-icon.png"
    window_icon = fit_image(masters.small, (256, 256), COMPACT_ICON_FILL_RATIO)
    save_png(window_icon, output_path(output_root, window_icon_relative))
    generated.append(window_icon_relative)

    header_icon_relative = "drawio/src/main/webapp/images/header-icon.png"
    header_icon = fit_image(masters.full, (256, 256), COMPACT_ICON_FILL_RATIO)
    save_png(header_icon, output_path(output_root, header_icon_relative))
    generated.append(header_icon_relative)

    contained_specs = {
        "images/apple-touch-icon.png": ((180, 180), 0.70),
        "images/android-chrome-512x512.png": ((512, 512), 0.66),
        "images/icon-192-maskable.png": ((192, 192), 0.66),
        "images/icon-512-maskable.png": ((512, 512), 0.66),
        "images/mstile-150x150.png": ((150, 150), 0.70),
    }
    for relative, (size, fill_ratio) in contained_specs.items():
        save_png(
            contained_icon(masters, size, fill_ratio=fill_ratio),
            output_path(output_root, f"drawio/src/main/webapp/{relative}"),
        )
        generated.append(f"drawio/src/main/webapp/{relative}")

    stacked = stacked_wordmark(masters, (170, 219))
    save_png(stacked, output_path(output_root, "drawio/src/main/webapp/images/logo-flat.png"))
    generated.append("drawio/src/main/webapp/images/logo-flat.png")

    stacked_large = stacked_wordmark(masters, (512, 640))
    save_png(stacked_large, output_path(output_root, "drawio/src/main/webapp/images/trellis-wordmark.png"))
    generated.append("drawio/src/main/webapp/images/trellis-wordmark.png")

    wide = wide_wordmark(masters, (1200, 360))
    save_png(wide, output_path(output_root, "drawio/src/main/webapp/images/trellis-wordmark-wide.png"))
    generated.append("drawio/src/main/webapp/images/trellis-wordmark-wide.png")

    save_gif(
        transparent_icon(masters, (16, 16)),
        output_path(output_root, "drawio/src/main/webapp/images/logo-small.gif"),
    )
    generated.append("drawio/src/main/webapp/images/logo-small.gif")

    save_png(embed_icon(masters), output_path(output_root, "drawio/src/main/webapp/images/embed-icon.png"))
    generated.append("drawio/src/main/webapp/images/embed-icon.png")

    svg_mark = transparent_icon(masters, (512, 512))
    for name in ("drawio.svg", "drawlogo.svg", "drawlogo-color.svg", "drawlogo-gray.svg"):
        relative = f"drawio/src/main/webapp/images/{name}"
        save_embedded_svg(svg_mark, output_path(output_root, relative), (512, 512))
        generated.append(relative)

    wordmark_relative = "drawio/src/main/webapp/images/drawlogo-text-bottom.svg"
    save_embedded_svg(stacked_large, output_path(output_root, wordmark_relative), (512, 640))
    generated.append(wordmark_relative)

    favicon_frames = {
        size: transparent_icon(masters, (size, size))
        for size in FAVICON_SIZES
    }
    save_ico(favicon_frames, output_path(output_root, "drawio/src/main/webapp/favicon.ico"))
    generated.append("drawio/src/main/webapp/favicon.ico")
    return generated


def generate_contact_sheet(masters: Masters, output_root: Path) -> str:
    """Render native-size icons on light and dark backgrounds for visual review."""

    sizes = (16, 32, 48, 64, 128, 256, 512)
    cell_width = 560
    header_height = 28
    row_heights = [max(64, size + 24) for size in sizes]
    sheet = Image.new("RGB", (cell_width * 2, header_height + sum(row_heights)), "#D9D9D9")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    draw.text((8, 8), "Light background", fill="#222222", font=font)
    draw.text((cell_width + 8, 8), "Dark background", fill="#222222", font=font)

    top = header_height
    for size, row_height in zip(sizes, row_heights):
        icon = transparent_icon(masters, (size, size))
        for column, background in enumerate(("#FFFFFF", "#242822")):
            left = column * cell_width
            draw.rectangle((left, top, left + cell_width - 1, top + row_height - 1), fill=background)
            x = left + (cell_width - size) // 2
            y = top + (row_height - size) // 2
            sheet.paste(icon, (x, y), icon)
            draw.text((left + 8, top + 8), f"{size}px", fill="#555555" if column == 0 else "#EEEEEE", font=font)
        top += row_height

    relative = "build/branding/trellis-icon-contact-sheet.png"
    save_png(sheet.convert("RGBA"), output_path(output_root, relative))
    return relative


def generate_all(output_root: Path) -> list[str]:
    """Generate every identity derivative and return project-relative paths."""

    masters = load_masters()
    generated = generate_build_assets(masters, output_root)
    generated.extend(generate_appx_assets(masters, output_root))
    generated.extend(generate_web_assets(masters, output_root))
    generated.append(generate_contact_sheet(masters, output_root))
    return generated


def md5_hex(path: Path) -> str:
    """Return the revision format already used by the Workbox manifest."""

    return hashlib.md5(path.read_bytes()).hexdigest()


def service_worker_url(relative_path: str) -> str | None:
    """Translate a generated project path to its Workbox URL when applicable."""

    prefix = "drawio/src/main/webapp/"
    if not relative_path.startswith(prefix):
        return None
    return relative_path[len(prefix) :].replace("\\", "/")


def append_missing_worker_cache_entries(worker_text: str, cache_paths: dict[str, Path]) -> str:
    """Append generated branding entries absent from the minified Workbox manifest."""

    missing = [
        url
        for url in GENERATED_BRANDING_CACHE_URLS
        if f'url:"{url}",revision:"' not in worker_text
    ]
    if not missing:
        return worker_text

    marker = '],{ignoreURLParametersMatching:[/.*/]})'
    if marker not in worker_text:
        raise ValueError("Workbox precache manifest terminator was not found")
    entries = "".join(
        f',{{url:"{url}",revision:"{md5_hex(cache_paths[url])}"}}'
        for url in missing
    )
    return worker_text.replace(marker, entries + marker, 1)


def append_missing_source_map_cache_entries(map_text: str, cache_paths: dict[str, Path]) -> str:
    """Mirror generated branding entries into the Workbox source-map source."""

    missing = [
        url
        for url in GENERATED_BRANDING_CACHE_URLS
        if f'\\"url\\": \\"{url}\\"' not in map_text
    ]
    if not missing:
        return map_text

    marker = '\\n  }\\n], {\\n  \\"ignoreURLParametersMatching\\"'
    if marker not in map_text:
        raise ValueError("Workbox source-map precache manifest terminator was not found")
    entries = "".join(
        ',\\n  {\\n'
        f'    \\"url\\": \\"{url}\\",\\n'
        f'    \\"revision\\": \\"{md5_hex(cache_paths[url])}\\"\\n'
        '  }'
        for url in missing
    )
    return map_text.replace(marker, entries + marker, 1)


def refresh_service_worker_revisions(generated: list[str]) -> None:
    """Refresh cached identity revisions in the minified worker and its source map."""

    worker_path = WEB_ROOT / "service-worker.js"
    worker_text = worker_path.read_text(encoding="utf-8")
    replacements: dict[str, str] = {}

    generated_urls = {
        url: ROOT / relative
        for relative in generated
        if (url := service_worker_url(relative)) is not None
    }
    cache_paths = dict(generated_urls)
    cache_paths.update({url: WEB_ROOT / url for url in BRANDING_CACHE_URLS})
    worker_text = append_missing_worker_cache_entries(worker_text, cache_paths)

    for url, actual_path in cache_paths.items():
        revision = md5_hex(actual_path)
        pattern = re.compile(
            rf'(url:"{re.escape(url)}",revision:")(?P<revision>[0-9a-f]{{32}})(")'
        )
        match = pattern.search(worker_text)
        if match is None:
            if url in BRANDING_CACHE_URLS:
                raise ValueError(f"Required branding cache entry is missing: {url}")
            continue
        old_revision = match.group("revision")
        worker_text = pattern.sub(rf"\g<1>{revision}\g<3>", worker_text, count=1)
        replacements[old_revision] = revision

    worker_path.write_text(worker_text, encoding="utf-8", newline="\n")
    map_path = WEB_ROOT / "service-worker.js.map"
    if map_path.exists():
        map_text = map_path.read_text(encoding="utf-8")
        map_text = append_missing_source_map_cache_entries(map_text, cache_paths)
        for old_revision, new_revision in replacements.items():
            map_text = map_text.replace(old_revision, new_revision)
        map_path.write_text(map_text, encoding="utf-8", newline="\n")


def validate_service_worker_revisions(generated: list[str]) -> list[str]:
    """Return stale Workbox identity entries without changing generated files."""

    worker_text = (WEB_ROOT / "service-worker.js").read_text(encoding="utf-8")
    stale: list[str] = []
    urls = [service_worker_url(relative) for relative in generated]
    urls.extend(BRANDING_CACHE_URLS)
    for url in (candidate for candidate in urls if candidate is not None):
        path = WEB_ROOT / url
        if not path.exists():
            continue
        entry_prefix = f'url:"{url}",revision:"'
        if entry_prefix not in worker_text:
            if url in BRANDING_CACHE_URLS:
                stale.append(url)
            continue
        revision = md5_hex(path)
        if f'url:"{url}",revision:"{revision}"' not in worker_text:
            stale.append(url)
    return stale


def compare_generated_assets(expected_root: Path, generated: list[str]) -> list[str]:
    """Compare staged outputs byte-for-byte with checked-in generated files."""

    mismatches: list[str] = []
    for relative in generated:
        expected = expected_root / relative
        actual = ROOT / relative
        if not actual.exists() or actual.read_bytes() != expected.read_bytes():
            mismatches.append(relative)
    return mismatches


def run_check() -> int:
    """Regenerate into a temporary tree and report every stale output."""

    with tempfile.TemporaryDirectory(prefix="trellis-icons-") as directory:
        staging_root = Path(directory)
        generated = generate_all(staging_root)
        mismatches = compare_generated_assets(staging_root, generated)

    mismatches.extend(validate_service_worker_revisions(generated))
    if mismatches:
        print("Trellis identity assets are stale:", file=sys.stderr)
        for relative in sorted(set(mismatches)):
            print(f"  {relative}", file=sys.stderr)
        print("Run: npm run assets:icons", file=sys.stderr)
        return 1

    print(f"Verified {len(generated)} generated Trellis identity assets.")
    return 0


def main(argv: list[str] | None = None) -> int:
    """Generate assets or validate the checked-in output set."""

    args = parse_args(sys.argv[1:] if argv is None else argv)
    if args.check:
        return run_check()

    generated = generate_all(ROOT)
    refresh_service_worker_revisions(generated)
    print(f"Generated {len(generated)} Trellis identity assets.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
