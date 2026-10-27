vi.mock("vscode", () => ({
  LanguageModelToolResult: class {
    constructor(public parts: unknown[]) {}
  },
  LanguageModelTextPart: class {
    constructor(public value: string) {}
  }
}))
vi.mock("../../adt/conections", () => ({ getClient: vi.fn() }))
vi.mock("../../config", () => ({ RemoteManager: { get: vi.fn() } }))
vi.mock("./toolGuard", () => ({ assertToolInvocationAuthorized: vi.fn() }))
vi.mock("./toolRegistry", () => ({ registerToolWithRegistry: vi.fn(() => ({ dispose() {} })) }))

import { readFileSync } from "fs"
import { ODataReadTool, odataReadToolNames, registerODataReadTools } from "./odataReadTools"
import { ODataReadService } from "../odataReadService"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { registerToolWithRegistry } from "./toolRegistry"
import { getClient } from "../../adt/conections"
import { RemoteManager } from "../../config"

describe("OData read tools", () => {
  beforeEach(() => vi.clearAllMocks())
  it("reloads evicted configuration without recreating an authenticated client", async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      body: '<serviceBinding version="active" published="false"><binding type="ODATA" version="V4"/></serviceBinding>',
      headers: { "content-type": "application/xml" }
    })
    vi.mocked(getClient).mockReturnValue({
      httpClient: { baseURL: "https://sap.example.invalid", client: "001", request }
    } as never)
    const byIdAsync = vi.fn().mockResolvedValue({
      url: "https://sap.example.invalid",
      client: "001",
      oauth: { clientId: "example" }
    })
    vi.mocked(RemoteManager.get).mockReturnValue({ byIdAsync } as never)
    registerODataReadTools({ subscriptions: [] } as never)
    const tool = vi
      .mocked(registerToolWithRegistry)
      .mock.calls.find(call => call[0] === "abapfs_odata_resolve_service")![1]
    const result = await tool.invoke(
      { input: { connectionId: "DEV100", bindingName: "ZEXAMPLE" } } as never,
      {} as never
    )
    expect(byIdAsync).toHaveBeenCalledWith("dev100")
    expect(getClient).toHaveBeenCalledWith("dev100", false)
    expect(request).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).toContain("NOT_PUBLISHED")
  })
  it("requires reconnect when settings and authenticated transport target differ", async () => {
    const request = vi.fn()
    vi.mocked(getClient).mockReturnValue({
      httpClient: { baseURL: "https://old.example.invalid", client: "001", request }
    } as never)
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: async () => ({
        url: "https://new.example.invalid",
        client: "001",
        oauth: { clientId: "example" }
      })
    } as never)
    registerODataReadTools({ subscriptions: [] } as never)
    const tool = vi
      .mocked(registerToolWithRegistry)
      .mock.calls.find(call => call[0] === "abapfs_odata_resolve_service")![1]
    expect(
      JSON.stringify(
        await tool.invoke(
          { input: { connectionId: "dev100", bindingName: "ZEXAMPLE" } } as never,
          {} as never
        )
      )
    ).toContain("CONNECTION_CHANGED")
    expect(request).not.toHaveBeenCalled()
  })
  it("registers three read-only MCP tools without credential, URL, header or body arguments", () => {
    registerODataReadTools({ subscriptions: [] } as never)
    expect(vi.mocked(registerToolWithRegistry).mock.calls.map(call => call[0])).toEqual([
      ...odataReadToolNames
    ])
    const manifest = JSON.parse(
      readFileSync(new URL("../../../../package.json", import.meta.url), "utf8")
    )
    for (const name of odataReadToolNames) {
      const tool = manifest.contributes.languageModelTools.find(
        (tool: { name: string }) => tool.name === name
      )
      expect(tool.tags).toContain("abap-fs")
      expect(tool.inputSchema.additionalProperties).toBe(false)
      const properties = Object.keys(tool.inputSchema.properties)
      expect(properties).not.toEqual(expect.arrayContaining(["url", "headers", "password", "body"]))
      expect(
        properties.some(name => /password|token|credential|url|header|body|filter/i.test(name))
      ).toBe(false)
    }
  })
  it("checks authorization inside invoke and forwards cancellation", async () => {
    const service = { getMetadata: vi.fn().mockResolvedValue({ httpStatus: 200 }) }
    const tool = new ODataReadTool(
      "abapfs_odata_get_metadata",
      service as unknown as ODataReadService
    )
    const input = { connectionId: "dev100", serviceRef: "example" }
    await tool.invoke({ input } as never, { isCancellationRequested: true } as never)
    expect(assertToolInvocationAuthorized).toHaveBeenCalled()
    expect(service.getMetadata.mock.calls[0][1]()).toBe(true)
    vi.mocked(assertToolInvocationAuthorized).mockImplementationOnce(() => {
      throw new Error("Unauthorized")
    })
    await expect(tool.invoke({ input } as never)).rejects.toThrow("Unauthorized")
    expect(service.getMetadata).toHaveBeenCalledTimes(1)
  })
  it("does not expose raw connection errors or unvalidated authentication contexts", async () => {
    registerODataReadTools({ subscriptions: [] } as never)
    const tool = vi
      .mocked(registerToolWithRegistry)
      .mock.calls.find(call => call[0] === "abapfs_odata_resolve_service")![1]
    vi.mocked(getClient).mockImplementationOnce(() => {
      throw new Error("password=private-secret at private-host")
    })
    const options = { input: { connectionId: "dev100", bindingName: "ZEXAMPLE" } }
    const result = await tool.invoke(options as never, {} as never)
    expect(JSON.stringify(result)).not.toMatch(/private-secret|private-host/)
    vi.mocked(getClient).mockReturnValue({} as never)
    vi.mocked(RemoteManager.get).mockReturnValue({
      byIdAsync: async () => ({ url: "https://sap.example.invalid", client: "001" })
    } as never)
    expect(JSON.stringify(await tool.invoke(options as never, {} as never))).toContain(
      "UNSUPPORTED_AUTH_CONTEXT"
    )
    expect(getClient).toHaveBeenCalledWith("dev100", false)
  })
})
