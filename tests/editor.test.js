(async () => {
  const results = document.querySelector("#results");
  let passed = 0, failed = 0;
  async function test(name, fn) {
    try {
      await fn();
      passed++;
      results.insertAdjacentHTML("beforeend", `<li class="pass">PASS ${name}</li>`);
    } catch (error) {
      failed++;
      const item = document.createElement("li");
      item.className = "fail";
      item.textContent = `FAIL ${name}: ${error.message}`;
      results.append(item);
    }
  }
  async function waitFor(predicate) {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error("Timed out waiting for the editor.");
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  function chooseFile(win, selector, file) {
    const files = new win.DataTransfer();
    files.items.add(file);
    const input = win.document.querySelector(selector);
    input.files = files.files;
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
  }

  try {
    const response = await fetch("../index.html");
    if (!response.ok) throw new Error(`Could not load editor: ${response.status}`);
    const html = (await response.text()).replace(
      /(href|src)="(styles\.css|sidebar-layout\.css|motion\.js|upscaler\.js|lyrics\.js|app\.js)"/g,
      (_, attribute, path) => `${attribute}="${new URL(`../${path}`, location.href).href}"`
    );
    const iframe = document.createElement("iframe");
    iframe.srcdoc = html.replace("<head>", `<head><base href="../"><script>
      const testStore = new Map();
      Object.defineProperty(window, "localStorage", { value: {
        getItem: key => testStore.get(key) || null,
        setItem: (key, value) => {
          if (window.failTestStorage) throw new Error("Storage unavailable");
          testStore.set(key, value);
        }
      } });
    <\/script>`);
    document.body.append(iframe);
    await new Promise((resolve, reject) => {
      iframe.onload = resolve;
      iframe.onerror = reject;
    });
    const win = iframe.contentWindow;
    const doc = win.document;

    await test("failed media imports remain retryable and restore their original clips", async () => {
      const project = {
        duration: 30,
        assets: [{ id: "original-asset", name: "test.png", type: "image" }],
        clips: [{ id: "original-clip", assetId: "original-asset", name: "test.png", lane: "image", start: 0, duration: 10, x: 640, y: 360, scale: 100, rotation: 0, opacity: 100, visible: true, animation: "none" }]
      };
      chooseFile(win, "#projectInput", new win.File([JSON.stringify(project)], "project.json", { type: "application/json" }));
      await waitFor(() => doc.querySelector("#toastRegion").textContent.includes("Project configuration opened."));
      chooseFile(win, "#fileInput", new win.File(["invalid"], "test.png", { type: "image/png" }));
      await waitFor(() => doc.querySelector("#toastRegion").textContent.includes("Couldn't load test.png."));
      if (doc.querySelector("#assetCount").textContent !== "0 assets in this project") throw new Error("Invalid image was added to the asset list.");
      const canvas = doc.createElement("canvas");
      canvas.width = canvas.height = 2;
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      chooseFile(win, "#fileInput", new win.File([blob], "test.png", { type: "image/png" }));
      await waitFor(() => doc.querySelector("#assetCount").textContent === "1 asset in this project");
      await waitFor(() => {
        const saved = JSON.parse(win.localStorage.getItem("pulseframe-project") || "null");
        return saved && saved.assets.length === 1;
      });
      const saved = JSON.parse(win.localStorage.getItem("pulseframe-project"));
      if (saved.assets[0].id !== "original-asset" || saved.clips.length !== 1 || saved.clips[0].id !== "original-clip") {
        throw new Error("Retry did not reconnect the original clip.");
      }
    });

    await test("autosave errors do not display a successful save", async () => {
      win.failTestStorage = true;
      const name = doc.querySelector("#projectName");
      name.value = "Changed project";
      name.dispatchEvent(new win.Event("input", { bubbles: true }));
      await waitFor(() => doc.querySelector("#saveState").textContent === "Autosave failed");
      if (!doc.querySelector("#toastRegion").textContent.includes("couldn't be autosaved")) throw new Error("Autosave error was not reported.");
    });
  } catch (error) {
    failed++;
    const item = document.createElement("li");
    item.className = "fail";
    item.textContent = `FAIL Test setup: ${error.message}`;
    results.append(item);
  }
  document.querySelector("#summary").textContent = `${passed} passed · ${failed} failed`;
  document.title = `${failed ? "FAIL" : "PASS"} — Pulseframe editor tests`;
})();
