# module-frontend

A React micro-frontend library for publishing remote bundles through a dynamic
manifest and loading them as independently mounted modules. It does not use
Module Federation; Providers register module entries on `window`.

```sh
npm install @lib-core-mfe/module-frontend react react-dom
```

## Provider

Register each remote module in its bundle:

```tsx
import { Modularize } from "@lib-core-mfe/module-frontend/client";

type CartProps = { entityId: string };

export default Modularize(
  "cart",
  ({ entityId }: CartProps) => <p>{entityId}</p>,
  { appName: "shop" },
);
```

Build one IIFE bundle per module (for example, `dist/modules/cart.js`) and
serve the bundles and manifest:

```ts
import { serveModules } from "@lib-core-mfe/module-frontend/server";

app.use(
  serveModules({
    modulesPath: "./dist/modules",
    appName: "shop",
    corsOrigins: ["https://app.example.com"],
    include: ["cart", "profile"],
    exclude: ["profile"],
  }),
);
// GET /modules/__modules_configuration
```

`include` and `exclude` are optional exact-name filters. Without `include`,
every top-level `.js` bundle is published. `exclude` takes precedence and
prevents both manifest publication and direct script serving.

## Consumer

Pass the remote module's props as a type parameter for compile-time checking:

```tsx
import { Module } from "@lib-core-mfe/module-frontend/client";

type CartProps = {
  entityId: string;
  onActionEvent: (event: Event) => void;
};

<Module<CartProps>
  name="cart"
  host="https://provider.example.com"
  allowedHosts={["https://provider.example.com"]}
  entityId="42"
  onActionEvent={(event) => console.log(event)}
  manifestTtlMs={60_000}
  onUpdateAvailable={({ previous, current }) => {
    console.info(`Update available: ${previous} → ${current}`);
  }}
  loading={<Spinner />}
  fallback={<Unavailable />}
  onError={report}
/>;
```

Without an explicit type parameter, additional props remain accepted for
backwards compatibility. `moduleLifeCycleEvent.onMounted` runs once after the
remote component commits; `onCriticalFailure` reports remote render failures.

`fallback` can be a React node or a render function that receives `retry`.
Retry revalidates the manifest and reloads the remote script after a load or
render failure:

```tsx
<Module
  name="cart"
  host={HOST}
  fallback={({ retry }) => <button onClick={retry}>Try again</button>}
/>
```

## CSS isolation

Opt in to Shadow DOM style isolation with `isolateStyles`:

```tsx
<Module name="cart" host={HOST} allowedHosts={[HOST]} isolateStyles />
```

The host's CSS does not enter the module, and the module's CSS does not leak
into the host. CSS custom properties still cross the boundary intentionally.
JavaScript, `window`, storage, cookies accessible to JavaScript, and global
events are **not** isolated. Each module has its own React runtime because it
is bundled and mounted with its own root; this is separate from CSS isolation.

The Provider supplies module CSS as text so the Consumer can inject it into the
shadow root:

```tsx
Modularize("cart", Cart, { appName: "shop", styles: cssText }); // string or string[]
```

Stylesheets inserted in `document.head` (for example, by `style-loader`) do
not reach a shadow root. For isolated modules, emit CSS as text (such as Vite's
`?inline` or Webpack's `css-loader` `exportType: "string"`) and pass it through
`styles`. Portals should target the `shadowRoot` exposed by `ModuleContext`;
`ModuleContext.isolateStyles` indicates whether this mode is active.

The old `isolate` prop remains temporarily as a deprecated alias and warns
once. Use `isolateStyles`; the alias is scheduled for removal in version 1.0.
Shadow DOM is not a JavaScript security sandbox. See
[ADR 0002](./docs/adr/0002-isolation-model.md).

| Boundary                                                                        | Isolated?                                                            |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Host CSS selectors and module CSS selectors                                     | Yes                                                                  |
| CSS custom properties                                                           | No; they intentionally inherit across the boundary                   |
| JavaScript, `window`, storage, JavaScript-accessible cookies, and global events | No                                                                   |
| React runtime                                                                   | Only when the remote bundle includes its own React; unrelated to CSS |

## Event bus

Use the framework-independent `/bus` entry for typed events shared across
independently bundled modules, and the `/client` hooks from React components:

```ts
import { createBus } from "@lib-core-mfe/module-frontend/bus";
import { createBusHooks } from "@lib-core-mfe/module-frontend/client";

type AppEvents = {
  "nav:request": { path: string };
  "student:created": { id: string };
};

const bus = createBus<AppEvents>();
export const { usePublish, useSubscribe } = createBusHooks(bus);
```

`usePublish` attributes events to the current module; `useSubscribe` cleans up
on unmount. Delivery is synchronous. Retention and replay are opt-in:
`publish(channel, payload, { ttl })` retains an event and
`subscribe(channel, handler, { replay: true })` replays unexpired events.
Handler errors do not stop delivery to other subscribers. See the
[event bus guide](./docs/guides/event-bus.md) and
[ADRs 0006–0007](./docs/adr/README.md).

## Trust and security

Remote scripts execute with the privileges of the host page. `allowedHosts` is
a trust allowlist, not a sandbox; by default only same-origin modules are
allowed. For cross-origin runtime diagnostics, the Consumer loads scripts
with `crossOrigin="anonymous"`, so the Provider must allow the Consumer origin
through `corsOrigins`.

The Provider publishes SHA-384 SRI hashes. The Consumer applies available
hashes; set `requireIntegrity` to reject modules without hashes. SRI detects
script bytes that do not match a trusted manifest, but it does not protect
against a compromised Provider that can change both the script and manifest.
Pass `nonce` to `<Module>` for CSP; it is applied to remote scripts and
injected shadow-root styles. Manifest and JavaScript responses include
`X-Content-Type-Options: nosniff`. See
[ADR 0005](./docs/adr/0005-security-model.md).

## Contract compatibility

Provider and Consumer validate contract version `1` in both the manifest and
the registered entry. Consumers reject Providers with a missing or
incompatible contract before attempting to mount the module. Upgrade both
sides together. Increment `CONTRACT_VERSION` for incompatible manifest or
entry changes. See [ADR 0003](./docs/adr/0003-contract-version.md).

| Library version | Contract     | Compatibility                                    |
| --------------- | ------------ | ------------------------------------------------ |
| `0.1.x`         | Not declared | Rejected by Consumers that validate the contract |
| `0.2.x`         | `1`          | Compatible with other modules using contract `1` |

## Manifest cache and updates

Manifests are cached for 60 seconds by default. While mounted, `<Module>`
revalidates after each TTL interval and calls `onUpdateAvailable` once per new
version with `{ previous, current }`. Setting `manifestTtlMs={0}` disables
automatic polling and bypasses completed manifest cache entries on subsequent
loads.

A newly published version does not replace a module already mounted on the
page. The global registry uses _first registration wins_ to avoid mixing
React runtimes and contexts; reload the page to activate an update. See
[ADR 0004](./docs/adr/0004-cache-and-versioning.md).

## Development

```sh
npm run typecheck      # TypeScript
npm run lint           # ESLint and React Hooks rules
npm run format         # Apply Prettier
npm run format:check   # Check formatting
npm test               # Unit and integration tests
npm run test:browser   # Real Chromium browser tests (CHROMIUM_PATH if needed)
npm run build          # ESM, CJS, and declaration bundles
npm run measure:bus    # Minified/gzip size of the bus and hooks
npm run check:package  # Build, publint, attw, and npm pack --dry-run
```

CI runs the unit and integration tests against React 18 and React 19. See the
[ADR index](./docs/adr/README.md) for the architecture decisions.
