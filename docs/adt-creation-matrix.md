# Creation contract audit — 2026-10-25

This audit covers all **23 creation types registered by this extension**: the 22 library entries and the runtime BDEF registration. It does not claim support for every repository type in SAP. Tests created fresh synthetic objects in one ABAP Cloud development system, through the shared wizard/MCP creator in an isolated Extension Development Host. No business objects were changed.

## Transport selection correction in 2.12.4

The live table below records the 2.12.3 creation audit. Version 2.12.4 retains that API runtime and corrects a separate transport-selection problem: the previous selector only recognized the classic local component marker, so a local Cloud package could prompt for a request even though SAP did not assign the created object to it. Choosing “new transport” in that unnecessary dialog could leave an empty request.

The new creator reads the target package's explicit `pak:recordChanges` setting. `false` skips selection, dialogs and transport creation in both the wizard and MCP, even if MCP supplied a transport choice. `true` or unknown metadata preserves the previous CTS path. Existing-object writes and locks are unchanged. Tests verify absent `corrNr` for class and CDS requests. The same check can be invoked read-only through diagnostics with `packageName`; `null` means unknown. Live read-only checks confirmed the distinction between a local Cloud package and a transportable Cloud package. No SAP writes or transport mutations were performed for 2.12.4.

## Request differences and fixes

Headers and XML were tested separately. With the original XML, replacing a wildcard/URL-derived media type with the exact collection's advertised XML type changed many HTTP 415 responses into transformation errors. Omitting a login alias longer than the shared `RESPONSIBL`/`AS4USER` CHAR(12) field then allowed creation. Each type retains its own XML root and namespace; DCL, DDLS and BDEF are not serialized as classes.

- Class V4 remains conditional on the class collection advertising V4. It has uppercase languages, public/final properties, a test-classes include and an empty superclass reference.
- Other types use an XML media type advertised by their exact collection in ADT discovery. Duplicate collections and absolute collection URLs are handled. HTML/JSON are excluded. The existing legacy path remains when no XML type is advertised, except the three separately verified fallback contracts: DDLS, DDLA and function-group includes.
- DDLA uses `application/vnd.sap.adt.ddic.ddla.v1+xml`, verified against its backend properties handler; this system omits the discovery accept entry. Function-group includes use the server-reported `application/vnd.sap.adt.functions.fincludes.v2+xml`.
- Common metadata omits blank/overlong owners, without truncation or substituting a fixed user. Valid short owners remain supported and are XML-escaped. Package creation requires an explicit owner, so an invalid login alias is resolved from the **same connection's** `/core/http/systeminformation` response. It never copies the parent package's owner.
- Packages reference their own requested name, retain their chosen superpackage/component/layer, and inherit change recording and language version from the actual superpackage metadata. Validation sends `transportlayer` with the spelling expected by SAP and retains `recordChanges=false` when applicable.
- MCP supplies function-group include suffixes and explicit package options without an extra UI selection. Service binding XML retains the requested category instead of always writing category 0. Existing UI and explicit transport choices remain supported; the tool reports a requested transport separately from backend verification.

The corresponding API source patches are separated in `patches/source/06` through `12`; earlier patches preserve the class and HTTP-diagnostics changes. The complete chain applies to the pinned upstream API source. The pnpm patch includes the compiled runtime and updated declarations.

## Live results

Creation is distinct from filling source, checking syntax, activating or publishing an object. Successful rows below mean the creation request succeeded and the object was independently read back or identified in the inactive-object list. Fresh inactive objects may be absent from quick search; search alone is not evidence that creation failed.

| Type | Result after fixes |
| --- | --- |
| CLAS/OC | Created |
| INTF/OI | Created |
| DDLS/DF | Created |
| DCLS/DL | Created |
| BDEF/BDO | Created |
| TABL/DT | Created |
| TABL/DS | Created |
| DTEL/DE | Created |
| DOMA/DD | Created |
| TTYP/DA | Created |
| DDLX/EX | Created |
| SRVD/SRV | Created |
| SRVB/SVB | Created; OData V2 UI category preserved; not published |
| MSAG/N | Created |
| AUTH | Created |
| SUSO/B | Created |
| FUGR/F | Created |
| FUGR/FF | Created |
| FUGR/I | Created; confirmed by the inactive-object list |
| DEVC/K | Created; owner resolved from the authenticated session, parent settings retained |
| DDLA/ADF | HTTP 403: not authorized to create Annotation Definitions |
| PROG/P | HTTP 403: S_DEVELOP authorization denied |
| PROG/I | HTTP 403: S_DEVELOP authorization denied |

The total is **20 created types and 3 backend authorization denials**. The three HTTP 403 results are backend authorization limits in the tested environment, not successful creation tests. This patch does not grant permissions or bypass SAP restrictions. Live compatibility with other SAP releases and OData V4 binding creation has not been established.

An approved test service definition was the only fixture explicitly edited and activated. An empty service is invalid in this backend, so the fixture exposes the existing language reference view. Its syntax check returned no findings and activation succeeded for that single definition. The binding remained unpublished. Other fixtures were left in the state produced by creation; no transports were created or released and no fixtures were deleted automatically. Extension rollback does not delete SAP fixtures; review and remove them separately in ADT if desired.

## Diagnostics and manual verification

`abapfs_get_creation_diagnostics` is a read-only MCP tool. With `connectionId` and optional `startLogging: true`, it reports extension identity/version/development mode, runtime creation types, discovered media types and in-memory creation traces for that connection. Returned request headers are restricted to Content-Type; only the requested transport query parameter is included. Authorization, Cookie and CSRF headers are excluded. Request/response bodies may contain object metadata: review and sanitize them before sharing. Legacy wildcard requests can still be rewritten by the upstream transport interceptor; the trace records the API-request header before that interceptor.

1. Install the VSIX in the intended profile, disable automatic updates for this extension if needed, and reload that window. Reconnect the MCP client so it reaches that process. Check the diagnostic tool's version and development flag; another open VS Code process may expose a different build.
2. Choose a fresh synthetic name, an explicitly verified package, and an existing authorized transport only when change recording requires it. For MCP use the exact creation subtype, e.g. `DCLS/DL` or `DDLS/DF`.
3. Enable the communication log before creating. Create once. Record Content-Type, XML, HTTP status/body and returned URI. Never share credential headers.
4. Read the URI back, including inactive state when necessary. Check the exact object's transport status. Do not retry merely because quick search is empty.
5. Test filling source and activation separately, with appropriate dependencies and authorization. Binding creation requires an already active service definition. The VSIX does not publish bindings automatically.

For local source debugging, build first and launch an Extension Development Host with separate `--user-data-dir` and `--extensions-dir` directories. Set a distinct MCP port in that test workspace. Authenticate in the test host; do not copy credentials into source or launch configuration.

Rollback: uninstall this build in the target profile, reinstall the saved previous VSIX (or the official Marketplace build), reload that window and reconnect MCP. Connections remain profile data; no credentials or workstation settings are included in the distributed VSIX.
