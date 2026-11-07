> Archived: this duplicate release note was retained for historical reference
> on 2026-11-07. It is not maintained; `CHANGELOG.md` is the canonical change
> history.

# Archived duplicate release notes for 0.2.0

`0.2.0` adds reliability, compatibility checks, and security controls for
remote modules. This release requires Provider and Consumer to use compatible
contract-aware versions.

## Highlights

- Add `moduleLifeCycleEvent.onMounted`, called once after the remote component
  commits and suppressed if rendering fails.
- Publish and validate a Provider/Consumer contract version in the manifest
  and registered entry.
- Revalidate manifests periodically and notify hosts when an update is
  available without replacing the mounted module.
- Add CSP nonce support, cross-origin script loading, SHA-384 SRI generation
  and optional enforcement, and `nosniff` headers.
- Add `isolateStyles` for Shadow DOM CSS isolation and expose the mode and root
  through `ModuleContext`.
- Support retry actions from Consumer fallbacks after loading or render
  failures.
- Add generic prop typing for `<Module>` and exact-name `include`/`exclude`
  filters for Provider bundles.
- Add ESLint, Prettier, package export/type checks, and CI coverage for React
  18 and React 19.

## Breaking changes and migration

- Upgrade Provider and Consumer together. Contract-aware Consumers reject
  Providers that do not publish contract version `1`.
- Remove the unused `HEADERS`, `CACHE_KEYS`, and `ENDPOINTS.resolveProps`
  exports, plus the unused `I18n` option from `Modularize` and
  `RemoteModuleEntry`.
- Rename `<Module isolate>` to `<Module isolateStyles>`. The old prop remains
  temporarily as a deprecated alias and warns once; it is planned for removal
  in version `1.0`.

## Notes

- Update notifications do not replace a module already mounted in the page;
  reload the page to activate the published version.
- Shadow DOM isolates CSS, not JavaScript. Remote scripts execute with the
  host page's privileges.
- See the [ADR index](../adr/README.md) and [changelog](../../CHANGELOG.md)
  for architecture details and the complete change history.
