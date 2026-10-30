"""
Rank Up Neo's sounds, all of them, synthesised from scratch for its world of light: analog-style
synths (detuned saws through resonant filters), sub bass, bit-crushed digital glitches, the whine of a
light-cycle going by, big reverb. Writes stereo WAVs into assets/rank-up-neo/sounds/:

- tap: a button, a crisp click and a bright blip
- pop: something appearing, two quick glassy blips
- swish: a light-cycle going by, its whine dropping as it passes, left to right
- drop: a row or a letter rezzing in, a short digital thunk
- lights: the board's lights going down, a power hum swelling and a sub thump
- spot: a scanner sweeping up through a chord
- lift: your row lifting out, a light-cycle revving up
- xp: XP counting up, a quick run of bright blips
- climb0-3: your row moving up a place, a stab a step higher each time
- swing: the leg swinging through, a fast whoosh
- knock: the kick landing, a punch, a crunch of shattering voxels and a metallic ring
- zone: over the promotion line, a big detuned power chord
- boom: the big hit, a sub drop and a long dark tail
- cannon: confetti, a pop and a spray of glitter
- tick: a quarter turn as the badge winds up, a tight ping
- spin: the badge whirling round to face you, a rising whirr
- launch: blast off, a kick and a roar rising
- whoosh: the rush of the climb
- deck: through a deck of grid, an electric zap and a whoomp
- warp: the jump into space out of the last deck, a sucking rise and a huge VOOM
- tunnel: flying through space down the tunnel of light: a deep drone and a chord opening out, stars
  streaking past, the badge flying off into the point of light, and a swell into what comes out of it
- rez: Gold's badge built out of light, a crunchy arpeggio landing on a chord
- promote: Gold, a huge hit and a synth-brass chord swelling over it
- fanfare: the title, a bright arpeggiated motif

    /Applications/Blender.app/Contents/Resources/5.2/python/bin/python3.13 scripts/rank_up_neo_sounds.py
"""

import math
import os
import wave

import numpy as np

SR = 44100
OUT = os.environ.get('OUT') or os.path.join(os.path.dirname(__file__), '..', 'assets', 'rank-up-neo', 'sounds')
rng = np.random.default_rng(7)


# ---- Building blocks ----


def t_of(seconds):
    return np.arange(int(seconds * SR)) / SR


def note(name):
    """A note's frequency, e.g. 'D3', 'F#4'"""
    names = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}
    n, o = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((names[n] + 12 * (o + 1) - 69) / 12)


def freq_of(f, n):
    return np.full(n, f, dtype=float) if np.isscalar(f) else np.asarray(f, dtype=float)


def phase_of(f, n, start=0.0):
    return (start + np.cumsum(freq_of(f, n)) / SR) % 1.0


def blep(ph, dt):
    out = np.zeros_like(ph)
    a = ph < dt
    x = ph[a] / dt[a]
    out[a] = x + x - x * x - 1
    b = ph > 1 - dt
    x = (ph[b] - 1) / dt[b]
    out[b] = x * x + x + x + 1
    return out


def saw(f, n, start=None):
    fr = freq_of(f, n)
    ph = phase_of(fr, n, rng.random() if start is None else start)
    dt = np.clip(fr / SR, 1e-6, 0.5)
    return 2 * ph - 1 - blep(ph, dt)


def square(f, n, pw=0.5):
    fr = freq_of(f, n)
    ph = phase_of(fr, n, rng.random())
    dt = np.clip(fr / SR, 1e-6, 0.5)
    sq = np.where(ph < pw, 1.0, -1.0)
    # Less its offset, which off a narrow pulse would thump and rumble under everything
    return sq + blep(ph, dt) - blep((ph + 1 - pw) % 1.0, dt) - (2 * pw - 1)


def sine(f, n, start=0.0):
    return np.sin(2 * np.pi * phase_of(f, n, start))


def supersaw(f, n, voices=7, detune=0.012):
    out = np.zeros(n)
    for v in range(voices):
        d = (v - (voices - 1) / 2) / ((voices - 1) / 2 or 1) * detune
        out += saw(freq_of(f, n) * (1 + d), n)
    return out / voices


def noise(seconds):
    return rng.standard_normal(int(seconds * SR))


def svf(x, cutoff, q=0.7, mode='lp'):
    """A state-variable filter (topology-preserving), its cutoff free to move every sample"""
    n = len(x)
    fc = np.clip(freq_of(cutoff, n), 20, SR * 0.45)
    g = np.tan(np.pi * fc / SR)
    k = 1.0 / q
    a1 = 1.0 / (1.0 + g * (g + k))
    a2 = g * a1
    a3 = g * a2
    lp = np.zeros(n)
    bp = np.zeros(n)
    ic1 = ic2 = 0.0
    for i in range(n):
        v3 = x[i] - ic2
        v1 = a1[i] * ic1 + a2[i] * v3
        v2 = ic2 + a2[i] * ic1 + a3[i] * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        lp[i] = v2
        bp[i] = v1
    if mode == 'lp':
        return lp
    if mode == 'bp':
        return bp * k
    return x - k * bp - lp


def env(n, attack, decay, curve=1.0):
    """A quick rise and an exponential fall, over n samples"""
    t = np.arange(n) / SR
    a = np.minimum(1, t / max(attack, 1e-4))
    return a * np.exp(-np.maximum(0, t - attack) / decay) ** curve


def ramp(n, a, b, curve=1.0):
    return a + (b - a) * np.linspace(0, 1, n) ** curve


def glide(n, f0, f1, curve=1.0):
    """A pitch sliding from f0 to f1 exponentially"""
    return f0 * (f1 / f0) ** (np.linspace(0, 1, n) ** curve)


def sat(x, drive=2.0):
    return np.tanh(x * drive) / np.tanh(drive)


def crush(x, bits=5, down=6):
    held = np.repeat(x[::down], down)[: len(x)]
    q = 2 ** (bits - 1)
    return np.round(held * q) / q


def silence(seconds):
    return np.zeros((int(seconds * SR), 2))


def at(buf, start, x, gain=1.0, pan=0.0):
    """Mix x into the stereo buffer at `start` seconds, panned -1 (left) to 1 (right)"""
    x = np.asarray(x)
    if x.ndim == 1:
        l, r = math.cos((pan + 1) * math.pi / 4), math.sin((pan + 1) * math.pi / 4)
        x = np.stack([x * l * 1.414, x * r * 1.414], axis=1)
    i = int(start * SR)
    j = min(len(buf), i + len(x))
    if j > i:
        buf[i:j] += x[: j - i] * gain


def wide(x, delay=0.011):
    """A mono sound spread wide: the right a hair behind the left"""
    d = int(delay * SR)
    r = np.concatenate([np.zeros(d), x])[: len(x)]
    return np.stack([x, r], axis=1)


def filter_fft(x, gain):
    """x through a filter given as its gain at each frequency; padded, so the end doesn't wrap round to the start"""
    size = 1 << (2 * len(x) - 1).bit_length()
    f = np.fft.rfftfreq(size, 1 / SR)
    return np.fft.irfft(np.fft.rfft(x, size) * gain(f), size)[: len(x)]


def lowpass_fft(x, cutoff):
    return filter_fft(x, lambda f: 1 / (1 + (f / cutoff) ** 4))


def highpass_fft(x, cutoff):
    return filter_fft(x, lambda f: 1 / (1 + (cutoff / np.maximum(f, 1e-3)) ** 4))


def reverb(buf, seconds=1.6, mix=0.3, tone=6000, predelay=0.012):
    """A plate-ish reverb: each side convolved with its own decaying noise, darker as it goes"""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = np.zeros((len(buf) + n, 2))
    for c in range(2):
        ir = rng.standard_normal(n) * np.exp(-t * 6.9 / seconds)
        ir = lowpass_fft(ir, tone)
        ir[: int(predelay * SR)] = 0
        ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
        m = len(buf) + n
        size = 1 << (m - 1).bit_length()
        wet = np.fft.irfft(np.fft.rfft(buf[:, c], size) * np.fft.rfft(ir, size), size)[:m]
        # No lows in the room, so the tail stays clear rather than booming
        out[:, c] = highpass_fft(wet, 180) * mix
        out[: len(buf), c] += buf[:, c] * (1 - mix * 0.5)
    return out


def delay(buf, time=0.16, feedback=0.35, mix=0.3, pingpong=True):
    d = int(time * SR)
    out = np.zeros((len(buf) + d * 6, 2))
    out[: len(buf)] += buf
    tap = buf.copy()
    for k in range(1, 6):
        tap = tap * feedback
        if pingpong:
            tap = tap[:, ::-1]
        out[d * k : d * k + len(buf)] += tap * mix
    return out


def write(name, buf, peak=0.92):
    buf = np.asarray(buf, dtype=float)
    if buf.ndim == 1:
        buf = np.stack([buf, buf], axis=1)
    buf = np.stack([highpass_fft(buf[:, c], 25) for c in range(2)], axis=1)
    buf = buf / (np.max(np.abs(buf)) + 1e-9)
    # A soft limiter, then the level it's meant to sit at
    buf = np.tanh(buf * 1.4) / np.tanh(1.4) * peak
    loud = np.nonzero(np.max(np.abs(buf), axis=1) > 0.004)[0]
    end = min(len(buf), (loud[-1] if len(loud) else len(buf)) + int(SR * 0.04))
    fade = np.minimum(1, (end - np.arange(end)) / (SR * 0.04))
    buf = buf[:end] * fade[:, None]
    pcm = (np.clip(buf, -1, 1) * 32767).astype(np.int16)
    os.makedirs(OUT, exist_ok=True)
    with wave.open(os.path.join(OUT, name), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print('wrote', name, round(end / SR, 2), 's')


# ---- Pieces several sounds share ----


def click(seconds=0.004):
    return svf(noise(seconds), 6000, 0.7, 'hp') * env(int(seconds * SR), 0.0002, seconds / 3)


def sub_drop(seconds, f0, f1, decay, curve=0.4):
    n = int(seconds * SR)
    return sine(glide(n, f0, f1, curve), n) * env(n, 0.002, decay)


def glitter(buf, start, seconds, count, lo=2500, hi=7000, gain=0.12):
    """Tiny bright pings scattered about the stereo field"""
    for _ in range(count):
        s = start + rng.random() ** 1.6 * seconds
        f = lo * (hi / lo) ** rng.random()
        n = int(0.05 * SR)
        at(buf, s, sine(f, n) * env(n, 0.001, 0.012), gain * (0.5 + rng.random()), pan=rng.uniform(-0.9, 0.9))


def shards(buf, start, seconds, count, gain=0.16):
    """Voxels of light breaking off: crunchy square blips, scattered"""
    for _ in range(count):
        s = start + rng.random() ** 1.3 * seconds
        f = 1500 * (5 ** rng.random())
        n = int(0.03 * SR)
        x = crush(square(f, n), 4, 3) * env(n, 0.0005, 0.008)
        at(buf, s, x, gain * (0.4 + rng.random()), pan=rng.uniform(-0.9, 0.9))


def chord_stab(freqs, seconds, attack=0.004, decay=0.35, f_lo=300, f_hi=5000, q=1.4, voices=7, detune=0.014):
    n = int(seconds * SR)
    x = sum(supersaw(f, n, voices, detune) for f in freqs) / len(freqs)
    e = env(n, attack, decay)
    cut = f_lo + (f_hi - f_lo) * env(n, attack, decay * 0.6)
    return svf(x, cut, q) * e


# ---- The sounds ----

# tap: a crisp click and a bright blip
b = silence(0.25)
n = int(0.06 * SR)
at(b, 0, click(), 0.6)
at(b, 0.002, sine(glide(n, 1900, 2600, 0.5), n) * env(n, 0.001, 0.018), 0.5)
at(b, 0.004, crush(square(3200, n), 6, 2) * env(n, 0.001, 0.008), 0.12)
write('tap.wav', reverb(b, 0.4, 0.15), 0.8)

# pop: two quick glassy blips, up a fifth
b = silence(0.35)
for k, f in enumerate([note('E6'), note('B6')]):
    n = int(0.07 * SR)
    x = svf(square(f, n, 0.3), 5000, 0.8) * 0.5 + sine(f * 2, n) * 0.4
    at(b, k * 0.045, x * env(n, 0.001, 0.022), 0.6, pan=-0.25 + 0.5 * k)
write('pop.wav', reverb(b, 0.7, 0.22), 0.7)

# swish: a light-cycle going by, its whine dropping as it passes, left to right
b = silence(0.75)
n = int(0.6 * SR)
tt = np.linspace(0, 1, n)
pitch = 300 * 2 ** ((3 - 8 * (1 / (1 + np.exp(-(tt - 0.45) * 10)))) / 12)
body = svf(
    saw(pitch, n) * 0.6 + square(pitch * 2, n, 0.25) * 0.3,
    ramp(n, 1200, 5000) * np.exp(-((tt - 0.45) / 0.3) ** 2) + 600,
    2.2,
)
bell = np.exp(-((tt - 0.45) / 0.18) ** 2)
air = svf(noise(0.6), glide(n, 6000, 900), 1.2, 'bp') * bell
x = (body * 0.7 + air * 0.6) * bell
pan = np.linspace(-0.85, 0.85, n)
at(b, 0, np.stack([x * np.cos((pan + 1) * np.pi / 4), x * np.sin((pan + 1) * np.pi / 4)], axis=1) * 1.4)
write('swish.wav', reverb(b, 0.9, 0.2), 0.8)

# drop: something rezzing in, a short digital thunk
b = silence(0.2)
n = int(0.12 * SR)
at(b, 0, sine(glide(n, 260, 60, 0.4), n) * env(n, 0.001, 0.035), 0.9)
at(b, 0, crush(square(2100, int(0.02 * SR)), 4, 4) * env(int(0.02 * SR), 0.0005, 0.006), 0.25)
at(b, 0, click(), 0.4)
write('drop.wav', reverb(b, 0.35, 0.12), 0.75)

# lights: the lights going down, a power hum swelling up and dying, a sub thump under it
b = silence(1.9)
n = int(1.5 * SR)
tt = np.linspace(0, 1, n)
hum = supersaw(55, n, 5, 0.006) * 0.7 + supersaw(110, n, 5, 0.008) * 0.4
cut = 150 + 1600 * np.sin(np.pi * np.minimum(1, tt * 1.3)) ** 2
x = svf(hum, cut, 3.0) * np.sin(np.pi * tt) ** 0.6
x *= 1 + 0.25 * np.sin(2 * np.pi * 8 * t_of(1.5))
at(b, 0, wide(x), 0.6)
at(b, 0, sub_drop(1.0, 70, 32, 0.35), 1.0)
whine = sine(glide(n, 3000, 5200), n) * np.sin(np.pi * tt) ** 3
at(b, 0.05, wide(whine, 0.017), 0.05)
write('lights.wav', reverb(b, 2.2, 0.35, 3500), 0.85)

# spot: a scanner sweeping up through a chord, echoing side to side
b = silence(1.3)
n = int(0.9 * SR)
x = supersaw(note('D3'), n, 5) + supersaw(note('A3'), n, 5) + supersaw(note('D4'), n, 5)
x = svf(x / 3, glide(n, 250, 4500, 0.8), 6.0, 'bp')
x *= env(n, 0.05, 0.4)
at(b, 0, wide(x, 0.013), 0.8)
for k, f in enumerate([note('D6'), note('A6'), note('D7')]):
    m = int(0.12 * SR)
    at(b, 0.25 + k * 0.09, sine(f, m) * env(m, 0.001, 0.04), 0.15, pan=(-0.6, 0.6, 0)[k])
write('spot.wav', reverb(delay(b, 0.14, 0.35, 0.3), 1.4, 0.3), 0.8)

# lift: your row lifting out, a light-cycle revving up
b = silence(1.0)
n = int(0.85 * SR)
tt = np.linspace(0, 1, n)
pitch = glide(n, 70, 190, 0.8) * (1 + 0.02 * np.sin(2 * np.pi * 18 * tt * 0.85))
x = sat(saw(pitch, n) * 0.6 + square(pitch * 1.005, n) * 0.4, 2.5)
x = svf(x, glide(n, 300, 4000, 0.7), 2.0) * np.minimum(1, tt * 6) * (1 - tt ** 4)
air = svf(noise(0.85), glide(n, 800, 6000), 1.0, 'bp') * tt ** 2 * 0.4
at(b, 0, wide(x * 0.8 + air, 0.009))
write('lift.wav', reverb(b, 1.0, 0.2), 0.8)

# xp: XP counting up, a quick run of bright blips climbing, the last one ringing
b = silence(0.6)
for k, f in enumerate([note('E5'), note('G#5'), note('B5'), note('E6'), note('G#6')]):
    m = int(0.09 * SR)
    x = svf(square(f, m, 0.25), 6000, 0.9) * 0.5 + sine(f * 2, m) * 0.3
    at(b, k * 0.04, x * env(m, 0.001, 0.05 if k == 4 else 0.02), 0.5, pan=-0.5 + k * 0.25)
write('xp.wav', reverb(delay(b, 0.09, 0.3, 0.25), 0.8, 0.2), 0.75)

# climb0-3: your row moving up a place, a power stab a step higher each time
for k, root in enumerate(['D3', 'F3', 'A3', 'D4']):
    b = silence(0.9)
    f = note(root)
    at(b, 0, wide(chord_stab([f, f * 1.5, f * 2], 0.7, 0.003, 0.22, 250, 6000, 2.2), 0.012), 0.8)
    at(b, 0, sine(f / 2, int(0.4 * SR)) * env(int(0.4 * SR), 0.003, 0.12), 0.5)
    write(f'climb{k}.wav', reverb(b, 1.2, 0.25), 0.8)

# swing: the leg swinging through, a fast whoosh with a whine in it
b = silence(0.3)
n = int(0.22 * SR)
tt = np.linspace(0, 1, n)
x = svf(noise(0.22), glide(n, 900, 7000, 0.6), 1.6, 'bp') * np.sin(np.pi * tt) ** 1.5
whine = saw(glide(n, 280, 900, 0.7), n) * np.sin(np.pi * tt) ** 2
at(b, 0, wide(x * 0.8 + svf(whine, 3000, 1.0) * 0.3, 0.006))
write('swing.wav', b, 0.7)

# knock: the kick landing: a punch, a crunch of voxels shattering off and a metallic ring
b = silence(0.9)
at(b, 0, click(0.005), 0.9)
n = int(0.4 * SR)
at(b, 0, sat(sine(glide(n, 190, 42, 0.35), n) * env(n, 0.001, 0.12), 3.0), 1.0)
m = int(0.12 * SR)
at(b, 0.003, wide(crush(svf(noise(0.12), 2500, 0.8, 'bp'), 4, 8) * env(m, 0.001, 0.035), 0.004), 0.7)
shards(b, 0.02, 0.3, 14, 0.18)
r = int(0.5 * SR)
at(b, 0.004, wide(sine(410 + 300 * sine(410 * 1.41, r), r) * env(r, 0.001, 0.12), 0.015), 0.12)
write('knock.wav', reverb(b, 0.9, 0.22, 5000), 0.95)

# zone: over the promotion line: a big detuned power chord, filter opening and shutting
b = silence(1.6)
f = note('D3')
at(b, 0, wide(chord_stab([f, f * 1.5, f * 2, f * 3], 1.2, 0.006, 0.5, 200, 7000, 2.0, 7, 0.018), 0.014), 0.8)
at(b, 0, sub_drop(0.6, 80, 45, 0.2), 0.7)
write('zone.wav', reverb(b, 2.0, 0.3), 0.85)

# boom: the big hit: a sub drop, a distorted punch, a burst of noise and a long dark tail
b = silence(2.4)
at(b, 0, click(0.006), 1.0)
at(b, 0, sat(sub_drop(1.6, 90, 26, 0.55, 0.3), 2.0), 1.0)
n = int(0.35 * SR)
at(b, 0, sat(sine(glide(n, 220, 55, 0.3), n) * env(n, 0.001, 0.08), 4.0), 0.6)
m = int(1.2 * SR)
at(b, 0, wide(svf(noise(1.2), glide(m, 7000, 300, 0.5), 0.9) * env(m, 0.002, 0.25), 0.013), 0.5)
at(b, 0, wide(svf(noise(2.0), 120, 0.7) * env(int(2.0 * SR), 0.05, 0.6), 0.02), 0.6)
write('boom.wav', reverb(b, 2.6, 0.35, 3000), 0.95)

# cannon: confetti: a pop, a puff of air and a spray of glitter
b = silence(0.8)
at(b, 0, sub_drop(0.15, 160, 60, 0.04), 0.8)
n = int(0.2 * SR)
at(b, 0, wide(svf(noise(0.2), glide(n, 3000, 800), 0.8) * env(n, 0.001, 0.05), 0.01), 0.5)
glitter(b, 0.03, 0.5, 28, gain=0.14)
write('cannon.wav', reverb(b, 1.0, 0.25), 0.8)

# tick: a quarter turn as the badge winds up, a tight resonant ping
b = silence(0.14)
n = int(0.08 * SR)
at(b, 0, click(0.002), 0.5)
at(b, 0, svf(square(1200, n), 2400, 8.0, 'bp') * env(n, 0.0005, 0.015), 0.6)
write('tick.wav', b, 0.7)

# spin: the badge whirling round to face you, a whirr rising and speeding up
b = silence(0.75)
n = int(0.65 * SR)
tt = np.linspace(0, 1, n)
trem = 0.5 + 0.5 * np.sin(2 * np.pi * np.cumsum(10 + 40 * tt ** 1.5) / SR)
x = svf(saw(glide(n, 140, 420, 0.8), n), glide(n, 600, 5000), 3.0) * trem * np.minimum(1, tt * 4) * (1 - tt ** 6)
at(b, 0, wide(x, 0.01), 0.8)
write('spin.wav', reverb(b, 0.8, 0.2), 0.75)

# launch: blast off: a kick, a roar rising, air tearing
b = silence(1.1)
at(b, 0, sat(sub_drop(0.5, 120, 40, 0.15), 2.5), 1.0)
at(b, 0, click(0.004), 0.8)
n = int(0.95 * SR)
tt = np.linspace(0, 1, n)
roar = sat(supersaw(glide(n, 55, 220, 0.6), n, 5, 0.02), 3.0)
roar = svf(roar, glide(n, 400, 6000, 0.6), 1.5) * np.minimum(1, tt * 20) * (1 - tt) ** 1.5
air = svf(noise(0.95), glide(n, 1000, 8000), 0.9, 'bp') * np.minimum(1, tt * 10) * (1 - tt)
at(b, 0, wide(roar * 0.7 + air * 0.5, 0.012))
write('launch.wav', reverb(b, 1.2, 0.2), 0.9)

# whoosh: the rush of the climb, wind rising and a tone climbing with it
b = silence(1.2)
n = int(1.1 * SR)
tt = np.linspace(0, 1, n)
shape = np.sin(np.pi * tt) ** 1.2
wind = svf(noise(1.1), glide(n, 500, 5000, 0.8), 1.3, 'bp') * shape
tone = svf(supersaw(glide(n, 110, 330), n, 5, 0.02), glide(n, 300, 2500), 2.0) * shape
at(b, 0, wide(wind * 0.8 + tone * 0.3, 0.015))
write('whoosh.wav', reverb(b, 1.3, 0.2), 0.8)

# deck: through a deck of grid: an electric zap crackling past and a whoomp under it
b = silence(0.7)
n = int(0.3 * SR)
tt = np.linspace(0, 1, n)
zap = crush(svf(noise(0.3), glide(n, 8000, 1200, 0.5), 2.5, 'bp'), 5, 3) * np.exp(-((tt - 0.3) / 0.18) ** 2)
at(b, 0, wide(zap, 0.008), 0.7)
at(b, 0.05, sub_drop(0.4, 140, 45, 0.12), 0.9)
m = int(0.25 * SR)
at(b, 0.05, wide(sine(glide(m, 2400, 600, 0.5), m) * env(m, 0.002, 0.06), 0.012), 0.2)
shards(b, 0.04, 0.2, 8, 0.1)
write('deck.wav', reverb(b, 1.0, 0.25), 0.85)

# warp: the jump into space: everything sucked in, rising, for a fifth of a second, then a huge VOOM,
# a sub drop under a wide flanged sweep, and the air of it rushing off into the distance
PRE = 0.2
b = silence(2.0)
n = int(PRE * SR)
tt = np.linspace(0, 1, n)
suck = svf(noise(PRE), glide(n, 400, 9000, 1.5), 2.0, 'bp') * tt ** 3
whine = sine(glide(n, 300, 2400, 1.6), n) * tt ** 2.5
at(b, 0, wide(suck * 0.6 + whine * 0.25, 0.008))
at(b, PRE, click(0.006), 1.0)
at(b, PRE, sat(sub_drop(1.2, 70, 24, 0.45, 0.3), 2.5), 1.0)
m = int(1.4 * SR)
tm = np.linspace(0, 1, m)
voom = sat(supersaw(glide(m, 220, 45, 0.35), m, 7, 0.03), 2.0)
voom = svf(voom, glide(m, 7000, 250, 0.5), 2.5) * env(m, 0.003, 0.35)
# Flanged: the same thing a few milliseconds behind itself, the gap sweeping
lag = (0.0015 + 0.004 * (0.5 + 0.5 * np.sin(2 * np.pi * 1.3 * tm))) * SR
idx = np.clip(np.arange(m) - lag, 0, m - 1).astype(int)
at(b, PRE, wide(voom + voom[idx] * 0.8, 0.014), 0.7)
air = svf(noise(1.4), glide(m, 9000, 400, 0.6), 0.9) * env(m, 0.005, 0.5)
at(b, PRE, wide(air, 0.02), 0.45)
glitter(b, PRE, 0.6, 18, 3000, 10000, 0.08)
write('warp.wav', reverb(b, 3.0, 0.4, 7000), 0.95)

# tunnel: flying through space, from the jump till Gold's badge is built: a deep drone and a wide
# chord of pads slowly opening out over it, stars streaking past either side, the tunnel's rings
# rushing by, the badge whining off ahead and falling away into the point of light (at 0.85s), and
# a shimmering swell up into what comes out of it (at 1.4s)
DUR = 1.6
b = silence(DUR + 0.3)
n = int(DUR * SR)
tt = np.linspace(0, 1, n)
fade_in = np.minimum(1, tt * 5)
drone = sine(note('D1'), n) * 0.8 + svf(supersaw(note('D2'), n, 5, 0.01), 260, 1.2) * 0.7
at(b, 0, wide(drone * fade_in, 0.02), 0.55)
pad = sum(supersaw(note(x), n, 7, 0.02) for x in ['D3', 'A3', 'E4', 'A4', 'D5']) / 5
pad = svf(pad, glide(n, 350, 4500, 0.8), 1.4) * fade_in * (0.7 + 0.3 * tt)
at(b, 0, wide(pad, 0.019), 0.55)
# The rings going by, faster and faster
rings = (0.5 + 0.5 * np.sin(2 * np.pi * np.cumsum(4 + 12 * tt ** 1.3) / SR)) ** 8
rush = svf(noise(DUR), glide(n, 900, 6000, 0.9), 1.4, 'bp') * rings * fade_in
at(b, 0, wide(rush, 0.011), 0.35)
# Stars streaking past: each a short bright tone dropping in pitch as it goes by, one side or the other
for k in range(16):
    st = 0.05 + k * 0.085 + rng.random() * 0.04
    m = int(0.18 * SR)
    f0 = 2500 + 3500 * rng.random()
    x = sine(glide(m, f0, f0 * 0.55, 0.7), m) * np.sin(np.pi * np.linspace(0, 1, m)) ** 2
    at(b, st, x, 0.07 + 0.05 * (k / 16), pan=(-0.85 if k % 2 else 0.85) * (0.6 + 0.4 * rng.random()))
# The badge flying off ahead: a whine dropping away, smaller and smaller, a soft ting as it reaches the light
m = int(0.85 * SR)
tm = np.linspace(0, 1, m)
off = svf(saw(glide(m, 880, 330, 0.8), m), glide(m, 5000, 900), 1.6) * (1 - tm) ** 1.5 * np.minimum(1, tm * 10)
at(b, 0, wide(off, 0.006), 0.3)
r = int(0.9 * SR)
at(b, 0.85, wide(sine(note('A6'), r) * env(r, 0.002, 0.25) + sine(note('E7'), r) * env(r, 0.002, 0.15) * 0.5, 0.02), 0.25)
# Swelling up into what comes out: a reversed shimmer and noise rising
m = int(0.6 * SR)
tm = np.linspace(0, 1, m)
swell = svf(noise(0.6), glide(m, 1500, 12000, 0.7), 1.2, 'bp') * tm ** 3
shimmer = sum(sine(note(x), m) for x in ['D6', 'A6', 'D7']) / 3 * tm ** 4
at(b, 0.8, wide(swell * 0.5 + shimmer * 0.35, 0.013))
write('tunnel.wav', delay(reverb(b, 3.2, 0.45, 7000), 0.19, 0.3, 0.2), 0.85)

# rez: Gold's badge built out of light: a crunchy arpeggio racing up two octaves over a rising hum,
# landing on a bright chord
b = silence(1.6)
seq = ['D4', 'F#4', 'A4', 'D5', 'F#5', 'A5', 'D6', 'F#6']
for k, nm in enumerate(seq):
    m = int(0.07 * SR)
    at(b, k * 0.055, crush(square(note(nm), m, 0.3), 5, 3) * env(m, 0.001, 0.03), 0.22, pan=-0.6 + 1.2 * k / 7)
n = int(0.45 * SR)
hum = svf(supersaw(glide(n, 73, 147), n, 5), glide(n, 300, 3000), 2.0) * np.minimum(1, t_of(0.45) * 8)
at(b, 0, wide(hum, 0.01), 0.35)
f = note('D4')
at(b, 0.45, wide(chord_stab([f, f * 1.25, f * 1.5, f * 2], 0.9, 0.004, 0.4, 600, 8000, 1.6), 0.012), 0.7)
m = int(0.8 * SR)
at(b, 0.45, wide(sine(note('D6'), m) * env(m, 0.001, 0.25), 0.02), 0.25)
glitter(b, 0.45, 0.4, 14, 3000, 8000, 0.1)
write('rez.wav', reverb(b, 1.6, 0.3), 0.85)

# promote: Gold: a huge hit, and a chord of synth brass swelling up over it, wide and shining
b = silence(3.4)
at(b, 0, click(0.006), 1.0)
at(b, 0, sat(sub_drop(1.4, 100, 30, 0.5, 0.3), 2.2), 1.0)
m = int(0.8 * SR)
at(b, 0, wide(svf(noise(0.8), glide(m, 8000, 500, 0.5), 0.9) * env(m, 0.002, 0.18), 0.012), 0.45)
n = int(2.8 * SR)
tt = np.linspace(0, 1, n)
chord = [note(x) for x in ['D3', 'A3', 'D4', 'F#4', 'A4', 'D5']]
brass = sum(supersaw(f, n, 7, 0.016) for f in chord) / len(chord)
brass = svf(brass, 400 + 5000 * np.minimum(1, tt * 2.2) ** 0.7 * (1 - 0.4 * tt), 1.3)
at(b, 0.02, wide(brass * np.minimum(1, tt * 7) * (1 - tt) ** 1.2, 0.018), 0.8)
glitter(b, 0.1, 1.8, 30, 3000, 9000, 0.08)
write('promote.wav', reverb(b, 3.0, 0.35, 5000), 0.95)

# fanfare: the title: a bright arpeggiated motif over a bass that steps up, ringing out at the end
b = silence(2.4)
motif = ['D5', 'A4', 'D5', 'F#5', 'A5', 'F#5', 'A5', 'D6']
for k, nm in enumerate(motif):
    m = int(0.2 * SR)
    f = note(nm)
    last = k == len(motif) - 1
    pluck = svf(supersaw(f, m, 3, 0.008), 1500 + 6000 * env(m, 0.002, 0.05), 1.5) * env(m, 0.002, 0.25 if last else 0.09)
    at(b, k * 0.11, pluck, 0.45, pan=(-0.35 if k % 2 else 0.35))
    at(b, k * 0.11, sine(f * 2, m) * env(m, 0.001, 0.06), 0.1)
for k, nm in enumerate(['D2', 'D2', 'A2', 'D3']):
    m = int(0.35 * SR)
    at(b, k * 0.22, svf(saw(note(nm), m), 900, 1.2) * env(m, 0.003, 0.15), 0.45)
write('fanfare.wav', reverb(delay(b, 0.11, 0.3, 0.2), 2.0, 0.3), 0.85)
