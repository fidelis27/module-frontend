# ADR 0006: Provide a typed event bus

- Status: Accepted

## Context

Independently bundled modules need a consistent way to exchange events without
depending on a particular React tree. A bus embedded in multiple bundles must
deliver events with the same ordering and error behavior, and late subscribers
need explicit control over event retention.

## Decision

- Expose a framework-independent API at `@lib-core-mfe/module-frontend/bus`.
- Type channels and payloads through an event map supplied to `createBus`.
- Deliver synchronously in subscription order from a snapshot of listeners.
- Allow bounded per-channel retention with an explicit TTL and replay opt-in.
- Include a per-channel sequence number, publication time, optional source, and
  replay flag in event metadata.
- Continue delivering after a handler throws; report failures through
  `onError`, or `console.error` when no error listener is registered.
- Expose React hooks separately from the bus core through the `/client` entry.
- Treat payloads as immutable by convention and pass the same reference to
  every listener.

## Consequences

- The bus is suitable for notifications, not shared mutable state or RPC.
- The default TTL is zero, so retention must be explicitly requested.
- Event delivery is reentrant: publishing inside a handler immediately
  dispatches the nested event.
- The bus does not validate runtime payloads or enforce channel ownership.
- Global event channels are not a security boundary; see
  [ADR 0005](./0005-security-model.md).
- The minified ESM core is slightly above the 1 KB gzip target. The measured
  size includes retention, replay, error isolation, per-channel sequencing,
  cancellation, and inspection; run `npm run measure:bus` to reproduce the
  measurement before optimizing away contract behavior.

## Alternatives considered

- Keeping the bus in the client entry would require React for core tests and
  non-React consumers.
- Implicit queuing would make delivery depend on which module subscribes first.
- Asynchronous delivery would change ordering relative to synchronous callers.
- Wildcard subscriptions and request/response are outside this release.
