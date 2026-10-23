import { createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { getRegistryKey } from '../shared/constants';
import type {
  ModularizeOptions,
  ModuleLifeCycleEvent,
  RemoteModuleEntry,
} from '../shared/types';
import { ErrorBoundary } from './ErrorBoundary';
import { ModuleContext } from './ModuleContext';

type WithLifeCycle<P> = P & { moduleLifeCycleEvent?: ModuleLifeCycleEvent };

/**
 * Lado Provider. Registra o módulo em `window` para o Consumer instanciar.
 * O React usado aqui é o do bundle do próprio módulo (isolamento de versão).
 */
export function Modularize<P extends object = Record<string, unknown>>(
  name: string,
  Component: ComponentType<P>,
  options: ModularizeOptions,
): RemoteModuleEntry<P> {
  const { appName, I18n, onCriticalFailure } = options;

  if (!appName) throw new Error(`Modularize("${name}"): appName é obrigatório`);
  if (!name) throw new Error('Modularize: name é obrigatório');

  const key = getRegistryKey(appName, name);
  const registry = window as unknown as Record<string, unknown>;

  if (registry[key]) {
    // Script carregado duas vezes: mantém a primeira instância para não
    // trocar o contexto de módulos já montados.
    return registry[key] as RemoteModuleEntry<P>;
  }

  const Wrapped: RemoteModuleEntry<P>['Component'] = (props) => {
    const { moduleLifeCycleEvent, ...rest } = props as WithLifeCycle<P>;
    return createElement(
      ErrorBoundary,
      {
        appName,
        name,
        onError: (error: Error) => {
          (moduleLifeCycleEvent?.onCriticalFailure ?? onCriticalFailure)?.(error);
        },
      },
      createElement(Component as ComponentType<object>, rest),
    );
  };
  Wrapped.displayName = `Modularized(${name})`;

  const entry: RemoteModuleEntry<P> = {
    appName,
    name,
    createRoot,
    createElement,
    ModuleContext,
    Component: Wrapped,
    I18n,
  };

  registry[key] = entry;
  return entry;
}
