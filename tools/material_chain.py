# -*- coding: utf-8 -*-
"""绿幕视频 → 白姐桌宠播放素材（VP9-alpha WebM，640×360）。

这是把「AI 图生视频产出的 10 秒绿幕片」变成 dsh-pet 能播的素材的那一段。
算法与阈值照抄上游 `PC2005-cloud/dsh-pet` 的 `chroma_step02.py` / `normalize_step03.py`
（MIT，见 tools/upstream/ 与 NOTICE），只做了三处适配：

1. **不写死 1280×720**：按输入实际分辨率抠像，最后统一归一化到 640×360；
2. **加了一道去绿边（despill）**：半透明边缘把 G 压到不超过 max(R,B)，
   否则白头发/浅蓝缎带边上会留一圈绿（上游靠 PR 手工抠像规避）；
3. **归一化直接对齐 640×360 画布**：站立高度 300px、水平居中、脚底贴底边，
   与现在这版占位素材同一套构图，换片时不会跳。

用法：
    python tools/material_chain.py --src green/                 # 整目录批量
    python tools/material_chain.py --src green/ --only 待机呼吸  # 单条
    python tools/material_chain.py --selftest                   # 自测（绿幕合成 → 抠回 → 比对 alpha）
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DST = ROOT / "petpack" / "pet" / "baijie-animation"
WORK = ROOT / "build" / "chain"

FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
FFPROBE = shutil.which("ffprobe") or "ffprobe"

# ---- 抠像参数（上游 chroma_step02.py 的同名常量）----
GREEN_HUE_MIN = 70.0
GREEN_HUE_MAX = 170.0
SAT_MIN = 0.15
VAL_MIN = 0.15
HUE_FEATHER = 6.0

# ---- 归一化参数（与占位素材一致）----
OUT_W, OUT_H = 480, 640        # 竖版 3:4（桌宠演出片段）
CHAR_H = 556                  # 人物高度（480×640 画布内，87%）
BOTTOM_MARGIN = 40   # 脚底基线 y=600（640-40）
FPS = 24
ALPHA_KEEP = 8  # alpha 低于这个值当作全透明（算外接框时用）

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".webm"}


# ---------------------------------------------------------------- ffmpeg 小工具
def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, capture_output=True, **kw)


def probe(path: Path) -> tuple[int, int, float]:
    r = run([FFPROBE, "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height,r_frame_rate",
             "-of", "csv=p=0", str(path)])
    w, h, rate = r.stdout.decode("utf-8", "replace").strip().split(",")[:3]
    if "/" in rate:
        num, den = rate.split("/")
        fps = float(num) / float(den or 1)
    else:
        fps = float(rate or FPS)
    return int(w), int(h), fps


def decode_rgb(path: Path, w: int, h: int) -> np.ndarray:
    """整段解码成 (N,H,W,3) uint8。视频都不长（10 秒），一次读进内存最省事。"""
    r = subprocess.run([FFMPEG, "-v", "error", "-i", str(path),
                        "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                       check=True, capture_output=True)
    frame_size = w * h * 3
    n = len(r.stdout) // frame_size
    return np.frombuffer(r.stdout[: n * frame_size], np.uint8).reshape(n, h, w, 3)


def encode_webm(frames_dir: Path, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    run([FFMPEG, "-y", "-loglevel", "error",
         "-framerate", str(FPS), "-i", str(frames_dir / "f%04d.png"),
         "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
         "-b:v", "0", "-crf", "30", "-row-mt", "1", "-auto-alt-ref", "0",
         str(out)])


# ---------------------------------------------------------------- 抠像
def rgb_to_hsv(frame: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """rgb uint8 (H,W,3) → hue(0-360) / sat(0-1) / val(0-1)，numpy 向量化。"""
    r = frame[..., 0].astype(np.float32) / 255.0
    g = frame[..., 1].astype(np.float32) / 255.0
    b = frame[..., 2].astype(np.float32) / 255.0
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    delta = mx - mn
    nz = delta > 0
    safe = np.where(nz, delta, 1.0)
    hr = 60.0 * (((g - b) / safe) % 6.0)
    hg = 60.0 * (((b - r) / safe) + 2.0)
    hb = 60.0 * (((r - g) / safe) + 4.0)
    hue = np.where((mx == r) & nz, hr,
                   np.where((mx == g) & nz, hg,
                            np.where((mx == b) & nz, hb, 0.0)))
    sat = np.where(mx > 0, delta / np.maximum(mx, 1e-6), 0.0)
    return hue, sat, mx


def key_frame(frame: np.ndarray) -> np.ndarray:
    """单帧 rgb → rgba。绿色色相带内且够饱和/够亮 → 透明（带羽化）。"""
    hue, sat, val = rgb_to_hsv(frame)
    lo, hi = GREEN_HUE_MIN - HUE_FEATHER, GREEN_HUE_MAX + HUE_FEATHER
    in_hue = (np.clip((hue - lo) / HUE_FEATHER, 0, 1)
              * np.clip((hi - hue) / HUE_FEATHER, 0, 1))
    bg_mask = (sat >= SAT_MIN) & (val >= VAL_MIN) & (hue >= lo) & (hue <= hi)

    # 补一刀：AI 生成的地面阴影是"低饱和的深绿"，sat 不够被上面的规则漏掉。
    # 判据：绿通道明显强于红蓝（哪怕很暗、很灰）→ 当作背景。
    r = frame[..., 0].astype(np.int16)
    g = frame[..., 1].astype(np.int16)
    b = frame[..., 2].astype(np.int16)
    shadow = (g > r + 12) & (g > b + 12) & (g >= 40) & (hue >= lo) & (hue <= hi)
    bg_mask = bg_mask | shadow

    alpha = np.where(bg_mask, (1.0 - in_hue) * 255.0, 255.0).astype(np.uint8)

    rgb = frame.copy()
    # despill：半透明边缘的绿色通道压到不超过 max(R,B)，消掉绿边
    edge = alpha < 250
    if edge.any():
        r = rgb[..., 0].astype(np.int16)
        g = rgb[..., 1].astype(np.int16)
        b = rgb[..., 2].astype(np.int16)
        cap = np.maximum(r, b)
        g2 = np.where(edge & (g > cap), cap, g)
        rgb[..., 1] = np.clip(g2, 0, 255).astype(np.uint8)
    return np.dstack([rgb, alpha])


# ---------------------------------------------------------------- 归一化
def bbox_of(alpha: np.ndarray) -> tuple[int, int, int, int] | None:
    ys, xs = np.nonzero(alpha > ALPHA_KEEP)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def normalize(frames: np.ndarray, out_dir: Path) -> dict:
    """按首帧站立姿态定标，把人物统一放到 640×360 画布上。

    frames: (N,H,W,4) uint8
    返回定标信息（写日志用）。
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    first_bbox = bbox_of(frames[0][..., 3])
    if first_bbox is None:
        raise RuntimeError("首帧全透明，没法定标（绿幕片是不是抠坏了？）")
    x0, y0, x1, y1 = first_bbox
    stand_h = y1 - y0
    scale = CHAR_H / stand_h
    info = {"standH": stand_h, "scale": round(scale, 4), "srcW": frames.shape[2], "srcH": frames.shape[1]}

    canvas_bottom = OUT_H - BOTTOM_MARGIN
    for i, fr in enumerate(frames):
        im = Image.fromarray(fr, "RGBA")
        nw = max(1, round(im.width * scale))
        nh = max(1, round(im.height * scale))
        im = im.resize((nw, nh), Image.LANCZOS)
        # 水平居中（按首帧人物中心，避免每一帧跟着动作左右飘）
        center_x = (x0 + x1) / 2 * scale
        paste_x = round(OUT_W / 2 - center_x)
        paste_y = canvas_bottom - round(y1 * scale)
        canvas = Image.new("RGBA", (OUT_W, OUT_H), (0, 0, 0, 0))
        canvas.alpha_composite(im, (paste_x, paste_y))
        canvas.save(out_dir / f"f{i:04d}.png")
    return info


def erase_boxes(arr: np.ndarray, boxes: list[tuple[float, float, float, float]]) -> np.ndarray:
    """把若干矩形区域（按画面比例 0–1 给）涂成纯绿，用来抹掉角标水印。

    只适合水印落在绿幕上、没压到人物的情形；压到人就只能会员导出/API。
    """
    if not boxes:
        return arr
    h, w, _ = arr.shape
    out = arr.copy()
    for (x0, y0, x1, y1) in boxes:
        px0, py0 = int(w * max(0.0, x0)), int(h * max(0.0, y0))
        px1, py1 = int(w * min(1.0, x1)), int(h * min(1.0, y1))
        if px1 <= px0 or py1 <= py0:
            continue
        out[py0:py1, px0:px1] = (0, 255, 0)
    return out


def _fg_mask(rgb: np.ndarray) -> np.ndarray:
    """非绿幕像素（用于统计人物本身的颜色）。"""
    return ~((rgb[..., 1] > 150) & (rgb[..., 0] < 110) & (rgb[..., 2] < 110))


def ref_stats(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """参考图上前景像素的每通道 均值 / 标准差。"""
    im = Image.open(path).convert("RGB")
    a = np.array(im).astype(np.float32)
    m = _fg_mask(a)
    px = a[m]
    if len(px) == 0:
        raise SystemExit(f"参考图里没找到人物像素：{path}")
    return px.mean(0), px.std(0)


def match_color(frames: np.ndarray, ref_mean: np.ndarray, ref_std: np.ndarray,
                mode: str = "mean") -> np.ndarray:
    """把生成片的亮度/色彩拉到参考图的统计分布上。

    生成式视频普遍比参考立绘**偏暗**（实测豆包约暗 12–14%），这里按
    前景像素的每通道均值（mode=mean）或均值+方差（mode=meanstd）做线性校正。
    """
    stat_frames = []
    for f in frames:
        m = _fg_mask(f)
        px = f[m].astype(np.float32)
        stat_frames.append((px.mean(0) if len(px) else ref_mean,
                            px.std(0) if len(px) else ref_std))
    out = np.empty_like(frames)
    for i, f in enumerate(frames):
        cur_mean, cur_std = stat_frames[i]
        gain = ref_mean / np.maximum(cur_mean, 1e-3)
        if mode == "meanstd":
            gain = gain * (ref_std / np.maximum(cur_std, 1e-3))
        out[i] = np.clip(f.astype(np.float32) * gain[None, None, :], 0, 255).astype(np.uint8)
    return out


def loop_fade(arr: np.ndarray, k: int = 12) -> np.ndarray:
    """把最后 k 帧渐隐到首帧，使循环接缝为 0（动作在这个区间会慢慢"落定"）。

    比乒乓循环自然（不会倒放），比硬裁更顺（接缝严格为 0）。
    """
    n = len(arr)
    k = min(k, max(2, n // 4))
    out = arr.astype(np.float32).copy()
    f0 = arr[0].astype(np.float32)
    for j in range(k):
        w = (j + 1) / k
        out[n - k + j] = (1 - w) * arr[n - k + j].astype(np.float32) + w * f0
    return np.clip(out, 0, 255).astype(np.uint8)


def loop_trim(arr: np.ndarray, search_from: float = 0.6) -> tuple[np.ndarray, int, float]:
    """给"循环播放"的片段找最合适的收尾点：末尾里挑一帧最接近首帧的，截到那里。

    AI 生成的 10 秒片通常首尾不完全一致，直接循环会"闪一下"。
    """
    n = len(arr)
    if n < 8:
        return arr, n, 0.0
    f0 = arr[0][..., :3].astype(np.float32)
    best_j, best_d = n - 1, 1e9
    for j in range(int(n * search_from), n):
        d = float(np.abs(arr[j][..., :3].astype(np.float32) - f0).mean())
        if d < best_d:
            best_j, best_d = j, d
    return arr[: best_j + 1], best_j + 1, best_d


# ---------------------------------------------------------------- 主流程
def convert(src: Path, dst: Path, keep_frames: bool = False, crop_pct: float = 0.0,
            wm_boxes: list[tuple[float, float, float, float]] | None = None,
            match_ref: Path | None = None, match_mode: str = "mean",
            loop_trim_frames: bool = False, loop_pingpong: bool = False,
            loop_fade_frames: int = 0,
            gain: tuple[float, float, float] | None = None) -> dict:
    """crop_pct：四边各裁掉画面宽/高的这个比例（0.05 = 5%）。
    wm_boxes：要涂绿的水印矩形（比例坐标），在抠像前抹掉。
    match_ref：参考图，用它的前景像素统计把生成片校色（对付"生成片偏暗"）。

    豆包/即梦 的水印通常在左上角和右下角；能裁就裁，裁不掉的（比如横向很长）就用 wm_boxes 抹。
    两者都做完仍会按人物站高重新归一化到 640×360，构图不会跑。
    """
    w, h, fps = probe(src)
    arr = decode_rgb(src, w, h)
    if gain:
        g3 = np.array(gain, dtype=np.float32).reshape(1, 1, 3)
        arr = np.clip(arr.astype(np.float32) * g3, 0, 255).astype(np.uint8)
        lum0 = float((0.2126*arr[0][...,0] + 0.7152*arr[0][...,1] + 0.0722*arr[0][...,2]).mean())
        print(f"[增益] {gain} → 均值亮度 {lum0:.1f}")
    if crop_pct > 0:
        cx, cy = round(w * crop_pct), round(h * crop_pct)
        if cx * 2 >= w or cy * 2 >= h:
            raise SystemExit(f"裁剪比例太大：{crop_pct}")
        arr = arr[:, cy:h - cy, cx:w - cx]
        print(f"[裁剪] {w}×{h} → {arr.shape[2]}×{arr.shape[1]}（四边各 {crop_pct:.0%}）")
    if wm_boxes:
        arr = np.stack([erase_boxes(f, wm_boxes) for f in arr])
        print(f"[水印] 已抹掉 {len(wm_boxes)} 块区域：{wm_boxes}")
    if match_ref is not None:
        rmean, rstd = ref_stats(match_ref)
        pre = arr[0][_fg_mask(arr[0])].astype(np.float32)
        pre_lum = float((0.2126 * pre[:, 0] + 0.7152 * pre[:, 1] + 0.0722 * pre[:, 2]).mean())
        arr = match_color(arr, rmean, rstd, match_mode)
        post = arr[0][_fg_mask(arr[0])].astype(np.float32)
        post_lum = float((0.2126 * post[:, 0] + 0.7152 * post[:, 1] + 0.0722 * post[:, 2]).mean())
        print(f"[校色] 参考 {match_ref.name}  亮度 {pre_lum:.1f} → {post_lum:.1f}"
              f"（模式 {match_mode}）")
    if loop_fade_frames > 0:
        arr = loop_fade(arr, loop_fade_frames)
        print(f"[循环] 末尾 {loop_fade_frames} 帧渐隐到首帧，接缝为 0")
    if loop_pingpong:
        arr = np.concatenate([arr, arr[-2:0:-1]])
        print(f"[循环] 乒乓循环（正放+倒放），共 {len(arr)} 帧，接缝为零")
    if loop_trim_frames:
        arr, kept, seam = loop_trim(arr)
        print(f"[循环] 截到第 {kept} 帧（首尾差 {seam:.2f}），循环接缝更顺")
    keyed = np.stack([key_frame(f) for f in arr])
    frames_dir = WORK / src.stem
    if frames_dir.exists():
        shutil.rmtree(frames_dir)
    info = normalize(keyed, frames_dir)
    encode_webm(frames_dir, dst)
    if not keep_frames:
        shutil.rmtree(frames_dir, ignore_errors=True)
    info.update({"file": src.name, "frames": len(arr), "fps": round(fps, 3),
                 "crop": crop_pct, "wm": len(wm_boxes or []),
                 "matched": bool(match_ref), "loopTrim": loop_trim_frames, "pingpong": loop_pingpong, "loopFade": loop_fade_frames, "out": dst.name,
                 "outKB": round(dst.stat().st_size / 1024)})
    return info


def find_sources(src: Path, only: str | None) -> list[Path]:
    files = sorted(p for p in src.iterdir() if p.suffix.lower() in VIDEO_EXTS) if src.is_dir() else [src]
    if only:
        files = [p for p in files if p.stem == only]
    return files


# ---------------------------------------------------------------- 自测
def selftest() -> int:
    """用现有素材合成一段绿幕片 → 跑素材链 → 比对 alpha，验证算法没跑偏。"""
    from PIL import Image as Im

    src_frames = ROOT / "build" / "frames" / "待机呼吸"
    files = sorted(src_frames.glob("f*.png"))
    if not files:
        print("没有 build/frames/待机呼吸，先跑 tools/make_baijie_clips.py")
        return 1

    tmp = WORK / "selftest"
    if tmp.exists():
        shutil.rmtree(tmp, ignore_errors=True)
    green_frames = tmp / "green"
    green_frames.mkdir(parents=True)
    for i, p in enumerate(files):
        im = Im.open(p).convert("RGBA").resize((OUT_W * 2, OUT_H * 2), Im.LANCZOS)
        bg = Im.new("RGBA", im.size, (0, 255, 0, 255))
        bg.alpha_composite(im)
        bg.convert("RGB").save(green_frames / f"f{i:04d}.png")

    src_video = tmp / "待机呼吸.mp4"
    run([FFMPEG, "-y", "-loglevel", "error", "-framerate", str(FPS),
         "-i", str(green_frames / "f%04d.png"), "-c:v", "libx264", "-crf", "16",
         "-pix_fmt", "yuv420p", str(src_video)])

    out = tmp / "待机呼吸.webm"
    info = convert(src_video, out, keep_frames=True)
    print(f"[自测] 定标 {info}")

    # 比对 alpha：拿原始占位帧当 ground truth
    orig = np.stack([np.array(Im.open(p).convert("RGBA"))[..., 3] for p in files[: len(files)]])
    got_dir = WORK / src_video.stem
    got = np.stack([np.array(Im.open(p).convert("RGBA"))[..., 3]
                    for p in sorted(got_dir.glob("f*.png"))])
    n = min(len(orig), len(got))
    a = orig[:n] > 128
    b = got[:n] > 128
    iou = float((a & b).sum() / max(1, (a | b).sum()))
    cover_o, cover_g = float(a.mean()), float(b.mean())
    print(f"[自测] {n} 帧  alpha IoU = {iou:.3f}  （覆盖 original={cover_o:.3f} / chain={cover_g:.3f}）")
    print(f"[自测] 产物 {out}（{out.stat().st_size / 1024:.0f} KB）")
    print(f"[自测] 中间帧留在 {got_dir}")
    shutil.rmtree(green_frames, ignore_errors=True)
    return 0 if iou > 0.90 else 2


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, help="绿幕视频文件或目录")
    ap.add_argument("--dst", type=Path, default=DEFAULT_DST, help="输出目录（默认 petpack 动画目录）")
    ap.add_argument("--only", help="只处理这条（按文件名主干匹配）")
    ap.add_argument("--keep-frames", action="store_true", help="保留归一化后的 PNG 帧")
    ap.add_argument("--crop-pct", type=float, default=0.0,
                    help="四边各裁掉的比例（0.05 = 5%%），用来裁掉豆包/即梦的角标水印")
    ap.add_argument("--loop-fade", type=int, default=0, metavar="K",
                    help="循环片段：末尾 K 帧渐隐到首帧，接缝严格为 0（推荐待机用，K=12≈0.5s）")
    ap.add_argument("--loop-pingpong", action="store_true",
                    help="循环片段：正放+倒放拼成完美循环（接缝为零，但发丝动作会回放）")
    ap.add_argument("--loop-trim", action="store_true",
                    help="循环片段：自动截到最接近首帧的那一帧，消除循环接缝闪动")
    ap.add_argument("--match-ref", type=Path, default=None,
                    help="参考图 PNG：用它的前景亮度/色彩校正生成片（治生成片偏暗）")
    ap.add_argument("--match-mode", choices=["mean", "meanstd"], default="mean",
                    help="mean=只对齐亮度均值；meanstd=连对比度一起对齐")
    ap.add_argument("--wm-box", action="append", default=None,
                    help="要抹掉的水印矩形，比例坐标 x0,y0,x1,y1（可多次给），抹之前涂成纯绿")
    ap.add_argument("--gain", help="整体增益 R,G,B（例如 1.09,1.16,1.11），作用在抠像之前")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args(argv[1:])

    if args.selftest:
        return selftest()
    if not args.src:
        ap.print_help()
        return 1

    files = find_sources(args.src, args.only)
    if not files:
        print(f"没找到视频：{args.src}" + (f"（--only {args.only}）" if args.only else ""))
        return 1
    boxes: list[tuple[float, float, float, float]] = []
    for spec in (args.wm_box or []):
        try:
            nums = [float(x) for x in spec.replace("，", ",").split(",")]
            if len(nums) != 4:
                raise ValueError
            boxes.append((nums[0], nums[1], nums[2], nums[3]))
        except ValueError:
            print(f"--wm-box 格式不对：{spec}（要 x0,y0,x1,y1，比例坐标）")
            return 1
    for f in files:
        dst = args.dst / f"{f.stem}.webm"
        info = convert(f, dst, keep_frames=args.keep_frames, crop_pct=args.crop_pct,
                       wm_boxes=boxes, match_ref=args.match_ref, match_mode=args.match_mode,
                       loop_trim_frames=args.loop_trim, loop_pingpong=args.loop_pingpong,
                       loop_fade_frames=args.loop_fade,
                       gain=(tuple(float(v) for v in args.gain.split(",")) if args.gain else None))
        print(f"[完成] {info['file']} → {info['out']}  {info['outKB']} KB  "
              f"（{info['frames']} 帧 @ {info['fps']}fps，定标 scale={info['scale']}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

