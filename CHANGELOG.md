# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Implement `moduleLifeCycleEvent.onMounted`, called once after the remote
  component commits and suppressed if rendering fails.
- Add a Provider/Consumer contract version to the manifest and remote entry.

### Breaking Changes

- Remove the unused `HEADERS`, `CACHE_KEYS`, and
  `ENDPOINTS.resolveProps` exports.
- Remove the unused `I18n` option from `Modularize` and `RemoteModuleEntry`.
- Contract-aware Consumers reject Providers that do not declare a compatible
  contract version.
