# ADR 0001: Register independently bundled modules on `window`

- Status: Accepted

## Context

The Provider packages a module as a JavaScript bundle. Calling `Modularize`
registers an entry on `window`, keyed by the application and module names. The
entry contains the component, `createRoot`, `createElement`, and the module's
`ModuleContext`. The Consumer downloads the manifest's scripts, finds that
entry, and mounts it with a separate React root.

The entry's React APIs come from the Provider bundle. When the Provider build
includes its own React and React DOM dependencies, it can use a runtime version
independent of the host's runtime. This is a build choice, not something the
library enforces: a bundler may instead externalize or share those dependencies.
Because the Consumer creates a separate React root, React context from the
host's root does not automatically flow into the remote component. The
Consumer supplies the Provider entry's `ModuleContext` explicitly.

## Decision

Use manifest-addressed JavaScript bundles and a `window` registry. Key each
entry by `appName` and module name, and keep the first registered entry for a
key so loading another script does not silently replace a component already in
use. Mount the entry through its own React root. A Provider that needs a React
version independent of the host must bundle that runtime into its module.

## Consequences

- The Consumer can discover and load modules from the Provider manifest
  without importing their source into the host build.
- A separately bundled React runtime can be used by a remote module, at the
  cost of including that runtime in the remote bundle.
- Host React context does not cross the Consumer-created root. Pass required
  host values as props or expose them through an explicit integration.
- The `window` registry is shared page state, not a sandbox. Remote scripts run
  in the host page's JavaScript realm.
- Module Federation, Custom Elements, and iframe mounting are not provided by
  this architecture.
