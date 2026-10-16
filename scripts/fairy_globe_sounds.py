"""
Fairy Globe's sounds, synthesised from scratch (no samples): Santa's "Ho ho ho!", the sleigh bells,
the rush of air down the chimney and out of the window, the fire, the present's squeak as it gets
hot and the twinkle as it falls asleep. Writes them as WAVs into assets/fairy-globe/.

The voice is a source-filter model: a glottal pulse train (Rosenberg pulses, a deep jolly pitch
that jumps up on each "ho" and falls off it, with jitter and vibrato) through the formants of an
"o", each "ho" opening on breath noise for the "h". A small room reverb glues it together.

The bells are inharmonic partials (a small cast bell's) with fast decays, struck in a galloping
rhythm with a little randomness, panned by nothing: mono.

    python3 scripts/fairy_globe_sounds.py   (needs numpy: Blender's own python has it)
"""

import os
import wave

import numpy as np

SR = 44100
OUT = os.environ.get('OUT') or os.path.join(os.path.dirname(__file__), '..', 'assets', 'fairy-globe')
rng = np.random.default_rng(7)


def biquad_bandpass(x, f, bw):
    """Two-pole resonator at f Hz, bandwidth bw Hz (a formant)"""
    r = np.exp(-np.pi * bw / SR)
    a1 = -2 * r * np.cos(2 * np.pi * f / SR)
    a2 = r * r
    g = 1 - r
    y = np.zeros_like(x)
    y1 = y2 = 0.0
    for i in range(len(x)):
        v = g * x[i] - a1 * y1 - a2 * y2
        y[i] = v
        y2, y1 = y1, v
    return y


def formants(x, fs):
    return sum(biquad_bandpass(x, f, bw) * amp for f, bw, amp in fs)


def glottal(f0):
    """A Rosenberg pulse train following the pitch curve f0 (Hz per sample)"""
    phase = np.cumsum(f0 / SR) % 1.0
    open_q = 0.6
    t = phase / open_q
    pulse = np.where(phase < open_q * 0.66, 0.5 * (1 - np.cos(np.pi * t / 0.66)), 0.0)
    close = (phase >= open_q * 0.66) & (phase < open_q)
    pulse = np.where(close, np.cos(np.pi / 2 * (t - 0.66) / 0.34), pulse)
    return np.diff(pulse, prepend=0) * 40  # flow derivative: what radiates


def ho(dur, pitch, fall):
    n = int(dur * SR)
    t = np.arange(n) / SR
    # Pitch jumps up into the vowel and falls off it, with a little vibrato and jitter
    f0 = pitch * (1 + 0.12 * np.exp(-t * 18)) * (1 - fall * (t / dur) ** 1.4)
    f0 *= 1 + 0.012 * np.sin(2 * np.pi * 5.5 * t) + 0.006 * rng.standard_normal(n).cumsum() / np.sqrt(np.arange(1, n + 1))
    voice = glottal(f0)
    # An "o": F1 ~ 450, F2 ~ 800, then the higher ones for body; a chesty, round sound
    vowel = formants(voice, [(430, 70, 1.0), (780, 90, 0.55), (2500, 160, 0.12), (3300, 220, 0.06)])
    # The "h": breath through the same mouth shape, before the voice comes in
    breath = formants(rng.standard_normal(n), [(430, 200, 0.6), (780, 260, 0.5), (1600, 500, 0.4)]) * 0.5
    h_env = np.exp(-((t - 0.03) / 0.05) ** 2)
    v_env = np.clip((t - 0.045) / 0.035, 0, 1) * np.clip((dur - t) / 0.09, 0, 1) ** 1.5
    # A belly laugh: the voice pulses a little as the breath is pushed out
    v_env *= 1 + 0.08 * np.sin(2 * np.pi * 9 * t)
    return breath * h_env + vowel * v_env


def reverb(x, wet=0.22):
    """A few feedback combs and all-passes: a small warm room"""
    out = np.zeros(len(x) + SR)
    xs = np.concatenate([x, np.zeros(SR)])
    for d, g in ((1557, 0.77), (1617, 0.76), (1491, 0.78), (1422, 0.75)):
        y = np.zeros_like(xs)
        for i in range(len(xs)):
            y[i] = xs[i] + (g * y[i - d] if i >= d else 0)
        out += y * 0.25
    for d, g in ((225, 0.5), (556, 0.5)):
        y = np.zeros_like(out)
        for i in range(len(out)):
            y[i] = -g * out[i] + (out[i - d] + g * y[i - d] if i >= d else 0)
        out = y
    return np.concatenate([x, np.zeros(SR)]) * (1 - wet) + out * wet


def write(name, x, peak=0.89):
    x = x / np.max(np.abs(x)) * peak
    data = (x * 32767).astype(np.int16)
    with wave.open(os.path.join(OUT, name), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    print(name, f'{len(x) / SR:.2f}s')


def hohoho():
    parts = [(0.3, 128, 0.18), (0.3, 120, 0.2), (0.52, 112, 0.34)]
    gap = 0.11
    total = sum(d for d, _, _ in parts) + gap * len(parts) + 0.1
    x = np.zeros(int(total * SR))
    at = 0.04
    for dur, pitch, fall in parts:
        h = ho(dur, pitch, fall)
        i = int(at * SR)
        x[i : i + len(h)] += h
        at += dur + gap
    # Warmth: a gentle low shelf by mixing in a smoothed copy
    k = np.ones(40) / 40
    x = x + np.convolve(x, k, mode='same') * 0.6
    y = reverb(x, 0.2)
    return y[: int((total + 0.5) * SR)]


def bell(freq, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    # A small cast bell's partials: inharmonic, the high ones dying first
    partials = [(1.0, 1.0, 9), (2.32, 0.55, 14), (4.25, 0.35, 22), (6.63, 0.22, 30), (9.38, 0.12, 40)]
    x = sum(a * np.sin(2 * np.pi * freq * r * t + rng.uniform(0, 6)) * np.exp(-t * d) for r, a, d in partials)
    # The clapper's tick
    x += rng.standard_normal(n) * np.exp(-t * 400) * 0.3
    return x


def bells(seconds=4.0):
    n = int(seconds * SR)
    x = np.zeros(n + SR)
    # Galloping: shaken twice a stride, a cluster of bells each time
    stride = 0.34
    t = 0.0
    while t < seconds:
        for hit in (0.0, 0.11):
            for _ in range(rng.integers(3, 6)):
                f = rng.choice([2093, 2349, 2637, 2794, 3136]) * rng.uniform(0.985, 1.015)
                at = t + hit + rng.uniform(0, 0.03)
                b = bell(f, 0.5) * rng.uniform(0.3, 0.8) * (0.8 if hit else 1.0)
                i = int(at * SR)
                x[i : i + len(b)] += b[: len(x) - i]
        t += stride
    x = x[:n]
    # Fades at both ends, so it can start and stop under the scene
    fade = int(0.25 * SR)
    env = np.ones(n)
    env[:fade] = np.linspace(0, 1, fade)
    env[-fade:] = np.linspace(1, 0, fade)
    return reverb(x * env, 0.18)[: n + SR // 2]


write('hohoho.wav', hohoho())
write('bells.wav', bells())


def lowpass(x, f):
    """One-pole low pass at f Hz"""
    a = np.exp(-2 * np.pi * f / SR)
    y = np.zeros_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


def fades(x, fin, fout):
    n = len(x)
    env = np.ones(n)
    a, b = int(fin * SR), int(fout * SR)
    if a:
        env[:a] = np.linspace(0, 1, a) ** 2
    if b:
        env[-b:] = np.linspace(1, 0, b) ** 2
    return x * env


def whoosh(seconds=1.3):
    """Air rushing past: noise through a resonance that sweeps up as it comes and down as it goes"""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    u = t / seconds
    noise = rng.standard_normal(n)
    # The resonance, a sweep (one biquad per short block, so it can move)
    centre = 260 + 1500 * np.sin(np.pi * u) ** 2
    out = np.zeros(n)
    block = 256
    y1 = y2 = 0.0
    for k in range(0, n, block):
        f = centre[k]
        bw = f * 0.9
        r = np.exp(-np.pi * bw / SR)
        a1 = -2 * r * np.cos(2 * np.pi * f / SR)
        a2 = r * r
        g = 1 - r
        for i in range(k, min(n, k + block)):
            v = g * noise[i] - a1 * y1 - a2 * y2
            out[i] = v
            y2, y1 = y1, v
    body = lowpass(noise, 180) * 0.6
    env = np.sin(np.pi * np.clip(u * 1.15, 0, 1)) ** 1.6
    return reverb((out + body) * env, 0.12)[: n + SR // 3]


def crackle(seconds=7.0):
    """A wood fire: a low roar, crackles and the odd snap, fading in and out under the room"""
    n = int(seconds * SR)
    roar = lowpass(lowpass(rng.standard_normal(n), 220), 220) * 3.0
    roar *= 0.75 + 0.25 * np.sin(2 * np.pi * 0.7 * np.arange(n) / SR + 1.0)
    x = roar
    t = 0.0
    while t < seconds:
        t += rng.exponential(0.07)
        i = int(t * SR)
        if i >= n:
            break
        snap = rng.random() < 0.07
        length = int((0.04 if snap else 0.012) * SR)
        burst = rng.standard_normal(length) * np.exp(-np.arange(length) / SR * (60 if snap else 260))
        burst = np.diff(burst, prepend=0) * (rng.uniform(1.5, 3.0) if snap else rng.uniform(0.2, 1.0))
        x[i : i + length] += burst[: n - i]
    return fades(x, 0.8, 1.6)


def eep():
    """The present's squeak as the fire gets it: "ee-EEP!", little and high"""
    def chirp(dur, f0, f1, f2):
        m = int(dur * SR)
        tt = np.arange(m) / SR
        u = tt / dur
        f = np.where(u < 0.7, f0 + (f1 - f0) * (u / 0.7) ** 0.6, f1 + (f2 - f1) * (u - 0.7) / 0.3)
        f = f * (1 + 0.03 * np.sin(2 * np.pi * 28 * tt))
        ph = 2 * np.pi * np.cumsum(f) / SR
        tone = np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)
        env = np.clip(tt / 0.012, 0, 1) * np.clip((dur - tt) / 0.04, 0, 1)
        return tone * env
    a = chirp(0.09, 980, 1350, 1300)
    b = chirp(0.22, 1150, 2100, 1750)
    x = np.zeros(int(0.5 * SR))
    x[: len(a)] += a * 0.7
    i = int(0.13 * SR)
    x[i : i + len(b)] += b
    return reverb(x, 0.15)[: int(0.75 * SR)]


def twinkle():
    """Falling asleep: a soft glassy arpeggio coming down, and a shimmer"""
    notes = [2093.0, 1760.0, 1568.0, 1318.5, 1046.5]
    seconds = 2.2
    n = int(seconds * SR)
    x = np.zeros(n)
    for k, f in enumerate(notes):
        at = int((0.04 + k * 0.17) * SR)
        m = n - at
        tt = np.arange(m) / SR
        tone = (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * f * 2.76 * tt) * np.exp(-tt * 6)) * np.exp(-tt * 3.2)
        tone *= np.clip(tt / 0.004, 0, 1) * (0.9 - k * 0.08)
        x[at:] += tone
    shimmer = rng.standard_normal(n)
    shimmer = shimmer - lowpass(shimmer, 6000)
    x += shimmer * 0.04 * np.exp(-np.arange(n) / SR * 2.5)
    return reverb(fades(x, 0.0, 0.5), 0.3)[: n + SR // 2]


write('whoosh.wav', whoosh(), 0.8)
write('crackle.wav', crackle(11.0), 0.5)
write('eep.wav', eep(), 0.75)
write('twinkle.wav', twinkle(), 0.55)
