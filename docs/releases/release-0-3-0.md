# Release 0.3.0

## Added

- A typed, page-wide event bus at
  `@lib-core-mfe/module-frontend/bus`, including synchronous delivery,
  optional bounded retention and replay, error reporting, event metadata, and
  diagnostics.
- React hooks at `@lib-core-mfe/module-frontend/client` for publishing with
  module source attribution and subscribing with automatic cleanup.
- Event bus integration, browser, and type-safety coverage.

The checked-in
[measurement script](../../scripts/measure-bus-size.mjs) reports the minified
and gzip sizes for the core and React hooks. The core is slightly above the
initial 1 KB gzip target because it includes the complete delivery contract.
`npm run measure:bus` reported 2,837 B minified / 1,294 B gzip for the core and
3,448 B minified / 1,552 B gzip for the hooks (React remains external).

See the [event bus guide](../guides/event-bus.md) and
[ADRs 0006–0007](../adr/README.md).
