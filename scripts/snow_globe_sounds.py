"""
The snow globe's sounds, synthesised from scratch: the music box's notes and the shimmer of
glitter and snow swirling in the water when it's shaken. Writes WAVs into assets/fairy-globe/
(the notes into assets/fairy-globe/box/).

A music box note is a steel tooth plucked by a pin: a clamped bar, so its overtones aren't
harmonic (a cantilever's modes, about 1 : 6.27 : 17.5 of the fundamental) and die away much faster
than it does; a bright click as the pin lets go; two teeth tuned a hair apart for each note, so
it shimmers a little; all of it ringing in the little wooden box it sits in.

The shimmer is a swirl of tiny high pings (bits of foil catching each other) over water moving:
filtered noise swelling and sweeping.

    /Applications/Blender.app/Contents/Resources/5.2/python/bin/python3.13 scripts/snow_globe_sounds.py
"""

import os
import wave

import numpy as np

SR = 44100
ROOT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'fairy-globe')
rng = np.random.default_rng(24)

# The tune's pitches (tune.ts), played an octave up: a music box sings high
PITCHES = {
    'C3': 130.81, 'F3': 174.61, 'G3': 196.00,
    'C4': 261.63, 'D4': 293.66, 'E4': 329.63, 'F4': 349.23, 'G4': 392.00, 'A4': 440.00, 'B4': 493.88,
    'C5': 523.25, 'D5': 587.33, 'E5': 659.26, 'F5': 698.46,
}


def convolve(x, ir):
    n = len(x) + len(ir) - 1
    size = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[:n]


def box_ir(seconds=0.9, bright=0.6):
    """The wooden box and the room round it: early knocks, then a short soft tail"""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    tail = rng.standard_normal(n) * np.exp(-t / 0.18) * 0.18
    # Darker as it decays
    k = np.exp(-2 * np.pi * 3500 / SR)
    for i in range(1, n):
        tail[i] = tail[i] * (1 - k) * (1 + bright) + tail[i - 1] * k
    ir = tail
    ir[0] = 1.0
    for d, g in ((0.0031, 0.35), (0.0047, 0.28), (0.0079, 0.2), (0.0113, 0.14)):
        ir[int(d * SR)] += g
    return ir


IR = box_ir()


def tooth(freq, seconds, detune=0.0):
    t = np.arange(int(seconds * SR)) / SR
    f = freq * (1 + detune)
    # The fundamental rings longest; the bar's overtones are bright and brief
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / 1.15)
    x += 0.34 * np.sin(2 * np.pi * f * 2.0 * t + 0.3) * np.exp(-t / 0.42)
    x += 0.22 * np.sin(2 * np.pi * f * 6.27 * t + 1.1) * np.exp(-t / 0.09)
    x += 0.08 * np.sin(2 * np.pi * f * 17.5 * t + 0.4) * np.exp(-t / 0.025)
    return x


def note(freq, seconds=2.6):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    x = tooth(freq, seconds) + 0.7 * tooth(freq, seconds, 0.0018)
    # The pin letting go: a tiny bright click
    click = rng.standard_normal(n) * np.exp(-t / 0.0025) * 0.35
    click = np.diff(click, prepend=0)
    x = x + click
    # A soft start, a clean end
    x *= np.minimum(1, t / 0.0015)
    x *= np.clip((seconds - t) / 0.4, 0, 1)
    wet = convolve(x, IR)[:n]
    return x * 0.75 + wet * 0.35


def shimmer(seconds=2.4):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    # Foil pinging: a hundred tiny high bells, thick at first, thinning out
    for _ in range(140):
        at = rng.random() ** 1.8 * (seconds - 0.6)
        f = 2400 + rng.random() * 5200
        dur = 0.08 + rng.random() * 0.22
        i0 = int(at * SR)
        m = int(dur * SR)
        tt = np.arange(m) / SR
        ping = np.sin(2 * np.pi * f * tt) * np.exp(-tt / (dur * 0.35)) * (0.25 + rng.random() * 0.5)
        out[i0 : i0 + m] += ping[: max(0, min(m, n - i0))]
    # Water swirling: noise through a resonant filter sweeping down
    noise = rng.standard_normal(n)
    sweep = 1800 * np.exp(-t / 0.9) + 300
    y = np.zeros(n)
    y1 = y2 = 0.0
    for i in range(n):
        f = sweep[i]
        r = 0.985
        a1 = -2 * r * np.cos(2 * np.pi * f / SR)
        a2 = r * r
        v = (1 - r) * noise[i] - a1 * y1 - a2 * y2
        y[i] = v
        y2, y1 = y1, v
    swell = np.minimum(1, t / 0.12) * np.exp(-t / 0.8)
    out = out * 0.6 + y * swell * 2.2
    out *= np.clip((seconds - t) / 0.5, 0, 1)
    wet = convolve(out, IR)[:n]
    return out * 0.8 + wet * 0.3


def write(path, x, peak=0.8):
    x = x / np.max(np.abs(x)) * peak
    data = (x * 32767).astype(np.int16)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    print(os.path.relpath(path, ROOT), f'{len(x) / SR:.2f}s')


if __name__ == '__main__':
    for name, f in PITCHES.items():
        bass = name.endswith('3')
        # Bass notes softer, so the tune sits on top
        write(os.path.join(ROOT, 'box', f'{name}.wav'), note(f * 2), peak=0.5 if bass else 0.78)
    write(os.path.join(ROOT, 'shimmer.wav'), shimmer(), peak=0.7)
