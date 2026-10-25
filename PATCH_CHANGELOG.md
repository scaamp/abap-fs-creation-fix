# Patched distribution changelog

## v2.12.1-adt-creation-fix.2-candidate — 2026-10-25

- Correct the DDLS/DF creation Content-Type to `application/vnd.sap.adt.ddlSource+xml`; preserve DDLS XML and other object contracts.
- Keep this header-only change separate from the earlier class V4 XML patch. Include API tests for headers, unchanged XML, context, no retry and unaffected object types, plus a regression test against the extension's installed API dependency.
- Use extension version `2.12.1` and a visible candidate display name to distinguish the VSIX from release `.1`/official `2.12.0`.
- Document the authenticated unsupported-media failure, exact scope, isolated manual test and rollback. No SAP object was created or modified during this diagnosis.

Validation: API build/typecheck and 309 tests in 20 suites passed. Extension build/typecheck and 4348 tests in 257 files passed. The DDLS source patch passed `git apply --check --whitespace=error-all` against the previously patched API baseline. Live DDLS creation has not been tested; no all-object fix is claimed.

## v2.12.0-adt-creation-fix.1 — 2026-10-24

- Base: upstream ABAP FS 2.12.0 and abap-adt-api 9.2.0; original MIT licenses and source history retained.
- Use the ADT class V4 media type and XML only when the class collection advertises V4. Preserve legacy creation for other systems and the separate DDLS contract.
- Preserve HTTP error bodies, headers and error markers in the communication log, with credential-header redaction.
- Include separate TypeScript source patches for Content-Type, class XML and diagnostics, with regression tests.
- Document VSIX installation/rollback, MCP instance routing, and existing/new transport selection without UI dialogs.
- Exclude generated `debug.log` from the VSIX. Restrict upstream Marketplace/Open VSX publishing workflows to the upstream repository.
- Make three existing number-formatting assertions locale-aware so the unchanged runtime can be tested on non-English Windows installations.

Validation: API build/typecheck and 298 Jest tests passed; extension build/typecheck, 89 focused tests, and the full suite of 4347 tests (256 files) passed. The original full suite's three locale-dependent failures motivated the test-only portability change above. Live class creation was verified through the wizard; successful MCP class creation was reported by the tester. DDLS and other object types are not claimed as fixed.
