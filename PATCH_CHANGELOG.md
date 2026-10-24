# Patched distribution changelog

## v2.12.0-adt-creation-fix.1 — 2026-10-24

- Base: upstream ABAP FS 2.12.0 and abap-adt-api 9.2.0; original MIT licenses and source history retained.
- Use the ADT class V4 media type and XML only when the class collection advertises V4. Preserve legacy creation for other systems and the separate DDLS contract.
- Preserve HTTP error bodies, headers and error markers in the communication log, with credential-header redaction.
- Include separate TypeScript source patches for Content-Type, class XML and diagnostics, with regression tests.
- Document VSIX installation/rollback, MCP instance routing, and existing/new transport selection without UI dialogs.
- Exclude generated `debug.log` from the VSIX. Restrict upstream Marketplace/Open VSX publishing workflows to the upstream repository.
- Make three existing number-formatting assertions locale-aware so the unchanged runtime can be tested on non-English Windows installations.

Validation: API build/typecheck and 298 Jest tests passed; extension build/typecheck, 89 focused tests, and the full suite of 4347 tests (256 files) passed. The original full suite's three locale-dependent failures motivated the test-only portability change above. Live class creation was verified through the wizard; successful MCP class creation was reported by the tester. DDLS and other object types are not claimed as fixed.
