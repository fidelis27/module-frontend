# Documentation

Start with the [English README](../README.md) or
[Portuguese README](../README.pt-BR.md) for installation and usage, then follow
its development section to run project checks.

## Architecture and decisions

The [ADR index](./adr/README.md) explains the module registry, contract, CSS
isolation, cache, event bus, and security decisions. The README's threat-model
section summarizes runtime security boundaries.

## Guides

- [Event bus (English)](./guides/event-bus.md)
- [Event bus (Português)](./guides/event-bus-pt-br.md)

## Release history

[`CHANGELOG.md`](../CHANGELOG.md) is the canonical change history. Use its
release section when preparing GitHub release notes; the publish workflow does
not generate release notes. The [0.2.0 release notes](./releases/release-0-2-0.md)
and [0.3.0 release notes](./releases/release-0-3-0.md) summarize releases. The
[archive index](./archive/README.md) links to superseded documents retained for
reference.

## How to publish a version

Publish a GitHub Release with a `vX.Y.Z` tag matching `package.json`. The
[publish workflow](../.github/workflows/publish.yml) runs on the
published-release event, checks that tag/version match, installs dependencies,
type-checks, tests, builds, then publishes to npm with provenance and public
access. `npm publish` also runs the package's `prepublishOnly` script. The
workflow requires npm publishing credentials in GitHub Actions.

## How to maintain this documentation

Update the existing document before creating one. New active documents must fit
this index and be linked here in the same commit; record architecture decisions
as numbered ADRs. Keep both READMEs in section parity, avoid duplicated content
and facts that age, and run `npm run check:docs` before committing.

## Competencies demonstrated

| Competency                             | Evidence                                                                                                                                     | How to verify                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| React and TypeScript                   | [Public client exports](../src/client/index.ts), [shared types](../src/shared/types.ts)                                                      | Run `npm run typecheck`                               |
| Micro-frontend architecture            | [Provider registry](../src/client/Modularize.tsx), [Consumer loader](../src/client/loadModule.ts), [ADR 0001](./adr/0001-module-registry.md) | Run `npm test -- tests/e2e/provider-consumer.test.ts` |
| Componentization                       | [Client entry point](../src/client/index.ts), [server entry point](../src/server/index.ts)                                                   | Inspect the public subpath exports                    |
| Automated testing                      | [Vitest configuration](../vitest.config.ts), [integration test](../tests/e2e/provider-consumer.test.ts)                                      | Run `npm test`                                        |
| CI and build automation                | [CI workflow](../.github/workflows/ci.yml), [tsup configuration](../tsup.config.ts)                                                          | Run `npm run build` and inspect CI                    |
| Versioning and releases                | [Changelog](../CHANGELOG.md), [publish workflow](../.github/workflows/publish.yml)                                                           | Check the release tag against `package.json`          |
| Manifest caching and on-demand loading | [Consumer loader](../src/client/loadModule.ts)                                                                                               | Inspect TTL handling and script insertion             |
| Dependency and package boundaries      | [Package metadata](../package.json)                                                                                                          | Inspect peer dependencies, exports, and `files`       |
