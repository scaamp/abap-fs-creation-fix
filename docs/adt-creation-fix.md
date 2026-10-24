# ADT creation fix: changes, installation and verification

This repository distributes an unofficial patched ABAP FS 2.12.0 build. It retains the upstream source history, authorship and MIT license. It does not publish to the VS Code Marketplace or Open VSX. The original publishing workflows are restricted to the upstream repository.

## Download and install

Download the `.vsix` and `SHA256SUMS.txt` from [GitHub Releases](https://github.com/scaamp/abap-fs-creation-fix/releases/latest).

1. Open the intended VS Code profile.
2. Open Extensions (`Ctrl+Shift+X`), choose `...` → **Install from VSIX...**, and select the downloaded file.
3. Run **Developer: Reload Window**.
4. Configure your SAP connection on a new workstation. The VSIX contains no SAP connection configuration.
5. Restart/reconnect your MCP client and confirm which VS Code instance serves its configured endpoint.

The extension keeps the upstream identifier `murbani.vscode-abap-remote-fs` and version `2.12.0` so that it replaces the existing extension in the chosen profile. The GitHub release tag identifies the patched build. If VS Code refuses to replace the same version, run:

```powershell
code --install-extension .\abap-fs-2.12.0-adt-creation-fix.1.vsix --force
```

For a named profile, add `--profile "Profile name"`. The VSIX includes the patched API runtime: no local source checkout, Node.js or pnpm is needed on the destination workstation. Its declared VS Code requirement is `^1.105.0`; the existing dependencies `larshp.vscode-abap` and `hudakf.cds` are still required. An official extension update can replace this build.

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

Only the class XML contract changes. DDLS uses its own `ddl:ddlSource` representation and media contract. Shared creation code and shared SAP transformation dependencies justify investigating other object types, but do not establish that all failures have the same cause.

### HTTP diagnostics

Three issues hid failed responses: parsing an ADT exception dropped its raw HTTP response; the log converter dropped response body/headers; and the log record omitted its error marker. The patch preserves those details, including non-XML HTTP errors, and avoids inventing HTTP 501 for failures with no response.

Authorization, proxy authorization, cookies and CSRF token headers are redacted before entries reach the log panel. The logger exports a safe error marker instead of the raw error/config/parent object. CSRF headers are redacted only after session-error classification so recovery behavior is preserved. Application data in bodies still needs review before sharing logs.

## Source and dependency provenance

| Component | Upstream baseline | Changes in this repository |
| --- | --- | --- |
| ABAP FS | `ff705d6a25db8c90b24855caffdf42fc2bae7e2e` (2.12.0) | Extension source, log-panel test, docs and packaging exclusions |
| abap-adt-api | `d8d0bd91d40545c8ad8ee3d907254b78b0cbb861` (9.2.0) | Compiled dependency patch plus TypeScript source patches |

`pnpm-workspace.yaml` applies `patches/abap-adt-api@9.2.0.patch` to the pinned npm package, and `pnpm-lock.yaml` records the patch hash. The compiler/bundler then includes that runtime in the VSIX. The corresponding source changes and regression tests are available separately:

1. [Content-Type negotiation](../patches/source/01-class-content-type.patch): changes the header while retaining the old XML, with header tests.
2. [Class V4 XML](../patches/source/02-class-v4-xml.patch): apply after 01; changes the XML/context and adds XML tests.
3. [HTTP diagnostics](../patches/source/03-http-diagnostics.patch): independent of 01/02.

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

Multiple VS Code windows can run separate MCP servers. ABAP FS increments the requested port when it is occupied. A client configured for port 4847 can therefore still reach an older extension while a development host uses 4848. Use the actual endpoint displayed by the intended host; do not infer it from the window in which a chat was opened.

## Validation and limits

Verified locally on Node 24.13.0 with pnpm 12.4.1:

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
