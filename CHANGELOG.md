# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.3.0-rc.1] - 2026-11-10

### Added

- Add a typed global event bus with optional retention and replay, isolated
  handler errors, event metadata, and diagnostics.
- Add React hooks for publishing with module source attribution and
  subscribing with automatic cleanup.
- Document event bus usage, integration limits, and migration guidance.

See the [0.3.0 release notes](./docs/releases/release-0-3-0.md).

## [0.2.0] - 2026-11-06

See the [0.2.0 release notes](./docs/releases/release-0-2-0.md).

### Added

- Implement `moduleLifeCycleEvent.onMounted`, called once after the remote
  component commits and suppressed if rendering fails.
- Add a Provider/Consumer contract version to the manifest and remote entry.
- Revalidate manifests every 60 seconds by default and notify hosts when a new
  Provider version is available without replacing the mounted module.
- Add CSP nonces, cross-origin script loading, optional SRI enforcement, and
  `nosniff` response headers.
- Add the explicit `isolateStyles` prop and expose that mode through
  `ModuleContext`; keep `isolate` temporarily as a deprecated alias.
- Allow `fallback` to render a retry action that revalidates the manifest and
  reloads the remote script after load or render failures.
- Add generic prop typing for `<Module>` and exact-name `include`/`exclude`
  filters to `serveModules`; exclusions take precedence.

### Breaking Changes

- Remove the unused `HEADERS`, `CACHE_KEYS`, and
  `ENDPOINTS.resolveProps` exports.
- Remove the unused `I18n` option from `Modularize` and `RemoteModuleEntry`.
- Contract-aware Consumers reject Providers that do not declare a compatible
  contract version.
