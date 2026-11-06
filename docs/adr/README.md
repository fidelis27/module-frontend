# Architecture decision records

This directory records the architecture decisions that shape the library.
Accepted decisions describe the current behavior; a later ADR should supersede
one when the design changes.

| ADR                                    | Decision                                                                                    | Status   |
| -------------------------------------- | ------------------------------------------------------------------------------------------- | -------- |
| [0002](./0002-isolation-model.md)      | Use Shadow DOM for CSS isolation; do not imply JavaScript sandboxing                        | Accepted |
| [0003](./0003-contract-version.md)     | Version and validate the Provider/Consumer contract                                         | Accepted |
| [0004](./0004-cache-and-versioning.md) | Revalidate manifests without swapping mounted modules                                       | Accepted |
| [0005](./0005-security-model.md)       | Harden remote script loading with CORS, optional SRI enforcement, CSP nonces, and `nosniff` | Accepted |

ADRs are numbered sequentially. Keep decisions and consequences explicit, and
link implementation or operational guidance from the relevant ADR when
appropriate.
