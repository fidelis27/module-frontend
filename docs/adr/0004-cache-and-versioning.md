# ADR 0004: Revalidate manifests without swapping mounted modules

- Status: Accepted
- Decision date: 2026-11-05

## Context

The Consumer previously cached each manifest indefinitely. A page left open
could not learn that its Provider had deployed a newer bundle. At the same
time, silently replacing a registered module in place risks mixing versions of
the module's React runtime and context.

## Decision

Cache manifests for 60 seconds by default, configurable with `manifestTtlMs`.
`loadModule` deduplicates concurrent requests by URL and does not cache failed
requests. A value of `0` bypasses completed manifest cache entries and disables
automatic polling in `<Module>`.

While mounted, `<Module>` revalidates after each TTL interval. If the manifest
version differs from the first version observed for the `(host, appName)` pair,
it calls `onUpdateAvailable({ previous, current })` once per new version. It
does not load or mount the newer script when the current entry is already
registered.

The global registry intentionally follows *first registration wins*. A host
can decide to reload after receiving the callback; a reload is the supported
way to adopt the new module version.

## Consequences

- Long-lived pages can learn that an update is available without changing
  module code while it is in use.
- With the default TTL, each mounted module periodically makes a manifest
  request. Set `manifestTtlMs={0}` to disable automatic polling.
- A newer version requires a page reload to become active.
- The manifest fetch is aborted when the load timeout expires; failed fetches
  are removed from cache so a later attempt can recover.
