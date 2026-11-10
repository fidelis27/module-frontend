import { createCore, type BusCore } from "./core";
import type { Bus, EventMap, Handler, PublishOptions } from "./types";

export const BUS_CONTRACT_VERSION = 1;
const GLOBAL_BUS_KEY = "__MFE_BUS__";

interface GlobalBusState {
  contractVersion: number;
  core: BusCore;
}

type BusGlobal = typeof globalThis & {
  __MFE_BUS__?: GlobalBusState;
};

function getCore(): BusCore {
  const global = globalThis as BusGlobal;
  const state = global[GLOBAL_BUS_KEY];
  if (!state) {
    const newState: GlobalBusState = {
      contractVersion: BUS_CONTRACT_VERSION,
      core: createCore(BUS_CONTRACT_VERSION),
    };
    global[GLOBAL_BUS_KEY] = newState;
    return newState.core;
  }

  if (state.contractVersion !== BUS_CONTRACT_VERSION) {
    throw new Error(
      `Incompatible event bus contract: found ${state.contractVersion}, expected ${BUS_CONTRACT_VERSION}`,
    );
  }
  if (
    typeof state.core?.publish !== "function" ||
    typeof state.core?.subscribe !== "function" ||
    typeof state.core?.once !== "function" ||
    typeof state.core?.onError !== "function" ||
    typeof state.core?.inspect !== "function"
  ) {
    throw new Error("Invalid global event bus core for contract version 1");
  }
  return state.core;
}

/**
 * Creates a typed handle to the page-wide event bus.
 *
 * @example
 * ```ts
 * const bus = createBus<{ "cart:updated": { count: number } }>();
 * bus.publish("cart:updated", { count: 2 });
 * ```
 */
export function createBus<E extends EventMap = EventMap>(options?: {
  source?: string;
}): Bus<E> {
  const core = getCore();
  return {
    publish(channel, payload, publishOptions?: PublishOptions) {
      const source = publishOptions?.source ?? options?.source;
      core.publish(channel, payload, { ...publishOptions, source });
    },
    subscribe(channel, handler, subscribeOptions) {
      return core.subscribe(
        channel,
        handler as Handler<unknown>,
        subscribeOptions,
      );
    },
    once(channel, handler, subscribeOptions) {
      return core.once(channel, handler as Handler<unknown>, subscribeOptions);
    },
    onError: core.onError,
    inspect: core.inspect,
  };
}
