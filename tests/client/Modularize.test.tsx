import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modularize } from '../../src/client';
import { getRegistryKey } from '../../src/shared';

afterEach(() => {
  for (const key of Object.keys(window)) {
    if (key.startsWith('__REMOTE_MODULE__')) delete (window as any)[key];
  }
});

describe('Modularize', () => {
  it('registra o módulo em window com a chave esperada', () => {
    const entry = Modularize('cart', () => <div>cart</div>, { appName: 'shop' });
    expect((window as any)[getRegistryKey('shop', 'cart')]).toBe(entry);
    expect(getRegistryKey('shop', 'cart')).toBe('__REMOTE_MODULE___shop-cart');
    expect(typeof entry.createRoot).toBe('function');
    expect(entry.ModuleContext).toBeDefined();
  });

  it('é idempotente: segundo script não troca a instância registrada', () => {
    const first = Modularize('cart', () => <div>a</div>, { appName: 'shop' });
    const second = Modularize('cart', () => <div>b</div>, { appName: 'shop' });
    expect(second).toBe(first);
  });

  it('exige appName e name', () => {
    expect(() => Modularize('cart', () => null, { appName: '' })).toThrow(/appName/);
    expect(() => Modularize('', () => null, { appName: 'shop' })).toThrow(/name/);
  });

  it('isola erros do componente e chama onCriticalFailure', async () => {
    const onCriticalFailure = vi.fn();
    const Boom = () => {
      throw new Error('boom');
    };
    const entry = Modularize('boom', Boom, { appName: 'shop', onCriticalFailure });

    const container = document.createElement('div');
    const root = entry.createRoot(container);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      root.render(entry.createElement(entry.Component, {}));
    });
    spy.mockRestore();

    expect(onCriticalFailure).toHaveBeenCalledTimes(1);
    expect(onCriticalFailure.mock.calls[0]![0].message).toBe('boom');
    expect(container.innerHTML).toBe('');
  });

  it('moduleLifeCycleEvent do consumer tem prioridade sobre o padrão do provider', async () => {
    const providerDefault = vi.fn();
    const consumerHandler = vi.fn();
    const Boom = () => {
      throw new Error('x');
    };
    const entry = Modularize('boom2', Boom, {
      appName: 'shop',
      onCriticalFailure: providerDefault,
    });
    const root = entry.createRoot(document.createElement('div'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      root.render(
        entry.createElement(entry.Component, {
          moduleLifeCycleEvent: { onCriticalFailure: consumerHandler },
        }),
      );
    });
    spy.mockRestore();
    expect(consumerHandler).toHaveBeenCalledTimes(1);
    expect(providerDefault).not.toHaveBeenCalled();
  });
});
