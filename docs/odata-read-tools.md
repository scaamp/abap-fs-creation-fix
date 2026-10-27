# OData V4 read tools — MCP preview 2

First published together in **2.13.2 MCP preview 3**. [Live validation and installation](mcp-preview-validation.md) confirm authenticated metadata, collection reads and two direct expansions in the tested Cloud OAuth context.

Version **2.13.1** adds three small read tools alongside the abapGit preview. They reuse an **already connected Cloud OAuth** profile and resolve the actual runtime URL from an active published service binding. The initial scope is same-origin OData V4 with XML CSDL. Other authentication modes, separate API hosts, V2, filters, keyed paths, automatic paging and writes are not implemented by this preview.

| Tool | Input | Result |
| --- | --- | --- |
| `abapfs_odata_resolve_service` | `connectionId`, `bindingName`, optional `serviceVersion` | Canonical service path, protocol/publication facts and an opaque `serviceRef` |
| `abapfs_odata_get_metadata` | `connectionId`, `serviceRef` | Entity sets, scalar property types, keys, direct navigations and metadata hash |
| `abapfs_odata_query` | `connectionId`, `serviceRef`, `entitySet`, `select`, optional `top` and `expand` | Selected rows, HTTP status and remaining-page indicators |

The tools make GET requests only. They never publish or activate a service, invoke an action/function, change SAP data or switch to another identity after an authorization error. A successful metadata read does not prove data permissions or correct DCL isolation. Errors preserve a bounded, redacted HTTP response when available; raw SDK exception/configuration objects and credential headers are not returned.

## Connect, resolve and read

1. Connect to the intended SAP system through ABAP FS. Initial login/MFA and later reauthentication may still use the configured OAuth browser flow. HTTP data reads run in the extension host and do not automate the browser UI. Tools do not accept tokens, passwords, arbitrary URLs or headers.
2. Use the existing ABAP object search to find a service binding (`SRVB`), then call `resolve_service`. Supply the binding name, not a guessed service root or a service-definition name. If it has multiple versions, select the exact advertised version.
3. Call `get_metadata` with the returned `serviceRef`. Inspect the actual entity set, keys, scalar properties and navigation targets.
4. Call `query` with an explicit selection. For example, in a hypothetical model declaring `Headers`, `ID` and `_Items`:

```json
{
  "connectionId": "dev100",
  "serviceRef": "reference-returned-by-resolve-service",
  "entitySet": "Headers",
  "select": ["ID"],
  "top": 1,
  "expand": [
    {
      "navigation": "_Items",
      "select": ["ItemID"],
      "top": 1
    }
  ]
}
```

These names are examples; obtain real names from the target metadata. This is a collection read, not a keyed entity URL or free-form query string. Metadata is reread before a query so validation uses the current contract. Returned rows can contain business data: select only fields authorized and needed for the task.

## Bounds and session behavior

- A service reference expires after 15 minutes and is bound to the connection, client instance and origin. Restart/reconnect requires resolving again. At most 100 unexpired references are held in memory; none contain serialized credentials.
- Select 1–20 distinct scalar properties. Complex, binary and stream properties are outside this first preview.
- Root `top` defaults to 5, maximum 20. Expand at most two direct navigations with explicit selected properties; a collection defaults to 1 child, maximum 5. Nested expansions are not supported.
- Each HTTP response is limited to 512 KiB using the patched Axios transport, with redirects disabled. A 15-second HTTP timeout and a 25-second outer wait bound each read. The existing OAuth provider may outlive the outer timeout; reconnect through ABAP FS before retrying. There is no new unattended authentication subsystem in this preview.
- No automatic next-page reads. `hasMore` and `expandedHasMore` indicate remaining data; next-link URLs are not returned or followed. A future paging tool needs its own scoped cursor contract.
- Request `IEEE754Compatible=true`; Decimal/Int64 values must arrive as strings. Reject unsafe numeric representation rather than silently rounding financial data. Unselected response fields and annotations are removed from the returned rows.
- XML DTD/entities are rejected. External schema/vocabulary references are counted but never fetched. This is a single-document model reader, not a complete interpretation of every vocabulary, capability annotation or authorization rule. An unresolved required entity type fails explicitly.

Existing ADT credentials are scoped to the configured origin. A service on another API host requires a separate authentication design; this preview refuses it. Missing or expired login should be handled in Connection Manager, not by passing credentials to a model. A forbidden response is not permission to create roles or weaken DCL.

## ADT representation negotiation

The live spike found a V4 binding advertising a details representation V1 while its endpoint required V2 and returned HTTP 406 for V1. Resolve tries known ADT V2 representations first, with one V1 fallback only on 406. This representation version is distinct from OData protocol V4/4.0. No fallback publishes a service or changes configuration.

The accompanying API source patch 14 forwards optional `maxRedirects` and `maxContentLength` into Axios per-request options. Existing callers retain their previous defaults. This is necessary for enforcing bounds with the authenticated transport; merely checking response size after returning it would not constrain the download.

## Validation and next scope

A private read-only spike on an existing connected backend obtained HTTP 200 for XML metadata and a single-row key-only GET. A second spike obtained HTTP 200 with one child from each of two declared navigations, also selecting only keys. No business values were retained in its report, and no SAP business writes, activation or publication occurred. This establishes a useful integration path, not universal support for every backend/authentication configuration.

Automated regressions cover scoped service roots, expiring references, reconnects, publication/version checks, representation negotiation, type/selection validation, row bounds, expansion, Decimal/Int64 precision, unsafe redirects, login HTML, timeouts, cancellation and redacted errors. Integration through the actual MCP tools must be distinguished from a private helper; retain explicit evidence for each.

Install a candidate in a separate profile first, reload its MCP connection, then resolve/get metadata/query a small authorized dataset. In a clean profile, configure/login to SAP before using the tools. The preview retains the upstream extension identifier. Reinstall stable v5 to roll back the extension; neither installing nor rolling it back modifies SAP objects. Stable v5 does not contain these OData tools.

The next possible increments are controlled paging and filters, broader authentication profiles, and contract/authorization test tools. Batch, writes and draft actions remain separate work. The [feature research](potential-mcp-features.md) describes proposals and is not a catalogue of implemented capabilities.
