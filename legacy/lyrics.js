(() => {
  "use strict";

  function parseTimestamp(value) {
    const parts = value.split(":");
    if (parts.length !== 3) return NaN;
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    const seconds = Number(parts[2]);
    if (minutes > 59 || seconds >= 60) return NaN;
    return hours * 3600 + minutes * 60 + seconds;
  }

  function parseSbv(text) {
    const lines = text.split(/\r?\n/);
    const cues = [];
    const timestamp = /^\s*(\d{1,2}:\d{2}:\d{2}(?:\.\d{1,3})?),\s*(\d{1,2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s*$/;
    for (let index = 0; index < lines.length;) {
      const match = lines[index].match(timestamp);
      if (!match) { index++; continue; }
      const start = parseTimestamp(match[1]);
      const end = parseTimestamp(match[2]);
      index++;
      const caption = [];
      while (index < lines.length && lines[index].trim()) caption.push(lines[index++]);
      const value = caption.join("\n").trim();
      if (value && Number.isFinite(start) && Number.isFinite(end) && end > start) {
        cues.push({ time: start, endTime: end, text: value });
      }
    }
    return cues.sort((a, b) => a.time - b.time);
  }

  function parseLyrics(text) {
    const sbv = parseSbv(text);
    if (sbv.length || text.split(/\r?\n/).some(line =>
      /^\s*\d{1,2}:\d{2}:\d{2}(?:\.\d{1,3})?,\s*\d{1,2}:\d{2}:\d{2}(?:\.\d{1,3})?\s*$/.test(line)
    )) return sbv;
    return text.split(/\r?\n/).flatMap(line => {
      const matches = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
      const words = line.replace(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g, "").trim();
      if (matches.length) return matches.map(match => ({
        time: Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] || 0}`),
        endTime: null,
        text: words
      }));
      if (words) return [{ time: null, endTime: null, text: words }];
      return [];
    }).sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
  }

  function activeCueAtTime(cues, time) {
    const synced = cues.filter(cue => cue.time !== null);
    if (synced.length) {
      let active = null;
      for (const cue of synced) {
        if (cue.time <= time && (cue.endTime === null || time < cue.endTime)) active = cue;
      }
      return active;
    }
    return cues.length ? cues[Math.floor(time / 3.5) % cues.length] : null;
  }

  window.PulseframeLyrics = Object.freeze({ parseLyrics, activeCueAtTime });
})();
