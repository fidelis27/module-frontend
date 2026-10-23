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
  /** Renderizado enquanto o módulo carrega. */
  loading?: ReactNode;
  /** Renderizado se o carregamento falhar. */
  fallback?: ReactNode;
  onError?: (error: Error) => void;
  moduleLifeCycleEvent?: ModuleLifeCycleEvent;
  /** Demais props (entityId, source, callbacks...) vão direto ao módulo remoto. */
  [prop: string]: unknown;
}

/** Lado Consumer: carrega o módulo remoto e o monta numa raiz React isolada. */
export function Module(props: ModuleProps) {
  const {
    name,
    host,
    path,
    allowedHosts,
    timeoutMs,
    loading = null,
    fallback = null,
    onError,
    moduleLifeCycleEvent,
    ...moduleProps
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<Root | null>(null);
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

  // Cria/destrói a raiz isolada quando o módulo carrega.
  useEffect(() => {
    if (!entry || !containerRef.current) return;
    const root = entry.createRoot(containerRef.current);
    rootRef.current = root;
    return () => {
      rootRef.current = null;
      // Adia o unmount: desmontar síncrono durante o commit do React pai gera warning.
      queueMicrotask(() => root.unmount());
    };
  }, [entry]);

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
        { value: { appName: entry.appName, name: entry.name } },
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
    createElement('div', { ref: containerRef }),
  );
}
