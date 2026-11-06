# ADR 0003: Version the Provider/Consumer contract

- Status: Accepted
- Decision date: 2026-11-05

## Context

The Consumer invokes `createRoot`, `createElement`, `ModuleContext`, and
`Component` from an entry registered by a remote Provider. These values formed
an implicit runtime contract. Different library versions could therefore fail
at mount time with confusing errors.

## Decision

Publish `CONTRACT_VERSION` in both the module manifest and each registered
entry. The Consumer validates the manifest before downloading a script, then
validates the entry's version and required shape before using it. Missing or
unsupported versions produce an actionable error through the normal loading
failure path.

The current contract is version `1`. Increment it whenever an incompatible
change is made to the manifest or registered entry shape.

## Consequences

- Provider and Consumer mismatches are detected before React attempts to mount
  the remote component.
- New Consumers intentionally reject older Providers that do not publish a
  contract version; both sides must be upgraded together.
- The manifest field and entry field are both checked: the manifest avoids
  downloading an obviously incompatible bundle, while the entry protects
  against stale or malformed script registrations.
- Compatible contract changes do not require a version increment.
