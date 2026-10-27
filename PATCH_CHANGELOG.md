# Patched distribution changelog

## v2.13.2-mcp-preview.3 — 2026-10-27

- Add an explicit **ABAP FS: Configure abapGit credentials** command to the Command Palette and repository context menu. Reuse the existing credential prompts and profile SecretStorage without entering the commit/push workflow. Wait for storage writes before reporting success; no secrets in MCP arguments or results.
- Refresh restored abapGit repositories whenever the user registers them in Source Control. Await loading, open Source Control and report sanitized errors. Normalize connection ID casing to avoid duplicate repository/SCM entries.
- Point MCP `AUTH_REQUIRED` at the explicit setup command. Retain all OData/read and reviewed commit+push guards from preview 2. No new SAP write or Git push is triggered by credential setup or registration.

Validation: **4462 tests / 264 files PASS**, build/typecheck and formatting PASS. The packaged VSIX was exercised in an isolated host and installed in the intended user profile. Live MCP verified exact two-file prepare/commit+push with independent GitHub commit/content checks, clean post-export staging, authenticated V4 metadata, three collections and two direct expansions (HTTP 200). See [validation and limits](docs/mcp-preview-validation.md). This prerelease retains stable creation fix 5 as the stable download.

## 2.13.1 MCP preview 2 — 2026-10-26 (local candidate, included in preview 3)

- Retain the eight abapGit preview tools and add only three OData tools: resolve an existing service binding, read runtime metadata and query a bounded collection with optional direct expansions.
- Limit this first OData implementation to active published V4 bindings and an already connected same-origin Cloud OAuth profile. No arbitrary URLs/headers, publication, actions/functions, filters, automatic paging or SAP writes.
- Validate explicit scalar selections against freshly read XML CSDL, bound parent/child rows and remove unselected values. Require safe Decimal/Int64 string representation; do not silently round amounts.
- Bind expiring service references to the client/connection/origin. Reject redirects, DTD/entities, unresolved required schemas and unexpected HTML login pages. Bound and redact HTTP diagnostics without exporting SDK credential/configuration objects.
- Add API source patch 14 to forward optional redirect and response-size limits to Axios without changing old defaults. Negotiate known ADT binding/details representations, including the V1/V2 discrepancy observed by the live spike.
- Private live spikes verified authenticated metadata/data reads and a two-navigation key-only expansion. These are read-only checks, distinct from the eventual MCP/packaged-VSIX acceptance test; no business data was changed.

## 2.13.0 abapGit MCP preview 1 — 2026-10-26 (local candidate, included in preview 3)

- Add eight MCP/LM tools for backend repositories, capabilities, serialized status/diffs, remote refs, exact commit preparation, combined commit+push and persisted attempt metadata. Reuse the existing ADT adapter; no Eclipse automation or direct calls to external Git services.
- Keep the backend semantics explicit: preparing is not committing; remote refs are not a local object fetch; standalone commit, merge, import and branch mutation are not exposed.
- Bind a single-use, expiring review to exact files, identities, message, repository and remote SHA. Recheck serialized content, staging and backend-visible inactive changes before submission. Block unintended deletions and changed reviews; preserve unselected files. There is no backend atomic compare-and-swap guarantee against concurrent clients.
- Record attempts before POST; return accepted/unknown without inventing a completed commit or retrying an ambiguous request. Reuse VS Code secret storage without credential tool parameters or hidden prompts.
- API source patch 13 escapes abapGit XML and preserves a distinct committer and multiline message. Redact abapGit credential headers and password XML from request logs.
- Candidate version/display name distinguish the preview from stable creation fix 5. Automated tests do not establish live export compatibility; no SAP import, activation or Git push is performed during implementation.

## v2.12.4-adt-creation-fix.5 — 2026-10-25

- Fix creation transport selection for local Cloud packages whose component is not the classic `LOCAL`. Read `pak:recordChanges` from the actual package before choosing or creating a transport. Explicit `false` skips the picker for the wizard and both MCP transport modes, including an otherwise explicit new-request choice.
- Do not infer locality from a package/component name. Read failure or a missing flag preserves the previous CTS selection path. Existing-object transport handling and locks are unchanged; package metadata is not cached between operations.
- Extend read-only creation diagnostics with optional `packageName`; `package.recordChanges` is `true`, `false` or `null` when unknown. The tool uses the same function as creation selection and does not enable logging unless requested.
- Add regressions for UI/MCP routing, no transport-creation side effects, omitted `corrNr` in actual class/CDS API requests, unknown metadata, namespaced packages and existing-object locks.
- Preserve all API/XML fixes from creation fix 4. The previous 23-type live audit remains historical evidence for 2.12.3. This release's package-policy check was verified read-only against local and transportable Cloud packages; no SAP objects or transports were created, edited, activated, published or deleted for this release.

Validation: build/typecheck PASS, **4379 tests / 259 files PASS** (including 15 new regressions). Read-only checks in an isolated Development Host confirmed `recordChanges=false` for a local Cloud package and `true` for a transportable Cloud package. No new live creation/activation test was performed for this release.

## v2.12.3-adt-creation-fix.4 — 2026-10-25

- Audit all 23 registered creation types. Live creation and independent verification passed for 20. DDLA, programs and standalone includes reached backend authorization denials (HTTP 403); they are not claimed as successful creation tests.
- Select exact per-collection XML media types from discovery. Add separately verified DDLA and function-group include fallbacks. Keep header fixes separate from XML/source patches.
- Enforce the common 12-character owner contract; resolve the required package owner from authenticated system information instead of a login email. No fixed system, user or transport identifiers are added.
- Fix package self-reference, inherited change-recording/language context and validation parameter spelling. Preserve explicit MCP package inputs, function include suffixes and requested binding categories.
- Add read-only sanitized creation diagnostics with extension identity and runtime type/discovery information. Retain HTTP response-body logging and requested-versus-verified transport reporting.
- Document the complete audit, installation, MCP instance checks, inactive-object verification and rollback. Ordinary installed extensions and the application repository were not modified. Only synthetic SAP fixtures were created; one approved test service definition was edited/activated to permit binding creation. No binding was published and no transport was created or released.

Validation: API build/typecheck and **367 tests / 23 suites PASS**. Extension full suite **4364 tests / 258 files PASS**; build/typecheck and formatting pass. All 12 source patches apply to the pinned upstream baseline and reproduce the tested source. Detailed live results and limitations: [creation matrix](docs/adt-creation-matrix.md).

## v2.12.2-adt-creation-fix.3-candidate — 2026-10-25

- Read-only backend inspection confirmed the DDLS/common-core owner maps to `RESPONSIBL`/`AS4USER`, `CHAR(12)`. Omit blank owners and owners over 12 characters in DDLS XML, including the reported login alias. Preserve names that fit the field; do not truncate, invent character restrictions or hardcode identity.
- Keep the DDLS header correction separate (source patch 04) from this owner/XML correction (patch 05). Leave DDLS root, language casing, other XML fields and other creation contracts unchanged.
- Normalize communication-log connection IDs so configured uppercase names match lowercase URI authorities. Explicitly activate logging after reload.
- Capture the UI-selected transport in programmatic creation results. Replace the false “local — no transport required” message with requested/unverified assignment reporting.
- Version `2.12.2` and display name identify candidate `.3`. No SAP writes, activation, transport changes or installed-extension changes were performed during its preparation.

Validation: API typecheck/build and 318 tests in 20 suites passed. Extension typecheck/build, 61 focused tests and the full suite of 4356 tests in 257 files passed. Formatting and source patch 05 apply checks passed. Live DDLS creation and live log recovery remain unverified. Table/data-element unsupported-media failures remain outside this patch.

## v2.12.1-adt-creation-fix.2-candidate — 2026-10-25

Tester subsequently reported DDLS deserialization failure with this header-only candidate. Superseded by candidate `.3`; do not treat `.2` as a verified DDLS fix.

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
