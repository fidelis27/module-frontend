import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../src");
const CHROMIUM =
  process.env.CHROMIUM_PATH ??
  (existsSync("/opt/pw-browsers/chromium")
    ? "/opt/pw-browsers/chromium"
    : chromium.executablePath());
const run = existsSync(CHROMIUM) ? describe : describe.skip;

let tmp: string;
let browser: Browser;
let page: Page;

interface BusTestWindow extends Window {
  publishFromFirstCopy?: (value: string) => void;
  subscribeFromSecondCopy?: () => void;
  received?: Array<{
    value: string;
    source?: string;
    replayed: boolean;
  }>;
}

async function bundle(code: string, outfile: string) {
  await build({
    stdin: { contents: code, resolveDir: SRC, loader: "ts" },
    bundle: true,
    format: "iife",
    outfile,
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
}

run("event bus em bundles isolados", () => {
  beforeAll(async () => {
    if (!existsSync(CHROMIUM)) return;
    tmp = await mkdtemp(path.join(os.tmpdir(), "mf-bus-browser-"));
    const first = path.join(tmp, "first.js");
    const second = path.join(tmp, "second.js");
    await bundle(
      `import { createBus } from './bus';
       type Events = { 'news:published': { value: string } };
       const bus = createBus<Events>({ source: 'provider' });
       bus.publish('news:published', { value: 'before subscribe' }, { ttl: 30000 });
       (window as Window & { publishFromFirstCopy: (value: string) => void }).publishFromFirstCopy = (value: string) =>
         bus.publish('news:published', { value });`,
      first,
    );
    await bundle(
      `import { createBus } from './bus';
       type Events = { 'news:published': { value: string } };
       const bus = createBus<Events>({ source: 'consumer' });
       (window as Window & {
         received: Array<{ value: string; source?: string; replayed: boolean }>;
         subscribeFromSecondCopy: () => void;
       }).subscribeFromSecondCopy = () => {
         const target = window as Window & {
           received: Array<{ value: string; source?: string; replayed: boolean }>;
         };
         target.received = [];
         bus.subscribe('news:published', (payload, meta) =>
           target.received.push({ ...payload, ...meta }), { replay: true });
       };`,
      second,
    );
    browser = await chromium.launch({
      executablePath: CHROMIUM,
      args: ["--no-sandbox"],
    });
    page = await browser.newPage();
    await page.goto("about:blank");
    await page.addScriptTag({ path: first });
    await page.addScriptTag({ path: second });
  }, 60000);

  afterAll(async () => {
    await browser?.close();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it("shares retained and live events between separate IIFE copies", async () => {
    await page.evaluate(() =>
      (window as BusTestWindow).subscribeFromSecondCopy?.(),
    );
    const replay = await page.evaluate(
      () => (window as BusTestWindow).received,
    );
    expect(replay).toEqual([
      expect.objectContaining({
        value: "before subscribe",
        source: "provider",
        replayed: true,
      }),
    ]);

    await page.evaluate(() =>
      (window as BusTestWindow).publishFromFirstCopy?.("after subscribe"),
    );
    const events = await page.evaluate(
      () => (window as BusTestWindow).received,
    );
    expect(events).toHaveLength(2);
    expect(events?.[1]).toMatchObject({
      value: "after subscribe",
      source: "provider",
      replayed: false,
    });
  });
});
