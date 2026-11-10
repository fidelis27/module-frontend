# module-frontend

A React micro-frontend library for publishing remote bundles through a dynamic
manifest and loading them as independently mounted modules. Providers register
module entries on `window`; the library does not use Module Federation.

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

type CartProps = { entityId: string; onActionEvent: (event: Event) => void };

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
The shadow host starts with `:host { all: initial; display: block }`, so
inherited host styles such as fonts and colors are reset.
JavaScript, `window`, storage, cookies accessible to JavaScript, and global
events are **not** isolated. The module uses an independent React runtime only
when its Provider bundle includes React and React DOM; this build choice is not
enforced by the library.

The Provider supplies module CSS as text so the Consumer can inject it into the
shadow root:

```tsx
Modularize("cart", Cart, { appName: "shop", styles: cssText }); // string or string[]
```

Stylesheets inserted in `document.head` (for example, by `style-loader`) do
not reach a shadow root. For isolated modules, emit CSS as text (such as Vite's
`?inline` or `exportType: "string"` in legacy Webpack `css-loader` setups) and
pass it through `styles`. Portals should target the `shadowRoot` exposed by
`ModuleContext`; `ModuleContext.isolateStyles` indicates whether this mode is
active.

| Boundary                                                                        | Isolated?                                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Host CSS selectors and module CSS selectors                                     | Yes                                                                            |
| CSS custom properties                                                           | No; they intentionally inherit across the boundary                             |
| JavaScript, `window`, storage, JavaScript-accessible cookies, and global events | No                                                                             |
| React runtime                                                                   | Only when the remote bundle includes its own React; unrelated to CSS isolation |

The old `isolate` prop remains temporarily as a deprecated alias and warns
once. Use `isolateStyles`; the alias is scheduled for removal in version 1.0.
Shadow DOM is not a JavaScript security sandbox. See
[ADR 0002](https://github.com/fidelis27/module-frontend/blob/main/docs/adr/0002-isolation-model.md).

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

## Guarantees and limits

- **Allowlist:** by default, only the page's same origin is accepted; add
  other origins to `allowedHosts`. Loading a remote script executes third-party
  code in the host page.
- **Cache:** scripts use `?v=<hash>` and immutable caching; the manifest is
  served with `no-cache`.
- **Defaults:** `basePath` is `/modules`, `corsOrigins` is empty, the manifest
  TTL is 60 seconds, and module loading times out after 15 seconds.
- **React runtime:** an independent React runtime is possible when the remote
  bundle includes its own React; the Provider build controls this.
- **React context:** context from the host's React root does not cross into the
  separately mounted remote root; pass required values as props or through an
  explicit integration.
- **CSS isolation:** enabled only by `<Module isolateStyles />`.
- **Failures:** network, timeout, missing-module, and render errors reach
  `onError`; failed manifest and script requests are not retained in cache.
- **Integrity:** SRI hashes are applied when present; `requireIntegrity`
  defaults to `false` and makes hashes mandatory when enabled.

## Contract compatibility

Provider and Consumer validate contract version `1` in the manifest and
registered entry. A missing or incompatible contract is reported through the
Consumer's `onError` path. Upgrade Provider and Consumer together, and
increment `CONTRACT_VERSION` for incompatible manifest or entry changes. See
[ADR 0003](https://github.com/fidelis27/module-frontend/blob/main/docs/adr/0003-contract-version.md).

| Checked value                    | Where            | Behavior                              |
| -------------------------------- | ---------------- | ------------------------------------- |
| Contract version                 | Manifest         | Checked before downloading scripts    |
| Contract version and entry shape | Registered entry | Checked before mounting the component |

## Manifest cache and updates

Manifests are cached for 60 seconds by default. While mounted, `<Module>`
revalidates after each TTL interval and, when `onUpdateAvailable` is supplied,
notifies once per newly observed Provider version with `{ previous, current }`.
Setting `manifestTtlMs={0}` disables automatic polling and bypasses completed
manifest cache entries on subsequent loads.

A newly published version does not replace a module already mounted on the
page. The global registry uses _first registration wins_ to avoid silently
replacing its React runtime and context; reload the page to activate an update.
The explicit fallback `retry` action is for recovery after a failure, not
routine version adoption. See
[ADR 0004](https://github.com/fidelis27/module-frontend/blob/main/docs/adr/0004-cache-and-versioning.md).

## Threat model

Remote scripts execute with the privileges of the host page and can access
`window`, storage, JavaScript-accessible cookies, and APIs available to the
host. `allowedHosts` is a trust allowlist, not a sandbox. Shadow DOM isolates
CSS, not JavaScript.

The Consumer loads scripts with `crossOrigin="anonymous"` for cross-origin
runtime diagnostics; the Provider must allow the Consumer origin through
`corsOrigins`. `serveModules` publishes SHA-384 SRI hashes. Set
`requireIntegrity` to reject modules without hashes. SRI detects script bytes
that differ from a trusted manifest, but it does not protect against a
compromised Provider that can change both the bundle and its manifest.

Pass `nonce` to `<Module>` for CSP; it is applied to remote scripts and
injected shadow-root styles. Manifest and JavaScript responses include
`X-Content-Type-Options: nosniff`. See
[ADR 0005](https://github.com/fidelis27/module-frontend/blob/main/docs/adr/0005-security-model.md).

## Development

```sh
npm run typecheck
npm run lint
npm run format
npm run format:check
npm run check:docs
npm test
npm run test:browser
npm run build
npm run measure:bus
npm run check:package
```

The CI workflow runs the quality checks, tests against supported React
versions, and the real-browser suite. See the
[ADR index](https://github.com/fidelis27/module-frontend/blob/main/docs/adr/README.md)
and [documentation index](https://github.com/fidelis27/module-frontend/blob/main/docs/README.md).
