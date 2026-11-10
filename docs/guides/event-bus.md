# Event bus

The bus lets independently bundled modules exchange typed notifications. It is
not shared state, RPC, or a security boundary.

## Quick start

```ts
import { createBus } from "@lib-core-mfe/module-frontend/bus";
import { createBusHooks } from "@lib-core-mfe/module-frontend/client";

type AppEvents = {
  "nav:request": { path: string };
  "student:created": { id: string };
};

export const bus = createBus<AppEvents>();
export const { usePublish, useSubscribe } = createBusHooks(bus);
```

In a component, `usePublish()` returns a stable publisher and
`useSubscribe()` cleans up when the component unmounts:

```tsx
function StudentList() {
  const publish = usePublish();
  useSubscribe("student:created", ({ id }) => refreshStudent(id));
  return (
    <button onClick={() => publish("nav:request", { path: "/students" })}>
      Open
    </button>
  );
}
```

## Define and name channels

Keep the event map in a shared contract module imported by the host and every
remote. Prefer `namespace:action` names such as `nav:request` and
`student:created`. Give each namespace one owning module and have only that
owner publish to it. This is a convention, not runtime authorization.

The payload type is determined by the map. The bus does not validate payloads
at runtime; validate untrusted data at its boundary before publishing it.

## Initialization, retention, and replay

Delivery is synchronous. A publish before a listener mounts is not retained by
default. Pass a positive `ttl` when a newly mounted module needs to replay an
event:

```ts
bus.publish("student:created", { id: "42" }, { ttl: 10_000 });
bus.subscribe("student:created", onCreated, { replay: true });
```

At most 100 unexpired events are retained per channel; publishing another
retained event evicts the oldest. Expiry is checked during later publication
or subscription, without timers. Replay delivers retained events by sequence
before live events. `afterSeq` can exclude already processed events.

The React hooks remember the last sequence per channel so effect re-runs,
including React StrictMode's development re-run, do not replay an event twice.
Outside React, cancel a subscription with the returned function or an
`AbortSignal`.

## Ordering and errors

Listeners run synchronously in subscription order. The listener list is copied
before each delivery, so adding or removing a listener affects the next event.
Nested publishes are delivered immediately. A handler exception does not stop
other handlers:

```ts
const stopReporting = bus.onError((error, meta) => {
  Sentry.captureException(error, {
    extra: { channel: meta.channel, source: meta.source },
  });
});
```

If there is no error listener, the bus reports the exception to `console.error`.
Errors thrown by an error listener are also reported there.

## Payloads and tests

Payload references are passed unchanged to every listener. Treat them as
immutable after publishing; the bus does not clone or freeze values.

Tests can create a typed bus, use unique channel names, and unsubscribe in
cleanup. `bus.inspect()` reports listener and retained-event counts and the
last sequence number without modifying state:

```ts
const snapshot = bus.inspect();
expect(snapshot.channels["student:created"]?.listeners).toBe(1);
```

All handles in one JavaScript realm share the same global core, including
between separately bundled copies. Use unique channels and clean up listeners
between tests.

## Debugging and anti-patterns

- Use `inspect()` for counts and sequence numbers; do not mutate the internal
  `globalThis.__MFE_BUS__` object.
- Do not use the bus as a source of truth or a replacement for application
  state.
- Avoid large payloads; send identifiers and load full data through an API.
- Do not depend on handler ordering to coordinate business logic.
- Do not leave subscriptions alive outside React; keep and call the
  unsubscribe function.
- Do not publish sensitive data. Any module in the page can publish any
  channel, and remote scripts run with the page's privileges. See
  [ADR 0005](../adr/0005-security-model.md).

## Migrating from a module-local bus

Define a shared event map first. Keep existing wrapper signatures temporarily
and map their channel arguments to typed channel names. Make retention explicit
where late subscribers need prior notifications. Migrate consumers in small
steps to `useSubscribe` and `usePublish`, then remove the wrapper only after all
modules have moved. Review the intended behavior changes: handler errors no
longer stop fan-out, and opted-in replay can deliver events published before a
listener mounted.
