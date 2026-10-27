import * as vscode from "vscode"
import { getClient } from "../../adt/conections"
import { RemoteManager } from "../../config"
import { ODataReadError } from "../odataModel"
import {
  ODataReadService,
  odataReadFailure,
  type ODataQueryInput,
  type ODataServiceInput,
  type ResolveODataInput
} from "../odataReadService"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { registerToolWithRegistry } from "./toolRegistry"

export const odataReadToolNames = [
  "abapfs_odata_resolve_service",
  "abapfs_odata_get_metadata",
  "abapfs_odata_query"
] as const
type ToolName = (typeof odataReadToolNames)[number]
type Input = ResolveODataInput & ODataServiceInput & ODataQueryInput

export class ODataReadTool implements vscode.LanguageModelTool<Input> {
  constructor(
    private name: ToolName,
    private service: ODataReadService
  ) {}
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<Input>,
    token?: vscode.CancellationToken
  ) {
    assertToolInvocationAuthorized(options)
    let result: unknown
    const cancelled = () => !!token?.isCancellationRequested
    try {
      switch (this.name) {
        case "abapfs_odata_resolve_service":
          result = await this.service.resolve(options.input, cancelled)
          break
        case "abapfs_odata_get_metadata":
          result = await this.service.getMetadata(options.input, cancelled)
          break
        case "abapfs_odata_query":
          result = await this.service.query(options.input, cancelled)
          break
      }
    } catch (error) {
      result = odataReadFailure(error)
    }
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(result))
    ])
  }
}

export function registerODataReadTools(context: vscode.ExtensionContext) {
  const service = new ODataReadService({
    connection: async id => {
      const client = getClient(id, false)
      const conf = await RemoteManager.get().byIdAsync(id)
      if (!conf?.oauth || (conf.authMethod && conf.authMethod !== "basic"))
        throw new ODataReadError(
          "UNSUPPORTED_AUTH_CONTEXT",
          "This preview uses an already connected Cloud OAuth profile. Connect in ABAP FS first; other authentication modes are not validated."
        )
      const http = client.httpClient
      if (
        new URL(http.baseURL).origin !== new URL(conf.url).origin ||
        String(http.client || "") !== String(conf.client || "")
      )
        throw new ODataReadError(
          "CONNECTION_CHANGED",
          "Connection settings changed; reconnect before reading OData"
        )
      return {
        identity: client,
        baseUrl: http.baseURL,
        sapClient: http.client,
        request: (path, options) => http.request(path, options)
      }
    }
  })
  for (const name of odataReadToolNames)
    context.subscriptions.push(registerToolWithRegistry(name, new ODataReadTool(name, service)))
}
