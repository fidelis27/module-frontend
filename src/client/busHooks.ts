import { useCallback, useContext, useEffect, useRef } from "react";
import {
  createBus,
  type Bus,
  type EventMap,
  type Handler,
  type SubscribeOptions,
} from "../bus";
import { ModuleContext } from "./ModuleContext";

/**
 * Creates React hooks bound to a typed event bus.
 *
 * @example
 * ```ts
 * const { usePublish, useSubscribe } = createBusHooks<AppEvents>(bus);
 * ```
 */
export function createBusHooks<E extends EventMap>(bus?: Bus<E>) {
  const eventBus = bus ?? createBus<E>();

  /** Returns a stable publisher that uses the current module as its source. */
  function usePublish(): Bus<E>["publish"] {
    const module = useContext(ModuleContext);
    const source = useRef<string | undefined>(undefined);
    source.current = module ? `${module.appName}-${module.name}` : undefined;

    return useCallback(
      <K extends keyof E & string>(
        channel: K,
        payload: E[K],
        options?: Parameters<Bus<E>["publish"]>[2],
      ) => {
        eventBus.publish(channel, payload, {
          ...options,
          source: options?.source ?? source.current,
        });
      },
      [],
    );
  }

  /** Subscribes with the latest handler and cancels when the component unmounts. */
  function useSubscribe<K extends keyof E & string>(
    channel: K,
    handler: Handler<E[K]>,
    options?: Pick<SubscribeOptions, "replay">,
  ): void {
    const handlerRef = useRef(handler);
    handlerRef.current = handler;
    const lastSeen = useRef<{ channel: string | undefined; seq: number }>({
      channel: undefined,
      seq: 0,
    });
    if (lastSeen.current.channel !== channel) {
      lastSeen.current = { channel, seq: 0 };
    }

    const replay = options?.replay;
    useEffect(() => {
      const unsubscribe = eventBus.subscribe(
        channel,
        (payload, meta) => {
          if (meta.seq <= lastSeen.current.seq) return;
          lastSeen.current = { channel, seq: meta.seq };
          handlerRef.current(payload, meta);
        },
        { replay, afterSeq: lastSeen.current.seq },
      );
      return unsubscribe;
    }, [channel, replay]);
  }

  return { usePublish, useSubscribe };
}
