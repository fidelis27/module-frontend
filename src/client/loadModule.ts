import { DEFAULT_MANIFEST_PATH, getRegistryKey } from '../shared/constants';
import type { Manifest, RemoteModuleEntry } from '../shared/types';

export interface LoadModuleOptions {
  /** Origem do Provider, ex.: https://provider.example.com */
  host: string;
  name: string;
  /** Caminho do manifesto no Provider. */
  path?: string;
  /**
   * Origens autorizadas a fornecer scripts. Mesma origem da página é sempre
   * permitida. Use `['*']` para liberar tudo (não recomendado em produção).
   */
  allowedHosts?: string[];
  /** Tempo máximo para manifesto + scripts, em ms. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const manifestCache = new Map<string, Promise<Manifest>>();
const scriptCache = new Map<string, Promise<void>>();

/** Limpa caches internos (útil em testes e em reload forçado). */
export function resetModuleCaches(): void {
  manifestCache.clear();
  scriptCache.clear();
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout (${ms}ms) ao ${label}`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function assertOriginAllowed(url: URL, allowedHosts: string[] | undefined): void {
  if (allowedHosts?.includes('*')) return;
  if (typeof window !== 'undefined' && url.origin === window.location.origin) return;
  if (allowedHosts?.some((h) => new URL(h).origin === url.origin)) return;
  throw new Error(
    `Origem não autorizada: ${url.origin}. Adicione-a em allowedHosts para carregar este módulo.`,
  );
}

function fetchManifest(url: URL, fetchImpl: typeof fetch): Promise<Manifest> {
  const key = url.href;
  const cached = manifestCache.get(key);
  if (cached) return cached;

  const promise = (async () => {
    const response = await fetchImpl(key, { credentials: 'omit' });
    if (!response.ok) {
      throw new Error(`Falha ao buscar manifesto (${response.status}) em ${key}`);
    }
    return (await response.json()) as Manifest;
  })();

  manifestCache.set(key, promise);
  // Falhas não podem ficar em cache: o próximo mount precisa poder tentar de novo.
  promise.catch(() => manifestCache.delete(key));
  return promise;
}

function loadScript(url: URL): Promise<void> {
  const key = url.href;
  const cached = scriptCache.get(key);
  if (cached) return cached;

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = key;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error(`Falha ao carregar script ${key}`));
    };
    document.head.appendChild(script);
  });

  scriptCache.set(key, promise);
  promise.catch(() => scriptCache.delete(key));
  return promise;
}

export async function loadModule<P = Record<string, unknown>>(
  options: LoadModuleOptions,
): Promise<RemoteModuleEntry<P>> {
  const {
    host,
    name,
    path = DEFAULT_MANIFEST_PATH,
    allowedHosts,
    timeoutMs = 15000,
    fetchImpl = fetch,
  } = options;

  const manifestUrl = new URL(path, host);
  assertOriginAllowed(manifestUrl, allowedHosts);

  const run = async (): Promise<RemoteModuleEntry<P>> => {
    const manifest = await fetchManifest(manifestUrl, fetchImpl);
    const mod = manifest.modules[name];
    if (!mod) {
      throw new Error(`Módulo "${name}" não existe no manifesto de ${manifestUrl.origin}`);
    }

    const scriptUrls = mod.scripts.map((s) => {
      const url = new URL(s, manifestUrl);
      assertOriginAllowed(url, allowedHosts);
      return url;
    });
    await Promise.all(scriptUrls.map(loadScript));

    const entry = (window as unknown as Record<string, unknown>)[
      getRegistryKey(manifest.appName, name)
    ] as RemoteModuleEntry<P> | undefined;

    if (!entry) {
      throw new Error(
        `Scripts carregados, mas o módulo "${name}" não se registrou na window. ` +
          `Confira se o appName do Modularize é "${manifest.appName}".`,
      );
    }
    return entry;
  };

  return withTimeout(run(), timeoutMs, `carregar o módulo "${name}"`);
}
