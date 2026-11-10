# ADR 0005: Harden remote script loading

- Status: Accepted
- Decision date: 2026-11-05

## Context

Remote modules are executable third-party JavaScript. They run in the host
page's JavaScript realm and can use the browser APIs available to that page.
The host allowlist limits which origins may provide code, but does not sandbox
that code. The global registry and mounting boundary are described in
[ADR 0001](./0001-module-registry.md).

## Decision

- Load scripts with `crossOrigin="anonymous"` so cross-origin runtime errors
  can include useful diagnostics. Providers must enable CORS for Consumer
  origins through `corsOrigins`.
- Generate SHA-384 SRI values for each bundle and publish them in the manifest.
  Consumers apply hashes when present; `requireIntegrity` makes their presence
  mandatory and defaults to `false` for optional enforcement.
- Accept a CSP `nonce` on `loadModule` and `<Module>`, and apply it to injected
  scripts and Shadow DOM styles.
- Send `X-Content-Type-Options: nosniff` with manifests and JavaScript bundles.

SRI compares downloaded script bytes with an expected hash. It can detect
unexpected changes to a bundle when the manifest is trusted independently of
the script bytes. It does not protect against a compromised Provider that can
change both the script and its manifest hash.

## Consequences

- Cross-origin Provider deployments must configure CORS correctly.
- `allowedHosts` is a trust decision, not an isolation boundary.
- A remote module has the host page's JavaScript privileges. Strong isolation
  requires a separate execution context such as a carefully designed iframe;
  that is outside this decision.
- `requireIntegrity` provides opt-in enforcement. It should be enabled only
  when the Provider publishes correct hashes and the manifest source is trusted.
