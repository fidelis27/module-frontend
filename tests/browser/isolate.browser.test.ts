/**
 * Prova em browser real (Chromium) de que `isolate` isola CSS nos dois sentidos
 * e corta a herança de estilos do host. jsdom não implementa a cascata, então
 * estes testes só fazem sentido num browser de verdade.
 *
 * Rodar: npm run test:browser   (usa CHROMIUM_PATH ou /opt/pw-browsers/chromium)
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveModules } from "../../src/server";
import { CONTRACT_VERSION } from "../../src/shared";

const SRC = path.resolve(__dirname, "../../src");
const CHROMIUM =
  process.env.CHROMIUM_PATH ??
  (existsSync("/opt/pw-browsers/chromium")
    ? "/opt/pw-browsers/chromium"
    : chromium.executablePath());
const run = existsSync(CHROMIUM) ? describe : describe.skip;

let tmp: string;
let server: http.Server;
let origin: string;
let browser: Browser;
let consumerJs: string;

const bundle = (code: string, outfile: string) =>
  build({
    stdin: { contents: code, resolveDir: SRC, loader: "tsx" },
    bundle: true,
    format: "iife",
    outfile,
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: Georgia, serif; color: rgb(0, 0, 255); }
  p { color: rgb(255, 0, 0); font-size: 40px; margin: 0; }
  .badge { background: rgb(255, 0, 0); }
</style></head>
<body>
  <h1 id="host-h1">host title</h1>
  <div id="plain"></div>
  <div id="isolated"></div>
  <div id="integrity"></div>
  <script src="/consumer.js"></script>
</body></html>`;

beforeAll(async () => {
  if (!existsSync(CHROMIUM)) return;
  tmp = await mkdtemp(path.join(os.tmpdir(), "mf-browser-"));
  const modulesDir = path.join(tmp, "modules");
  await mkdir(modulesDir, { recursive: true });

  // Módulo com CSS próprio (declarado em `styles`) e um elemento por regra de interesse.
  await bundle(
    `import { Modularize } from './client';
     Modularize('widget', () => (
       <div>
         <p id="m-p">module text</p>
         <h1 id="m-h1">module title</h1>
         <span className="badge" id="m-badge">badge</span>
       </div>
     ), {
       appName: 'shop',
       styles: 'h1 { color: rgb(0, 128, 0); } .badge { background: rgb(0, 128, 0); }',
     });`,
    path.join(modulesDir, "widget.js"),
  );

  consumerJs = path.join(tmp, "consumer.js");
  await bundle(
    `import { createRoot } from 'react-dom/client';
     import { Module } from './client';
     const common = { name: 'widget', host: location.origin, allowedHosts: [location.origin] };
     createRoot(document.getElementById('plain')!).render(<Module {...common} />);
     createRoot(document.getElementById('isolated')!).render(<Module {...common} isolate />);
     createRoot(document.getElementById('integrity')!).render(
       <Module
         name="widget"
         host={location.origin}
         path="/bad-manifest"
         allowedHosts={[location.origin]}
         requireIntegrity
         fallback={<span id="integrity-failed">blocked</span>}
       />,
     );`,
    consumerJs,
  );

  const modules = serveModules({ modulesPath: modulesDir, appName: "shop" });
  server = http.createServer(async (req, res) => {
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return void res.end(PAGE);
    }
    if (req.url === "/consumer.js") {
      res.setHeader("Content-Type", "application/javascript");
      return void res.end(await readFile(consumerJs));
    }
    if (req.url === "/bad-manifest") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return void res.end(
        JSON.stringify({
          contractVersion: CONTRACT_VERSION,
          appName: "shop",
          version: "tampered",
          modules: {
            widget: {
              name: "widget",
              scripts: ["/modules/widget.js"],
              integrity: [`sha384-${"A".repeat(64)}`],
            },
          },
        }),
      );
    }
    return modules(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ["--no-sandbox"],
  });
}, 60000);

afterAll(async () => {
  await browser?.close();
  server?.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

/** Valor computado de uma propriedade, dentro ou fora do shadow root. */
async function computed(
  page: Page,
  where: "plain" | "isolated",
  sel: string,
  prop: string,
) {
  return page.evaluate(
    ([where, sel, prop]) => {
      const host = document.getElementById(where)!;
      const root =
        (host.querySelector("[data-module] > div") as HTMLElement).shadowRoot ??
        host;
      const el = root.querySelector(sel as string) as HTMLElement;
      return getComputedStyle(el).getPropertyValue(prop as string);
    },
    [where, sel, prop] as const,
  );
}

run("isolate em Chromium real", () => {
  let page: Page;

  beforeAll(async () => {
    page = await browser.newPage();
    await page.goto(origin);
    await page.waitForFunction(
      () =>
        document.querySelector("#plain #m-p") &&
        (
          document.querySelector(
            "#isolated [data-module] > div",
          ) as HTMLElement | null
        )?.shadowRoot?.querySelector("#m-p"),
      undefined,
      { timeout: 15000 },
    );
  }, 30000);

  it("o módulo isolado fica dentro de um shadow root; o outro, no DOM normal", async () => {
    expect(
      await page.evaluate(() => !!document.querySelector("#isolated #m-p")),
    ).toBe(false);
    expect(
      await page.evaluate(() => !!document.querySelector("#plain #m-p")),
    ).toBe(true);
  });

  it("CSS do host NÃO entra no módulo isolado (mas entra no não isolado)", async () => {
    // O host define `p { color: red; font-size: 40px }`.
    expect(await computed(page, "plain", "#m-p", "font-size")).toBe("40px");
    expect(await computed(page, "plain", "#m-p", "color")).toBe(
      "rgb(255, 0, 0)",
    );

    expect(await computed(page, "isolated", "#m-p", "font-size")).toBe("16px");
    expect(await computed(page, "isolated", "#m-p", "color")).not.toBe(
      "rgb(255, 0, 0)",
    );
  });

  it("a herança do host (fonte e cor do body) é cortada no módulo isolado", async () => {
    // body { font-family: Georgia, serif; color: blue }
    expect(await computed(page, "plain", "#m-h1", "font-family")).toMatch(
      /Georgia/,
    );
    expect(
      await computed(page, "isolated", "#m-h1", "font-family"),
    ).not.toMatch(/Georgia/);
    expect(await computed(page, "isolated", "#m-badge", "color")).not.toBe(
      "rgb(0, 0, 255)",
    );
  });

  it("o CSS declarado em `styles` vale dentro do módulo isolado", async () => {
    expect(await computed(page, "isolated", "#m-h1", "color")).toBe(
      "rgb(0, 128, 0)",
    );
    expect(
      await computed(page, "isolated", "#m-badge", "background-color"),
    ).toBe("rgb(0, 128, 0)");
  });

  it("o CSS do módulo NÃO vaza para o host", async () => {
    const hostH1 = await page.evaluate(
      () => getComputedStyle(document.getElementById("host-h1")!).color,
    );
    expect(hostH1).not.toBe("rgb(0, 128, 0)");
    expect(
      await page.evaluate(() => document.head.querySelectorAll("style").length),
    ).toBe(1);
  });

  it("eventos e render do React funcionam dentro do shadow root", async () => {
    const text = await page.evaluate(
      () =>
        (
          (
            document.querySelector(
              "#isolated [data-module] > div",
            ) as HTMLElement
          ).shadowRoot!.querySelector("#m-p") as HTMLElement
        ).textContent,
    );
    expect(text).toBe("module text");
  });

  it("o browser bloqueia scripts cujo conteúdo não confere com o hash SRI", async () => {
    await page.waitForSelector("#integrity-failed");
    expect(await page.locator("#integrity-failed").textContent()).toBe(
      "blocked",
    );
  });
});
