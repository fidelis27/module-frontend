import {
  createElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Root } from "react-dom/client";
import type {
  ModuleLifeCycleEvent,
  ModuleUpdateAvailable,
  RemoteModuleEntry,
} from "../shared/types";
import { loadModule } from "./loadModule";

export interface ModuleProps {
  name: string;
  host: string;
  path?: string;
  allowedHosts?: string[];
  timeoutMs?: number;
  /** TTL do manifesto; `0` desativa o polling automático de atualizações. */
  manifestTtlMs?: number;
  /** Chamado quando o Provider publica uma nova versão; o módulo atual não é trocado. */
  onUpdateAvailable?: (update: ModuleUpdateAvailable) => void;
  /** CSP nonce aplicado aos scripts e estilos do módulo. */
  nonce?: string;
  /** Rejeita o módulo se o manifesto não contiver SRI para cada script. */
  requireIntegrity?: boolean;
  /** Monta este módulo em um Shadow DOM para isolar seu CSS. */
  isolateStyles?: boolean;
  /**
   * @deprecated Use `isolateStyles`; este alias será removido na versão 1.0.
   */
  isolate?: boolean;
  /** Renderizado enquanto o módulo carrega. */
  loading?: ReactNode;
  /** Renderizado se o carregamento falhar. */
  fallback?: ReactNode;
  onError?: (error: Error) => void;
  moduleLifeCycleEvent?: ModuleLifeCycleEvent;
  /** Demais props (entityId, source, callbacks...) vão direto ao módulo remoto. */
  [prop: string]: unknown;
}

/** Base do shadow root: corta a herança de estilos do host (fonte, cor, etc.). */
const SHADOW_BASE_CSS = ":host{all:initial;display:block}";
let hasWarnedAboutLegacyIsolate = false;

/** Lado Consumer: carrega o módulo remoto e o monta numa raiz React isolada. */
export function Module(props: ModuleProps) {
  const {
    name,
    host,
    path,
    allowedHosts,
    timeoutMs,
    manifestTtlMs = 60_000,
    onUpdateAvailable,
    nonce,
    requireIntegrity,
    isolateStyles: isolateStylesProp,
    isolate: legacyIsolate,
    loading = null,
    fallback = null,
    onError,
    moduleLifeCycleEvent,
    ...moduleProps
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<Root | null>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);
  const [entry, setEntry] = useState<RemoteModuleEntry | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onUpdateAvailableRef = useRef(onUpdateAvailable);
  onUpdateAvailableRef.current = onUpdateAvailable;
  const allowedHostsRef = useRef(allowedHosts);
  allowedHostsRef.current = allowedHosts;
  const nonceRef = useRef(nonce);
  nonceRef.current = nonce;
  const isolateStyles = isolateStylesProp ?? legacyIsolate ?? false;

  const allowedKey = JSON.stringify(allowedHosts);

  useEffect(() => {
    if (legacyIsolate === undefined || hasWarnedAboutLegacyIsolate) return;
    hasWarnedAboutLegacyIsolate = true;
    console.warn(
      "A prop `isolate` de `Module` foi depreciada; use `isolateStyles`. O alias será removido na versão 1.0.",
    );
  }, [legacyIsolate]);

  useEffect(() => {
    let cancelled = false;
    setEntry(null);
    setError(null);

    loadModule({
      host,
      name,
      path,
      allowedHosts: allowedHostsRef.current,
      timeoutMs,
      manifestTtlMs,
      onUpdateAvailable: onUpdateAvailableRef.current,
      nonce,
      requireIntegrity,
    }).then(
      (loaded) => {
        if (!cancelled) setEntry(loaded);
      },
      (err: unknown) => {
        if (cancelled) return;
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        onErrorRef.current?.(e);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [
    host,
    name,
    path,
    allowedKey,
    timeoutMs,
    manifestTtlMs,
    nonce,
    requireIntegrity,
  ]);

  useEffect(() => {
    if (!entry || manifestTtlMs === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const checkForUpdates = async () => {
      try {
        await loadModule({
          host,
          name,
          path,
          allowedHosts: allowedHostsRef.current,
          timeoutMs,
          manifestTtlMs,
          onUpdateAvailable: onUpdateAvailableRef.current,
          nonce,
          requireIntegrity,
        });
      } catch (err) {
        if (!cancelled) {
          const e = err instanceof Error ? err : new Error(String(err));
          onErrorRef.current?.(e);
        }
      }
      if (!cancelled) {
        timer = setTimeout(checkForUpdates, manifestTtlMs);
      }
    };

    timer = setTimeout(checkForUpdates, manifestTtlMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    entry,
    host,
    name,
    path,
    allowedKey,
    timeoutMs,
    manifestTtlMs,
    nonce,
    requireIntegrity,
  ]);

  // Cria/destrói a raiz isolada quando o módulo carrega (ou quando `isolateStyles` muda).
  useEffect(() => {
    const container = containerRef.current;
    if (!entry || !container) return;

    let mountPoint: Element = container;
    let shadow: ShadowRoot | null = null;

    if (isolateStyles) {
      if (typeof container.attachShadow !== "function") {
        const e = new Error(
          "isolateStyles requer Shadow DOM, que este ambiente não suporta",
        );
        setError(e);
        onErrorRef.current?.(e);
        return;
      }
      // attachShadow só pode ser chamado uma vez por elemento: reaproveita o existente
      // (ex.: efeitos duplicados do StrictMode) e limpa o conteúdo anterior.
      shadow = container.shadowRoot ?? container.attachShadow({ mode: "open" });
      shadow.replaceChildren();

      const base = document.createElement("style");
      base.textContent = SHADOW_BASE_CSS;
      if (nonceRef.current) base.nonce = nonceRef.current;
      shadow.appendChild(base);
      for (const css of entry.styles ?? []) {
        const style = document.createElement("style");
        style.textContent = css;
        if (nonceRef.current) style.nonce = nonceRef.current;
        shadow.appendChild(style);
      }
      mountPoint = document.createElement("div");
      shadow.appendChild(mountPoint);
    }

    const root = entry.createRoot(mountPoint);
    rootRef.current = root;
    shadowRef.current = shadow;
    return () => {
      rootRef.current = null;
      shadowRef.current = null;
      // Adia o unmount: desmontar síncrono durante o commit do React pai gera warning.
      queueMicrotask(() => root.unmount());
    };
  }, [entry, isolateStyles]);

  // Re-renderiza o módulo remoto a cada mudança de props.
  useEffect(() => {
    const root = rootRef.current;
    if (!entry || !root) return;
    const lifeCycle: ModuleLifeCycleEvent = {
      ...moduleLifeCycleEvent,
      onCriticalFailure: (e) => {
        (moduleLifeCycleEvent?.onCriticalFailure ?? onErrorRef.current)?.(e);
      },
    };
    root.render(
      entry.createElement(
        entry.ModuleContext.Provider,
        {
          value: {
            appName: entry.appName,
            name: entry.name,
            isolateStyles,
            shadowRoot: shadowRef.current,
          },
        },
        entry.createElement(entry.Component, {
          ...moduleProps,
          moduleLifeCycleEvent: lifeCycle,
        }),
      ),
    );
  });

  if (error)
    return createElement("div", { "data-module-error": name }, fallback);

  return createElement(
    "div",
    { "data-module": name },
    !entry && loading,
    // `key` recria o elemento quando `isolateStyles` muda: um elemento que já recebeu
    // attachShadow não pode voltar a ser um container comum.
    createElement("div", {
      ref: containerRef,
      key: isolateStyles ? "shadow" : "light",
    }),
  );
}
