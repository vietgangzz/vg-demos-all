"""
Spooky Progress's sounds, synthesised from scratch (no samples). Writes WAVs into
assets/spooky-progress/sounds/:

- correct: an answer right, a celesta run in a minor key with a little shimmer on top
- tap: a button
- plop: something dropping into a potion
- bubble: a brew bubbling up, a burst of blips
- cork: a cork popping out
- whoosh: something flying past
- ghost: a ghost's wail, a wavering whistle
- bats: a flurry of wings
- carve: a knife slicing through a pumpkin
- ignite: a candle catching, a match strike and a soft whump
- spider: a spider skittering down its thread
- boo: a ghost's BOO, low and round
- sizzle: a fuse burning
- boom: a pumpkin bomb going off
- candy: sweets raining down, bright pops
- squelch: slime oozing forward
- splat: slime hitting the screen
- drip: a drop of slime falling
- finale: the lesson done, an organ chord that turns from minor to major, bells

    /Applications/Blender.app/Contents/Resources/5.2/python/bin/python3.13 scripts/spooky_sounds.py
"""

import os
import wave

import numpy as np

SR = 44100
OUT = os.environ.get('OUT') or os.path.join(os.path.dirname(__file__), '..', 'assets', 'spooky-progress', 'sounds')
rng = np.random.default_rng(31)


def write(name, x, peak=0.89):
    x = x / (np.max(np.abs(x)) + 1e-9) * peak
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


def t_of(seconds):
    return np.arange(int(seconds * SR)) / SR


def at(buf, start, x, gain=1.0):
    i = int(start * SR)
    j = min(len(buf), i + len(x))
    if j > i:
        buf[i:j] += x[: j - i] * gain


def band(x, lo, hi):
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X = np.fft.rfft(x)
    edge = lambda v, c, w: 1 / (1 + np.exp(-(v - c) / w))  # noqa: E731
    mask = edge(f, lo, lo * 0.15 + 1) * (1 - edge(f, hi, hi * 0.15 + 1))
    return np.fft.irfft(X * mask, len(x))


def noise(seconds, lo, hi):
    return band(rng.standard_normal(int(seconds * SR)), lo, hi)


def note(n):
    """MIDI note to Hz"""
    return 440 * 2 ** ((n - 69) / 12)


def celesta(f, seconds=0.8):
    t = t_of(seconds)
    out = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.35)
    out += 0.35 * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t / 0.08)
    out += 0.12 * np.sin(2 * np.pi * f * 7.1 * t) * np.exp(-t / 0.03)
    return out * np.minimum(1, t / 0.002)


def bell(f, seconds=1.6, decay=0.6):
    t = t_of(seconds)
    out = np.zeros_like(t)
    for ratio, amp, d in ((1, 1, 1), (2.01, 0.5, 0.7), (3.02, 0.3, 0.45), (4.17, 0.18, 0.3), (5.43, 0.1, 0.2)):
        out += amp * np.sin(2 * np.pi * f * ratio * t + rng.uniform(0, 6)) * np.exp(-t / (decay * d))
    return out * np.minimum(1, t / 0.002)


def blip(f, seconds=0.09, fall=1.6, decay=0.025):
    """A bubble bursting: a quick blip that falls in pitch"""
    t = t_of(seconds)
    freq = f * (1 + fall * np.exp(-t / 0.01))
    return np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t / decay)


def rise(f, seconds=0.12, decay=0.03):
    """A drop of water: a blip that rises in pitch"""
    t = t_of(seconds)
    freq = f * (1 + 2.2 * (1 - np.exp(-t / 0.02)))
    return np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t / decay)


def whoosh(seconds, lo=400, hi=7000, centre=0.5, width=0.25):
    t = t_of(seconds)
    return noise(seconds, lo, hi) * np.exp(-((t / seconds - centre) / width) ** 2)


def organ(f, seconds, attack=0.08, release=0.7):
    t = t_of(seconds)
    env = np.minimum(1, t / attack) * np.exp(-np.maximum(0, t - (seconds - release)) / (release * 0.35))
    out = np.zeros_like(t)
    for n, amp in ((1, 1), (2, 0.6), (3, 0.35), (4, 0.25), (6, 0.12), (8, 0.08)):
        out += amp * np.sin(2 * np.pi * f * n * t * (1 + 0.0015 * np.sin(2 * np.pi * 5 * t)))
    return out * env


def thump(f0=120, f1=35, seconds=0.8):
    t = t_of(seconds)
    freq = f1 + (f0 - f1) * np.exp(-t / 0.06)
    return np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t / 0.25)


# ---- correct, tap ----
x = silence(1.1)
for i, n in enumerate((69, 72, 76, 81)):  # A minor, up
    at(x, i * 0.06, celesta(note(n)), 0.8 - i * 0.08)
at(x, 0.2, celesta(note(88), 0.9), 0.35)
at(x, 0.05, noise(0.6, 5000, 12000) * np.exp(-t_of(0.6) / 0.15), 0.05)
write('correct.wav', x, peak=0.7)

x = silence(0.15)
at(x, 0, blip(900, 0.08, 0.6, 0.015), 0.6)
write('tap.wav', x, peak=0.5)

# ---- potion: plop, bubble, cork ----
x = silence(0.5)
at(x, 0, blip(260, 0.2, 2.5, 0.06), 1)
at(x, 0.02, noise(0.25, 300, 2500) * np.exp(-t_of(0.25) / 0.05), 0.5)
for i in range(4):
    at(x, 0.08 + i * 0.07, rise(700 + rng.uniform(0, 500), 0.1, 0.025), 0.35)
write('plop.wav', x, peak=0.8)

x = silence(1.2)
for i in range(26):
    s = rng.uniform(0, 1.0)
    at(x, s, blip(rng.uniform(250, 900), 0.08, rng.uniform(0.8, 2.0), rng.uniform(0.015, 0.035)), rng.uniform(0.3, 0.8))
at(x, 0, noise(1.2, 150, 900) * 0.08 * np.minimum(1, t_of(1.2) / 0.2))
write('bubble.wav', x, peak=0.7)

x = silence(0.6)
t = t_of(0.12)
at(x, 0, np.sin(2 * np.pi * np.cumsum(500 + 900 * np.exp(-t / 0.01)) / SR) * np.exp(-t / 0.03), 1)
at(x, 0, noise(0.05, 1500, 9000) * np.exp(-t_of(0.05) / 0.006), 0.6)
at(x, 0.05, whoosh(0.4, 1200, 8000, 0.3, 0.3), 0.25)
write('cork.wav', x, peak=0.85)

# ---- whoosh, ghost, bats ----
write('whoosh.wav', whoosh(0.55, 300, 6000, 0.45, 0.22), peak=0.55)

t = t_of(1.6)
f = 520 + 160 * np.sin(2 * np.pi * 0.7 * t) + 40 * np.sin(2 * np.pi * 6 * t)
f *= 1 + 0.25 * np.exp(-t / 0.3)
x = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.8 + np.sin(2 * np.pi * np.cumsum(f * 2.01) / SR) * 0.2
x += band(rng.standard_normal(len(t)), 600, 2500) * 0.15
x *= np.minimum(1, t / 0.25) * np.exp(-np.maximum(0, t - 1.0) / 0.25)
write('ghost.wav', x, peak=0.55)

x = silence(1.4)
for i in range(60):
    s = rng.uniform(0, 1.2) * (1 - rng.uniform(0, 0.4))
    flap = noise(0.05, 200, 3000) * np.sin(np.pi * t_of(0.05) / 0.05)
    at(x, s, flap, rng.uniform(0.3, 1))
x *= np.exp(-np.maximum(0, t_of(1.4) - 0.6) / 0.35)
write('bats.wav', x, peak=0.6)

# ---- pumpkins: carve, ignite ----
x = silence(0.45)
t = t_of(0.3)
at(x, 0, noise(0.3, 2500, 11000) * np.exp(-((t - 0.1) / 0.07) ** 2), 0.7)
at(x, 0.16, noise(0.06, 400, 3000) * np.exp(-t_of(0.06) / 0.01), 0.9)
at(x, 0.17, blip(220, 0.12, 0.4, 0.04), 0.5)
write('carve.wav', x, peak=0.7)

x = silence(0.9)
at(x, 0, noise(0.12, 2000, 9000) * np.exp(-t_of(0.12) / 0.025), 0.8)
t = t_of(0.7)
at(x, 0.05, noise(0.7, 120, 1200) * np.minimum(1, t / 0.06) * np.exp(-t / 0.22), 0.9)
at(x, 0.05, thump(90, 50, 0.5), 0.3)
write('ignite.wav', x, peak=0.7)

# ---- ghost web: spider, boo ----
x = silence(0.9)
for i in range(34):
    s = i * 0.022 + rng.uniform(0, 0.008)
    at(x, s, noise(0.012, 2500, 9000) * np.exp(-t_of(0.012) / 0.003), rng.uniform(0.4, 1))
at(x, 0, whoosh(0.8, 300, 2000, 0.4, 0.4), 0.2)
write('spider.wav', x, peak=0.6)

t = t_of(0.9)
f = 150 * (1 + 0.3 * np.exp(-t / 0.08)) * (1 - 0.15 * t)
x = np.zeros_like(t)
for n, amp in ((1, 1), (2, 0.5), (3, 0.35), (4, 0.15)):
    x += amp * np.sin(2 * np.pi * n * np.cumsum(f) / SR)
x = band(x, 80, 1800) * np.minimum(1, t / 0.04) * np.exp(-np.maximum(0, t - 0.4) / 0.2)
at(x, 0, thump(140, 50, 0.6), 0.4)
write('boo.wav', x, peak=0.85)

# ---- fuse: sizzle, boom, candy ----
x = silence(1.3)
for i in range(240):
    at(x, rng.uniform(0, 1.2), noise(0.006, 3000, 12000) * np.exp(-t_of(0.006) / 0.0015), rng.uniform(0.2, 1))
at(x, 0, noise(1.3, 4000, 12000) * 0.12)
x *= np.minimum(1, t_of(1.3) / 0.05) * np.exp(-np.maximum(0, t_of(1.3) - 0.9) / 0.15)
write('sizzle.wav', x, peak=0.5)

x = silence(2.2)
at(x, 0, thump(150, 32, 1.6), 1.2)
t = t_of(1.8)
at(x, 0, noise(1.8, 60, 4000) * np.exp(-t / 0.35), 0.9)
at(x, 0, noise(0.08, 2000, 10000) * np.exp(-t_of(0.08) / 0.015), 0.7)
write('boom.wav', x, peak=0.95)

x = silence(1.6)
for i in range(40):
    s = rng.uniform(0.05, 1.3)
    at(x, s, blip(rng.uniform(1200, 2600), 0.06, 0.4, 0.012), rng.uniform(0.2, 0.6))
for i, n in enumerate((84, 88, 91, 96)):
    at(x, i * 0.05, celesta(note(n), 0.6), 0.4)
write('candy.wav', x, peak=0.7)

# ---- slime: squelch, splat, drip ----
t = t_of(0.55)
f = 90 + 60 * np.sin(2 * np.pi * 7 * t) * np.exp(-t / 0.3)
x = noise(0.55, 80, 900) * (0.6 + 0.4 * np.sin(2 * np.pi * np.cumsum(f) / SR))
x = band(x, 80, 1200) * np.minimum(1, t / 0.05) * np.exp(-t / 0.2)
y = silence(0.6)
at(y, 0, x)
for i in range(3):
    at(y, 0.1 + i * 0.09, blip(180 + i * 40, 0.12, 1.2, 0.04), 0.5)
write('squelch.wav', y, peak=0.7)

x = silence(0.6)
at(x, 0, noise(0.3, 100, 2500) * np.exp(-t_of(0.3) / 0.05), 1)
at(x, 0, thump(160, 60, 0.3), 0.5)
for i in range(6):
    at(x, 0.04 + rng.uniform(0, 0.25), rise(rng.uniform(500, 1000), 0.08, 0.02), 0.3)
write('splat.wav', x, peak=0.8)

x = silence(0.3)
at(x, 0, rise(600, 0.15, 0.04), 1)
write('drip.wav', x, peak=0.55)

# ---- the finale ----
x = silence(3.2)
for n in (45, 57, 60, 64):  # A minor
    at(x, 0, organ(note(n), 1.1, release=0.4), 0.35)
for n in (45, 57, 61, 64, 69):  # turning to A major
    at(x, 0.9, organ(note(n), 2.2, release=1.2), 0.32)
for i, n in enumerate((81, 85, 88, 93)):
    at(x, 0.95 + i * 0.07, bell(note(n), 1.8, 0.5), 0.3)
at(x, 0.9, noise(2.0, 5000, 12000) * np.exp(-t_of(2.0) / 0.6), 0.05)
write('finale.wav', x, peak=0.9)
