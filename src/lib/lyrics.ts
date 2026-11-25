export interface LyricCue {
  time: number | null;
  endTime: number | null;
  text: string;
}

const sbvTimestamp =
  /^\s*(\d{1,2}:\d{2}:\d{2}(?:\.\d{1,3})?),\s*(\d{1,2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s*$/;

function timestamp(value: string): number {
  const [hours, minutes, seconds] = value.split(":").map(Number);
  return minutes > 59 || seconds >= 60
    ? NaN
    : hours * 3600 + minutes * 60 + seconds;
}

export function parseLyrics(text: string): LyricCue[] {
  const lines = text.split(/\r?\n/);
  if (lines.some((line) => sbvTimestamp.test(line))) {
    const cues: LyricCue[] = [];
    for (let index = 0; index < lines.length;) {
      const match = lines[index].match(sbvTimestamp);
      if (!match) {
        index++;
        continue;
      }
      const start = timestamp(match[1]);
      const end = timestamp(match[2]);
      index++;
      const caption: string[] = [];
      while (index < lines.length && lines[index].trim())
        caption.push(lines[index++]);
      const value = caption.join("\n").trim();
      if (
        value &&
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end > start
      ) {
        cues.push({ time: start, endTime: end, text: value });
      }
    }
    return cues.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  }
  return lines
    .flatMap<LyricCue>((line) => {
      const matches = [
        ...line.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g),
      ];
      const words = line
        .replace(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g, "")
        .trim();
      if (matches.length)
        return matches.map((match) => ({
          time:
            Number(match[1]) * 60 +
            Number(match[2]) +
            Number(`0.${match[3] || 0}`),
          endTime: null,
          text: words,
        }));
      return words ? [{ time: null, endTime: null, text: words }] : [];
    })
    .sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
}

export function activeCueAtTime(
  cues: LyricCue[],
  time: number,
): LyricCue | null {
  const synced = cues.filter((cue) => cue.time !== null);
  if (synced.length) {
    let active: LyricCue | null = null;
    for (const cue of synced) {
      if (
        cue.time !== null &&
        cue.time <= time &&
        (cue.endTime === null || time < cue.endTime)
      )
        active = cue;
    }
    return active;
  }
  return cues.length
    ? cues[Math.floor(Math.max(0, time) / 3.5) % cues.length]
    : null;
}
