import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveModules } from "../../src/server";
import { CONTRACT_VERSION } from "../../src/shared";

let dir: string;
let server: http.Server;
let base: string;

function rawAt(
  targetBase: string,
  pathname: string,
  headers: http.OutgoingHttpHeaders = {},
  method = "GET",
) {
  return new Promise<{
    status: number;
    body: string;
    headers: http.IncomingHttpHeaders;
  }>((resolve, reject) => {
    const url = new URL(targetBase);
    const req = http.request(
      { host: url.hostname, port: url.port, path: pathname, method, headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode!, body, headers: res.headers }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function raw(
  pathname: string,
  headers: http.OutgoingHttpHeaders = {},
  method = "GET",
) {
  return rawAt(base, pathname, headers, method);
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "mf-"));
  await writeFile(path.join(dir, "cart.js"), "window.cart = 1;");
  await writeFile(path.join(dir, "cart.js.map"), "{}");
  await writeFile(path.join(dir, "notes.txt"), "não deve ser servido");
  await writeFile(path.join(path.dirname(dir), "mf-secret.js"), "segredo");

  const middleware = serveModules({
    modulesPath: dir,
    appName: "shop",
    corsOrigins: ["https://app.example.com"],
  });
  server = http.createServer((req, res) =>
    middleware(req, res, () => {
      res.statusCode = 418;
      res.end("next");
    }),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
  await rm(path.join(path.dirname(dir), "mf-secret.js"), { force: true });
});

describe("serveModules", () => {
  it("publica o manifesto com appName, versão e scripts versionados por hash", async () => {
    const res = await raw("/modules/__modules_configuration");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");

    const manifest = JSON.parse(res.body);
    expect(manifest.contractVersion).toBe(CONTRACT_VERSION);
    expect(manifest.appName).toBe("shop");
    expect(manifest.version).toMatch(/^[0-9a-f]{10}$/);
    expect(Object.keys(manifest.modules)).toEqual(["cart"]);
    expect(manifest.modules.cart.scripts[0]).toMatch(
      /^\/modules\/cart\.js\?v=[0-9a-f]{10}$/,
    );
    expect(manifest.modules.cart.integrity).toEqual([
      `sha384-${createHash("sha384").update("window.cart = 1;").digest("base64")}`,
    ]);
  });

  it("serve o bundle com cache imutável quando tem ?v= e revalida quando não tem", async () => {
    const manifest = JSON.parse(
      (await raw("/modules/__modules_configuration")).body,
    );
    const versioned = await raw(manifest.modules.cart.scripts[0]);
    expect(versioned.status).toBe(200);
    expect(versioned.body).toBe("window.cart = 1;");
    expect(versioned.headers["content-type"]).toMatch(/javascript/);
    expect(versioned.headers["x-content-type-options"]).toBe("nosniff");
    expect(versioned.headers["cache-control"]).toMatch(/immutable/);

    const plain = await raw("/modules/cart.js");
    expect(plain.headers["cache-control"]).toBe("no-cache");
  });

  it("muda a versão do manifesto quando o conteúdo do bundle muda", async () => {
    const before = JSON.parse(
      (await raw("/modules/__modules_configuration")).body,
    );
    await writeFile(path.join(dir, "cart.js"), "window.cart = 2; // novo");
    const future = new Date(Date.now() + 5000);
    await utimes(path.join(dir, "cart.js"), future, future);
    const after = JSON.parse(
      (await raw("/modules/__modules_configuration")).body,
    );
    expect(after.version).not.toBe(before.version);
    expect(after.modules.cart.scripts[0]).not.toBe(
      before.modules.cart.scripts[0],
    );
  });

  it("filtra módulos por nome e faz exclude prevalecer sobre include", async () => {
    const excludedModule = path.join(dir, "admin.js");
    const notIncludedModule = path.join(dir, "hidden.js");
    await writeFile(excludedModule, "window.admin = true;");
    await writeFile(notIncludedModule, "window.hidden = true;");
    const middleware = serveModules({
      modulesPath: dir,
      appName: "shop",
      include: ["cart", "admin"],
      exclude: ["admin"],
    });
    const filteredServer = http.createServer((req, res) =>
      middleware(req, res, () => {
        res.statusCode = 418;
        res.end("next");
      }),
    );
    await new Promise<void>((resolve) =>
      filteredServer.listen(0, "127.0.0.1", resolve),
    );
    const filteredBase = `http://127.0.0.1:${(filteredServer.address() as AddressInfo).port}`;

    try {
      const manifest = JSON.parse(
        (await rawAt(filteredBase, "/modules/__modules_configuration")).body,
      );
      expect(Object.keys(manifest.modules)).toEqual(["cart"]);
      expect((await rawAt(filteredBase, "/modules/admin.js")).status).toBe(418);
      expect((await rawAt(filteredBase, "/modules/hidden.js")).status).toBe(
        418,
      );
      expect((await rawAt(filteredBase, "/modules/cart.js")).status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) =>
        filteredServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("bloqueia path traversal (codificado e literal)", async () => {
    for (const p of [
      "/modules/..%2Fmf-secret.js",
      "/modules/%2e%2e/mf-secret.js",
      "/modules/..%2f..%2fetc%2fpasswd",
    ]) {
      const res = await raw(p);
      expect(res.status, p).toBe(418); // cai no next(), nunca serve o arquivo
      expect(res.body).not.toContain("segredo");
    }
  });

  it("só serve .js e .js.map", async () => {
    expect((await raw("/modules/notes.txt")).status).toBe(418);
    expect((await raw("/modules/cart.js.map")).status).toBe(200);
  });

  it("delega rotas desconhecidas e métodos não suportados ao next()", async () => {
    expect((await raw("/outra-rota")).status).toBe(418);
    expect((await raw("/modules/cart.js", {}, "POST")).status).toBe(418);
    expect((await raw("/modules/nao-existe.js")).status).toBe(418);
  });

  it("aplica CORS só para origens permitidas", async () => {
    const ok = await raw("/modules/__modules_configuration", {
      origin: "https://app.example.com",
    });
    expect(ok.headers["access-control-allow-origin"]).toBe(
      "https://app.example.com",
    );
    expect(ok.headers.vary).toMatch(/Origin/);

    const bad = await raw("/modules/__modules_configuration", {
      origin: "https://evil.com",
    });
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();

    const pre = await raw(
      "/modules/__modules_configuration",
      { origin: "https://app.example.com" },
      "OPTIONS",
    );
    expect(pre.status).toBe(204);
  });
});
