(() => {
  const { parseLyrics, activeCueAtTime } = window.PulseframeLyrics;
  const results = document.querySelector("#results");
  let passed = 0,
    failed = 0;
  function test(name, fn) {
    try {
      fn();
      passed++;
      results.insertAdjacentHTML(
        "beforeend",
        `<li class="pass">PASS ${name}</li>`,
      );
    } catch (error) {
      failed++;
      results.insertAdjacentHTML(
        "beforeend",
        `<li class="fail">FAIL ${name}: ${error.message}</li>`,
      );
    }
  }
  function equal(actual, expected) {
    if (actual !== expected)
      throw new Error(`expected ${actual} to equal ${expected}`);
  }

  test("YouTube SBV timestamps parse start, end, and caption text", () => {
    const [cue] = parseLyrics("0:00:02.500,0:00:04.000\nHello world\n");
    equal(cue.time, 2.5);
    equal(cue.endTime, 4);
    equal(cue.text, "Hello world");
  });

  test("SBV preserves multiline captions and orders cues by start time", () => {
    const cues = parseLyrics(
      "0:00:05.000,0:00:06.000\nLater\n\n0:00:01.250,0:00:03.500\nFirst\nSecond",
    );
    equal(cues.length, 2);
    equal(cues[0].time, 1.25);
    equal(cues[0].text, "First\nSecond");
  });

  test("invalid or empty SBV cues are ignored", () => {
    const cues = parseLyrics(
      "0:00:03.000,0:00:02.000\nBackwards\n\n0:99:04.000,0:00:05.000\nInvalid minutes\n\n0:00:04.000,0:00:05.000\n",
    );
    equal(cues.length, 0);
  });

  test("LRC and plain-text lyric behavior remains supported", () => {
    const lrc = parseLyrics("[00:12.50]First line\n[01:02.125]Second line");
    equal(lrc[0].time, 12.5);
    equal(lrc[1].time, 62.125);
    equal(lrc[0].endTime, null);
    const plain = parseLyrics("Un-timed line");
    equal(plain[0].time, null);
    equal(plain[0].text, "Un-timed line");
  });

  test("SBV captions activate only within their start and end window", () => {
    const cues = parseLyrics(
      "0:00:02.000,0:00:04.000\nFirst\n\n0:00:05.000,0:00:06.000\nSecond",
    );
    equal(activeCueAtTime(cues, 1), null);
    equal(activeCueAtTime(cues, 2).text, "First");
    equal(activeCueAtTime(cues, 4), null);
    equal(activeCueAtTime(cues, 5).text, "Second");
  });

  test("LRC lines persist until the next timestamp and plain lyrics advance", () => {
    const lrc = parseLyrics("[00:02.00]First\n[00:05.00]Second");
    equal(activeCueAtTime(lrc, 4).text, "First");
    equal(activeCueAtTime(lrc, 5).text, "Second");
    const plain = parseLyrics("First\nSecond");
    equal(activeCueAtTime(plain, 4).text, "Second");
  });

  document.querySelector("#summary").textContent =
    `${passed} passed · ${failed} failed`;
  document.title = `${failed ? "FAIL" : "PASS"} — Pulseframe lyrics tests`;
})();
