/**
 * End-to-end: bundles reais (cada um com a SUA cópia do React), servidos por
 * serveModules e carregados por um browser simulado (jsdom) executando scripts.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveModules } from '../../src/server';

const SRC = path.resolve(__dirname, '../../src');
let tmp: string;
let server: http.Server;
let host: string;
let consumerJs: string;

async function bundle(entryCode: string, outfile: string) {
  await build({
    stdin: { contents: entryCode, resolveDir: SRC, loader: 'tsx' },
    bundle: true,
    format: 'iife',
    outfile,
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'silent',
  });
}

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'mf-e2e-'));
  const modulesDir = path.join(tmp, 'dist/modules');
  await mkdir(modulesDir, { recursive: true });

  await bundle(
    `import { Modularize } from './client';
     Modularize('cart', ({ entityId, onActionEvent }: any) => (
       <button data-testid="btn" onClick={() => onActionEvent?.({ action: 'SUBMIT', entityId })}>
         cart:{entityId}
       </button>
     ), { appName: 'shop' });`,
    path.join(modulesDir, 'cart.js'),
  );

  await bundle(
    `import { Modularize } from './client';
     Modularize('broken', () => { throw new Error('provider exploded'); }, { appName: 'shop' });`,
    path.join(modulesDir, 'broken.js'),
  );

  const consumerFile = path.join(tmp, 'consumer.js');
  await bundle(
    `import { createRoot } from 'react-dom/client';
     import { Module } from './client';
     (window as any).mountConsumer = (props: any) =>
       createRoot(document.getElementById('root')!).render(<Module {...props} />);`,
    consumerFile,
  );
  consumerJs = consumerFile;

  const middleware = serveModules({ modulesPath: modulesDir, appName: 'shop', corsOrigins: ['*'] });
  server = http.createServer((req, res) =>
    middleware(req, res, () => {
      res.statusCode = 404;
      res.end();
    }),
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await rm(tmp, { recursive: true, force: true });
});

async function bootConsumer() {
  const { readFile } = await import('node:fs/promises');
  const code = await readFile(consumerJs, 'utf8');
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'http://consumer.local/',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      // jsdom não traz fetch; usamos o do Node (CORS não se aplica fora do browser).
      (window as any).fetch = fetch;
    },
  });
  dom.window.eval(code);
  return dom;
}

async function waitFor<T>(fn: () => T | null | undefined, ms = 4000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error('waitFor: timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('provider → servidor → consumer (bundles reais, Reacts separados)', () => {
  it('carrega o módulo remoto, repassa props e devolve eventos por callback', async () => {
    const dom = await bootConsumer();
    const events: unknown[] = [];

    (dom.window as any).mountConsumer({
      name: 'cart',
      host,
      allowedHosts: [host],
      entityId: '42',
      onActionEvent: (d: unknown) => events.push(d),
    });

    const btn = await waitFor(() => dom.window.document.querySelector<HTMLElement>('[data-testid="btn"]'));
    expect(btn.textContent).toBe('cart:42');

    btn.click();
    expect(events).toEqual([{ action: 'SUBMIT', entityId: '42' }]);

    // O script foi injetado uma vez, com versão por hash.
    const scripts = [...dom.window.document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatch(/\/modules\/cart\.js\?v=[0-9a-f]{10}$/);
    dom.window.close();
  });

  it('falha do módulo não derruba o hospedeiro e chega em onError', async () => {
    const dom = await bootConsumer();
    const errors: Error[] = [];
    const origError = console.error;
    console.error = () => {};

    (dom.window as any).mountConsumer({
      name: 'broken',
      host,
      allowedHosts: [host],
      onError: (e: Error) => errors.push(e),
    });

    await waitFor(() => errors[0]);
    console.error = origError;
    expect(errors[0]!.message).toBe('provider exploded');
    expect(dom.window.document.getElementById('root')).not.toBeNull();
    dom.window.close();
  });

  it('recusa carregar de um host fora da allowlist', async () => {
    const dom = await bootConsumer();
    const errors: Error[] = [];
    (dom.window as any).mountConsumer({ name: 'cart', host, onError: (e: Error) => errors.push(e) });
    await waitFor(() => errors[0]);
    expect(errors[0]!.message).toMatch(/Origem não autorizada/);
    expect(dom.window.document.querySelectorAll('script[src]')).toHaveLength(0);
    dom.window.close();
  });
});
