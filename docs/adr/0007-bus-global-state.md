# ADR 0007: Share a versioned event bus core globally

- Status: Accepted

## Context

Each independently bundled module can contain its own copy of this library.
Module-local state would prevent those copies from communicating. Sharing only
data while keeping separate dispatch implementations could also make behavior
differ between versions.

## Decision

- Create the global bus lazily on the first `createBus()` call, not at import
  time, to preserve tree-shaking and the package's `sideEffects: false`
  declaration.
- Store the complete core and its `BUS_CONTRACT_VERSION` on `globalThis` under
  `__MFE_BUS__`.
- Make later library copies delegate to the first core.
- Throw a descriptive error when a copy finds an incompatible contract
  version or an invalid core.
- Keep each returned handle's configured source local to that handle; an
  explicit per-publication source takes precedence.

## Consequences

- All bundles in one JavaScript realm share listeners, retention, and sequence
  numbers.
- The first copy to create the bus supplies the implementation used by later
  copies. Deployments should keep bus contract versions compatible.
- A contract mismatch fails fast instead of silently mixing incompatible state.
- The global is not created by importing the bus entry.
