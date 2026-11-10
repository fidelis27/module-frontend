import type {
  BusSnapshot,
  EventMeta,
  Handler,
  PublishOptions,
  SubscribeOptions,
  Unsubscribe,
} from "./types";

const MAX_RETAINED_PER_CHANNEL = 100;

interface PublishedEvent {
  channel: string;
  payload: unknown;
  meta: EventMeta;
  expiresAt: number;
}

interface ListenerRecord {
  handler: Handler<unknown>;
  lastSeq: number;
  replaying: boolean;
  queuedEvents: PublishedEvent[];
}

export interface BusCore {
  publish(channel: string, payload: unknown, options?: PublishOptions): void;
  subscribe(
    channel: string,
    handler: Handler<unknown>,
    options?: SubscribeOptions,
  ): Unsubscribe;
  once(
    channel: string,
    handler: Handler<unknown>,
    options?: SubscribeOptions,
  ): Unsubscribe;
  onError(listener: (error: unknown, meta: EventMeta) => void): Unsubscribe;
  inspect(): BusSnapshot;
}

export function createCore(contractVersion: number): BusCore {
  const listeners = new Map<string, Set<ListenerRecord>>();
  const retainedEvents = new Map<string, PublishedEvent[]>();
  const sequences = new Map<string, number>();
  const errorListeners = new Set<(error: unknown, meta: EventMeta) => void>();

  const expireRetained = (channel: string, now: number) => {
    const retained = retainedEvents.get(channel);
    if (!retained) return [];
    const valid = retained.filter((event) => event.expiresAt > now);
    if (valid.length === 0) retainedEvents.delete(channel);
    else retainedEvents.set(channel, valid);
    return valid;
  };

  const reportError = (error: unknown, meta: EventMeta) => {
    if (errorListeners.size === 0) {
      console.error(error, meta);
      return;
    }

    for (const listener of [...errorListeners]) {
      try {
        listener(error, meta);
      } catch (listenerError) {
        console.error(listenerError, meta);
      }
    }
  };

  const invoke = (record: ListenerRecord, event: PublishedEvent) => {
    if (event.meta.seq <= record.lastSeq) return;
    record.lastSeq = event.meta.seq;
    try {
      record.handler(event.payload, event.meta);
    } catch (error) {
      reportError(error, event.meta);
    }
  };

  const deliver = (record: ListenerRecord, event: PublishedEvent) => {
    if (record.replaying) record.queuedEvents.push(event);
    else invoke(record, event);
  };

  const publish: BusCore["publish"] = (channel, payload, options) => {
    const ttl = options?.ttl ?? 0;
    if (!Number.isFinite(ttl) || ttl < 0) {
      throw new RangeError(
        "Event bus ttl must be a finite non-negative number",
      );
    }

    const now = Date.now();
    const expiresAt = ttl > 0 ? now + ttl : 0;
    if (!Number.isFinite(expiresAt)) {
      throw new RangeError("Event bus ttl is too large");
    }
    const seq = (sequences.get(channel) ?? 0) + 1;
    sequences.set(channel, seq);

    const meta: EventMeta = {
      channel,
      ...(options?.source === undefined ? {} : { source: options.source }),
      seq,
      publishedAt: now,
      replayed: false,
    };
    const event: PublishedEvent = {
      channel,
      payload,
      meta,
      expiresAt,
    };

    if (ttl > 0) {
      const retained = expireRetained(channel, now);
      retained.push(event);
      if (retained.length > MAX_RETAINED_PER_CHANNEL) {
        retained.splice(0, retained.length - MAX_RETAINED_PER_CHANNEL);
      }
      retainedEvents.set(channel, retained);
    }

    for (const record of [...(listeners.get(channel) ?? [])]) {
      deliver(record, event);
    }
  };

  const subscribe: BusCore["subscribe"] = (channel, handler, options) => {
    if (options?.afterSeq !== undefined && !Number.isFinite(options.afterSeq)) {
      throw new RangeError("Event bus afterSeq must be a finite number");
    }
    if (options?.signal?.aborted) return () => {};

    const record: ListenerRecord = {
      handler,
      lastSeq: options?.afterSeq ?? 0,
      replaying: false,
      queuedEvents: [],
    };
    if (!sequences.has(channel)) sequences.set(channel, 0);
    const channelListeners = listeners.get(channel) ?? new Set();
    channelListeners.add(record);
    listeners.set(channel, channelListeners);

    let active = true;
    const unsubscribe = () => {
      if (!active) return;
      active = false;
      channelListeners.delete(record);
      if (channelListeners.size === 0) listeners.delete(channel);
      options?.signal?.removeEventListener("abort", unsubscribe);
    };
    options?.signal?.addEventListener("abort", unsubscribe, { once: true });

    if (options?.replay) {
      const retained = expireRetained(channel, Date.now());
      record.replaying = true;
      for (const event of retained) {
        if (event.meta.seq <= record.lastSeq) continue;
        invoke(record, {
          ...event,
          meta: { ...event.meta, replayed: true },
        });
      }
      let queuedIndex = 0;
      while (queuedIndex < record.queuedEvents.length) {
        invoke(record, record.queuedEvents[queuedIndex]!);
        queuedIndex += 1;
      }
      record.queuedEvents = [];
      record.replaying = false;
    }

    return unsubscribe;
  };

  const once: BusCore["once"] = (channel, handler, options) => {
    let unsubscribe: Unsubscribe = () => {};
    let called = false;
    const stop = subscribe(
      channel,
      (payload, meta) => {
        if (called) return;
        called = true;
        unsubscribe();
        handler(payload, meta);
      },
      options,
    );
    unsubscribe = stop;
    if (called) unsubscribe();
    return unsubscribe;
  };

  const onError: BusCore["onError"] = (listener) => {
    errorListeners.add(listener);
    return () => errorListeners.delete(listener);
  };

  const inspect: BusCore["inspect"] = () => {
    const channels = new Set([
      ...sequences.keys(),
      ...listeners.keys(),
      ...retainedEvents.keys(),
    ]);
    const snapshot: BusSnapshot["channels"] = Object.fromEntries(
      [...channels].map((channel) => [
        channel,
        {
          listeners: listeners.get(channel)?.size ?? 0,
          retained: retainedEvents.get(channel)?.length ?? 0,
          lastSeq: sequences.get(channel) ?? 0,
        },
      ]),
    );
    return { contractVersion, channels: snapshot };
  };

  return { publish, subscribe, once, onError, inspect };
}
