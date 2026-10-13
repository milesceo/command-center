// Startup time, idle memory and initial JS weight on the production build.
//   pnpm build && E2E_PROD=1 node e2e/startup.mjs [runs]
// Numbers are taken in headless Chromium (no Tauri/WebView2), so they are for comparing
// builds against each other, not absolute figures for the installed app.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { startHarness } from './harness.mjs';

const runs = Number(process.argv[2] ?? 5);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const mb = (bytes) => Math.round((bytes / 1048576) * 10) / 10;

const h = await startHarness({ real: false });
const samples = {
  ready: [],
  interactive: [],
  heapMb: [],
  rssMb: [],
  initialJsKb: [],
  initialJsGzipKb: [],
};

/** Resident memory of Chromium's renderer processes (what the app's webview would occupy), from /proc. */
function chromiumRssBytes() {
  let total = 0;
  for (const pid of readdirSync('/proc').filter((p) => /^\d+$/.test(p))) {
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (!/--type=renderer/.test(cmd)) continue;
      const pages = Number(readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1]);
      total += pages * 4096;
    } catch {
      /* process vanished */
    }
  }
  return total;
}

for (let i = 0; i < runs; i++) {
  const t0 = Date.now();
  const app = await h.launch();
  const { page } = app;
  samples.ready.push(Date.now() - t0); // page loaded and the bridge answered a ping
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const paints = Object.fromEntries(
      performance.getEntriesByType('paint').map((p) => [p.name, p.startTime]),
    );
    const js = performance
      .getEntriesByType('resource')
      .filter((r) => r.name.endsWith('.js'))
      .reduce((n, r) => n + (r.encodedBodySize || r.decodedBodySize), 0);
    return { dcl: nav.domContentLoadedEventEnd, fcp: paints['first-contentful-paint'] ?? 0, js };
  });
  await page.waitForSelector('text=What are we building?');
  samples.interactive.push(Math.round(timing.fcp));
  samples.initialJsKb.push(Math.round(timing.js / 1024));
  await page.waitForTimeout(3000); // idle
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = Object.fromEntries(
    (await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]),
  );
  samples.heapMb.push(mb(metrics.JSHeapUsedSize));
  samples.rssMb.push(mb(chromiumRssBytes()));
  await app.close();
}
await h.stop();

const dist = join(import.meta.dirname, '..', 'dist', 'assets');
const files = readdirSync(dist);
const size = (f) => statSync(join(dist, f)).size;
const index = files.find((f) => /^index-.*\.js$/.test(f));
console.log(
  JSON.stringify(
    {
      runs,
      timeToReadyMs: median(samples.ready),
      firstContentfulPaintMs: median(samples.interactive),
      idleJsHeapMb: median(samples.heapMb),
      idleRendererRssMb: median(samples.rssMb),
      initialJsKbCompressed: median(samples.initialJsKb),
      indexChunkKb: index ? Math.round(size(index) / 1024) : null,
      totalDistMb: mb(files.reduce((n, f) => n + size(f), 0)),
      jsChunks: files.filter((f) => f.endsWith('.js')).length,
    },
    null,
    2,
  ),
);
