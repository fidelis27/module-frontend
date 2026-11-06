# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Implement `moduleLifeCycleEvent.onMounted`, called once after the remote
  component commits and suppressed if rendering fails.

### Breaking Changes

- Remove the unused `HEADERS`, `CACHE_KEYS`, and
  `ENDPOINTS.resolveProps` exports.
- Remove the unused `I18n` option from `Modularize` and `RemoteModuleEntry`.
