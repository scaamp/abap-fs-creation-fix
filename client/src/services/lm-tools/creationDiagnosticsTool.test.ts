vi.mock("vscode", () => ({
  ExtensionMode: { Development: 2 },
  LanguageModelToolResult: class {
    constructor(public parts: unknown[]) {}
  },
  LanguageModelTextPart: class {
    constructor(public value: string) {}
  }
}))
vi.mock("../../adt/conections", () => ({ getClient: vi.fn() }))
vi.mock("../../adt/adtCommLog", () => ({
  CallLogger: { getOrCreate: vi.fn(), getActiveConnIds: vi.fn(() => ["dev100"]) },
  getLogEntries: vi.fn(() => [])
}))
vi.mock("./toolGuard", () => ({ assertToolInvocationAuthorized: vi.fn() }))
import { CreationDiagnosticsTool, creationCollections } from "./creationDiagnosticsTool"
import { getClient } from "../../adt/conections"
import { CallLogger, getLogEntries } from "../../adt/adtCommLog"

const discovery = `<app:service><app:workspace><app:collection href="/sap/bc/adt/ddic/ddl/sources"><app:accept>application/vnd.sap.adt.ddlSource+xml</app:accept><app:accept>application/xml</app:accept></app:collection></app:workspace></app:service>`

describe("creation diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getClient).mockReturnValue({
      httpClient: { request: vi.fn().mockResolvedValue({ body: discovery }) }
    } as any)
    vi.mocked(getLogEntries).mockReturnValue([])
  })

  it("reads singleton workspaces and multiple accepts without deriving media types from paths", () => {
    expect(creationCollections(discovery)).toEqual([
      {
        path: "/sap/bc/adt/ddic/ddl/sources",
        accepts: ["application/vnd.sap.adt.ddlSource+xml", "application/xml"]
      }
    ])
  })

  it("handles absent collections and empty accepts", () => {
    expect(creationCollections("<app:service/>")).toEqual([])
    expect(
      creationCollections(
        '<app:service><app:workspace><app:collection href="/test"><app:accept/></app:collection></app:workspace></app:service>'
      )
    ).toEqual([{ path: "/test", accepts: [] }])
  })

  it("returns only same-connection creation logs and never exports credential headers", async () => {
    const base = {
      id: 1,
      connId: "DEV100",
      method: "POST",
      url: "/sap/bc/adt/ddic/ddl/sources",
      requestHeaders: {
        "Content-Type": "application/xml",
        Authorization: "secret",
        Cookie: "secret",
        "x-csrf-token": "secret"
      },
      requestBody: "<ddl:ddlSource/>",
      responseBody: "<exception/>",
      status: 400,
      error: true,
      params: { corrNr: "DEVK900123", secret: "secret" }
    }
    vi.mocked(getLogEntries).mockReturnValue([
      base,
      { ...base, connId: "other" },
      { ...base, url: "/sap/bc/adt/cts/transports" }
    ] as any)
    const tool = new CreationDiagnosticsTool({
      extension: { id: "example", packageJSON: { version: "test" } },
      extensionMode: 2
    } as any)
    const result = await tool.invoke({
      input: { connectionId: "DEV100", startLogging: true }
    } as any)
    const text = (result as any).parts[0].value
    const data = JSON.parse(text)
    expect(data.creationLog).toHaveLength(1)
    expect(data.creationLog[0]).toMatchObject({
      contentType: "application/xml",
      status: 400,
      responseBody: "<exception/>",
      transportRequested: "DEVK900123"
    })
    expect(text).not.toContain("secret")
    expect(data.development).toBe(true)
    expect(CallLogger.getOrCreate).toHaveBeenCalledWith("dev100")
    expect(getClient).toHaveBeenCalledWith("dev100")
  })
})
