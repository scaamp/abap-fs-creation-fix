import * as vscode from "vscode"
import { CreatableTypes } from "abap-adt-api"
import { XMLParser } from "fast-xml-parser"
import { CallLogger, getLogEntries } from "../../adt/adtCommLog"
import { getClient } from "../../adt/conections"
import { registerToolWithRegistry } from "./toolRegistry"
import { assertToolInvocationAuthorized } from "./toolGuard"

interface Parameters {
  connectionId: string
  startLogging?: boolean
}

interface Collection {
  "@_href"?: string
  "app:accept"?: string | string[]
}
const array = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value]

export function creationCollections(body: string) {
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(body) as {
    "app:service"?: { "app:workspace"?: { "app:collection"?: Collection | Collection[] }[] }
  }
  return array(parsed["app:service"]?.["app:workspace"]).flatMap(workspace =>
    array(workspace["app:collection"]).map(collection => ({
      path: collection["@_href"] || "",
      accepts: array(collection["app:accept"]).filter(
        value => typeof value === "string" && value.length > 0
      )
    }))
  )
}

function isCreationPath(url: string) {
  const segments = url
    .split(/[?#]/, 1)[0]
    .replace(/^\/sap\/bc\/adt\//, "")
    .split("/")
  return [...CreatableTypes.values()].some(type => {
    const expected = type.creationPath.split("/")
    return (
      expected.length === segments.length &&
      expected.every((value, i) => value === "%s" || value === segments[i])
    )
  })
}

// Odczyt kontraktów i śladów tworzenia; bez zapisu w SAP i bez credentiali w nagłówkach.
export class CreationDiagnosticsTool implements vscode.LanguageModelTool<Parameters> {
  constructor(private context: vscode.ExtensionContext) {}

  async invoke(options: vscode.LanguageModelToolInvocationOptions<Parameters>) {
    assertToolInvocationAuthorized(options)
    const connectionId = options.input.connectionId.toLowerCase()
    if (options.input.startLogging) CallLogger.getOrCreate(connectionId)
    const response = await getClient(connectionId).httpClient.request("/sap/bc/adt/discovery")
    const collections = creationCollections(response.body)
    const types = [...CreatableTypes.values()].map(type => ({
      type: type.typeId,
      path: "/sap/bc/adt/" + type.creationPath,
      root: type.rootName,
      maxLength: type.maxLen
    }))
    const creationLog = getLogEntries()
      .filter(
        entry =>
          entry.connId.toLowerCase() === connectionId &&
          entry.method.toUpperCase() === "POST" &&
          isCreationPath(entry.url)
      )
      .map(entry => ({
        id: entry.id,
        url: entry.url,
        contentType: Object.entries(entry.requestHeaders || {}).find(
          ([name]) => name.toLowerCase() === "content-type"
        )?.[1],
        requestBody: entry.requestBody,
        status: entry.status,
        responseBody: entry.responseBody,
        error: entry.error,
        transportRequested: entry.params?.corrNr
      }))
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        JSON.stringify({
          extensionId: this.context.extension.id,
          version: this.context.extension.packageJSON.version,
          development: this.context.extensionMode === vscode.ExtensionMode.Development,
          logging: CallLogger.getActiveConnIds().includes(connectionId),
          types,
          collections,
          creationLog
        })
      )
    ])
  }
}

export function registerCreationDiagnosticsTool(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    registerToolWithRegistry(
      "abapfs_get_creation_diagnostics",
      new CreationDiagnosticsTool(context)
    )
  )
}
