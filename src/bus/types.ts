/** Maps event channel names to their payload types. */
export type EventMap = Record<string, unknown>;

/** Cancels a bus subscription or error listener. */
export type Unsubscribe = () => void;

/** Metadata attached to each live or replayed event. */
export interface EventMeta {
  /** Channel used to publish the event. */
  channel: string;
  /** Publishing module or explicit source, when available. */
  source?: string;
  /** Monotonically increasing sequence number for this channel. */
  seq: number;
  /** Publication time in milliseconds since the Unix epoch. */
  publishedAt: number;
  /** Whether this delivery came from retained history. */
  replayed: boolean;
}

/** Receives an event payload and its metadata. */
export type Handler<T> = (payload: T, meta: EventMeta) => void;

/** Options for publishing and optionally retaining an event. */
export interface PublishOptions {
  /** Retain the event for this many milliseconds; zero disables retention. */
  ttl?: number;
  /** Overrides the source configured for this bus handle. */
  source?: string;
}

/** Options for subscriptions and retained-event replay. */
export interface SubscribeOptions {
  /** Deliver retained, unexpired events before live events. */
  replay?: boolean;
  /** Ignore events with a sequence less than or equal to this value. */
  afterSeq?: number;
  /** Automatically unsubscribe when the signal is aborted. */
  signal?: AbortSignal;
}

/** Read-only counts and sequence information for debugging. */
export interface BusSnapshot {
  /** Contract version of the shared core. */
  contractVersion: number;
  /** Current listener and retention counts by channel. */
  channels: Record<
    string,
    { listeners: number; retained: number; lastSeq: number }
  >;
}

/** Typed handle to the page-wide event bus. */
export interface Bus<E extends EventMap> {
  /**
   * Publishes an event synchronously to current subscribers.
   *
   * @example `bus.publish("cart:updated", { count: 2 });`
   */
  publish<K extends keyof E & string>(
    channel: K,
    payload: E[K],
    options?: PublishOptions,
  ): void;
  /**
   * Subscribes to an event channel.
   *
   * @example `const stop = bus.subscribe("cart:updated", onUpdate);`
   */
  subscribe<K extends keyof E & string>(
    channel: K,
    handler: Handler<E[K]>,
    options?: SubscribeOptions,
  ): Unsubscribe;
  /**
   * Subscribes for one live or replayed event, then unsubscribes.
   *
   * @example `bus.once("cart:updated", onFirstUpdate);`
   */
  once<K extends keyof E & string>(
    channel: K,
    handler: Handler<E[K]>,
    options?: SubscribeOptions,
  ): Unsubscribe;
  /**
   * Registers a listener for handler errors.
   *
   * @example `const stop = bus.onError((error) => report(error));`
   */
  onError(listener: (error: unknown, meta: EventMeta) => void): Unsubscribe;
  /**
   * Returns channel counts without changing bus state.
   *
   * @example `console.log(bus.inspect().channels);`
   */
  inspect(): BusSnapshot;
}
