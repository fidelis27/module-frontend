# ADR 0001: Register independently bundled modules on `window`

- Status: Accepted
- Decision date: 2026-11-07

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
The end-to-end test builds separate IIFEs with bundled dependencies and
verifies that the remote component mounts through its registered entry.

Because the Consumer creates a separate React root, React context from the
host's root does not automatically flow into the remote component. The
Consumer supplies the Provider entry's `ModuleContext` explicitly; applications
can pass other required values through the remote module's props.

## Options considered

| Approach                                  | Fit for this library                                                                                                     | Trade-offs                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-module bundles registered on `window` | Selected: matches the manifest-and-script loading path and lets each bundle provide the APIs used to mount its component | Bundle size can increase when modules include their own React dependencies; host React context does not cross the separate root                                               |
| Module Federation                         | Not used: it is not required for the current manifest and registry contract                                              | Can support shared dependencies and runtime integration, but introduces a different federation and dependency-sharing model                                                   |
| Custom Elements                           | Not used as the module registration and mounting API                                                                     | Provides a browser component interface; it does not, by itself, create a separate JavaScript realm or React runtime                                                           |
| Iframe                                    | Not part of the current runtime                                                                                          | Creates a separate browsing context, but mounting and interacting with React modules would require a messaging and lifecycle integration that this library does not implement |

## Decision

Use manifest-addressed JavaScript bundles and a `window` registry. Key each
entry by `appName` and module name, and keep the first registered entry for a
key so loading another script does not silently replace a component already in
use. Mount the entry through its own React root. A Provider that needs a React
version independent of the host must bundle that runtime into its module.

## Consequences

- The Consumer can discover and load modules from the Provider manifest without
  importing their source into the host build.
- A separately bundled React runtime can be used by a remote module, at the
  cost of including that runtime in the remote bundle.
- Host React context does not cross the Consumer-created root. Pass required
  host values as props or expose them through an explicit integration.
- The `window` registry is shared page state, not a sandbox. Remote scripts run
  in the host page's JavaScript realm.
- Module Federation, Custom Elements, and iframe mounting are not provided by
  this architecture.

## Evidence

- `src/client/Modularize.tsx` creates the entry, includes React mounting APIs,
  and registers it under a key derived from `appName` and module name.
- `src/client/loadModule.ts` loads manifest scripts and reads the registered
  entry from `window`.
- `src/client/Module.tsx` creates a separate root and supplies the entry's
  `ModuleContext`.
- `tests/client/Modularize.test.tsx` covers registration and first-entry
  behavior; `tests/e2e/provider-consumer.test.ts` builds and loads remote IIFEs.
