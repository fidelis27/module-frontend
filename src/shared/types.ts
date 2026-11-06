import type { ComponentType, Context, createElement } from "react";
import type { Root } from "react-dom/client";

export interface ManifestModule {
  name: string;
  /** URLs dos scripts; podem ser relativas ao host do Provider. */
  scripts: string[];
}

export interface Manifest {
  /** Version of the Provider/Consumer runtime contract. */
  contractVersion: number;
  appName: string;
  /** Hash agregado dos bundles; muda a cada deploy com conteúdo novo. */
  version: string;
  modules: Record<string, ManifestModule>;
}

export interface ModuleLifeCycleEvent {
  onCriticalFailure?: (error: Error) => void;
  /** Called once after the remote component commits; not called if rendering fails. */
  onMounted?: () => void;
}

export interface ModuleContextValue {
  appName: string;
  name: string;
  /** Shadow root onde o módulo está montado (só com `isolate`). Use como alvo de portais e style tags. */
  shadowRoot?: ShadowRoot | null;
  [key: string]: unknown;
}

/** Objeto que o Provider registra na window. */
export interface RemoteModuleEntry<P = Record<string, unknown>> {
  contractVersion: number;
  appName: string;
  name: string;
  createRoot: (container: Element | DocumentFragment) => Root;
  createElement: typeof createElement;
  ModuleContext: Context<ModuleContextValue | null>;
  Component: ComponentType<P & { moduleLifeCycleEvent?: ModuleLifeCycleEvent }>;
  /** CSS do módulo; com `isolate` é injetado dentro do shadow root. */
  styles?: string[];
}

export interface ModularizeOptions {
  appName: string;
  /**
   * CSS do módulo como texto. Com `<Module isolate />` é injetado no shadow root,
   * já que `<style>` colocado em document.head não alcança o Shadow DOM.
   */
  styles?: string | string[];
  /** Callback padrão para falhas críticas capturadas pelo ErrorBoundary. */
  onCriticalFailure?: (error: Error) => void;
}
