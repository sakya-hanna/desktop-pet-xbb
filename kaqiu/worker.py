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


def box_sum(a, h, w):
    s = np.pad(a, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    return s[h:, w:] - s[:-h, w:] - s[h:, :-w] + s[:-h, :-w]


def correlation(gray, template):
    """Same zero-mean normalized correlation as supplied detect._match_group."""
    h, w = template.shape
    H, Wd = gray.shape
    if h > H or w > Wd or min(h, w) < 2:
        return np.full((1, 1), -1.0)
    g = gray.astype(np.float64)
    t = template.astype(np.float64) - template.mean()
    norm = np.sqrt((t * t).sum())
    if norm < 1e-6:
        return np.full((H-h+1, Wd-w+1), -1.0)
    shape = (H+h-1, Wd+w-1)
    corr = np.fft.irfft2(np.fft.rfft2(g, s=shape) * np.conj(np.fft.rfft2(t, s=shape)), s=shape)[:H-h+1, :Wd-w+1]
    variance = np.maximum(0, box_sum(g*g, h, w) - box_sum(g, h, w)**2/(h*w))
    denom = np.sqrt(variance) * norm
    return np.divide(corr, denom, out=np.full_like(corr, -1.0), where=denom > 1e-6)


class EdgeGate:
    """A persistent banner is one event, not a periodic cooldown retrigger."""
    def __init__(self):
        self.present = False
        self.absent_since = None
        self.hit_since = None

    def update(self, hit, now):
        if hit:
            self.absent_since = None
            if self.hit_since is None:
                self.hit_since = now
            if not self.present and now-self.hit_since >= 0.10:
                self.present = True
                return True
        else:
            self.hit_since = None
            if self.absent_since is None:
                self.absent_since = now
            if now-self.absent_since >= 0.6:
                self.present = False
        return False


class InstallGate:
    def __init__(self):
        self.first = self.last = self.missing = None

    def update(self, hit, now, min_seen, gone):
        if hit:
            if self.first is None:
                self.first = now
            self.last = now
            self.missing = None
        elif self.first is not None:
            if self.missing is None:
                self.missing = now
            if now-self.missing >= gone:
                fire = self.last-self.first >= min_seen
                self.first = self.last = self.missing = None
                return fire
        return False


class MessageGate:
    """Count matching own-message rows. Scrolling alone must not start a timer.

    New identical rows increase the count; disappearing chat re-arms after a
    sustained absence. A full chat containing visually identical replacements
    is intrinsically ambiguous without an additional game confirmation cue.
    """
    def __init__(self):
        self.count = 0
        self.candidate = 0
        self.since = 0
        self.absent = None

    def update(self, count, now):
        if not count:
            if self.absent is None:
                self.absent = now
            if now-self.absent >= 0.8:
                self.count = self.candidate = 0
            return False
        self.absent = None
        if count != self.candidate:
            self.candidate, self.since = count, now
        if now-self.since < 0.15:
            return False
        old, self.count = self.count, count
        return count > old


def own_message(sub, x, y, h, threshold):
    band = np.asarray(sub.crop((0, max(0, y-4), max(1, x), min(sub.height, y+h+4))), dtype=np.int16)
    if not band.size:
        return False
    r, g, b = band[..., 0], band[..., 1], band[..., 2]
    yellow = (r > 170) & (g > 140) & (b < 130) & (r-b > 60)
    blue = (b > 150) & (b-r > 40)
    return float(yellow.mean()) > max(threshold, float(blue.mean()))


class Recognizer:
    def __init__(self, assets=BASE/'assets'):
        self.assets = Path(assets)
        self.config = json.loads((self.assets/'config.default.json').read_text(encoding='utf-8-sig'))
        self.geometry = None
        self.rules = []
        self.selected = {'miao', 'notes'}
        self.edges = {}
        self.installs = {}
        self.messages = MessageGate()
        self.last_miao = -math.inf
        self.last_round = -math.inf
        self.profile = False

    def reset_contacts(self):
        self.installs.clear()  # Alt-tab/HUD loss must not mean a grenade was thrown.

    def clear(self):
        self.reset_contacts()
        # Keep visible-banner latches: clearing a round must not immediately
        # re-detect the same screen. New screen appearances can re-arm normally.

    def configure(self, cards):
        self.selected = set(cards) & CARD_IDS
        self.geometry = None

    def setup(self, geometry):
        if geometry == self.geometry:
            return
        self.geometry = geometry
        _, _, width, height = geometry
        self.reset_contacts()
        self.profile = (width, height) == (2560, 1600)
        profile = next((p for p in self.config['profiles'] if tuple(p['size']) == (width, height)), None)
        definitions = profile['rules'] if profile else self.config['rules']
        folder = self.assets/(profile['templates'] if profile else 'templates')
        self.rules = []
        for r in definitions:
            if r['card'] not in self.selected and r.get('action') != 'gameover':
                continue
            source = Image.open(folder/r['template']).convert('L')
            sx, sy = (1, 1) if profile else (width/1920, height/1080)
            x, y, w, h = r['region']
            if profile:
                rect = (x, y, w, h)
            else:
                anchor = r.get('anchor', 'left')
                x = width-(1920-x)*sx if anchor == 'right' else width/2+(x-960)*sx if anchor == 'center' else x*sx
                rect = (int(x), int(y*sy), int(w*sx), int(h*sy))
            variants = []
            for jitter in r.get('jitters', self.config.get('jitters', [1])):
                variants.append(np.asarray(source.resize((max(2, round(source.width*sx*jitter)), max(2, round(source.height*sy*jitter))), Image.Resampling.BILINEAR), dtype=np.float32))
            self.rules.append((r, rect, variants))

    def process(self, frame, now):
        events = []
        for r, (x, y, w, h), templates in self.rules:
            # Clip the scan ROI to the client; no extra desktop capture.
            sub = frame.crop((max(0, x), max(0, y), min(frame.width, x+w), min(frame.height, y+h))).convert('RGB')
            if min(sub.size) < 2:
                continue
            gray = np.asarray(sub.convert('L'), dtype=np.float32)
            threshold = r.get('threshold', self.config['match_threshold'])
            maps = [(correlation(gray, tpl), tpl.shape) for tpl in templates]
            scoremap, (th, tw) = max(maps, key=lambda item: float(item[0].max()))
            hit = float(scoremap.max()) >= threshold
            cid, key = r['card'], r.get('key', r['card'])
            if cid == 'miao':
                rows = []
                candidates = scoremap.copy()
                while len(rows) < 12 and float(candidates.max()) >= threshold:
                    yy, xx = np.unravel_index(int(candidates.argmax()), candidates.shape)
                    if own_message(sub, int(xx), int(yy), th, r.get('owner_yellow', 0.003)):
                        rows.append(int(yy))
                    candidates[max(0, yy-th//2):yy+th, :] = -1
                if self.messages.update(len(rows), now) and now-self.last_miao >= 15:
                    self.last_miao = now
                    events.append({'type':'trigger', 'card':'miao'})
            elif r.get('type') == 'install':
                gate = self.installs.setdefault(key, InstallGate())
                if gate.update(hit, now, r.get('min_seen', 1), r.get('gone_sec', 0.9)):
                    events.append({'type':'trigger', 'card':cid})
            elif self.edges.setdefault(key, EdgeGate()).update(hit, now):
                if r.get('action') == 'gameover':
                    if now-self.last_round >= 15:
                        self.last_round = now
                        self.reset_contacts()
                        events.append({'type':'round-end'})
                else:
                    events.append({'type':'trigger', 'card':cid})
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
                        send_miao(native, lambda:not stopped.is_set() and state['miaoEnabled'], emit)
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
                if detector.profile:
                    status = '16:10 模板：喵喵暂需手动计时，其他已选卡牌可识别'
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
