#!/usr/bin/env python3
"""PNG/JPG → ICO 转换工具：生成包含多尺寸的 Windows 图标文件"""

import sys
from PIL import Image

ICO_SIZES = [16, 32, 48, 64, 128, 256]


def convert(src_path: str, ico_path: str) -> None:
    src = Image.open(src_path)
    if src.mode != "RGBA":
        src = src.convert("RGBA")

    # Pillow ICO 保存：sizes 参数指定输出尺寸，会自动缩放
    src.save(ico_path, format="ICO", sizes=[(s, s) for s in ICO_SIZES])

    # 验证
    ico = Image.open(ico_path)
    count = 0
    for i in range(20):
        try:
            ico.seek(i)
            count += 1
        except EOFError:
            break
    print(f"✅ {ico_path}  已生成 ({count} 尺寸: {', '.join(str(s) for s in ICO_SIZES)})")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(f"用法: {sys.argv[0]} <input> <output.ico>")
        sys.exit(1)
    convert(sys.argv[1], sys.argv[2])
