import { createElement, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import type { ModuleLifeCycleEvent, RemoteModuleEntry } from '../shared/types';
import { loadModule } from './loadModule';

export interface ModuleProps {
  name: string;
  host: string;
  path?: string;
  allowedHosts?: string[];
  timeoutMs?: number;
  /**
   * Monta o módulo dentro de um Shadow DOM: o CSS do host não entra no módulo
   * e o do módulo não vaza para o host. Estilos do módulo precisam ser
   * declarados em `Modularize(..., { styles })` para serem injetados no shadow root.
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
const SHADOW_BASE_CSS = ':host{all:initial;display:block}';

/** Lado Consumer: carrega o módulo remoto e o monta numa raiz React isolada. */
export function Module(props: ModuleProps) {
  const {
    name,
    host,
    path,
    allowedHosts,
    timeoutMs,
    isolate = false,
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

  const allowedKey = allowedHosts?.join(',');

  useEffect(() => {
    let cancelled = false;
    setEntry(null);
    setError(null);

    loadModule({ host, name, path, allowedHosts, timeoutMs }).then(
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
    // allowedHosts entra via allowedKey para não re-disparar a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, name, path, allowedKey, timeoutMs]);

  // Cria/destrói a raiz isolada quando o módulo carrega (ou quando `isolate` muda).
  useEffect(() => {
    const container = containerRef.current;
    if (!entry || !container) return;

    let mountPoint: Element = container;
    let shadow: ShadowRoot | null = null;

    if (isolate) {
      if (typeof container.attachShadow !== 'function') {
        const e = new Error('isolate requer Shadow DOM, que este ambiente não suporta');
        setError(e);
        onErrorRef.current?.(e);
        return;
      }
      // attachShadow só pode ser chamado uma vez por elemento: reaproveita o existente
      // (ex.: efeitos duplicados do StrictMode) e limpa o conteúdo anterior.
      shadow = container.shadowRoot ?? container.attachShadow({ mode: 'open' });
      shadow.replaceChildren();

      const base = document.createElement('style');
      base.textContent = SHADOW_BASE_CSS;
      shadow.appendChild(base);
      for (const css of entry.styles ?? []) {
        const style = document.createElement('style');
        style.textContent = css;
        shadow.appendChild(style);
      }
      mountPoint = document.createElement('div');
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
  }, [entry, isolate]);

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
        { value: { appName: entry.appName, name: entry.name, shadowRoot: shadowRef.current } },
        entry.createElement(entry.Component, {
          ...moduleProps,
          moduleLifeCycleEvent: lifeCycle,
        }),
      ),
    );
  });

  if (error) return createElement('div', { 'data-module-error': name }, fallback);

  return createElement(
    'div',
    { 'data-module': name },
    !entry && loading,
    // `key` recria o elemento quando `isolate` muda: um elemento que já recebeu
    // attachShadow não pode voltar a ser um container comum.
    createElement('div', { ref: containerRef, key: isolate ? 'shadow' : 'light' }),
  );
}
