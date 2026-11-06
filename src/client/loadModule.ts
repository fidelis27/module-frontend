import {
  CONTRACT_VERSION,
  DEFAULT_MANIFEST_PATH,
  getRegistryKey,
} from "../shared/constants";
import type {
  Manifest,
  ModuleUpdateAvailable,
  RemoteModuleEntry,
} from "../shared/types";

const DEFAULT_MANIFEST_TTL_MS = 60_000;

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
  /** Tempo de cache do manifesto. `0` sempre revalida ao chamar `loadModule`. */
  manifestTtlMs?: number;
  /** Ignora respostas em cache e recarrega o registro do módulo para uma nova tentativa. */
  forceReload?: boolean;
  /** Chamado uma vez para cada nova versão encontrada após a primeira. */
  onUpdateAvailable?: (update: ModuleUpdateAvailable) => void;
  /** CSP nonce aplicado aos scripts remotos. */
  nonce?: string;
  /** Rejeita manifestos sem hashes SRI para todos os scripts do módulo. */
  requireIntegrity?: boolean;
  fetchImpl?: typeof fetch;
}

interface ManifestCacheEntry {
  promise: Promise<Manifest>;
  fetchedAt: number;
  pending: boolean;
}

interface VersionObservation {
  initialVersion: string;
  notifiedVersions: Set<string>;
}

const manifestCache = new Map<string, ManifestCacheEntry>();
const scriptCache = new Map<string, Promise<void>>();
const versionObservations = new Map<string, VersionObservation>();

/** Limpa caches internos (útil em testes e em reload forçado). */
export function resetModuleCaches(): void {
  manifestCache.clear();
  scriptCache.clear();
  versionObservations.clear();
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`Timeout (${ms}ms) ao ${label}`));
    }, ms);
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

function assertOriginAllowed(
  url: URL,
  allowedHosts: string[] | undefined,
): void {
  if (allowedHosts?.includes("*")) return;
  if (typeof window !== "undefined" && url.origin === window.location.origin)
    return;
  if (allowedHosts?.some((h) => new URL(h).origin === url.origin)) return;
  throw new Error(
    `Origem não autorizada: ${url.origin}. Adicione-a em allowedHosts para carregar este módulo.`,
  );
}

function assertContractVersion(actual: unknown, name: string, source: string) {
  if (actual === CONTRACT_VERSION) return;
  const found = actual === undefined ? "ausente" : String(actual);
  throw new Error(
    `Contrato incompatível para "${name}": versão ${found} no ${source}; ` +
      `este consumer suporta ${CONTRACT_VERSION}. Atualize @lib-core-mfe/module-frontend ` +
      `no Provider e no Consumer para versões compatíveis.`,
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidEntry<P>(
  value: unknown,
  appName: string,
  name: string,
): value is RemoteModuleEntry<P> {
  if (!isObject(value)) return false;
  const component = value.Component;
  const isComponent =
    typeof component === "function" ||
    (typeof component === "object" && component !== null);
  const context = value.ModuleContext;
  const isContext = isObject(context) && "Provider" in context;
  return (
    value.contractVersion === CONTRACT_VERSION &&
    value.appName === appName &&
    value.name === name &&
    typeof value.createRoot === "function" &&
    typeof value.createElement === "function" &&
    isContext &&
    isComponent
  );
}

function validateEntry<P>(
  value: unknown,
  appName: string,
  name: string,
): RemoteModuleEntry<P> {
  if (!isObject(value)) {
    throw new Error(`Entry do módulo "${name}" está malformada.`);
  }
  assertContractVersion(value.contractVersion, name, "entry");

  if (!isValidEntry<P>(value, appName, name)) {
    throw new Error(
      `Entry do módulo "${name}" está malformada ou não corresponde ao app "${appName}".`,
    );
  }
  return value;
}

function fetchManifest(
  url: URL,
  fetchImpl: typeof fetch,
  manifestTtlMs: number,
  signal: AbortSignal,
  forceReload: boolean,
): Promise<Manifest> {
  const key = url.href;
  const cached = manifestCache.get(key);
  if (
    cached &&
    (cached.pending ||
      (!forceReload &&
        manifestTtlMs > 0 &&
        Date.now() - cached.fetchedAt < manifestTtlMs))
  ) {
    return cached.promise;
  }

  const promise = (async () => {
    const response = await fetchImpl(key, { credentials: "omit", signal });
    if (!response.ok) {
      throw new Error(
        `Falha ao buscar manifesto (${response.status}) em ${key}`,
      );
    }
    return (await response.json()) as Manifest;
  })();

  const entry: ManifestCacheEntry = {
    promise,
    fetchedAt: Date.now(),
    pending: true,
  };
  manifestCache.set(key, entry);
  promise.then(
    () => {
      entry.fetchedAt = Date.now();
      entry.pending = false;
    },
    () => {
      if (manifestCache.get(key) === entry) manifestCache.delete(key);
    },
  );
  // Falhas não podem ficar em cache: o próximo mount precisa poder tentar de novo.
  return promise;
}

function loadScript(
  url: URL,
  integrity?: string,
  nonce?: string,
  forceReload = false,
): Promise<void> {
  const key = `${url.href}\0${integrity ?? ""}`;
  const cached = scriptCache.get(key);
  if (cached && !forceReload) return cached;

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url.href;
    script.async = true;
    script.crossOrigin = "anonymous";
    if (integrity) script.integrity = integrity;
    if (nonce) script.nonce = nonce;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error(`Falha ao carregar script ${url.href}`));
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
    manifestTtlMs = DEFAULT_MANIFEST_TTL_MS,
    forceReload = false,
    onUpdateAvailable,
    nonce,
    requireIntegrity = false,
    fetchImpl = fetch,
  } = options;
  if (!Number.isFinite(manifestTtlMs) || manifestTtlMs < 0) {
    throw new Error(
      "manifestTtlMs deve ser um número finito maior ou igual a 0",
    );
  }

  const manifestUrl = new URL(path, host);
  assertOriginAllowed(manifestUrl, allowedHosts);
  const controller = new AbortController();

  const run = async (): Promise<RemoteModuleEntry<P>> => {
    const manifest = await fetchManifest(
      manifestUrl,
      fetchImpl,
      manifestTtlMs,
      controller.signal,
      forceReload,
    );
    if (!manifest || typeof manifest !== "object") {
      throw new Error(`Manifesto inválido em ${manifestUrl.origin}`);
    }
    assertContractVersion(manifest.contractVersion, name, "manifesto");
    if (typeof manifest.appName !== "string") {
      throw new Error(`Manifesto sem appName válido em ${manifestUrl.origin}`);
    }
    if (typeof manifest.version !== "string" || !isObject(manifest.modules)) {
      throw new Error(`Manifesto inválido em ${manifestUrl.origin}`);
    }

    const versionKey = JSON.stringify([manifestUrl.origin, manifest.appName]);
    const registry = window as unknown as Record<string, unknown>;
    const registryKey = getRegistryKey(manifest.appName, name);
    if (forceReload) delete registry[registryKey];
    let observation = versionObservations.get(versionKey);
    if (!observation) {
      observation = {
        initialVersion: manifest.version,
        notifiedVersions: new Set(),
      };
      versionObservations.set(versionKey, observation);
    } else if (manifest.version !== observation.initialVersion) {
      if (
        onUpdateAvailable &&
        !observation.notifiedVersions.has(manifest.version)
      ) {
        observation.notifiedVersions.add(manifest.version);
        onUpdateAvailable?.({
          previous: observation.initialVersion,
          current: manifest.version,
        });
      }
      const currentEntry = registry[registryKey];
      if (currentEntry) {
        return validateEntry<P>(currentEntry, manifest.appName, name);
      }
    }

    const mod = manifest.modules[name];
    if (!mod) {
      throw new Error(
        `Módulo "${name}" não existe no manifesto de ${manifestUrl.origin}`,
      );
    }
    if (
      !Array.isArray(mod.scripts) ||
      mod.scripts.length === 0 ||
      mod.scripts.some((script) => typeof script !== "string")
    ) {
      throw new Error(`Manifesto contém scripts inválidos para "${name}"`);
    }
    if (
      mod.integrity !== undefined &&
      (!Array.isArray(mod.integrity) ||
        mod.integrity.length !== mod.scripts.length ||
        mod.integrity.some(
          (hash) => typeof hash !== "string" || hash.trim() === "",
        ))
    ) {
      throw new Error(`Manifesto contém hashes SRI inválidos para "${name}"`);
    }
    if (
      requireIntegrity &&
      (!mod.integrity || mod.integrity.length !== mod.scripts.length)
    ) {
      throw new Error(
        `O módulo "${name}" não fornece hashes SRI para todos os scripts; ` +
          `desative requireIntegrity somente se confiar no Provider.`,
      );
    }

    const scriptUrls = mod.scripts.map((s) => {
      const url = new URL(s, manifestUrl);
      assertOriginAllowed(url, allowedHosts);
      return url;
    });
    await Promise.all(
      scriptUrls.map((url, index) =>
        loadScript(url, mod.integrity?.[index], nonce, forceReload),
      ),
    );

    const entry = (window as unknown as Record<string, unknown>)[
      getRegistryKey(manifest.appName, name)
    ];

    if (!entry) {
      throw new Error(
        `Scripts carregados, mas o módulo "${name}" não se registrou na window. ` +
          `Confira se o appName do Modularize é "${manifest.appName}".`,
      );
    }
    return validateEntry<P>(entry, manifest.appName, name);
  };

  return withTimeout(run(), timeoutMs, `carregar o módulo "${name}"`, () =>
    controller.abort(),
  );
}
