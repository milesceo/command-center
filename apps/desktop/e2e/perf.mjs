// Streaming smoothness check: ~6 KB of markdown arrives at ~500 tokens/s while we
// sample frame times and long tasks. Run with: E2E_PROD=1 node e2e/perf.mjs (after `pnpm build`)
import assert from 'node:assert/strict';
import { startHarness } from './harness.mjs';

const h = await startHarness({ real: false });
const app = await h.launch();
const { page } = app;
// E2E_THROTTLE=3 emulates a CPU 3x slower (informational: the stress rate is ~5x a real stream).
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.E2E_THROTTLE ?? 1) });
await page.evaluate(() => {
  window.__frames = [];
  window.__long = [];
  new PerformanceObserver((list) =>
    list.getEntries().forEach((e) => window.__long.push(e.duration)),
  ).observe({ entryTypes: ['longtask'] });
  let last = performance.now();
  const tick = (now) => {
    window.__frames.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.fill('textarea[aria-label="Message"]', 'stress test');
await page.press('textarea[aria-label="Message"]', 'Enter');
await page.waitForSelector('[data-role="assistant"]:not([data-streaming])', { timeout: 60000 });
const stats = await page.evaluate(() => {
  const f = window.__frames.slice(5).sort((a, b) => a - b);
  const pct = (p) => f[Math.min(f.length - 1, Math.floor(f.length * p))];
  return {
    frames: f.length,
    p50: pct(0.5),
    p95: pct(0.95),
    p99: pct(0.99),
    max: f[f.length - 1],
    longTasks: window.__long.length,
    longMax: Math.max(0, ...window.__long),
  };
});
const chars = await page.evaluate(
  () => document.querySelector('[data-role="assistant"]').textContent.length,
);
console.log({ ...stats, renderedChars: chars });
assert.ok(chars > 3000, 'whole reply rendered');
assert.ok(stats.p95 <= 70, `p95 frame time ${stats.p95}ms`);
assert.ok(stats.longMax < 150, `longest task ${stats.longMax}ms`);
await app.close();
await h.stop();
