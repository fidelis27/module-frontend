import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadModule, Modularize, resetModuleCaches } from "../../src/client";
import { CONTRACT_VERSION, getRegistryKey } from "../../src/shared";

const HOST = "https://provider.example.com";

function manifest(version: string) {
  return {
    contractVersion: CONTRACT_VERSION,
    appName: "shop",
    version,
    modules: {
      cart: { name: "cart", scripts: [`/modules/cart.js?v=${version}`] },
    },
  };
}

function fetchResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => value,
  } as Response;
}

function stubScript() {
  const loaded: string[] = [];
  vi.spyOn(document.head, "appendChild").mockImplementation(((node: Node) => {
    const script = node as HTMLScriptElement;
    if (script.tagName === "SCRIPT") {
      loaded.push(script.src);
      queueMicrotask(() => {
        Modularize("cart", () => null, { appName: "shop" });
        script.onload?.(new Event("load"));
      });
    }
    return node;
  }) as typeof document.head.appendChild);
  return loaded;
}

beforeEach(() => resetModuleCaches());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  const registry = window as unknown as Record<string, unknown>;
  delete registry[getRegistryKey("shop", "cart")];
  vi.useRealTimers();
});

describe("loadModule manifest revalidation", () => {
  it("reuses a manifest until its TTL expires, then fetches again", async () => {
    let now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetchImpl = vi.fn(async () => fetchResponse(manifest("v1")));
    stubScript();
    const onUpdateAvailable = vi.fn();
    const options = {
      host: HOST,
      name: "cart",
      allowedHosts: [HOST],
      manifestTtlMs: 1_000,
      fetchImpl,
      onUpdateAvailable,
    };

    await loadModule(options);
    await loadModule(options);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 1_001;
    await loadModule(options);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onUpdateAvailable).not.toHaveBeenCalled();
  });

  it("notifies once on a new version and keeps the first registered entry", async () => {
    let currentManifest = manifest("v1");
    const fetchImpl = vi.fn(async () => fetchResponse(currentManifest));
    const loaded = stubScript();
    const options = {
      host: HOST,
      name: "cart",
      allowedHosts: [HOST],
      manifestTtlMs: 0,
      fetchImpl,
    };
    const firstEntry = await loadModule(options);

    currentManifest = manifest("v2");
    const onUpdateAvailable = vi.fn();
    const updatedEntry = await loadModule({ ...options, onUpdateAvailable });
    await loadModule({ ...options, onUpdateAvailable });

    expect(updatedEntry).toBe(firstEntry);
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
    expect(onUpdateAvailable).toHaveBeenCalledWith({
      previous: "v1",
      current: "v2",
    });
    expect(loaded).toHaveLength(1);
  });

  it("aborts the manifest fetch when the load timeout expires", async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init?.signal ?? undefined;
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    await expect(
      loadModule({
        host: HOST,
        name: "cart",
        allowedHosts: [HOST],
        timeoutMs: 10,
        fetchImpl,
      }),
    ).rejects.toThrow(/Timeout/);
    expect(signal?.aborted).toBe(true);
  });
});
