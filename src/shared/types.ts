import type { ComponentType, Context, createElement } from "react";
import type { Root } from "react-dom/client";

export interface ManifestModule {
  name: string;
  /** URLs dos scripts; podem ser relativas ao host do Provider. */
  scripts: string[];
  /** SRI hashes alinhados por índice com `scripts`. */
  integrity?: string[];
}

export interface Manifest {
  /** Version of the Provider/Consumer runtime contract. */
  contractVersion: number;
  appName: string;
  /** Hash agregado dos bundles; muda a cada deploy com conteúdo novo. */
  version: string;
  modules: Record<string, ManifestModule>;
}

/** Provider versions reported when a manifest changes after initial load. */
export interface ModuleUpdateAvailable {
  /** First version observed by this Consumer. */
  previous: string;
  /** New version available from the Provider. */
  current: string;
}

export interface ModuleLifeCycleEvent {
  onCriticalFailure?: (error: Error) => void;
  /** Called once after the remote component commits; not called if rendering fails. */
  onMounted?: () => void;
}

export interface ModuleContextValue {
  appName: string;
  name: string;
  /** Indica se os estilos do módulo estão em um Shadow DOM. */
  isolateStyles: boolean;
  /** Shadow root do módulo; use como alvo para portais e tags de estilo. */
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
  /** CSS do módulo; com `isolateStyles` é injetado no Shadow DOM. */
  styles?: string[];
}

export interface ModularizeOptions {
  appName: string;
  /**
   * CSS do módulo como texto. Com `<Module isolateStyles />` é injetado no shadow root,
   * já que `<style>` colocado em document.head não alcança o Shadow DOM.
   */
  styles?: string | string[];
  /** Callback padrão para falhas críticas capturadas pelo ErrorBoundary. */
  onCriticalFailure?: (error: Error) => void;
}
