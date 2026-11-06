export const REMOTE_MODULE_KEY = "__REMOTE_MODULE__";
export const CONTRACT_VERSION = 1;

export const ENDPOINTS = {
  modulesConfiguration: "/__modules_configuration",
} as const;

/** Prefixo padrão em que o Provider publica manifesto e bundles. */
export const DEFAULT_BASE_PATH = "/modules";

/** Caminho padrão do manifesto; Consumer e serveModules usam o mesmo default. */
export const DEFAULT_MANIFEST_PATH = `${DEFAULT_BASE_PATH}${ENDPOINTS.modulesConfiguration}`;

/** Chave usada no registro global: `${KEY}_${appName}-${name}`. */
export function getModuleIdentifier(appName: string, name: string): string {
  return `${appName}-${name}`;
}

export function getRegistryKey(appName: string, name: string): string {
  return `${REMOTE_MODULE_KEY}_${getModuleIdentifier(appName, name)}`;
}
