"""
Water Dragon's sounds, synthesised from scratch (no samples). Writes WAVs into assets/water-dragon/:

- drum: the big drum of a water puppet show, a deep 'tùng' with the hall ringing after it
- splash: something breaking the water, the drops pattering back
- big-splash: the dragon diving back in: a deep whump, a wash of water, a long patter of drops
- plop: a single drop or a finger on the water
- hit: a blow landed: the wooden clappers' crack, a thump, the water thrown up
- spray: the dragon's spout: the hiss of the jet and the rain of it coming down
- flute: a phrase on a bamboo flute (sáo), in the five-note scale, with its slides and breath
- night: the pond at night, looping: crickets, now and then a frog, the water lapping

    python3 scripts/water_dragon_sounds.py   (needs numpy)
"""

import os
import wave

import numpy as np

SR = 44100
OUT = os.environ.get('OUT') or os.path.join(os.path.dirname(__file__), '..', 'assets', 'water-dragon')
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


def at(buf, start, x, gain=1.0):
    i = int(start * SR)
    j = min(len(buf), i + len(x))
    if j > i:
        buf[i:j] += x[: j - i] * gain


def band(x, lo, hi):
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X = np.fft.rfft(x)
    edge = lambda v, c, w: 1 / (1 + np.exp(-(v - c) / w))
    mask = edge(f, lo, lo * 0.15 + 1) * (1 - edge(f, hi, hi * 0.15 + 1))
    return np.fft.irfft(X * mask, len(x))


def env(n, attack, decay):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(attack, 1e-4)) * np.exp(-t / decay)


def room(x, seconds=1.2, wet=0.25, tone=4000):
    """A hall's ring after it: noise decaying, darker as it goes"""
    n = int(seconds * SR)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / (SR * seconds / 5))
    ir = band(ir, 120, tone)
    ir /= np.sqrt(np.sum(ir**2)) + 1e-9
    y = np.convolve(x, ir)[: len(x) + n]
    out = np.zeros(len(y))
    out[: len(x)] += x
    return out + y * wet


def bubble(freq, dur=0.03, gain=1.0):
    """A drop going in: a little ring rising in pitch as the bubble it trapped closes"""
    n = int(dur * 3 * SR)
    t = np.arange(n) / SR
    f = freq * (1 + 1.6 * t / dur)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t / dur) * gain


def patter(seconds, count, lo, hi, start=0.0, falloff=0.5):
    buf = silence(seconds + 0.2)
    for _ in range(count):
        t = start + rng.exponential(falloff)
        if t > seconds:
            continue
        f = rng.uniform(lo, hi)
        at(buf, t, bubble(f, rng.uniform(0.008, 0.025), rng.uniform(0.15, 1.0)))
    return buf


def drum():
    n = int(2.2 * SR)
    t = np.arange(n) / SR
    f = 58 + 40 * np.exp(-t / 0.05)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.55)
    over = np.sin(2 * np.pi * np.cumsum(f * 1.59) / SR) * np.exp(-t / 0.22) * 0.35
    over += np.sin(2 * np.pi * np.cumsum(f * 2.14) / SR) * np.exp(-t / 0.12) * 0.18
    hit = band(rng.standard_normal(n), 80, 1800) * np.exp(-t / 0.012) * 0.6
    x = body + over + hit
    return room(x, 1.6, 0.35, 2500)


def splash(big=False):
    secs = 2.0 if big else 0.9
    n = int(secs * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    wash = band(noise, 250, 7000) * env(n, 0.004, 0.16 if not big else 0.35)
    # The water sloshing: the noise rising and falling a few times
    if big:
        wash *= 1 + 0.5 * np.sin(2 * np.pi * 7 * t) * np.exp(-t / 0.4)
        thump = np.sin(2 * np.pi * np.cumsum(55 + 50 * np.exp(-t / 0.04)) / SR) * env(n, 0.002, 0.18)
        wash = wash + thump * 1.4
    drops = patter(secs, 140 if big else 45, 500, 2200, 0.05, 0.45 if big else 0.18)[:n]
    return room(wash * 0.9 + drops * 0.5, 0.9, 0.18, 6000)


def plop():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    at(x, 0.0, bubble(520, 0.035, 1.0))
    x += band(rng.standard_normal(n), 800, 6000) * np.exp(-t / 0.01) * 0.25
    return room(x, 0.6, 0.15, 6000)


def hit():
    n = int(1.4 * SR)
    t = np.arange(n) / SR
    # The clappers: two hard wooden knocks, a hollow ring in each
    crack = np.zeros(n)
    for start, f in [(0.0, 1850), (0.028, 1240)]:
        m = int(0.12 * SR)
        tt = np.arange(m) / SR
        knock = (np.sin(2 * np.pi * f * tt) + 0.5 * np.sin(2 * np.pi * f * 2.7 * tt)) * np.exp(-tt / 0.018)
        knock += band(rng.standard_normal(m), 1500, 8000) * np.exp(-tt / 0.004) * 0.8
        at(crack, start, knock)
    thump = np.sin(2 * np.pi * np.cumsum(70 + 60 * np.exp(-t / 0.03)) / SR) * env(n, 0.002, 0.14)
    water = splash()
    water = water[:n] if len(water) >= n else np.pad(water, (0, n - len(water)))
    return room(crack * 0.9 + thump * 0.9 + water * 0.5, 0.8, 0.2, 5000)


def spray():
    secs = 2.6
    n = int(secs * SR)
    t = np.arange(n) / SR
    shape = np.minimum(1, t / 0.12) * np.clip((2.2 - t) / 0.4, 0, 1)
    hiss = band(rng.standard_normal(n), 1400, 9000) * shape
    hiss *= 1 + 0.25 * np.sin(2 * np.pi * 11 * t + np.sin(2 * np.pi * 3 * t))
    rain = patter(secs, 420, 900, 3200, 0.5, 0.9)[:n]
    return hiss * 0.55 + rain * 0.6


# The flute: ngũ cung, sol la đô rê mi (G A C D E), with slides up into notes and a breathy tone
NOTES = {'G4': 392.0, 'A4': 440.0, 'C5': 523.25, 'D5': 587.33, 'E5': 659.25, 'G5': 783.99}


def flute():
    phrase = [
        ('D5', 0.5, 'G4'),
        ('E5', 0.35, None),
        ('D5', 0.25, None),
        ('C5', 0.5, None),
        ('A4', 0.35, None),
        ('C5', 0.3, None),
        ('D5', 1.2, 'C5'),
        ('G5', 0.3, 'E5'),
        ('E5', 0.3, None),
        ('D5', 0.4, None),
        ('C5', 0.3, None),
        ('A4', 0.35, None),
        ('G4', 1.6, 'A4'),
    ]
    total = sum(d for _, d, _ in phrase) + 0.4
    n = int(total * SR)
    f = np.zeros(n)
    amp = np.zeros(n)
    i = 0
    for note, dur, slide in phrase:
        m = int(dur * SR)
        target = NOTES[note]
        seg = np.full(m, target)
        if slide:
            s = int(min(0.09, dur * 0.3) * SR)
            k = np.linspace(0, 1, s)
            seg[:s] = NOTES[slide] + (target - NOTES[slide]) * (1 - (1 - k) ** 2)
        f[i : i + m] = seg[: max(0, min(m, n - i))]
        a = np.ones(m)
        a[: int(0.03 * SR)] = np.linspace(0.3, 1, int(0.03 * SR))
        a[-int(0.04 * SR) :] *= np.linspace(1, 0.55, int(0.04 * SR))
        amp[i : i + m] = a[: max(0, min(m, n - i))]
        i += m
    f[i:] = f[i - 1]
    t = np.arange(n) / SR
    # Vibrato coming in on the long notes
    vib = 1 + 0.012 * np.sin(2 * np.pi * 5.4 * t) * np.clip((t % 1.2) / 0.5, 0, 1)
    ph = 2 * np.pi * np.cumsum(f * vib) / SR
    tone = np.sin(ph) + 0.22 * np.sin(2 * ph) + 0.08 * np.sin(3 * ph)
    breath = band(rng.standard_normal(n), 1500, 6000) * 0.07
    swell = np.minimum(1, t / 0.15) * np.clip((total - t) / 0.5, 0, 1)
    smooth_amp = np.convolve(amp, np.ones(400) / 400, mode='same')
    x = (tone + breath) * smooth_amp * swell
    return room(x, 2.2, 0.45, 5000)


def night():
    secs = 16.0
    n = int(secs * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    # Crickets: a few, each chirping its own rhythm
    for k in range(4):
        fc = rng.uniform(4200, 5200)
        rate = rng.uniform(1.4, 2.4)
        pulses = (np.sin(2 * np.pi * 32 * t) > 0.2).astype(float)
        groups = (np.sin(2 * np.pi * rate * t + rng.uniform(0, 6)) > 0.55).astype(float)
        gate = np.convolve(pulses * groups, np.ones(60) / 60, mode='same')
        x += np.sin(2 * np.pi * fc * t) * gate * rng.uniform(0.04, 0.08)
    # Frogs, now and then: a croak is a rough buzz, rising
    for start in [1.2, 5.6, 6.1, 10.4, 13.3]:
        m = int(0.32 * SR)
        tt = np.arange(m) / SR
        f = 210 + 90 * tt / 0.32
        buzz = np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * (np.sin(2 * np.pi * 28 * tt) > -0.2)
        croak = band(buzz * np.sin(np.pi * tt / 0.32) ** 0.6, 150, 1600) * 0.22
        at(x, start, croak)
    # The water lapping at the stage
    lap = band(rng.standard_normal(n), 120, 900) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.31 * t) * np.sin(2 * np.pi * 0.13 * t + 1))
    x += lap * 0.12
    # Loop it: the end crossfaded into the start
    fade = int(1.0 * SR)
    k = np.linspace(0, 1, fade)
    x[:fade] = x[:fade] * k + x[-fade:] * (1 - k)
    return x[: n - fade]


write('drum.wav', drum())
write('splash.wav', splash())
write('big-splash.wav', splash(big=True))
write('plop.wav', plop(), peak=0.7)
write('spray.wav', spray())
write('hit.wav', hit())
write('flute.wav', flute(), peak=0.8)
write('night.wav', night(), peak=0.5, trim=False)
