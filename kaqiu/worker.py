"""Kaqiu recognition/input helper. No UI, imports of the supplied EXE, or game memory access.

Templates/regions/timings come from the user's F8 package. Matching follows its
PIL + numpy normalized-correlation approach; this is editable source rebuilt
from the verified app/detect control flow, not recovered original source.
"""
import argparse
import ctypes as C
from ctypes import wintypes as W
import json
import math
import os
from pathlib import Path
import queue
import sys
import threading
import time
import uuid

import numpy as np
from PIL import Image, ImageGrab

BASE = Path(getattr(sys, '_MEIPASS', Path(__file__).parent))
CARD_IDS = {'miao', 'notes', 'endeye', 'beacon', 'analyzer'}


_FFT_CACHE = {}
_FAST_LEN_CACHE = {}


def _fast_fft_len(n):
    cached = _FAST_LEN_CACHE.get(n)
    if cached is not None:
        return cached
    best = 1 << (n - 1).bit_length()
    for a in range(14):
        p2 = 1 << a
        if p2 >= best:
            break
        for b in range(9):
            p23 = p2 * (3 ** b)
            if p23 >= best:
                break
            v = p23
            while v < n:
                v *= 5
            if v < best:
                best = v
    _FAST_LEN_CACHE[n] = best
    return best


def _clear_fft_cache():
    if len(_FFT_CACHE) > 256:
        _FFT_CACHE.clear()


def box_sum(a, h, w):
    s = np.pad(a.astype(np.float64, copy=False), ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    return s[h:, w:] - s[:-h, w:] - s[h:, :-w] + s[:-h, :-w]


def correlation(gray, template, mask=None, cache_key=None):
    """Fast 5-smooth FFT zero-mean normalized cross-correlation (with optional mask)."""
    h, w = template.shape
    H, Wd = gray.shape
    if h > H or w > Wd or min(h, w) < 2:
        return np.full((1, 1), -1.0, dtype=np.float32)

    shape = (_fast_fft_len(H + h - 1), _fast_fft_len(Wd + w - 1))
    full_key = (cache_key, shape) if cache_key is not None else None
    cached = _FFT_CACHE.get(full_key) if full_key is not None else None

    if cached is None:
        t = template.astype(np.float32, copy=False)
        if mask is not None:
            m = mask.astype(np.float32, copy=False)
            wsum = float(m.sum())
            if wsum < 4.0:
                return np.full((H - h + 1, Wd - w + 1), -1.0, dtype=np.float32)
            t_mean = float((t * m).sum()) / wsum
            t0 = (t - t_mean) * m
            norm = float(np.sqrt((((t - t_mean) ** 2) * m).sum()))
            t_fft = np.conj(np.fft.rfft2(t0, s=shape))
            m_fft = np.conj(np.fft.rfft2(m, s=shape))
            cached = (True, t_fft, m_fft, wsum, norm)
        else:
            t0 = t - float(t.mean())
            norm = float(np.sqrt((t0 * t0).sum()))
            t_fft = np.conj(np.fft.rfft2(t0, s=shape))
            cached = (False, t_fft, None, float(h * w), norm)
        if full_key is not None:
            _clear_fft_cache()
            _FFT_CACHE[full_key] = cached

    has_mask, t_fft, m_fft, wsum, norm = cached
    if norm < 1e-6:
        return np.full((H - h + 1, Wd - w + 1), -1.0, dtype=np.float32)

    g = gray.astype(np.float32, copy=False)
    g_zero = g - float(g.mean())
    oh, ow = H - h + 1, Wd - w + 1
    g_fft = np.fft.rfft2(g_zero, s=shape)
    corr = np.fft.irfft2(g_fft * t_fft, s=shape)[:oh, :ow]

    if has_mask:
        sum_wg = np.fft.irfft2(g_fft * m_fft, s=shape)[:oh, :ow]
        sum_wg2 = np.fft.irfft2(np.fft.rfft2(g_zero * g_zero, s=shape) * m_fft, s=shape)[:oh, :ow]
        variance = np.maximum(0.0, sum_wg2 - (sum_wg * sum_wg) / wsum)
    else:
        gd = g_zero.astype(np.float64, copy=False)
        variance = np.maximum(0.0, box_sum(gd * gd, h, w) - box_sum(gd, h, w) ** 2 / wsum)

    min_var = 4.0 * wsum  # Require >= 2.0/255 local patch std-dev; eliminates flat-screen false peaks
    denom = np.sqrt(variance) * norm
    out = np.full((oh, ow), -1.0, dtype=np.float32)
    valid = (variance >= min_var) & (denom > 1e-3)
    out[valid] = np.clip(corr[valid] / denom[valid], -1.0, 1.0).astype(np.float32)
    return out


def yellow_channel(rgb_arr):
    """ Isolate warm golden HUD text ('已记录成功') from bright snow/sky backgrounds."""
    r = rgb_arr[..., 0].astype(np.float32)
    g = rgb_arr[..., 1].astype(np.float32)
    b = rgb_arr[..., 2].astype(np.float32)
    return np.clip(0.55 * r + 0.45 * g - 0.65 * b + 64.0, 0.0, 255.0)


class EdgeGate:
    """A persistent banner is one event, not a periodic cooldown retrigger."""
    def __init__(self, confirm_sec=0.05, release_sec=0.55):
        self.present = False
        self.absent_since = None
        self.hit_since = None
        self.confirm_sec = confirm_sec
        self.release_sec = release_sec

    def update(self, hit, now):
        if hit:
            self.absent_since = None
            if self.hit_since is None:
                self.hit_since = now
            if not self.present and now - self.hit_since >= self.confirm_sec:
                self.present = True
                return True
        else:
            self.hit_since = None
            if self.absent_since is None:
                self.absent_since = now
            if now - self.absent_since >= self.release_sec:
                self.present = False
        return False


class InstallGate:
    """Matches Reference app.py install state machine with explicit `armed` latch."""
    def __init__(self):
        self.first = self.last = self.missing = None
        self.armed = False

    def update(self, hit, now, min_seen, gone):
        if hit:
            if self.first is None:
                self.first = now
            self.last = now
            self.missing = None
            if now - self.first >= min_seen:
                self.armed = True
        elif self.first is not None:
            if self.missing is None:
                self.missing = now
            if now - self.missing >= gone:
                fire = self.armed or (self.last - self.first >= min_seen)
                self.first = self.last = self.missing = None
                self.armed = False
                return fire
        return False


class MessageGate:
    """Detects new own-player '喵喵赐福' chat rows, including full-chat upward scroll."""
    def __init__(self):
        self.count = 0
        self.rows = ()
        self.candidate = (0, ())
        self.since = 0.0
        self.absent = None

    @staticmethod
    def _quantize(rows, line_h):
        step = max(6, line_h // 2)
        return tuple(round(y / step) for y in sorted(rows))

    def update(self, rows, now, line_h=24, recent_f8=False):
        count = len(rows)
        if not count:
            if self.absent is None:
                self.absent = now
            if now - self.absent >= 0.75:
                self.count = 0
                self.rows = ()
                self.candidate = (0, ())
            return False

        self.absent = None
        qrows = self._quantize(rows, line_h)
        sig = (count, qrows)
        if sig != self.candidate:
            self.candidate = sig
            self.since = now
        if now - self.since < (0.06 if recent_f8 else 0.11):
            return False

        old_count, old_rows = self.count, self.rows
        self.count, self.rows = count, sorted(rows)
        if count > old_count:
            return True
        # Full chat box scroll: an older own-message scrolled off the top while a new
        # message appeared at the bottom (count stays >=1, top/bottom rows shifted up
        # or F8 was just dispatched and row layout shifted).
        if old_count > 0 and old_rows:
            shifted_up = any(all(abs(oy - ny) >= max(10, int(line_h * 0.65)) for oy in old_rows) for ny in self.rows)
            if shifted_up and (recent_f8 or self.rows[-1] >= old_rows[-1] - 4):
                return True
        return False


def own_message(sub, x, y, h, threshold):
    band = np.asarray(sub.crop((0, max(0, y - 4), max(1, x), min(sub.height, y + h + 4))), dtype=np.int16)
    if not band.size:
        return False
    r, g, b = band[..., 0], band[..., 1], band[..., 2]
    yellow = (r > 165) & (g > 135) & (b < 135) & (r - b > 55)
    blue = (b > 150) & (b - r > 40)
    return float(yellow.mean()) > max(threshold, float(blue.mean()))


class Recognizer:
    def __init__(self, assets=BASE / 'assets'):
        self.assets = Path(assets)
        self.config = json.loads((self.assets / 'config.default.json').read_text(encoding='utf-8-sig'))
        self.geometry = None
        self.uiscale = 1.0
        self.rules = []
        self.selected = {'miao', 'notes'}
        self.edges = {}
        self.installs = {}
        self.messages = MessageGate()
        self.last_miao = -math.inf
        self.last_round = -math.inf
        self.last_checked = {}
        self.last_scores = {}
        self.recent_f8_until = -math.inf
        self.cache_id = object()

    def notify_f8(self, now):
        self.recent_f8_until = now + 3.2

    def reset_contacts(self):
        self.installs.clear()

    def clear(self):
        self.reset_contacts()

    def configure(self, cards):
        self.selected = set(cards) & CARD_IDS
        self.geometry = None

    def _build_rule_specs(self, width, height):
        u = min(width / 1920.0, height / 1080.0)
        self.uiscale = u
        v2 = self.assets / 'templates_v2'
        v1 = self.assets / 'templates'
        use_v2 = v2.exists()

        specs = [
            {
                'card': 'endeye',
                'key': 'endeye',
                'path': (v2 / 'endeye_clean.png') if use_v2 else (v1 / 'endeye_name.png'),
                'rect': (int(185 * u), int(height * 0.5 + 15 * u), int(290 * u), int(155 * u)),
                'threshold': 0.80,
                'jitters': (1.0, 0.96, 1.04),
            },
            {
                'card': 'beacon',
                'key': 'beacon',
                'type': 'install',
                'path': (v2 / 'beacon_clean.png') if use_v2 else (v1 / 'beacon_text.png'),
                'rect': (int(width * 0.5 + 110 * u), int(height * 0.5 + 150 * u), int(470 * u), int(200 * u)),
                'threshold': 0.78,
                'min_seen': 0.42,
                'gone_sec': 0.55,
                'jitters': (1.0, 0.96, 1.04),
            },
            {
                'card': 'notes',
                'key': 'notes',
                'path': (v2 / 'notes_text.png') if use_v2 else (v1 / 'notes_banner.png'),
                'rect': (int(width * 0.5 - 190 * u), int(185 * u), int(380 * u), int(215 * u)),
                'threshold': 0.72,
                'yellow_boost': True,
                'jitters': (1.0, 0.96, 1.04),
            },
            {
                'card': 'analyzer',
                'key': 'analyzer_upper',
                'type': 'install',
                'path': (v2 / 'analyzer_octagon.png') if use_v2 else (v1 / 'analyzer_icon4.png'),
                'mask_path': (v2 / 'analyzer_mask.png') if use_v2 else None,
                'rect': (int(width - 170 * u), int(height * 0.5 + 75 * u), int(170 * u), int(97 * u)),
                'threshold': 0.80,
                'min_seen': 0.22,
                'gone_sec': 0.28,
                'jitters': (1.0, 0.96, 1.04),
            },
            {
                'card': 'analyzer',
                'key': 'analyzer_lower',
                'type': 'install',
                'path': (v2 / 'analyzer_octagon.png') if use_v2 else (v1 / 'analyzer_icon.png'),
                'mask_path': (v2 / 'analyzer_mask.png') if use_v2 else None,
                'rect': (int(width - 170 * u), int(height * 0.5 + 171 * u), int(170 * u), int(125 * u)),
                'threshold': 0.80,
                'min_seen': 0.22,
                'gone_sec': 0.28,
                'jitters': (1.0, 0.96, 1.04),
            },
            {
                'card': 'miao',
                'key': 'miao',
                'path': (v2 / 'miao_prefix.png') if use_v2 else (v1 / 'miao_text.png'),
                'rect': (
                    0,
                    int(min(height * 0.5 + 175 * u, height - 370 * u)),
                    int(460 * u),
                    int(max(290 * u, height - 65 * u - min(height * 0.5 + 175 * u, height - 370 * u))),
                ),
                'threshold': 0.80,
                'owner_yellow': 0.0025,
                'jitters': (1.0, 0.96, 1.04),
            },
            {
                'card': 'victory_super',
                'key': 'victory_super',
                'action': 'gameover',
                'interval': 0.85,
                'path': v1 / 'victory_super.png',
                'rect': (int(width * 0.5 - 315 * u), int(height * 0.5 - 285 * u), int(630 * u), int(165 * u)),
                'threshold': 0.86,
                'jitters': (1.0,),
            },
            {
                'card': 'victory_crystal',
                'key': 'victory_crystal',
                'action': 'gameover',
                'interval': 0.85,
                'path': v1 / 'victory_crystal.png',
                'rect': (int(width * 0.5 - 315 * u), int(height * 0.5 - 285 * u), int(630 * u), int(165 * u)),
                'threshold': 0.86,
                'jitters': (1.0,),
            },
        ]
        # Exact measured layouts take priority for already-supported cards.
        # Use the scaled V2 rules for cards absent from an exact profile.
        profile = next((p for p in self.config['profiles'] if tuple(p['size']) == (width, height)), None)
        if profile:
            authored = [
                {**r, 'key': r.get('key', r['card']), 'path': self.assets / profile['templates'] / r['template'],
                 'rect': tuple(r['region']), 'template_scale': 1.0, 'jitters': (1.0,),
                 'threshold': r.get('threshold', self.config['match_threshold'])}
                for r in profile['rules']
            ]
            covered = {r['card'] for r in authored}
            return authored + [r for r in specs if r['card'] not in covered]
        return specs

    def setup(self, geometry):
        if geometry == self.geometry:
            return
        self.geometry = geometry
        _, _, width, height = geometry
        if width < 300 or height < 200:
            self.rules = []
            return
        self.reset_contacts()
        self.last_checked.clear()
        self.rules = []
        for spec in self._build_rule_specs(width, height):
            if spec['card'] not in self.selected and spec.get('action') != 'gameover':
                continue
            src_rgb = Image.open(spec['path']).convert('RGB')
            src_gray = src_rgb.convert('L')
            src_mask = Image.open(spec['mask_path']).convert('L') if spec.get('mask_path') and spec['mask_path'].exists() else None
            variants = []
            scale = spec.get('template_scale', self.uiscale)
            for jitter in spec.get('jitters', (1.0,)):
                tw = max(2, round(src_gray.width * scale * jitter))
                th = max(2, round(src_gray.height * scale * jitter))
                tpl_g = np.asarray(src_gray.resize((tw, th), Image.Resampling.BILINEAR), dtype=np.float32)
                tpl_m = (np.asarray(src_mask.resize((tw, th), Image.Resampling.BILINEAR), dtype=np.float32) / 255.0) if src_mask else None
                tpl_y = yellow_channel(np.asarray(src_rgb.resize((tw, th), Image.Resampling.BILINEAR), dtype=np.uint8)) if spec.get('yellow_boost') else None
                ckey = (self.cache_id, spec['key'], width, height, round(jitter, 3))
                variants.append((jitter, tpl_g, tpl_m, tpl_y, ckey))
            self.rules.append((spec, spec['rect'], variants))

    def _eval_variant(self, gray, yel, variant, threshold=1.0):
        _, tpl_g, tpl_m, tpl_y, ckey = variant
        smap = correlation(gray, tpl_g, mask=tpl_m, cache_key=(ckey, 'g'))
        best = float(smap.max())
        if best < threshold and tpl_y is not None and yel is not None:
            ymap = correlation(yel, tpl_y, mask=tpl_m, cache_key=(ckey, 'y'))
            ybest = float(ymap.max())
            if ybest > best:
                smap, best = ymap, ybest
        return smap, best, tpl_g.shape

    def process(self, frame, now):
        events = []
        for spec, (x, y, w, h), variants in self.rules:
            cid, key = spec['card'], spec['key']
            interval = spec.get('interval', 0.0)
            if interval > 0.0 and (key not in self.edges or self.edges[key].hit_since is None):
                prev_t = self.last_checked.get(key, -math.inf)
                if 0.0 <= now - prev_t < interval:
                    continue
                self.last_checked[key] = now
            x0, y0 = max(0, x), max(0, y)
            x1, y1 = min(frame.width, x + w), min(frame.height, y + h)
            if x1 - x0 < 4 or y1 - y0 < 4:
                continue
            sub = frame.crop((x0, y0, x1, y1)).convert('RGB')
            rgb = np.asarray(sub, dtype=np.uint8)
            gray = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]).astype(np.float32)

            threshold = spec['threshold']
            skip_fft = False
            if spec.get('yellow_boost'):
                r16 = rgb[..., 0].astype(np.int16)
                if int(((r16 > 165) & (rgb[..., 1] > 125) & (r16 - rgb[..., 2] > 45)).sum()) < 20:
                    skip_fft = True
            elif spec.get('mask_path') is not None:
                if int((gray > 195).sum()) < 25:
                    skip_fft = True
            elif cid in ('miao', 'endeye', 'beacon') or spec.get('action') == 'gameover':
                if float(gray.max()) - float(gray.min()) < 28.0:
                    skip_fft = True

            if skip_fft:
                self.last_scores[key] = 0.0
                if cid == 'miao':
                    self.messages.update([], now)
                elif spec.get('type') == 'install':
                    if self.installs.setdefault(key, InstallGate()).update(False, now, spec.get('min_seen', 0.25), spec.get('gone_sec', 0.45)):
                        events.append({'type': 'trigger', 'card': cid})
                else:
                    self.edges.setdefault(key, EdgeGate()).update(False, now)
                continue

            yel = yellow_channel(rgb) if spec.get('yellow_boost') else None
            # Stage 1: primary scale (jitter = 1.0)
            scoremap, best_score, (th, tw) = self._eval_variant(gray, yel, variants[0], threshold)
            # Stage 2: only probe scale jitters on borderline misses
            if best_score < threshold and best_score >= threshold - 0.14 and len(variants) > 1:
                for var in variants[1:]:
                    sm2, sc2, shp2 = self._eval_variant(gray, yel, var, threshold)
                    if sc2 > best_score:
                        scoremap, best_score, (th, tw) = sm2, sc2, shp2

            self.last_scores[key] = round(best_score, 3)
            hit = best_score >= threshold

            if cid == 'miao':
                rows = []
                candidates = scoremap.copy()
                while len(rows) < 12 and float(candidates.max()) >= threshold:
                    yy, xx = np.unravel_index(int(candidates.argmax()), candidates.shape)
                    if own_message(sub, int(xx), int(yy), th, spec.get('owner_yellow', 0.0025)):
                        rows.append(int(yy))
                    # Suppress full template height above AND below to prevent double-peak jitter
                    candidates[max(0, yy - th):min(candidates.shape[0], yy + th), :] = -1.0
                recent_f8 = now <= self.recent_f8_until
                if self.messages.update(rows, now, line_h=th, recent_f8=recent_f8) and now - self.last_miao >= 15:
                    self.last_miao = now
                    events.append({'type': 'trigger', 'card': 'miao'})
            elif spec.get('type') == 'install':
                gate = self.installs.setdefault(key, InstallGate())
                if gate.update(hit, now, spec.get('min_seen', 0.25), spec.get('gone_sec', 0.45)):
                    events.append({'type': 'trigger', 'card': cid})
            elif self.edges.setdefault(key, EdgeGate()).update(hit, now):
                if spec.get('action') == 'gameover':
                    if now - self.last_round >= 15:
                        self.last_round = now
                        self.reset_contacts()
                        events.append({'type': 'round-end'})
                else:
                    events.append({'type': 'trigger', 'card': cid})
        return events


class Windows:
    def __init__(self):
        self.u = C.WinDLL('user32', use_last_error=True)
        self.k = C.WinDLL('kernel32', use_last_error=True)
        try:
            C.WinDLL('shcore').SetProcessDpiAwareness(2)
        except OSError:
            self.u.SetProcessDPIAware()
        self.u.GetForegroundWindow.restype = W.HWND
        self.u.GetWindowThreadProcessId.argtypes = (W.HWND, C.POINTER(W.DWORD))
        self.u.GetClientRect.argtypes = (W.HWND, C.POINTER(W.RECT))
        self.u.ClientToScreen.argtypes = (W.HWND, C.POINTER(W.POINT))
        self.u.IsIconic.argtypes = (W.HWND,)
        self.k.OpenProcess.argtypes = (W.DWORD, W.BOOL, W.DWORD)
        self.k.OpenProcess.restype = W.HANDLE
        self.k.QueryFullProcessImageNameW.argtypes = (W.HANDLE, W.DWORD, W.LPWSTR, C.POINTER(W.DWORD))
        self.k.CloseHandle.argtypes = (W.HANDLE,)
        self.cache = (None, False)

    def game(self):
        hwnd = self.u.GetForegroundWindow()
        if not hwnd or self.u.IsIconic(hwnd):
            return None
        if hwnd != self.cache[0]:
            pid = W.DWORD()
            self.u.GetWindowThreadProcessId(hwnd, C.byref(pid))
            handle = self.k.OpenProcess(0x1000, False, pid.value)
            ok = False
            if handle:
                try:
                    buf, size = C.create_unicode_buffer(32768), W.DWORD(32768)
                    if self.k.QueryFullProcessImageNameW(handle, 0, buf, C.byref(size)):
                        name = Path(buf.value).name.lower()
                        ok = name in {'calabiyau-win64-shipping.exe', 'calabiyau.exe', 'calabiyau', 'calabiyau-win64-test.exe', 'strinova-win64-shipping.exe', 'strinova.exe'}
                finally:
                    self.k.CloseHandle(handle)
            self.cache = (hwnd, ok)
        if not self.cache[1]:
            return None
        rect, point = W.RECT(), W.POINT()
        if not self.u.GetClientRect(hwnd, C.byref(rect)) or not self.u.ClientToScreen(hwnd, C.byref(point)):
            return None
        if rect.right < 300 or rect.bottom < 200:
            return None
        return hwnd, (point.x, point.y, rect.right, rect.bottom)

    def down(self, vk):
        return bool(self.u.GetAsyncKeyState(vk) & 0x8000)

    @staticmethod
    def admin():
        return bool(C.windll.shell32.IsUserAnAdmin())

    def send(self, vk=0, char=0):
        class KEY(C.Structure):
            _fields_ = [('vk', W.WORD), ('scan', W.WORD), ('flags', W.DWORD), ('time', W.DWORD), ('extra', C.c_size_t)]
        class MOUSE(C.Structure):
            _fields_ = [('dx', W.LONG), ('dy', W.LONG), ('data', W.DWORD), ('flags', W.DWORD), ('time', W.DWORD), ('extra', C.c_size_t)]
        class UNION(C.Union):
            _fields_ = [('ki', KEY), ('mi', MOUSE)]
        class INPUT(C.Structure):
            _anonymous_ = ('u',)
            _fields_ = [('type', W.DWORD), ('u', UNION)]
        values = (INPUT*2)()
        flags = 4 if char else 0
        for i in range(2):
            values[i].type = 1
            values[i].ki = KEY(vk, char, flags | (2 if i else 0), 0, 0)
        return self.u.SendInput(2, values, C.sizeof(INPUT)) == 2


def send_miao(native, allowed, emit, wait=time.sleep):
    """One key press, one sequence. Input submission != game confirmation."""
    game = native.game()
    if not game or not allowed():
        return False
    target = game[0]
    request = uuid.uuid4().hex
    for vk, char, delay in [(13, 0, 0.18), (0, ord('喵'), 0.06), (13, 0, 0)]:
        current = native.game()
        if not allowed() or not current or current[0] != target:
            emit({'type':'input-error', 'message':'游戏已离开前台，一键喵已停止。'})
            return False
        if not native.send(vk, char):
            emit({'type':'input-error', 'message':'一键喵未能提交按键；请在计时菜单授权 F8 辅助程序。'})
            return False
        if delay:
            wait(delay)
    emit({'type':'input-dispatched', 'requestId':request, 'at':round(time.time()*1000)})
    return True


class Capture:
    # Keep a single in-flight capture. A stalled ImageGrab must not accumulate
    # more capture threads or stop F8 polling and IPC shutdown.
    def __init__(self):
        self.thread = None
        self.result = queue.Queue(maxsize=1)
        self.started = 0
        self.geometry = None

    def get(self, geometry):
        if self.thread is not None:
            try:
                result = self.result.get_nowait()
            except queue.Empty:
                return None
            self.thread = None
            return result if geometry == self.geometry else None
        self.geometry, self.started = geometry, time.monotonic()
        x, y, w, h = geometry
        def run():
            try:
                value = ImageGrab.grab(bbox=(x, y, x+w, y+h), all_screens=True)
            except Exception:
                value = None
            self.result.put(value)
        self.thread = threading.Thread(target=run, daemon=True)
        self.thread.start()
        return None


def run(pipe, probe=False):
    stopped = threading.Event()
    messages = queue.Queue()
    write_lock = threading.Lock()
    state = {'miaoEnabled':False}
    # A blocking read on this synchronous Windows pipe also blocks a concurrent
    # write (even with dup). Peek first and read only bytes already available.
    # The main loop owns reads; F8 and detection share the short write lock.
    import msvcrt
    with open(pipe, 'r+b', buffering=0) as channel:
        handle = msvcrt.get_osfhandle(channel.fileno())
        peek = C.WinDLL('kernel32', use_last_error=True).PeekNamedPipe
        peek.argtypes = (W.HANDLE, C.c_void_p, W.DWORD, C.c_void_p, C.POINTER(W.DWORD), C.c_void_p)
        buffer = b''
        def emit(value):
            if stopped.is_set():
                return
            value.setdefault('at', round(time.time()*1000))
            try:
                with write_lock:
                    channel.write((json.dumps(value, ensure_ascii=False)+'\n').encode('utf-8'))
            except OSError:
                stopped.set()
        def read():
            nonlocal buffer
            try:
                available = W.DWORD()
                if not peek(handle, None, 0, None, C.byref(available), None):
                    stopped.set()
                    return
                if not available.value:
                    return
                buffer += channel.read(min(4096, available.value))
                if len(buffer) > 65536:
                    stopped.set()
                    return
                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    msg = json.loads(line)
                    if msg.get('type') == 'stop':
                        stopped.set()
                    else:
                        messages.put(msg)
            except (OSError, ValueError):
                stopped.set()
        if probe:
            # Native pipeline smoke check: original packaged image -> detector
            # -> real pipe. No Windows object, capture, key polling or SendInput.
            detector = Recognizer()
            emit({'type':'ready', 'admin':False})
            while not stopped.wait(0.05):
                read()
                if stopped.is_set():
                    break
                while not messages.empty():
                    msg = messages.get_nowait()
                    if msg.get('type') == 'configure':
                        detector.configure(['notes'])
                        detector.setup((0, 0, 1920, 1080))
                        frame = Image.new('RGB', (1920, 1080), (20, 20, 20))
                        frame.paste(Image.open(detector.assets/'templates/notes_banner.png').convert('RGB'), (760, 240))
                        detector.process(frame, 0)
                        for event in detector.process(frame, .2):
                            emit(event)
                        emit({'type':'probe-complete', 'pid':os.getpid(), 'nativeInput':False, 'capture':False})
            return
        native, detector, capture = Windows(), Recognizer(), Capture()
        def keys():
            old_f8 = native.down(0x77)
            old_clear = native.down(0x4B)
            while not stopped.wait(0.03):
                f8, clear = native.down(0x77), native.down(0x4B)
                if f8 and not old_f8 and state['miaoEnabled']:
                    # Do not carry Ctrl/Alt/Shift/Win into the Enter sequence.
                    if not any(native.down(v) for v in [0x10, 0x11, 0x12, 0x5B, 0x5C]):
                        if send_miao(native, lambda:not stopped.is_set() and state['miaoEnabled'], emit):
                            detector.notify_f8(time.monotonic())
                if clear and not old_clear and native.down(0x11) and native.game():
                    emit({'type':'clear'})
                old_f8, old_clear = f8, clear
        threading.Thread(target=keys, daemon=True).start()
        emit({'type':'ready', 'admin':native.admin()})
        last_status = None
        while not stopped.wait(0.05):
            read()
            if stopped.is_set():
                break
            while not messages.empty():
                msg = messages.get_nowait()
                if msg.get('type') == 'configure':
                    detector.configure(msg.get('cards', []))
                    state['miaoEnabled'] = msg.get('miaoEnabled') is True
                elif msg.get('type') == 'clear':
                    detector.clear()
            game = native.game()
            if not game:
                detector.reset_contacts()
                status = '等待卡拉比丘前台 · 已有计时继续'
            else:
                _, geometry = game
                detector.setup(geometry)
                status = '正在识别游戏画面'
                frame = capture.get(geometry)
                if frame is not None:
                    # Ignore a frame if the player switched apps while capturing.
                    current = native.game()
                    if current and current[0] == game[0] and current[1] == geometry:
                        for event in detector.process(frame, time.monotonic()):
                            emit(event)
                elif capture.thread is not None and time.monotonic()-capture.started > 2:
                    status = '当前未取得游戏画面，可手动计时'
            if status != last_status:
                emit({'type':'status', 'text':status})
                last_status = status


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--pipe', required=True)
    parser.add_argument('--probe', action='store_true')
    args = parser.parse_args()
    # Only the owning desktop application creates this private local endpoint.
    if not args.pipe.startswith('\\\\.\\pipe\\baijie-kaqiu-'):
        raise SystemExit('Invalid owner pipe')
    run(args.pipe, args.probe)
