"""
Juice's sounds, synthesised from scratch (no samples). Writes WAVs into assets/juice/:

- plug: the plug going in, a crackle of electricity, and the stream whooshing across the floor
  toward the dock (it lands 0.44 s in, where `surge` takes over)
- surge: the charge landing: a deep whump, a bright shimmer as the rays flare, the capsule gulping
  it down (glugs) and a fizz of bubbles that thins out
- unplug: the pull, a power-down sweep, a few dying crackles and the last drop falling in
- full: three soft bells going up
- splash: a tap on the glass: the liquid slopping, a few bubbles

    python3 scripts/juice_sounds.py   (needs numpy: Blender's own python has it)
"""

import os
import wave

import numpy as np

SR = 44100
OUT = os.environ.get('OUT') or os.path.join(os.path.dirname(__file__), '..', 'assets', 'juice')
rng = np.random.default_rng(11)


def write(name, x, peak=0.89):
    x = x / (np.max(np.abs(x)) + 1e-9) * peak
    # Down to where it's gone quiet (-60 dB), with a short fade so the end doesn't click
    loud = np.nonzero(np.abs(x) > 0.001)[0]
    end = min(len(x), (loud[-1] if len(loud) else len(x)) + int(SR * 0.05))
    x = x[:end] * np.minimum(1, (end - np.arange(end)) / (SR * 0.05))
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    os.makedirs(OUT, exist_ok=True)
    with wave.open(os.path.join(OUT, name), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print('wrote', name, round(len(x) / SR, 2), 's')


def silence(seconds):
    return np.zeros(int(seconds * SR))


def at(buf, start, x, gain=1.0):
    """Mix x into buf from `start` seconds"""
    i = int(start * SR)
    j = min(len(buf), i + len(x))
    if j > i:
        buf[i:j] += x[: j - i] * gain


def band(x, lo, hi):
    """Brick-ish band-pass in the frequency domain, soft edges"""
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X = np.fft.rfft(x)
    edge = lambda v, c, w: 1 / (1 + np.exp(-(v - c) / w))
    mask = edge(f, lo, lo * 0.15 + 1) * (1 - edge(f, hi, hi * 0.15 + 1))
    return np.fft.irfft(X * mask, len(x))


def resonator(x, f, bw):
    """Two-pole resonator, f may change per sample (an array)"""
    f = np.broadcast_to(np.asarray(f, dtype=float), x.shape)
    r = np.exp(-np.pi * bw / SR)
    y = np.zeros_like(x)
    y1 = y2 = 0.0
    for i in range(len(x)):
        a1 = -2 * r * np.cos(2 * np.pi * f[i] / SR)
        v = (1 - r) * x[i] - a1 * y1 - r * r * y2
        y[i] = v
        y2, y1 = y1, v
    return y


def sweep(f0, f1, seconds, curve=1.0):
    """A sine gliding from f0 to f1 (exponentially), its phase kept continuous"""
    n = int(seconds * SR)
    t = np.arange(n) / n
    f = f0 * (f1 / f0) ** (t ** curve)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def env(n, attack, decay):
    t = np.arange(n) / SR
    return (1 - np.exp(-t / max(attack, 1e-4))) * np.exp(-t / decay)


def bubble(f0, seconds=0.03, rise=2.2):
    """A bubble popping: a short sine that chirps upward as it closes (the Minnaert pitch rising)"""
    x = sweep(f0, f0 * rise, seconds, 0.6)
    return x * env(len(x), 0.0015, seconds * 0.35)


def reverb(x, wet=0.2, size=1.0):
    """A few feedback combs and all-passes: a small, dark room"""
    tail = int(SR * 0.9)
    xs = np.concatenate([x, np.zeros(tail)])
    out = np.zeros_like(xs)
    for d, g in ((1557, 0.8), (1617, 0.79), (1491, 0.81), (1422, 0.78), (1277, 0.8), (1356, 0.79)):
        d = int(d * size)
        y = np.zeros_like(xs)
        for i in range(d, len(xs)):
            y[i] = xs[i - d] + g * y[i - d]
        out += y
    out /= 6
    for d, g in ((225, 0.7), (556, 0.7), (441, 0.7)):
        y = np.zeros_like(out)
        for i in range(len(out)):
            prev = y[i - d] if i >= d else 0.0
            inp = out[i - d] if i >= d else 0.0
            y[i] = -g * out[i] + inp + g * prev
        out = y
    out = band(out, 120, 7000)
    return xs * (1 - wet) + out * wet


def crackle(seconds, rate, lo=1800, hi=9000, decay=0.004):
    """Electricity: sparse sharp ticks of random size"""
    n = int(seconds * SR)
    x = np.zeros(n)
    count = int(seconds * rate)
    for _ in range(count):
        i = rng.integers(0, n)
        k = rng.uniform(0.2, 1.0) ** 2
        m = min(n - i, int(SR * decay * 6))
        x[i : i + m] += rng.standard_normal(m) * np.exp(-np.arange(m) / (SR * decay)) * k
    return band(x, lo, hi)


def plug():
    out = silence(0.75)
    # The plug: a firm click, a little body under it
    click = band(rng.standard_normal(int(SR * 0.012)), 2200, 6500) * env(int(SR * 0.012), 0.0003, 0.0022)
    at(out, 0.0, click, 0.8)
    at(out, 0.006, click[::-1] * 0.4 + click * 0.3, 0.5)
    thump = sweep(120, 55, 0.09) * env(int(SR * 0.09), 0.001, 0.025)
    at(out, 0.0, thump, 0.6)
    # The arc: crackling, and a buzz under it
    n = int(SR * 0.42)
    t = np.arange(n) / SR
    crack = crackle(0.42, 520) * np.exp(-t / 0.16)
    at(out, 0.012, crack, 0.55)
    saw = 2 * ((np.cumsum(110 * (1 + 0.04 * rng.standard_normal(n))) / SR) % 1.0) - 1
    buzz = band(saw, 600, 3200) * np.exp(-t / 0.12) * (1 - np.exp(-t / 0.004))
    at(out, 0.01, buzz, 0.22)
    # The stream racing across the floor: air rising in pitch, getting there at 0.44 s
    n = int(SR * 0.46)
    t = np.arange(n) / SR
    rush = resonator(rng.standard_normal(n), 500 * (8.0 ** (t / t[-1]) ** 1.6), 900) * (t / t[-1]) ** 2.2
    at(out, 0.0, rush, 0.5)
    whine = sweep(380, 2600, 0.44, 1.8) * (np.arange(int(SR * 0.44)) / (SR * 0.44)) ** 2.5
    at(out, 0.0, whine, 0.07)
    return reverb(out, 0.16, 0.8)


def surge():
    out = silence(2.4)
    # The whump of it landing
    whump = sweep(78, 36, 0.5, 0.7) * env(int(SR * 0.5), 0.002, 0.16)
    at(out, 0.0, whump, 1.0)
    at(out, 0.0, band(rng.standard_normal(int(SR * 0.2)), 60, 420) * env(int(SR * 0.2), 0.001, 0.05), 0.7)
    # The flare: a bright, slightly detuned chord that rings off, with sparkles in it
    n = int(SR * 1.8)
    t = np.arange(n) / SR
    shimmer = np.zeros(n)
    for f, g in ((659.3, 0.5), (987.8, 0.45), (1318.5, 0.35), (1975.5, 0.22), (2637.0, 0.12)):
        for detune in (-1.6, 1.4):
            shimmer += np.sin(2 * np.pi * (f + detune) * t + rng.uniform(0, 6.28)) * g
    shimmer *= (1 - np.exp(-t / 0.012)) * np.exp(-t / 0.55)
    at(out, 0.01, shimmer, 0.16)
    for _ in range(70):
        s = rng.uniform(0.02, 1.2)
        f = rng.uniform(3200, 7600)
        g = rng.uniform(0.2, 1.0) * np.exp(-s / 0.5)
        n2 = int(SR * 0.05)
        at(out, s, np.sin(2 * np.pi * f * np.arange(n2) / SR) * env(n2, 0.001, 0.012), 0.05 * g)
    # The capsule drinking it: three glugs
    for k, s in enumerate((0.08, 0.27, 0.5)):
        n2 = int(SR * 0.12)
        g = sweep(150 + k * 30, 420 + k * 40, 0.12, 0.8) * env(n2, 0.004, 0.045)
        at(out, s, resonator(g, 600 + k * 90, 260) * 9 + g * 0.4, 0.5 - k * 0.1)
    # And the fizz: bubbles everywhere, thinning out
    for _ in range(260):
        s = rng.uniform(0.05, 2.0) ** 1.35
        f = rng.uniform(700, 2600)
        g = rng.uniform(0.15, 1.0) * np.exp(-s / 0.8)
        at(out, s, bubble(f, rng.uniform(0.012, 0.03)), 0.12 * g)
    # A swell of power under it all
    n = int(SR * 1.6)
    t = np.arange(n) / SR
    swell = (sweep(196, 247, 1.6, 0.5) + 0.5 * sweep(294, 370, 1.6, 0.5)) * np.sin(np.pi * t / t[-1]) ** 1.5
    at(out, 0.0, swell, 0.12)
    return reverb(out, 0.24, 1.0)


def unplug():
    out = silence(1.3)
    # The pull
    click = band(rng.standard_normal(int(SR * 0.01)), 1800, 5000) * env(int(SR * 0.01), 0.0003, 0.002)
    at(out, 0.0, click, 0.55)
    # Powering down
    n = int(SR * 0.75)
    t = np.arange(n) / SR
    down = sweep(560, 62, 0.75, 0.55) * np.exp(-t / 0.35) * (1 + 0.25 * np.sin(2 * np.pi * 14 * t))
    at(out, 0.01, down, 0.4)
    hum = band(rng.standard_normal(n), 200, 1400) * np.exp(-t / 0.2)
    at(out, 0.01, hum, 0.18)
    # Embers dying
    n = int(SR * 0.9)
    at(out, 0.05, crackle(0.9, 70, 1500, 6000, 0.006) * np.exp(-np.arange(n) / (SR * 0.35)), 0.3)
    # The last drop
    at(out, 0.47, bubble(950, 0.05, 2.6), 0.5)
    return reverb(out, 0.2, 0.9)


def full():
    out = silence(2.2)
    for k, (f, s) in enumerate(((1046.5, 0.0), (1318.5, 0.13), (1568.0, 0.26))):
        n = int(SR * 1.8)
        t = np.arange(n) / SR
        # A small bell: inharmonic partials, the high ones dying first
        bell = sum(np.sin(2 * np.pi * f * m * t) * g * np.exp(-t / d) for m, g, d in ((1, 1.0, 0.9), (2.76, 0.35, 0.3), (5.4, 0.15, 0.12)))
        at(out, s, bell * (1 - np.exp(-t / 0.002)), 0.32 - k * 0.03)
    return reverb(out, 0.3, 1.1)


def splash():
    out = silence(0.8)
    n = int(SR * 0.3)
    t = np.arange(n) / SR
    slop = resonator(rng.standard_normal(n), 900 + 700 * np.exp(-t / 0.05), 700) * env(n, 0.006, 0.07)
    at(out, 0.0, slop, 0.9)
    blub = sweep(140, 320, 0.09, 0.8) * env(int(SR * 0.09), 0.003, 0.03)
    at(out, 0.01, blub, 0.4)
    for _ in range(14):
        at(out, rng.uniform(0.03, 0.45), bubble(rng.uniform(800, 2200), rng.uniform(0.015, 0.03)), rng.uniform(0.08, 0.2))
    return reverb(out, 0.18, 0.8)


write('plug.wav', plug(), 0.85)
write('surge.wav', surge(), 0.9)
write('unplug.wav', unplug(), 0.75)
write('full.wav', full(), 0.6)
write('splash.wav', splash(), 0.6)
