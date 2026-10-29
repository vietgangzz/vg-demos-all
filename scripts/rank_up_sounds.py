"""
Rank Up's sounds, synthesised from scratch (no samples). Writes WAVs into assets/rank-up/sounds/:

The board:
- lights: the board drawing back behind a veil, a soft swell
- spot: warm light gathering under your row, a glassy shimmer
- lift: your row lifting out of the board
- xp: XP ticking up on your row, a coin blip
- climb0..3: each step up the board, a swoosh and a note, rising
- knock: the one you pass knocked down a place
- zone: crossing the promotion line, a chime
- boom: the top: a thump, a brass chord, bells
- cannon: a confetti popper

The promotion:
- charge: light pulled into the badge, rising into the spin
- spin: the badge whirling round, faster and faster
- promote: it bursts into gold: the biggest hit, brass, bells and a long shimmer
- fanfare: GOLD LEAGUE landing, a brass run up into a chord
- tick: the badge flicked round, a metal ratchet each quarter turn
- launch: it rocketing up, a rising roar
- whoosh: the camera climbing with it through the clouds
- twinkle: it shining far above as a star
- fall: it coming back down as a meteor

And: tap (a button), pop (something popping up), swish (something sliding), drop (a row or a letter
landing)

    /Applications/Blender.app/Contents/Resources/5.2/python/bin/python3.13 scripts/rank_up_sounds.py
"""

import os
import wave

import numpy as np

SR = 44100
OUT = os.environ.get('OUT') or os.path.join(os.path.dirname(__file__), '..', 'assets', 'rank-up', 'sounds')
rng = np.random.default_rng(11)


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


def mix(*xs):
    out = np.zeros(max(len(x) for x in xs))
    for x in xs:
        out[: len(x)] += x
    return out


def note(n):
    """MIDI note to Hz"""
    return 440 * 2 ** ((n - 69) / 12)


def marimba(f, seconds=0.6):
    t = t_of(seconds)
    out = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.28)
    out += 0.45 * np.sin(2 * np.pi * f * 3.98 * t) * np.exp(-t / 0.06)
    out += 0.18 * np.sin(2 * np.pi * f * 9.2 * t) * np.exp(-t / 0.018)
    out += noise(seconds, 2000, 8000) * np.exp(-t / 0.003) * 0.15
    return out * np.minimum(1, t / 0.0015)


def bell(f, seconds=1.2, decay=0.5, bright=1.0):
    t = t_of(seconds)
    out = np.zeros_like(t)
    for ratio, amp, d in ((1, 1, 1), (2.01, 0.5, 0.7), (3.02, 0.3 * bright, 0.45), (4.17, 0.18 * bright, 0.3),
                          (5.43, 0.1 * bright, 0.2)):
        out += amp * np.sin(2 * np.pi * f * ratio * t + rng.uniform(0, 6)) * np.exp(-t / (decay * d))
    return out * np.minimum(1, t / 0.002)


def ping(f, seconds=0.35, decay=1.0):
    t = t_of(seconds)
    out = np.zeros_like(t)
    for ratio, amp, d in ((1, 1, 0.09), (2.76, 0.7, 0.06), (5.4, 0.45, 0.04), (8.93, 0.25, 0.025)):
        out += amp * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / (d * decay))
    return out


def knock(seconds=0.06, lo=300, hi=2400, decay=0.012):
    t = t_of(seconds)
    return noise(seconds, lo, hi) * np.exp(-t / decay)


def brass(f, seconds, attack=0.04, release=0.5):
    """A synth brass note: a sawtooth's harmonics, brightening as it swells, a little vibrato"""
    t = t_of(seconds)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * t) * np.minimum(1, t / 0.3)
    phase = 2 * np.pi * np.cumsum(f * vib) / SR
    env = np.minimum(1, t / attack) * np.exp(-np.maximum(0, t - (seconds - release)) / (release * 0.35))
    bright = 0.5 + 0.5 * np.minimum(1, t / 0.12)
    out = np.zeros_like(t)
    for n in range(1, 14):
        out += np.sin(n * phase) / n * bright ** (n * 0.4)
    return out * env


def pop(f=600, seconds=0.12):
    """A bubble popping: a fast falling blip"""
    t = t_of(seconds)
    freq = f * (1 + 1.6 * np.exp(-t / 0.012))
    return np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t / 0.03)


def whoosh(seconds, lo=500, hi=8000, centre=0.5, width=0.25):
    t = t_of(seconds)
    return noise(seconds, lo, hi) * np.exp(-((t / seconds - centre) / width) ** 2)


def sweep(f0, f1, seconds, curve=1.0):
    t = t_of(seconds)
    freq = f0 * (f1 / f0) ** ((t / seconds) ** curve)
    return np.sin(2 * np.pi * np.cumsum(freq) / SR)


# ---- tap, pop, swish, drop ----
x = silence(0.2)
at(x, 0, knock(0.04, 800, 5000, 0.004), 0.5)
at(x, 0, pop(420, 0.12), 0.8)
write('tap.wav', x, peak=0.6)
write('pop.wav', mix(pop(520, 0.14), knock(0.03, 1000, 6000, 0.003) * 0.3), peak=0.6)
x = silence(0.5)
at(x, 0, whoosh(0.35, 1200, 9000, 0.5, 0.25), 0.7)
write('swish.wav', x, peak=0.45)
write('drop.wav', mix(marimba(note(91), 0.12) * np.exp(-t_of(0.12) / 0.03), knock(0.03, 1500, 6000, 0.004) * 0.3),
      peak=0.3)


def thump(f0=110, f1=38, seconds=0.7):
    """A big low hit: a sine dropping in pitch, fast attack"""
    t = t_of(seconds)
    return sweep(f0, f1, seconds, 0.5) * np.exp(-t / (seconds * 0.3)) * np.minimum(1, t / 0.003)


def hum(f, seconds):
    t = t_of(seconds)
    out = sum(np.sin(2 * np.pi * f * n * t) / n for n in range(1, 8))
    return out


# ---- lights: the board drawing back, a soft breath and a low warm chord swelling ----
x = silence(1.6)
lt = t_of(1.4)
env = np.minimum(1, lt / 0.5) * np.exp(-np.maximum(0, lt - 0.6) / 0.35)
for n in (48, 55, 60, 64):
    at(x, 0, np.sin(2 * np.pi * note(n) * lt) * env, 0.12)
at(x, 0, noise(1.4, 300, 3000) * env, 0.12)
write('lights.wav', x, peak=0.55)

# ---- spot: warm light gathering under your row, a glassy shimmer ----
x = silence(1.4)
for k, n in enumerate((88, 91, 95, 100)):
    at(x, k * 0.06, bell(note(n), 1.1, decay=0.45, bright=0.4), 0.18)
sh = noise(1.0, 5000, 11000) * np.minimum(1, t_of(1.0) / 0.3) * np.exp(-t_of(1.0) / 0.45)
at(x, 0.05, sh, 0.06)
write('spot.wav', x, peak=0.55)

# ---- lift: a soft swoosh up and a glint ----
x = silence(0.9)
at(x, 0, whoosh(0.45, 600, 8000, 0.6, 0.3), 0.6)
at(x, 0, sweep(300, 900, 0.4, 1.5) * np.exp(-((t_of(0.4) - 0.3) / 0.12) ** 2), 0.2)
at(x, 0.3, bell(note(91), 0.6, decay=0.3, bright=0.6), 0.25)
write('lift.wav', x, peak=0.6)

# ---- xp: a coin blip ----
x = silence(0.45)
at(x, 0, ping(note(95), 0.3, 1.2), 0.6)
at(x, 0.06, ping(note(100), 0.35, 1.5), 0.7)
write('xp.wav', x, peak=0.5)

# ---- climb: a swoosh up and a brass-and-marimba note, a step higher each time ----
for k, n in enumerate((67, 71, 74, 79)):
    x = silence(1.0)
    at(x, 0, whoosh(0.32, 800, 9000, 0.55, 0.3), 0.5)
    at(x, 0, sweep(note(n - 12), note(n), 0.18, 0.6) * np.exp(-t_of(0.18) / 0.12), 0.25)
    at(x, 0.16, brass(note(n), 0.5, attack=0.02, release=0.3), 0.3)
    at(x, 0.16, marimba(note(n + 12), 0.6), 0.5)
    at(x, 0.16, bell(note(n + 24), 0.6, decay=0.3, bright=0.4), 0.12)
    write(f'climb{k}.wav', x, peak=0.7)

# ---- knock: a row bumped down ----
x = silence(0.35)
at(x, 0, knock(0.06, 200, 2500, 0.012), 0.9)
at(x, 0, pop(220, 0.15), 0.6)
write('knock.wav', x, peak=0.55)

# ---- zone: over the line, a bright chime ----
x = silence(1.4)
for k, n in enumerate((84, 88, 91, 96)):
    at(x, k * 0.03, bell(note(n), 1.2, decay=0.5, bright=0.8), 0.25)
at(x, 0, noise(0.8, 6000, 12000) * np.exp(-t_of(0.8) / 0.25), 0.08)
write('zone.wav', x, peak=0.7)

# ---- boom: the top of the board ----
x = silence(2.6)
at(x, 0, thump(120, 36, 0.9), 1.0)
at(x, 0, noise(0.5, 100, 4000) * np.exp(-t_of(0.5) / 0.08), 0.5)
for n in (60, 64, 67, 72):
    at(x, 0.02, brass(note(n), 1.4, attack=0.03, release=0.8), 0.18)
for k, n in enumerate((84, 88, 91, 96, 100)):
    at(x, 0.04 + k * 0.035, bell(note(n), 1.8, decay=0.6, bright=0.7), 0.16)
sh = noise(2.0, 5000, 12000) * np.exp(-t_of(2.0) / 0.6) * (0.5 + 0.5 * np.sin(2 * np.pi * 16 * t_of(2.0)))
at(x, 0.05, sh, 0.1)
write('boom.wav', x, peak=0.92)

# ---- cannon: a confetti popper ----
x = silence(0.6)
at(x, 0, noise(0.12, 1500, 12000) * np.exp(-t_of(0.12) / 0.02), 1.0)
at(x, 0, thump(180, 70, 0.15), 0.5)
at(x, 0.03, noise(0.5, 3000, 10000) * np.exp(-t_of(0.5) / 0.12) * 0.3, 1.0)
write('cannon.wav', x, peak=0.7)

# ---- charge: rising, pulsing faster, into the spin ----
x = silence(1.8)
ct = t_of(1.7)
rate = 4 + 26 * (ct / 1.7) ** 2
trem = 0.55 + 0.45 * np.sin(2 * np.pi * np.cumsum(rate) / SR)
rise = (ct / 1.7) ** 1.6
at(x, 0, sweep(140, 1100, 1.7, 1.5) * rise * trem, 0.35)
at(x, 0, sweep(280, 2200, 1.7, 1.5) * rise * trem, 0.12)
at(x, 0, noise(1.7, 2000, 12000) * rise ** 1.5 * trem, 0.22)
write('charge.wav', x, peak=0.7)

# ---- spin: air whirling, the flutter speeding up ----
x = silence(0.7)
st = t_of(0.6)
flutter = 0.5 + 0.5 * np.sin(2 * np.pi * np.cumsum(6 + 40 * (st / 0.6) ** 2.3) / SR)
at(x, 0, noise(0.6, 500, 7000) * flutter * (st / 0.6) ** 1.2, 0.8)
write('spin.wav', x, peak=0.6)

# ---- promote: the badge bursting into gold ----
x = silence(3.4)
at(x, 0, thump(140, 32, 1.1), 1.0)
at(x, 0, noise(0.6, 80, 5000) * np.exp(-t_of(0.6) / 0.1), 0.6)
at(x, 0, knock(0.05, 2000, 9000, 0.006), 0.6)
for n in (55, 60, 64, 67, 72, 76):
    at(x, 0.03, brass(note(n), 1.8, attack=0.03, release=1.0), 0.16)
for k, n in enumerate((79, 84, 88, 91, 96, 100, 103)):
    at(x, 0.05 + k * 0.03, bell(note(n), 2.4, decay=0.8, bright=0.8), 0.14)
sh = noise(2.8, 5000, 13000) * np.exp(-t_of(2.8) / 0.9) * (0.5 + 0.5 * np.sin(2 * np.pi * 14 * t_of(2.8)))
at(x, 0.08, sh, 0.12)
write('promote.wav', x, peak=0.95)

# ---- fanfare: a brass run up into a chord ----
x = silence(2.4)
for k, n in enumerate((67, 72, 76)):
    at(x, k * 0.1, brass(note(n), 0.16, attack=0.015, release=0.08), 0.5)
for n in (72, 76, 79, 84):
    at(x, 0.3, brass(note(n), 1.5, attack=0.03, release=0.9), 0.3)
at(x, 0.3, bell(note(96), 1.6, decay=0.6, bright=0.7), 0.25)
for k in range(5):
    at(x, 0.32 + rng.uniform(0, 0.6), ping(rng.uniform(4000, 7000), 0.2, 0.5), 0.06)
write('fanfare.wav', x, peak=0.8)

# ---- tick: the badge flicked round, a quarter turn at a time, a little metal ratchet ----
x = silence(0.12)
at(x, 0, knock(0.025, 3000, 11000, 0.0025), 0.8)
at(x, 0, ping(2600, 0.1, 0.4), 0.35)
write('tick.wav', x, peak=0.5)

# ---- launch: the badge rocketing up, a rising roar ----
x = silence(0.7)
lt = t_of(0.6)
at(x, 0, noise(0.6, 300, 6000) * (lt / 0.6) ** 1.5, 0.7)
at(x, 0, sweep(120, 900, 0.6, 1.8) * (lt / 0.6) ** 1.2, 0.35)
write('launch.wav', x, peak=0.7)

# ---- whoosh: the camera climbing with it through the clouds, the wind swelling and dying away ----
x = silence(1.0)
wt = t_of(0.9)
swell = np.sin(np.pi * wt / 0.9) ** 1.5
at(x, 0, noise(0.9, 250, 5000) * swell, 0.8)
at(x, 0, noise(0.9, 2000, 9000) * swell ** 2, 0.25)
write('whoosh.wav', x, peak=0.6)

# ---- twinkle: the star coming out, high above ----
x = silence(1.4)
for k, n in enumerate((96, 103, 100, 108)):
    at(x, k * 0.06, bell(note(n), 1.2, decay=0.5, bright=0.6), 0.25)
sh = noise(1.0, 6000, 13000) * np.exp(-t_of(1.0) / 0.35) * (0.5 + 0.5 * np.sin(2 * np.pi * 18 * t_of(1.0)))
at(x, 0, sh, 0.08)
write('twinkle.wav', x, peak=0.6)

# ---- fall: coming back down as a meteor, a falling whistle and a rising roar ----
x = silence(0.4)
ft = t_of(0.3)
at(x, 0, sweep(2200, 500, 0.3, 0.8) * (0.4 + 0.6 * ft / 0.3), 0.3)
at(x, 0, noise(0.3, 200, 6000) * (ft / 0.3) ** 1.5, 0.8)
write('fall.wav', x, peak=0.7)
