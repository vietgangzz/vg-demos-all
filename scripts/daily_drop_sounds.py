"""
Daily Drop's sounds, synthesised from scratch (no samples). Writes WAVs into assets/daily-drop/sounds/:

- charge: the power gathering in the glass orb while it's held, looping (the app raises its pitch
  with the playback rate as the orb fills, and lets it sag when let go early)
- rattle: the chains straining, rattling, looping (louder and faster the longer it's held)
- dive: the orb diving into the padlock: a rising whoosh, sucked in
- impact: the padlock breaking: a crack, a sub-bass boom, metal shattering, a long dark tail
- chains: the chains whipping off and clattering down
- erupt: the treasure going up: a jingling fountain and a bright chord
- clink1..3: a coin knocking the dais; clank: a chain link; tink: a shard of the padlock
- coin1..3: a coin landing in the wallet
- rewind: the burst running backwards (Replay): a reversed swell and a shimmer
- spin: a card spun round
- flip, reveal, legendary, levelup, stamp, close: the cards, the level, the day, the lid
- vault: the vault's hum, looping under it all
- unlock: the key turning in the padlock; rise: the egg coming up out of the chest
- breath: the drake breathing fire

    python3 scripts/daily_drop_sounds.py   (needs numpy: Blender's own python has it)
"""

import os
import wave

import numpy as np

SR = 44100
OUT = os.environ.get('OUT') or os.path.join(os.path.dirname(__file__), '..', 'assets', 'daily-drop', 'sounds')
rng = np.random.default_rng(7)


def write(name, x, peak=0.89, trim=True):
    x = x / (np.max(np.abs(x)) + 1e-9) * peak
    if trim:
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


def bell(f, seconds, decay=0.6, bright=1.0):
    t = t_of(seconds)
    out = np.zeros_like(t)
    for ratio, amp, d in ((1, 1, 1), (2.01, 0.55, 0.7), (3.02, 0.32 * bright, 0.45), (4.17, 0.2 * bright, 0.3), (5.43, 0.12 * bright, 0.2)):
        out += amp * np.sin(2 * np.pi * f * ratio * t + rng.uniform(0, 6)) * np.exp(-t / (decay * d))
    return out * np.minimum(1, t / 0.002)


def ping(f, seconds=0.35, decay=1.0):
    """A coin: bright and metallic, very short"""
    t = t_of(seconds)
    out = np.zeros_like(t)
    for ratio, amp, d in ((1, 1, 0.09), (2.76, 0.7, 0.06), (5.4, 0.45, 0.04), (8.93, 0.25, 0.025)):
        out += amp * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / (d * decay))
    click = band(rng.standard_normal(len(t)), 3000, 12000) * np.exp(-t / 0.004) * 0.6
    return out + click


def knock(seconds=0.06, lo=300, hi=2400, decay=0.012):
    t = t_of(seconds)
    return band(rng.standard_normal(len(t)), lo, hi) * np.exp(-t / decay)


def clank(f=900, seconds=0.25):
    """An iron link knocking stone: a dull ring, a click"""
    t = t_of(seconds)
    out = np.zeros_like(t)
    for ratio, amp, d in ((1, 1, 0.05), (2.3, 0.6, 0.035), (3.9, 0.4, 0.02), (6.1, 0.2, 0.012)):
        out += amp * np.sin(2 * np.pi * f * ratio * t + rng.uniform(0, 6)) * np.exp(-t / d)
    return out + knock(seconds, 400, 5000, 0.006) * 0.8


def loop_fade(x, fade=0.04):
    """Crossfade the end into the start so it loops without a click"""
    n = int(fade * SR)
    head = x[:n].copy()
    x = x[n:].copy()
    ramp = np.linspace(0, 1, n)
    x[-n:] = x[-n:] * (1 - ramp) + head * ramp
    return x


# ---- charge: a gathering drone, 2 s, looping ----
L = 2.0
t = t_of(L + 0.04)
x = np.zeros_like(t)
for f, g in ((110, 0.5), (165, 0.32), (220, 0.28), (330, 0.14), (440, 0.1)):
    x += g * np.sin(2 * np.pi * f * t + rng.uniform(0, 6))
x *= 0.8 + 0.2 * np.sin(2 * np.pi * 6 * t)
air = band(rng.standard_normal(len(t)), 2500, 9000) * (0.25 + 0.1 * np.sin(2 * np.pi * 3 * t))
x += air * 0.35
write('charge.wav', loop_fade(x), peak=0.7, trim=False)

# ---- rattle: chains straining, 1.5 s, looping ----
L = 1.5
x = silence(L + 0.04)
k = 0.0
while k < L:
    at(x, k, clank(rng.uniform(1100, 2600), 0.12), rng.uniform(0.25, 0.7))
    k += rng.uniform(0.025, 0.07)
write('rattle.wav', loop_fade(x), peak=0.6, trim=False)

# ---- dive: a whoosh rising into the padlock, sucked in ----
n = int(0.42 * SR)
t = np.arange(n) / SR
x = rng.standard_normal(n)
x = band(x, 400, 10000)
env = (t / 0.42) ** 2.2
x *= env
tone = np.sin(2 * np.pi * np.cumsum(220 * 2 ** (t / 0.42 * 2.2)) / SR) * env * 0.5
write('dive.wav', x + tone, peak=0.7)

# ---- impact: crack, boom, shatter, tail ----
x = silence(3.2)
tb = t_of(2.0)
boom = np.sin(2 * np.pi * (38 + 60 * np.exp(-tb / 0.06)) * tb) * np.exp(-tb / 0.55)
at(x, 0, boom, 1.6)
at(x, 0, knock(0.08, 800, 12000, 0.008), 1.2)  # the crack
at(x, 0, band(rng.standard_normal(int(0.6 * SR)), 60, 1200) * np.exp(-t_of(0.6) / 0.12), 1.0)
for k in range(26):  # metal shattering
    at(x, rng.uniform(0.0, 0.25), ping(rng.uniform(1800, 5200), 0.4, decay=1.4), rng.uniform(0.15, 0.4))
# A dark, long tail: low noise swelling away
tt = t_of(2.8)
tail = band(rng.standard_normal(len(tt)), 40, 400) * np.exp(-tt / 0.9) * np.minimum(1, tt / 0.05)
at(x, 0.05, tail, 0.8)
for f in (55, 82.5):
    at(x, 0, np.sin(2 * np.pi * f * tt) * np.exp(-tt / 1.4) * 0.4)
write('impact.wav', x)

# ---- chains: whipping off, clattering down ----
x = silence(1.6)
k = 0.0
while k < 1.4:
    dens = np.exp(-k / 0.5)
    at(x, k, clank(rng.uniform(700, 2200), 0.2), rng.uniform(0.2, 0.6) * (0.3 + dens))
    k += rng.uniform(0.008, 0.03) / (0.3 + dens)
whip = band(rng.standard_normal(int(0.3 * SR)), 1500, 8000) * np.exp(-((t_of(0.3) - 0.08) / 0.05) ** 2)
at(x, 0.0, whip, 0.8)
write('chains.wav', x, peak=0.8)

# ---- erupt: a jingling fountain and a bright chord ----
x = silence(2.4)
for k in range(70):
    at(x, rng.uniform(0, 1.2) ** 1.2, ping(rng.uniform(1600, 3400), 0.3), rng.uniform(0.08, 0.25))
for f, d in ((523.25, 1.6), (659.25, 1.5), (783.99, 1.4), (1046.5, 1.2)):
    at(x, 0.02, bell(f, 2.2, decay=d, bright=0.8), 0.28)
whoosh = band(rng.standard_normal(int(0.6 * SR)), 800, 9000) * np.exp(-((t_of(0.6) - 0.15) / 0.12) ** 2)
at(x, 0, whoosh, 0.6)
write('erupt.wav', x)

# ---- knocks ----
for i, f in enumerate((2300, 2650, 3000)):
    write(f'clink{i + 1}.wav', ping(f, 0.3, decay=0.8), peak=0.6)
write('clank.wav', clank(1300, 0.25), peak=0.6)
write('tink.wav', ping(4100, 0.25, decay=0.6), peak=0.55)

# ---- wallet coins ----
for i, f in enumerate((1780, 2000, 2240)):
    write(f'coin{i + 1}.wav', ping(f), peak=0.7)

# ---- rewind: a reversed swell, sucked back, a shimmer ----
x = silence(1.4)
sw = band(rng.standard_normal(int(1.1 * SR)), 300, 7000) * (t_of(1.1) / 1.1) ** 3
at(x, 0, sw, 0.9)
for k in range(18):
    at(x, 0.2 + k * 0.05, bell(2000 + k * 120, 0.5, decay=0.15, bright=0.4), 0.08)
at(x, 1.08, knock(0.1, 100, 1500, 0.03), 0.9)
write('rewind.wav', x, peak=0.75)

# ---- spin: a card spun, its edge flicking the air ----
n = int(0.5 * SR)
t = np.arange(n) / SR
x = band(rng.standard_normal(n), 2000, 8000) * (0.5 + 0.5 * np.sin(2 * np.pi * 18 * t)) * np.exp(-t / 0.2)
write('spin.wav', x, peak=0.45)

# ---- flip ----
nf = int(0.32 * SR)
ft = np.arange(nf) / SR
sw = band(rng.standard_normal(nf), 1500, 7000) * np.exp(-((ft - 0.08) / 0.05) ** 2)
write('flip.wav', sw + knock(0.32, 1500, 6000) * 0.2, peak=0.55)

# ---- reveal: three bells up ----
x = silence(1.4)
for k, f in enumerate((880, 1108.7, 1318.5)):
    at(x, k * 0.07, bell(f, 1.2, decay=0.5), 0.5)
write('reveal.wav', x, peak=0.7)

# ---- legendary ----
x = silence(3.0)
lt = t_of(3.0)
swell = np.minimum(1, lt / 0.25) * np.exp(-np.maximum(0, lt - 0.6) / 1.1)
for f in (261.63, 329.63, 392.0, 523.25, 659.25):
    for det in (-0.004, 0.0, 0.004):
        saw = 2 * ((f * (1 + det) * lt) % 1) - 1
        x += band(saw, 150, 3200) * swell * 0.06
for k, f in enumerate((523.25, 659.25, 783.99, 1046.5, 1318.5, 1568.0)):
    at(x, 0.05 + k * 0.06, bell(f, 2.0, decay=0.9), 0.3)
for k in range(60):
    at(x, 0.1 + rng.uniform(0, 2.2) ** 1.2, bell(rng.uniform(2500, 7000), 0.3, decay=0.1, bright=0.3), rng.uniform(0.03, 0.09))
write('legendary.wav', x)

# ---- levelup ----
x = silence(2.2)
for k, f in enumerate((523.25, 659.25, 783.99, 1046.5, 1318.5)):
    at(x, k * 0.085, bell(f, 0.8, decay=0.4), 0.4)
for f in (1046.5, 1318.5, 1568.0, 2093.0):
    at(x, 0.45, bell(f, 1.7, decay=0.9), 0.28)
write('levelup.wav', x)

# ---- stamp ----
x = silence(0.5)
st = t_of(0.4)
at(x, 0, np.sin(2 * np.pi * 95 * st) * np.exp(-st / 0.07), 1.0)
at(x, 0, knock(0.1, 200, 3000), 0.8)
at(x, 0.02, ping(2600, 0.2), 0.25)
write('stamp.wav', x, peak=0.75)

# ---- close: the lid swinging shut, the chains locking back on ----
x = silence(0.9)
ct = t_of(0.5)
at(x, 0, np.sin(2 * np.pi * 70 * ct) * np.exp(-ct / 0.09), 1.0)
at(x, 0, knock(0.12, 120, 1500), 1.0)
for k in range(6):
    at(x, 0.03 + k * 0.03, clank(rng.uniform(900, 1800), 0.18), 0.35)
write('close.wav', x, peak=0.8)

# ---- vault: a low hum and a far shimmer, looping (8 s) ----
L = 8.0
vt = t_of(L)
hum = (np.sin(2 * np.pi * 55 * vt) * 0.5 + np.sin(2 * np.pi * 82.5 * vt) * 0.25 + np.sin(2 * np.pi * 110 * vt) * 0.12)
hum *= 0.75 + 0.25 * np.sin(2 * np.pi * vt / L * 2)
air = band(rng.standard_normal(len(vt)), 200, 1200) * 0.15 * (0.6 + 0.4 * np.sin(2 * np.pi * vt / L * 3 + 1))
shimmer = np.zeros_like(vt)
for k in range(10):
    f = rng.uniform(1800, 4200)
    c = rng.uniform(0.5, L - 1.5)
    shimmer += np.sin(2 * np.pi * f * vt) * np.exp(-((vt - c) / 0.5) ** 2) * 0.05
write('vault.wav', hum + air + shimmer, peak=0.5, trim=False)

# ---- unlock: the key slides into the padlock and turns, and its works give: a scrape, two clacks, a thunk ----
x = silence(0.6)
st = t_of(0.12)
at(x, 0, band(rng.standard_normal(len(st)), 2500, 9000) * np.sin(np.pi * st / 0.12), 0.3)
at(x, 0.11, clank(2400, 0.12), 0.7)
at(x, 0.2, clank(1500, 0.18), 1.0)
ut = t_of(0.35)
at(x, 0.2, np.sin(2 * np.pi * 85 * ut) * np.exp(-ut / 0.08), 1.0)
at(x, 0.2, knock(0.08, 150, 2500, 0.015), 0.8)
write('unlock.wav', x, peak=0.8)

# ---- rise: the egg comes up out of the chest: a swell, a shimmer climbing ----
x = silence(1.4)
rt = t_of(1.2)
at(x, 0, band(rng.standard_normal(len(rt)), 500, 9000) * np.sin(np.pi * np.minimum(1, rt / 1.0)) ** 2, 0.5)
for k in range(14):
    at(x, 0.05 + k * 0.06, bell(900 * 2 ** (k / 8), 0.6, decay=0.25, bright=0.5), 0.12)
write('rise.wav', x, peak=0.7)

# ---- breath: the drake breathing fire: a roaring rush of flame, crackling, dying away ----
x = silence(1.2)
bt = t_of(1.0)
roar = band(rng.standard_normal(len(bt)), 120, 3200)
swell = np.minimum(1, bt / 0.08) * np.exp(-np.maximum(0, bt - 0.45) / 0.18)
flutter = 0.75 + 0.25 * np.sin(2 * np.pi * 13 * bt + 2 * np.sin(2 * np.pi * 3 * bt))
at(x, 0, roar * swell * flutter, 1.0)
at(x, 0, np.sin(2 * np.pi * np.cumsum(70 + 30 * np.exp(-bt / 0.2)) / SR) * swell, 0.5)
for k in range(40):
    at(x, rng.uniform(0.02, 0.8), knock(0.02, 2000, 12000, 0.004), rng.uniform(0.15, 0.4))
write('breath.wav', x, peak=0.8)
