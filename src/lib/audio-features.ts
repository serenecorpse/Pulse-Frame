export const BAND_COUNT = 64;

export interface AudioFeatures {
  /** Log-spaced, smoothed spectrum (0–1), low to high frequencies. */
  bands: Float32Array;
  /** Slowly falling maxima of `bands`, for peak caps. */
  peaks: Float32Array;
  bass: number;
  mid: number;
  treble: number;
  level: number;
  /** Envelope that jumps on a detected beat and decays over ~150 ms. */
  beat: number;
  sinceBeat: number;
  beatCount: number;
}

export function silentFeatures(): AudioFeatures {
  return {
    bands: new Float32Array(BAND_COUNT),
    peaks: new Float32Array(BAND_COUNT),
    bass: 0,
    mid: 0,
    treble: 0,
    level: 0,
    beat: 0,
    sinceBeat: Infinity,
    beatCount: 0,
  };
}

function averageRange(
  frequency: Uint8Array,
  sampleRate: number,
  low: number,
  high: number,
): number {
  const binHz = sampleRate / (frequency.length * 2);
  if ((high - low) / binHz < 1 && frequency.length > 2) {
    // Narrower than one FFT bin: interpolate so neighbouring low bands don't render as identical bars.
    const position = (low + high) / 2 / binHz,
      index = Math.max(1, Math.min(frequency.length - 2, Math.floor(position)));
    const t = Math.min(1, Math.max(0, position - index));
    return (frequency[index] * (1 - t) + frequency[index + 1] * t) / 255;
  }
  const from = Math.max(1, Math.floor(low / binHz));
  if (from >= frequency.length) return 0;
  const to = Math.max(
    from + 1,
    Math.min(frequency.length, Math.ceil(high / binHz)),
  );
  let sum = 0;
  for (let i = from; i < to; i++) sum += frequency[i];
  return sum / (to - from) / 255;
}

export function logBands(
  frequency: Uint8Array,
  sampleRate: number,
  count = BAND_COUNT,
  min = 32,
  max = 16000,
): Float32Array {
  const bands = new Float32Array(count),
    top = Math.min(max, sampleRate / 2);
  for (let i = 0; i < count; i++) {
    const low = min * (top / min) ** (i / count),
      high = min * (top / min) ** ((i + 1) / count);
    // Higher frequencies carry less energy; a gentle tilt keeps the right side of an equalizer alive.
    bands[i] = Math.min(
      1,
      averageRange(frequency, sampleRate, low, high) * (1 + (0.5 * i) / count),
    );
  }
  return bands;
}

export class BeatTracker {
  private features = silentFeatures();
  private history: { time: number; value: number }[] = [];
  private clock = 0;
  private lastBeat = -Infinity;
  private previousBass = 0;
  private strength = 0;

  reset(): void {
    this.features = silentFeatures();
    this.history = [];
    this.clock = 0;
    this.lastBeat = -Infinity;
    this.previousBass = 0;
    this.strength = 0;
  }

  /** `elapsed` is real seconds since the previous update, so envelopes decay even while paused. */
  update(
    frequency: Uint8Array | undefined,
    sampleRate: number,
    elapsed: number,
  ): AudioFeatures {
    const dt =
      Number.isFinite(elapsed) && elapsed > 0 ? Math.min(elapsed, 0.1) : 1 / 60;
    this.clock += dt;
    const f = this.features,
      hasAudio = !!frequency?.length;
    const raw = hasAudio
      ? logBands(frequency!, sampleRate)
      : new Float32Array(BAND_COUNT);
    const attack = 1 - Math.exp(-dt / 0.025),
      release = 1 - Math.exp(-dt / 0.16);
    const follow = (previous: number, next: number) =>
      previous + (next - previous) * (next > previous ? attack : release);
    let total = 0;
    for (let i = 0; i < BAND_COUNT; i++) {
      f.bands[i] = follow(f.bands[i], raw[i]);
      f.peaks[i] = Math.max(f.bands[i], f.peaks[i] - dt * 0.45);
      total += raw[i];
    }
    const bass = hasAudio ? averageRange(frequency!, sampleRate, 35, 150) : 0;
    f.bass = follow(f.bass, bass);
    f.mid = follow(
      f.mid,
      hasAudio ? averageRange(frequency!, sampleRate, 150, 2000) : 0,
    );
    f.treble = follow(
      f.treble,
      hasAudio ? averageRange(frequency!, sampleRate, 2000, 12000) : 0,
    );
    f.level = follow(f.level, total / BAND_COUNT);

    this.history.push({ time: this.clock, value: bass });
    while (this.history.length && this.clock - this.history[0].time > 1.5)
      this.history.shift();
    const mean =
      this.history.reduce((sum, item) => sum + item.value, 0) /
      this.history.length;
    const deviation = Math.sqrt(
      this.history.reduce((sum, item) => sum + (item.value - mean) ** 2, 0) /
        this.history.length,
    );
    const threshold = mean + Math.max(0.045, 1.35 * deviation);
    if (
      bass > 0.18 &&
      bass > this.previousBass &&
      bass > threshold &&
      this.clock - this.lastBeat > 0.2
    ) {
      this.lastBeat = this.clock;
      this.strength = Math.min(1, Math.max(0.45, (bass - mean) / 0.2));
      f.beatCount++;
    }
    this.previousBass = bass;
    f.sinceBeat = this.clock - this.lastBeat;
    f.beat = Number.isFinite(f.sinceBeat)
      ? this.strength * Math.exp(-f.sinceBeat / 0.15)
      : 0;
    return f;
  }
}
