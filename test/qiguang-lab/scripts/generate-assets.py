# -*- coding: utf-8 -*-
"""栖光艺术节 Lab 素材生成：四象限标尺图（与 orientation fixture 同一画法）。

输出到 test/qiguang-lab/public/media/：
- qiguang-hero-wide.jpg   1600x900  横版主视觉（共享媒体，三容器消费）
- qiguang-hero-tall.jpg    900x1125 竖版主视觉 4:5（共享媒体的替换目标）
- qiguang-home-local.jpg  1200x800  首页本地图（仅首页消费，替换共享媒体时不得变化）
- qiguang-archive.jpg     1600x900  档案页独立素材（共享媒体替换时不得变化）

标尺语义：四象限色块 + 白分隔线 + 边缘 100px 刻度 + 象限标号 + 中央尺寸标注，
肉眼即可核对 cover 裁切可见窗口。复现：python test/qiguang-lab/scripts/generate-assets.py
"""
from PIL import Image, ImageDraw

OUT = "test/qiguang-lab/public/media"

# 与 orientation fixture 错开的色相，避免与青野/横竖版素材混淆
QUADRANTS = {
    "hero-wide": [(109, 40, 217), (14, 116, 144), (180, 83, 9), (77, 124, 15)],
    "hero-tall": [(109, 40, 217), (14, 116, 144), (180, 83, 9), (77, 124, 15)],
    "home-local": [(190, 24, 93), (13, 148, 136), (202, 138, 4), (71, 85, 179)],
    "archive": [(55, 65, 81), (113, 63, 18), (30, 90, 120), (94, 48, 93)],
}


def draw_ruler(draw: ImageDraw.ImageDraw, w: int, h: int) -> None:
    # 边缘 100px 刻度（上/下沿竖刻，左/右沿横刻）
    tick = 28
    for x in range(0, w + 1, 100):
        draw.line([(x, 0), (x, tick)], fill=(255, 255, 255), width=3)
        draw.line([(x, h), (x, h - tick)], fill=(255, 255, 255), width=3)
    for y in range(0, h + 1, 100):
        draw.line([(0, y), (tick, y)], fill=(255, 255, 255), width=3)
        draw.line([(w, y), (w - tick, y)], fill=(255, 255, 255), width=3)


def make(name: str, size: tuple[int, int], label: str) -> None:
    w, h = size
    image = Image.new("RGB", size)
    draw = ImageDraw.Draw(image)
    colors = QUADRANTS[name]
    draw.rectangle([0, 0, w // 2, h // 2], fill=colors[0])
    draw.rectangle([w // 2, 0, w, h // 2], fill=colors[1])
    draw.rectangle([0, h // 2, w // 2, h], fill=colors[2])
    draw.rectangle([w // 2, h // 2, w, h], fill=colors[3])
    draw.line([(w // 2, 0), (w // 2, h)], fill=(255, 255, 255), width=6)
    draw.line([(0, h // 2), (w, h // 2)], fill=(255, 255, 255), width=6)
    draw_ruler(draw, w, h)
    qfont = max(48, min(w, h) // 8)
    for (cx, cy), tag in zip(
        [(w // 4, h // 4), (3 * w // 4, h // 4), (w // 4, 3 * h // 4), (3 * w // 4, 3 * h // 4)],
        ["TL", "TR", "BL", "BR"],
    ):
        draw.text((cx, cy), tag, fill=(255, 255, 255), anchor="mm", font_size=qfont)
    draw.text((w // 2, h // 2), label, fill=(255, 255, 255), anchor="mm", font_size=max(36, min(w, h) // 16))
    image.save(f"{OUT}/qiguang-{name}.jpg", quality=90)
    print(f"qiguang-{name}.jpg {size}")


if __name__ == "__main__":
    make("hero-wide", (1600, 900), "QIGUANG WIDE 1600x900")
    make("hero-tall", (900, 1125), "QIGUANG TALL 900x1125")
    make("home-local", (1200, 800), "QIGUANG HOME LOCAL 1200x800")
    make("archive", (1600, 900), "QIGUANG ARCHIVE 1600x900")
