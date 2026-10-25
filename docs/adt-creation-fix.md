# ADT creation fix: changes, installation and verification

This repository distributes unofficial patched builds based on ABAP FS 2.12.0. It retains the upstream source history, authorship and MIT license. It does not publish to the VS Code Marketplace or Open VSX. The original publishing workflows are restricted to the upstream repository.

## Download and install

Download the `.vsix` and `SHA256SUMS.txt` from [GitHub Releases](https://github.com/scaamp/abap-fs-creation-fix/releases/latest).

The current [creation fix 5](https://github.com/scaamp/abap-fs-creation-fix/releases/tag/v2.12.4-adt-creation-fix.5) fixes unnecessary transport prompts/request creation for local Cloud packages. It retains the API/XML changes from 2.12.3, whose [23-type live audit](adt-creation-matrix.md) remains documented separately. The new package-policy check was verified read-only; this release did not create SAP objects or transports.

1. Open the intended VS Code profile.
2. Open Extensions (`Ctrl+Shift+X`), choose `...` → **Install from VSIX...**, and select the downloaded file.
3. Run **Developer: Reload Window**.
4. Configure your SAP connection on a new workstation. The VSIX contains no SAP connection configuration.
5. Restart/reconnect your MCP client and confirm which VS Code instance serves its configured endpoint.

The extension keeps the upstream identifier `murbani.vscode-abap-remote-fs` so that it replaces the existing extension in the chosen profile. This build uses version `2.12.4` and display name **ABAP remote filesystem (ADT creation fix 5)**. The earlier class-only release used `2.12.0`. If necessary, install it explicitly:

```powershell
code --install-extension .\abap-fs-2.12.4-adt-creation-fix.5.vsix --force
```

For a named profile, add `--profile "Profile name"`. The VSIX includes the patched API runtime: no local source checkout, Node.js or pnpm is needed on the destination workstation. Its declared VS Code requirement is `^1.105.0`; the existing dependencies `larshp.vscode-abap` and `hudakf.cds` are still required. An official extension update can replace this build.

## Current release: creation fix 5

Extension version **2.12.4**, release `v2.12.4-adt-creation-fix.5`, reads the target package's `pak:recordChanges` flag before creation transport selection. When explicitly `false`, both the wizard and MCP skip CTS selection, dialogs and transport creation, and object creation has no `corrNr`. A local Cloud package does not have to be named `$TMP` or use component `LOCAL`.

When recording is enabled, the existing CTS/transport-selection flow is retained. Missing metadata or an unavailable package read retains the previous fallback; it is not treated as proof of locality. Existing-object editing and transport locks are unchanged. The flag is read afresh from the same SAP connection.

For a read-only preflight, invoke `abapfs_get_creation_diagnostics` with `connectionId` and `packageName`. The returned `package.recordChanges` is `false`, `true`, or `null` if unknown. This uses the same function as the creator, without SAP writes or transport creation. Do not set `startLogging` unless communication capture is wanted.

The [23-type creation audit](adt-creation-matrix.md) was performed for 2.12.3; it is not a claim that all live writes were repeated for 2.12.4. The API runtime/source patches are unchanged. The current correction is verified with regression tests and read-only checks against local and transportable Cloud packages, followed by an isolated packaged-VSIX smoke check.

No workstation profile, connection credentials or private SAP identifiers are distributed in the VSIX. Other SAP versions still require their own verification; backend authorization limits are not bypassed. The historical candidate sections below describe their original scope.

## What changed

The original library sends object creation requests with `Content-Type: application/*`. Classes also use the generic XML seed, which differs from an Eclipse ADT V4 class creation request.

| Field | Original class seed | Patched class V4 seed |
| --- | --- | --- |
| Content-Type | `application/*` | `application/vnd.sap.adt.oo.classes.v4+xml`, only when advertised by the class collection |
| Language | Preserves caller casing | Uppercase logon/request language and master language |
| Class properties | Missing | `class:final="true"`, `class:visibility="public"` |
| Test include | Missing | `class:include` with `class:includeType="testclasses"` |
| Superclass reference | Missing | Empty `class:superClassRef` |
| Backend owner | Defaults to the logon string | Does not infer an ABAP owner from an email alias |
| Master system | Optional caller value | Optional caller value, never inferred from a connection label |

Discovery is read before the class POST. Systems that do not advertise class V4 retain the legacy representation. A discovery failure stops creation. The creation function does not retry an unsuccessful POST. Explicit backend owner/master system values remain supported; when omitted, their handling belongs to the authenticated backend. The verification scope below does not establish every backend's behavior for those omitted fields.

The initial class fix changed the class XML contract. The historical DDLS candidates below were scoped separately; creation fix 4 extends negotiation and common-owner handling as described in the audit.

### DDLS candidate `.2`: header only (tester reported deserialization failure)

An authenticated failed DDLS creation request supplied by the tester used `Content-Type: application/*` and returned `ExceptionUnsupportedMediaType` (`SADT_RESOURCE/039`). The object was confirmed absent by the tester. The installed build matched the published class-only VSIX; this DDLS failure was outside its scope.

For `DDLS/DF`, the candidate now sends `application/vnd.sap.adt.ddlSource+xml` to `/sap/bc/adt/ddic/ddl/sources`. The case-sensitive, singular `ddlSource` media type is used by the [adtler implementation](https://github.com/Hochfrequenz/adtler/blob/main/adt/object.go) and the [pinned DDLS client constants](https://github.com/fr0ster/mcp-abap-adt-clients/blob/b7990e7df4bc735679a9cdc08c0031fb500e8509/src/constants/contentTypes.ts). It is not derived by replacing slashes in the endpoint URL. The change is in the shared API creator used by the wizard and MCP; it does not depend on an Axios interceptor.

The DDLS XML, language casing and owner handling are deliberately unchanged in this header-only candidate. No class includes or superclass references are added. Package and transport still come from the request context. An unsuccessful POST is not retried. A later deserialization error must be investigated separately against the DDLS transformation/Eclipse trace. This candidate has not yet passed a live DDLS creation test and does not claim to fix all object types.

### DDLS candidate `.3`: owner contract

After installing `.2`, the tester reported `SDDIC_ST_ADT_DDLS` deserialization failure from the ordinary creation wizard. This is a different stage from the earlier unsupported-media response. The tester could not obtain a new HTTP trace because the communication log showed no entries.

Read-only inspection of the backend transformation chain established `SDDIC_ST_ADT_DDLS` → `SADT_ABAP_SOURCE_MAIN_OBJECT` → `SADT_MAIN_OBJECT`. The shared owner maps to `IF_ADT_TOOLS_CORE_TYPES=>TY_MAIN_OBJECT-RESPONSIBLE`, of DDIC type `RESPONSIBL`/domain `AS4USER`, `CHAR(12)`. The previously supplied request contained a login email longer than that field; the wizard and MCP creator both assign the login string to this attribute. This is a concrete contract violation, consistent with the deserialization error. Without the latest detailed exception or a successful controlled creation, the exact failing node and complete live fix remain unconfirmed.

Patch 05 changes only DDLS owner serialization. Values exceeding 12 characters, including the reported login alias, are omitted, never truncated or replaced with a hardcoded user. Empty/blank owners are omitted too. Names that fit the field remain supported and retain the existing uppercase handling; no speculative character restrictions are added. The shared transformation makes this owner attribute conditional; omitting it leaves handling to the authenticated backend. The backend resource controller was also inspected read-only and defaults missing creation/change users to its authenticated user. No raw SAP implementation source or private identifiers are redistributed here.

The DDLS media type from patch 04, root, namespace, language casing, master-system handling and package/transport inputs are unchanged. The candidate does not copy class includes, add speculative DDLS source types/templates, or retry creation. The tester also reported table and data-element unsupported-media failures in another probe; their HTTP trace/build identity was unavailable, and their contracts are not fixed by this DDLS change. No all-object fix is claimed.

### HTTP diagnostics

Three issues hid failed responses: parsing an ADT exception dropped its raw HTTP response; the log converter dropped response body/headers; and the log record omitted its error marker. The patch preserves those details, including non-XML HTTP errors, and avoids inventing HTTP 501 for failures with no response.

Authorization, proxy authorization, cookies and CSRF token headers are redacted before entries reach the log panel. The logger exports a safe error marker instead of the raw error/config/parent object. CSRF headers are redacted only after session-error classification so recovery behavior is preserved. Application data in bodies still needs review before sharing logs.

Candidate `.3` also normalizes communication-log connection IDs to lowercase, matching the connection manager. Previously a configured name such as `DEV100` could miss a logger activated for URI authority `dev100`, silently dropping requests before the panel. Activation is still required after a window reload; opening the panel alone does not enable collection. This routing fix has regression tests, but its live effect on the tester's empty panel has not yet been verified.

## Source and dependency provenance

| Component | Upstream baseline | Changes in this repository |
| --- | --- | --- |
| ABAP FS | `ff705d6a25db8c90b24855caffdf42fc2bae7e2e` (2.12.0) | Extension source, log-panel test, docs and packaging exclusions |
| abap-adt-api | `d8d0bd91d40545c8ad8ee3d907254b78b0cbb861` (9.2.0) | Compiled dependency patch plus TypeScript source patches |

`pnpm-workspace.yaml` applies `patches/abap-adt-api@9.2.0.patch` to the pinned npm package, and `pnpm-lock.yaml` records the patch hash. The compiler/bundler then includes that runtime in the VSIX. The corresponding source changes and regression tests are available separately:

1. [Content-Type negotiation](../patches/source/01-class-content-type.patch): changes the header while retaining the old XML, with header tests.
2. [Class V4 XML](../patches/source/02-class-v4-xml.patch): apply after 01; changes the XML/context and adds XML tests.
3. [HTTP diagnostics](../patches/source/03-http-diagnostics.patch): independent of 01/02.
4. [DDLS Content-Type](../patches/source/04-ddls-content-type.patch): apply after 01–03; header-only DDLS correction and regression tests.
5. [DDLS owner](../patches/source/05-ddls-owner.patch): apply after 04; omit owners that violate the separate DDLS/common-core contract, with boundary and alias tests.

The source patches apply to a clean API baseline. They are included for review and upstream contribution; the normal extension build needs only `pnpm install --frozen-lockfile` and `pnpm build`. No npm package or Marketplace publication is performed by this repository.

## MCP transport selection without a dialog

Creation through MCP already supports a noninteractive transport choice. Include the following fragment in the `abapfs_create_object` arguments:

```json
{
  "additionalOptions": {
    "transportRequest": {
      "type": "existing",
      "number": "DEVK900123"
    }
  }
}
```

To request a new transport, use `{"type":"new","description":"Synthetic integration test"}` instead. Transport creation requires an explicit user instruction and SAP permissions. The helper checks local-package requirements and existing locks. If `transportRequest` is omitted, creation can open the ordinary VS Code transport picker, leaving the MCP call waiting for user input. This behavior is separate from the V4 fix.

Candidate `.3` retains the selected transport even when the ordinary UI picker is used. Previously the wrapper only captured a choice supplied through `additionalOptions.transportRequest`; a UI choice was lost from its result. The MCP formatter then incorrectly called an empty/undefined result “local — no transport required.” It now reports a number as **requested**, or says the backend assignment has not been verified. A selected or absent `corrNr` does not prove the final backend assignment. This explains the reporting defect; it does not establish which selection or backend mechanism produced any particular existing assignment. No transport was created, changed or released while preparing the fix.

Multiple VS Code windows can run separate MCP servers. ABAP FS increments the requested port when it is occupied. A client configured for port 4847 can therefore still reach an older extension while a development host uses 4848. Use the actual endpoint displayed by the intended host; do not infer it from the window in which a chat was opened.

## Validation and limits

The following results describe release `.1`. Current candidate results are recorded in PATCH_CHANGELOG.md. Verified locally on Node 24.13.0 with pnpm 12.4.1:

- API typecheck and build: PASS. Jest: 19 suites, 298 tests PASS. Existing integration helpers return early without `ADT_URL`; those counts do not represent live SAP coverage.
- Extension typecheck, build and VSIX packaging: PASS.
- Focused extension tests for creation, the communication log and transport selection: 89/89 PASS.
- The original full extension suite on Polish Windows had 4344 PASS and three failures in `systemOneService.test.ts` assertions that hardcoded English number separators. This distribution makes those three expectations locale-aware without changing runtime behavior. The final full suite passed: 256 test files, 4347 tests.
- Source patches applied to a clean API checkout with `git apply --whitespace=error-all`: PASS.
- Live class wizard: a single synthetic class creation POST returned HTTP 200; a separate SAP read confirmed the class, generated source and requested transport assignment. No activation was performed by the agent.
- MCP class creation: the tester reported success after directing MCP to the patched instance. The agent did not independently execute that MCP creation. The transport picker appeared when no programmatic transport choice was supplied.
- DDLS creation, other object creation types, older SAP systems and productive use: not verified live. No broad all-object fix is claimed.

## Isolated F5 test and rollback

Build first, then use an Extension Development Host with its own extension/profile directories and a test workspace. Before a SAP write, confirm that the development extension is loaded, verify the target system/client, package and transport, enable ADT Communication Log, and use one fresh object name. Check existence after any ambiguous response before another POST. Keep Content-Type-only and XML changes separate when investigating causality; the combined successful test does not identify which change was decisive.

To roll back an installed patched build, reinstall the official 2.12.0 VSIX (using `--force` if needed) or use **Install Another Version**, then reload VS Code and reconnect MCP. For an isolated host, stop debugging and close the host. Rolling back the extension does not remove SAP objects or release transports.

### Manual DDLS verification (requires separate SAP-write approval)

1. Install the candidate only in an isolated profile/development host. Verify version `2.12.2` and its candidate display name; restart the MCP client and check its endpoint.
2. Confirm the connection/system/client and inspect the selected test package configuration. Supply an existing transport only when required by that package; do not create or release a transport implicitly.
3. Choose a fresh synthetic DDLS name, for example `ZI_ADT_MEDIA_TEST01`, verify that it is absent, and approve that exact creation before calling `abapfs_create_object` with `objectType: "DDLS/DF"` and explicit `packageName`. Do not reuse a business object as a diagnostic test.
4. After reload, explicitly activate ADT Communication Log for the connection. First confirm that an ordinary read creates an entry. For an approved creation, inspect the log: exactly one POST to the DDLS collection, Content-Type `application/vnd.sap.adt.ddlSource+xml`, DDLS root/namespace, no overlength owner attribute and no class XML. Review the real HTTP status and response body, with credentials redacted.
5. Read back metadata/source and inspect inactive objects after either success or failure. Do not retry an ambiguous POST. Activation and cleanup require their own authorized scope. This header test does not require uploading source or activating the object.
6. If a transformation error follows, preserve the sanitized response and obtain the equivalent Eclipse DDLS creation trace before changing XML. Roll back by reinstalling the saved `.1` VSIX/official VSIX with `--force`, reload the window and reconnect MCP; verify the loaded version. Rolling back the extension does not remove SAP objects.
