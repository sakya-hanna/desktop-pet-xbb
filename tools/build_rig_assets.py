"""把解包出来的立绘 + 表情差分，烘成 2D rig 用的贴图和配置。

输入：D:\\dsh-pet\\xiaobobai\\game\\{baijie-src,kurenai}
输出：D:\\dsh-pet\\xiaobobai\\puppet\\rig\\
  - assets/<char>-body.png          身体（无脸）
  - assets/<char>-face-<id>.png     表情脸（已裁到外接框）
  - js/assets.js                    config（画布、缩放、脸部基准点、每个表情的偏移）
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(r"D:\dsh-pet\xiaobobai")
OUT = ROOT / "puppet" / "rig"
ASSETS = OUT / "assets"
ASSETS.mkdir(parents=True, exist_ok=True)
(OUT / "js").mkdir(parents=True, exist_ok=True)

TARGET_H = 800  # 贴图里角色的高度（像素）

# 白姐：锚点 (1240, 313) 是 3901 那张差分的左上角；其余相对它偏移
# 由「虹膜中心 + 脸部外接框」求的偏移（v2，比最早那版贴得准）
BAIJIE_DIFFS = {
    3496: (-1, -8), 3523: (5, 2), 3563: (0, -37), 3599: (2, 20),
    3625: (-3, 8), 3665: (0, -7), 3711: (0, -32), 3751: (0, -16),
    3791: (0, -20), 3831: (0, 1), 3861: (-6, -3), 3901: (0, 0),
    3942: (0, -3), 4006: (7, -11),
}

# 手描发束中线（原图坐标），r=半径 f=羽化；back=是否后发（做视差）
BAIJIE_STRANDS = [
    dict(pts=[(1250,220),(1050,600),(750,1200),(420,1700),(200,2050)], r=95, f=60, back=True),
    dict(pts=[(1400,260),(1000,900),(600,1500),(300,1900)], r=85, f=55, back=True),
    dict(pts=[(1700,260),(1980,800),(2200,1300),(2280,1650)], r=95, f=60, back=True),
    dict(pts=[(1800,240),(2150,700),(2380,1250)], r=80, f=50, back=True),
    dict(pts=[(1150,180),(1400,150),(1700,200),(1850,320)], r=90, f=55, back=False),
    dict(pts=[(1750,380),(1820,800),(1750,1150)], r=75, f=45, back=False),
]

BAIJIE_LABELS = {3496:"别扭",3523:"笑",3563:"小惊讶",3599:"平静",3625:"闭眼",3665:"嘟嘴",
                  3711:"生气",3751:"难过",3791:"意外",3831:"疑问",3861:"大笑",3901:"微笑",
                  3942:"温柔",4006:"震惊"}
BAIJIE_BLINK = 3625
# 游戏里的「コミカル」（搞笑）差分，画风夸张，和她的气质不搭 → 默认不出现在循环里
BAIJIE_SKIP = [3523, 3861, 4006]

KURENAI_LABELS = {11:"生气",12:"大怒",13:"微笑",14:"平静",15:"惊讶",16:"闭眼",17:"不满",
                  18:"难过",19:"认真",20:"默认",21:"平常",22:"开心",23:"微笑了",24:"平静二"}
KURENAI_BLINK = 16
KURENAI_SKIP = [12]

# 同样用「虹膜 + 脸部外接框」求（18 是流泪脸，虹膜检测失败，单独用外接框）
KURENAI_DIFFS = {
    11: (19, 9), 12: (13, -1), 13: (26, 0), 14: (10, -4), 15: (2, 19),
    16: (14, 18), 17: (1, 8), 18: (-3, -20), 19: (-11, 5), 20: (-1, 2),
    21: (0, 0), 22: (17, 17), 23: (-1, 5), 24: (-2, 8),
}

CHARS = [
    dict(key="baijie", name="白姐",
         body=ROOT / "game/baijie-src/白__白Ａ_0_2788.png",
         diffdir=ROOT / "game/baijie-src",
         diffpat="白__白Ａ_0_{}.png",
         anchor=(1240, 313), diffs=BAIJIE_DIFFS, ref=3901,
         labels=BAIJIE_LABELS, blink=BAIJIE_BLINK, skip=BAIJIE_SKIP,
         strands=BAIJIE_STRANDS),
    dict(key="kurenai", name="小红",
         body=ROOT / "game/kurenai/紅__紅Ａ_0_27.png",
         diffdir=ROOT / "game/kurenai",
         diffpat="紅__紅Ａ_0_{}.png",
         anchor=(588, 472), diffs=KURENAI_DIFFS, ref=None,
         labels=KURENAI_LABELS, blink=KURENAI_BLINK, skip=KURENAI_SKIP),
]


def main():
    config = {}
    for c in CHARS:
        body = Image.open(c["body"]).convert("RGBA")
        cw, ch = body.size
        scale = TARGET_H / ch

        # 身体：整体等比缩到 TARGET_H 高
        tw, th = round(cw * scale), TARGET_H
        body.resize((tw, th), Image.LANCZOS).save(ASSETS / f"{c['key']}-body.png")

        # 脸部基准：参考差分的左上角在画布上的位置
        ref_id = c["ref"] or next(iter(c["diffs"]))
        ref_off = c["diffs"][ref_id]
        ax, ay = c["anchor"]

        faces = {}
        ref_size = None
        for did, (dx, dy) in sorted(c["diffs"].items()):
            im = Image.open(c["diffdir"] / c["diffpat"].format(did)).convert("RGBA")
            bbox = im.getbbox()
            crop = im.crop(bbox)
            if did == ref_id:
                ref_size = im.size
            # 位置 = 锚点 + 该差分相对参考的偏移 + 它自己的裁切框偏移，最后乘缩放
            x = (ax + dx + bbox[0]) * scale
            y = (ay + dy + bbox[1]) * scale
            fw, fh = max(1, round(crop.width * scale)), max(1, round(crop.height * scale))
            crop.resize((fw, fh), Image.LANCZOS).save(ASSETS / f"{c['key']}-face-{did}.png")
            faces[did] = dict(x=round(x, 2), y=round(y, 2), w=fw, h=fh)

        # 解剖点（先按脸部基准估，跑起来再调）
        fw, fh = ref_size
        face_cx = (ax + ref_off[0] + fw * 0.5) * scale
        face_cy = (ay + ref_off[1] + fh * 0.45) * scale
        fw_s, fh_s = fw * scale, fh * scale
        config[c["key"]] = dict(
            name=c["name"],
            canvas=[tw, th],
            scale=round(scale, 5),
            srcCanvas=[cw, ch],
            head=dict(c=[round(face_cx, 1), round(face_cy + 8, 1)],
                      rx=round(fw_s * 0.82, 1), ry=round(fh_s * 0.98, 1), feather=0.35),
            neck=[round(face_cx, 1), round(face_cy + fh_s * 0.72, 1)],
            hips=[round(tw * 0.5, 1), round(th * 0.56, 1)],
            feetY=th - 2,
            strands=[
                dict(pts=[[round(px * scale, 1), round(py * scale, 1)] for px, py in s["pts"]],
                     r=round(s["r"] * scale, 1), f=round(s["f"] * scale, 1), back=s["back"])
                for s in (c.get("strands") or [])
            ],
            dome=dict(c=[round(face_cx, 1), round(face_cy - 20, 1)],
                      rx=round(fw_s * 0.78, 1), ry=round(fh_s * 0.72, 1)),
            skirt=dict(x=[52, 487], y=[244, 325, 447, 487]),
            upper=[round(th * 0.30, 1), round(th * 0.72, 1)],
            body=[round(th * 0.50, 1), round(th * 0.95, 1)],
            faces=faces,
            labels=c.get("labels", {}),
            blinkFace=c.get("blink"),
            faceOrder=[3901, 3942, 4006, 3599, 3831, 3523, 3861, 3711,
                       3751, 3791, 3496, 3625, 3665, 3563] if c["key"] == "baijie" else sorted(faces),
            skip=c.get("skip", []),
        )
        print(f"{c['key']}: 画布 {tw}x{th}  缩放 {scale:.4f}  表情 {len(faces)} 个")

    js = "// 自动生成，不要手改\nwindow.RIG_ASSETS = " + json.dumps(config, ensure_ascii=False, indent=1) + ";\n"
    (OUT / "js" / "assets.js").write_text(js, encoding="utf-8")
    print("写出", OUT / "js" / "assets.js")


if __name__ == "__main__":
    main()
