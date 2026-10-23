import type { ComponentType, Context, createElement } from 'react';
import type { Root } from 'react-dom/client';

export interface ManifestModule {
  name: string;
  /** URLs dos scripts; podem ser relativas ao host do Provider. */
  scripts: string[];
}

export interface Manifest {
  appName: string;
  /** Hash agregado dos bundles; muda a cada deploy com conteúdo novo. */
  version: string;
  modules: Record<string, ManifestModule>;
}

export interface ModuleLifeCycleEvent {
  onCriticalFailure?: (error: Error) => void;
  onMounted?: () => void;
}

export interface ModuleContextValue {
  appName: string;
  name: string;
  [key: string]: unknown;
}

/** Objeto que o Provider registra na window. */
export interface RemoteModuleEntry<P = Record<string, unknown>> {
  appName: string;
  name: string;
  createRoot: (container: Element | DocumentFragment) => Root;
  createElement: typeof createElement;
  ModuleContext: Context<ModuleContextValue | null>;
  Component: ComponentType<P & { moduleLifeCycleEvent?: ModuleLifeCycleEvent }>;
  I18n?: unknown;
}

export interface ModularizeOptions {
  appName: string;
  I18n?: unknown;
  /** Callback padrão para falhas críticas capturadas pelo ErrorBoundary. */
  onCriticalFailure?: (error: Error) => void;
}
