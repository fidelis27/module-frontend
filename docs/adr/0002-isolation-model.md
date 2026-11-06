# ADR 0002: Use Shadow DOM for CSS isolation

- Status: Accepted
- Decision date: 2026-11-05

## Context

Remote modules need predictable styles without implying that their JavaScript
is sandboxed. The old `isolate` prop did not make this boundary clear.

## Options considered

| Approach          | CSS isolation                        | JavaScript isolation                                                            | Trade-offs                                                                                                                   |
| ----------------- | ------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Shadow DOM        | Yes, for selectors and style scoping | No; page globals are shared                                                     | Lightweight, supports portals through `shadowRoot`, and keeps a single page/runtime                                          |
| Iframe            | Yes                                  | Can provide a separate browsing context when sandboxed and configured carefully | Stronger boundary, but requires a messaging protocol and decisions about navigation, storage, focus, sizing, and permissions |
| Custom Elements   | Depends on using Shadow DOM          | No                                                                              | Useful component lifecycle and browser integration, but does not independently isolate JavaScript                            |
| Module Federation | No inherent CSS boundary             | No; modules normally share a page/runtime                                       | Useful for shared dependencies and integration, but is not a security sandbox and is not used by this library                |

## Decision

Use Shadow DOM for the opt-in `isolateStyles` behavior. Keep the module in the
same page and expose its root through `ModuleContext` for portals and styles.
The name explicitly limits the promise to styles. Keep `isolate` as a
deprecated alias that warns once and remove it in version 1.0.

Do not implement an iframe mode in this change. A genuinely stronger boundary
would need a carefully sandboxed iframe, restrictive CSP, explicit permission
decisions, and a validated `postMessage` protocol; merely moving the component
into an iframe would not be sufficient.

## Consequences

- CSS selectors are scoped in both directions, while custom properties cross
  the boundary intentionally.
- JavaScript, globals, storage, cookies, and events remain shared with the host.
- Each module's React version remains independent because it is bundled with
  that module and mounted using its own root; this is separate from CSS
  isolation.
- Consumers needing stronger isolation must use a separate execution context.

Future consideration: Should a sandboxed iframe mode be proposed separately?
