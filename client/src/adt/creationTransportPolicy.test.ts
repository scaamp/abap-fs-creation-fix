import { ADTClient } from "abap-adt-api"
import { funWindow as window } from "../services/funMessenger"
import {
  packageChangeRecording,
  pickTransportProgrammatically,
  selectTransport
} from "./AdtTransports"

vi.mock("vscode", () => ({ ProgressLocation: { Notification: 15 } }))
vi.mock("../services/funMessenger", () => ({
  funWindow: {
    showQuickPick: vi.fn(),
    showInputBox: vi.fn(),
    showInformationMessage: vi.fn()
  }
}))
vi.mock("../lib", () => ({ fieldOrder: () => () => 0, withp: vi.fn() }))
vi.mock("../api", () => ({}))
vi.mock("./conections", () => ({ uriRoot: vi.fn(), getClient: vi.fn() }))
vi.mock("abapfs", () => ({ isAbapStat: vi.fn(), isAbapFolder: vi.fn() }))

const path = "/sap/bc/adt/oo/classes/zexample"
function setup(recordChanges?: string) {
  const client = {
    getObjectSource: vi
      .fn()
      .mockResolvedValue(
        `<pak:package xmlns:pak="http://www.sap.com/adt/packages"><pak:attributes ${recordChanges === undefined ? "" : `pak:recordChanges="${recordChanges}"`}/><pak:transport><pak:softwareComponent pak:name="ZLOCAL"/></pak:transport></pak:package>`
      ),
    transportInfo: vi.fn().mockResolvedValue({
      DLVUNIT: "ZLOCAL",
      DEVCLASS: "ZPACKAGE",
      OBJECT: "CLAS",
      OBJECTNAME: "ZEXAMPLE",
      TRANSPORTS: [{ TRKORR: "DEVK900123", AS4TEXT: "Existing request" }]
    }),
    createTransport: vi.fn().mockResolvedValue("DEVK900124")
  }
  return { mock: client, client: client as unknown as ADTClient }
}
const modes = ["wizard", "mcp-existing", "mcp-new"] as const
type Mode = (typeof modes)[number]
function select(mode: Mode, client: ADTClient) {
  if (mode === "wizard") return selectTransport(path, "ZPACKAGE", client, true)
  return pickTransportProgrammatically(
    client,
    mode === "mcp-existing"
      ? { type: "existing", number: "DEVK900123" }
      : { type: "new", description: "Explicit test request" },
    path,
    "ZPACKAGE"
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(window.showQuickPick).mockResolvedValue("DEVK900123 Existing request" as never)
})

describe("creation transport policy", () => {
  test.each(["CLAS/OC", "DDLS/DF"] as const)(
    "omits corrNr in the actual API creation request for local %s",
    async objtype => {
      const client = new ADTClient("https://example.invalid", "DEV_USER", "unused")
      const request = vi.spyOn(client.httpClient, "request").mockImplementation(async url => ({
        status: 200,
        statusText: "OK",
        headers: {},
        body: url.includes("/packages/")
          ? '<pak:package><pak:attributes pak:recordChanges="false"/></pak:package>'
          : '<app:service><app:workspace><app:collection href="/sap/bc/adt/oo/classes"><app:accept>application/vnd.sap.adt.oo.classes.v4+xml</app:accept></app:collection></app:workspace></app:service>'
      }))
      const selection = await selectTransport(path, "ZPACKAGE", client, true)
      await client.createObject({
        objtype,
        name: "ZEXAMPLE",
        description: "Example",
        parentName: "ZPACKAGE",
        parentPath: "/sap/bc/adt/packages/zpackage",
        transport: selection.transport
      })
      const creation = request.mock.calls.find(([, options]) => options?.method === "POST")
      expect(creation?.[1]?.qs).toEqual({})
      expect(request.mock.calls.some(([url]) => url.includes("/cts/"))).toBe(false)
      expect(window.showQuickPick).not.toHaveBeenCalled()
    }
  )

  test.each(modes)(
    "%s skips CTS, dialogs and request creation when the package disables recording",
    async mode => {
      const { client, mock } = setup("false")
      expect(await select(mode, client)).toEqual({ cancelled: false, transport: "" })
      expect(mock.getObjectSource).toHaveBeenCalledWith("/sap/bc/adt/packages/zpackage")
      expect(mock.transportInfo).not.toHaveBeenCalled()
      expect(mock.createTransport).not.toHaveBeenCalled()
      expect(window.showQuickPick).not.toHaveBeenCalled()
      expect(window.showInputBox).not.toHaveBeenCalled()
    }
  )

  test.each(modes)("%s retains CTS selection when recording is enabled", async mode => {
    const { client, mock } = setup("true")
    const result = await select(mode, client)
    expect(result.transport).toBe(mode === "mcp-new" ? "DEVK900124" : "DEVK900123")
    expect(mock.transportInfo).toHaveBeenCalledOnce()
    expect(mock.createTransport).toHaveBeenCalledTimes(mode === "mcp-new" ? 1 : 0)
  })

  test.each(["missing attribute", "read failure"])(
    "does not guess local status on %s",
    async scenario => {
      const { client, mock } = setup()
      if (scenario === "read failure")
        mock.getObjectSource.mockRejectedValue(new Error("Unavailable"))
      expect((await select("mcp-existing", client)).transport).toBe("DEVK900123")
      expect(mock.transportInfo).toHaveBeenCalledOnce()
    }
  )

  test("does not bypass an existing object's lock with package metadata", async () => {
    const { client, mock } = setup("false")
    mock.transportInfo.mockResolvedValue({ LOCKS: { HEADER: { TRKORR: "DEVK900123" } } })
    expect((await selectTransport(path, "ZPACKAGE", client, false)).transport).toBe("DEVK900123")
    expect(mock.getObjectSource).not.toHaveBeenCalled()
  })

  test("encodes a namespaced package and does not cache changed metadata", async () => {
    const { client, mock } = setup("false")
    expect(await packageChangeRecording(client, "/NS/ZPACKAGE")).toBe(false)
    expect(mock.getObjectSource).toHaveBeenCalledWith("/sap/bc/adt/packages/%2Fns%2Fzpackage")
    mock.getObjectSource.mockResolvedValue(
      '<pak:package><pak:attributes pak:recordChanges="true"/></pak:package>'
    )
    expect(await packageChangeRecording(client, "/NS/ZPACKAGE")).toBe(true)
  })
})
