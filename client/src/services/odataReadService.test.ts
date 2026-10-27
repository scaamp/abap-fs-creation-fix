import type { HttpClientResponse } from "abap-adt-api/build/AdtHTTP"
import { ODataReadService, odataReadFailure, type ODataConnection } from "./odataReadService"
import { planQuery, projectRows, readModel } from "./odataModel"

const metadata = `<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0"><edmx:Reference Uri="https://schema.example/vocabulary.xml"/><edmx:DataServices><Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="Demo" Alias="D">
<EntityType Name="Header"><Key><PropertyRef Name="ID"/></Key><Property Name="ID" Type="Edm.Guid" Nullable="false"/><Property Name="Text" Type="Edm.String"/><Property Name="Amount" Type="Edm.Decimal"/><Property Name="Counter" Type="Edm.Int64"/><Property Name="Blob" Type="Edm.Stream"/><NavigationProperty Name="_Items" Type="Collection(D.Item)"/><NavigationProperty Name="_Parent" Type="D.Header"/></EntityType>
<EntityType Name="Item"><Key><PropertyRef Name="ItemID"/></Key><Property Name="ItemID" Type="Edm.Guid"/><Property Name="Amount" Type="Edm.Decimal"/></EntityType>
<EntityContainer Name="Container"><EntitySet Name="Headers" EntityType="D.Header"/><EntitySet Name="Items" EntityType="D.Item"/></EntityContainer>
</Schema></edmx:DataServices></edmx:Edmx>`
const binding = `<serviceBinding version="active" published="true"><link href="/sap/bc/adt/businessservices/odatav4/ZEXAMPLE" rel="http://www.sap.com/categories/odatav4" type="application/vnd.sap.adt.businessservices.odatav4.v1+xml"/><services name="ZEXAMPLE"><content version="0001"><serviceDefinition name="ZEXAMPLE_DEF"/></content></services><binding type="ODATA" version="V4"/></serviceBinding>`
const details = `<serviceGroup published="true"><services serviceVersion="0001" serviceUrl="/sap/opu/odata4/example/0001/"/></serviceGroup>`
const input = { connectionId: "DEV100", bindingName: "ZEXAMPLE" }
const ok = (body: string, contentType = "application/xml"): HttpClientResponse => ({
  status: 200,
  statusText: "OK",
  body,
  headers: { "content-type": contentType }
})

describe("OData scoped read service", () => {
  let time: number
  let connection: ODataConnection
  let service: ODataReadService
  let request: ReturnType<typeof vi.fn<ODataConnection["request"]>>
  let values: unknown
  beforeEach(() => {
    time = 1000
    values = {
      value: [
        {
          ID: "example-id",
          Text: "Example",
          Amount: "12345678901234567890.12",
          Counter: "9223372036854775807",
          Hidden: "not-selected",
          _Items: [{ ItemID: "item-id", Amount: "4.50", Hidden: "not-selected" }],
          _Parent: null
        }
      ]
    }
    request = vi.fn(async path => {
      if (path.includes("/bindings/")) return ok(binding)
      if (path.includes("/businessservices/odatav4/")) return ok(details)
      if (path.endsWith("$metadata")) return ok(metadata)
      return ok(JSON.stringify(values), "application/json;IEEE754Compatible=true")
    })
    connection = { identity: {}, baseUrl: "https://sap.example.invalid", sapClient: "001", request }
    service = new ODataReadService({
      connection: id => {
        expect(id).toBe("dev100")
        return connection
      },
      now: () => time
    })
  })
  const resolved = async (svc: ODataReadService) => ({
    connectionId: "dev100",
    serviceRef: (await svc.resolve(input)).serviceRef
  })

  it("resolves exact backend V4 root and chooses details V2 despite advertised V1", async () => {
    const result = await service.resolve(input)
    expect(result).toMatchObject({
      servicePath: "/sap/opu/odata4/example/0001/",
      protocol: "V4",
      published: true,
      authContext: "existing_same_origin_adt_oauth"
    })
    expect(request.mock.calls[1][1].headers.Accept).toBe(
      "application/vnd.sap.adt.businessservices.odatav4.v2+xml"
    )
    for (const [, options] of request.mock.calls)
      expect(options).toMatchObject({
        method: "GET",
        maxRedirects: 0,
        maxContentLength: 512 * 1024,
        qs: { "sap-client": "001" }
      })
  })

  it("returns normalized metadata while preserving entity set names and avoiding external references", async () => {
    const result = await service.getMetadata(await resolved(service))
    expect(result).toMatchObject({
      httpStatus: 200,
      externalReferenceCount: 1,
      externalReferencesFetched: false,
      entitySets: [
        { name: "Headers", type: "Demo.Header", keys: ["ID"] },
        { name: "Items", type: "Demo.Item", keys: ["ItemID"] }
      ]
    })
    expect(result.metadataHash).toMatch(/^[a-f0-9]{64}$/)
    expect(request).toHaveBeenCalledTimes(3)
  })

  it("queries bounded direct expansion and returns only explicitly selected scalar values", async () => {
    const ref = await resolved(service)
    const result = await service.query({
      ...ref,
      entitySet: "Headers",
      select: ["ID", "Amount", "Counter"],
      top: 1,
      expand: [{ navigation: "_Items", select: ["ItemID", "Amount"], top: 1 }]
    })
    expect(result.rows).toEqual([
      {
        ID: "example-id",
        Amount: "12345678901234567890.12",
        Counter: "9223372036854775807",
        _Items: [{ ItemID: "item-id", Amount: "4.50" }]
      }
    ])
    expect(JSON.stringify(result)).not.toContain("not-selected")
    expect(request.mock.calls.at(-1)?.[1]).toMatchObject({
      headers: { Accept: "application/json;IEEE754Compatible=true" },
      qs: { $select: "ID,Amount,Counter", $top: 1, $expand: "_Items($select=ItemID,Amount;$top=1)" }
    })
    expect(request.mock.calls.every(([, options]) => options.method === "GET")).toBe(true)
    expect(result.paginationFollowed).toBe(false)
  })

  it.each([
    { entitySet: "DoAction", select: ["ID"] },
    { entitySet: "Headers", select: ["*"] },
    { entitySet: "Headers", select: ["ID", "ID"] },
    { entitySet: "Headers", select: ["ID;$expand=Other"] },
    { entitySet: "Headers", select: ["Blob"] },
    { entitySet: "Headers", select: ["ID"], top: 21 },
    { entitySet: "Headers", select: ["ID"], top: 0 },
    { entitySet: "Headers", select: ["ID"], top: 1.5 },
    {
      entitySet: "Headers",
      select: ["ID"],
      expand: [{ navigation: "Unknown", select: ["ItemID"] }]
    },
    { entitySet: "Headers", select: ["ID"], expand: [{ navigation: "_Items", select: ["ID"] }] },
    {
      entitySet: "Headers",
      select: ["ID"],
      expand: [{ navigation: "_Parent", select: ["ID"], top: 1 }]
    }
  ])("rejects invalid query before issuing a data request: %j", async query => {
    const ref = await resolved(service)
    await expect(service.query({ ...ref, ...query })).rejects.toHaveProperty("code")
    expect(request).toHaveBeenCalledTimes(3)
  })

  it.each([
    "https://other.example/odata/",
    "https://user:fake-secret@sap.example.invalid/sap/opu/odata4/",
    "/sap/opu/odata4/example/?access_token=fake-secret",
    "/sap/opu/odata4/example/%255c/"
  ])("rejects unsafe service root %s before sending any runtime credentials", async root => {
    request.mockImplementation(async path =>
      path.includes("/bindings/")
        ? ok(binding)
        : ok(details.replace("/sap/opu/odata4/example/0001/", root))
    )
    await expect(service.resolve(input)).rejects.toMatchObject({
      code: "UNSUPPORTED_SERVICE_ORIGIN"
    })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it("binds references to connection, client instance and lifetime", async () => {
    const ref = await resolved(service)
    await expect(service.getMetadata({ ...ref, connectionId: "other" })).rejects.toMatchObject({
      code: "SERVICE_MISMATCH"
    })
    connection = { ...connection, identity: {} }
    await expect(service.getMetadata(ref)).rejects.toMatchObject({ code: "SERVICE_EXPIRED" })
    const next = await resolved(service)
    time += 15 * 60 * 1000
    await expect(service.getMetadata(next)).rejects.toMatchObject({ code: "SERVICE_EXPIRED" })
  })

  it("does not publish an unpublished binding or guess a service version", async () => {
    request.mockResolvedValueOnce(ok(binding.replace('published="true"', 'published="false"')))
    await expect(service.resolve(input)).rejects.toMatchObject({ code: "NOT_PUBLISHED" })
    request.mockResolvedValueOnce(
      ok(
        binding.replace(
          "</services>",
          '<content version="0002"><serviceDefinition name="ZOTHER"/></content></services>'
        )
      )
    )
    await expect(service.resolve(input)).rejects.toMatchObject({ code: "AMBIGUOUS_SERVICE" })
    expect(request.mock.calls.every(([, options]) => options.method === "GET")).toBe(true)
  })

  it("falls back once on a details representation 406, never on an authorization failure", async () => {
    request.mockImplementation(async (path, options) => {
      if (path.includes("/bindings/")) return ok(binding)
      if (options.headers.Accept.endsWith("v2+xml"))
        throw { status: 406, response: { status: 406, body: "Unsupported representation" } }
      return ok(details)
    })
    expect(await service.resolve(input)).toHaveProperty("serviceRef")
    expect(request).toHaveBeenCalledTimes(3)
    request.mockRejectedValue({ status: 403, response: { status: 403, body: "Forbidden" } })
    await expect(service.resolve(input)).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(request).toHaveBeenCalledTimes(4)
  })

  it.each([301, 302, 401, 403, 404])(
    "reports HTTP %s with redacted body and no raw SDK exception",
    async status => {
      request.mockRejectedValue({
        status,
        parent: {
          response: { status, body: '{"error":{"message":"failed"},"access_token":"fake-secret"}' }
        },
        config: { password: "private-password" }
      })
      const error = await service.resolve(input).catch(error => odataReadFailure(error))
      expect(error).toMatchObject({ httpStatus: status })
      expect(JSON.stringify(error)).not.toMatch(/fake-secret|private-password/)
      expect(request).toHaveBeenCalledTimes(1)
    }
  )

  it("detects HTML login, payload bounds and cancellation", async () => {
    request.mockResolvedValueOnce(ok("<html>Login</html>", "text/html"))
    await expect(service.resolve(input)).rejects.toMatchObject({ code: "AUTH_REQUIRED" })
    request.mockResolvedValueOnce(ok("x".repeat(512 * 1024 + 1)))
    await expect(service.resolve(input)).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" })
    await expect(service.resolve(input, () => true)).rejects.toMatchObject({ code: "CANCELLED" })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it("never exports authentication HTML or hidden form tokens in failed responses", async () => {
    request.mockRejectedValue({
      status: 302,
      response: {
        status: 302,
        headers: { "content-type": "text/html" },
        body: '<html><form><input name="SAMLResponse" value="fake-secret"/></form></html>'
      }
    })
    const result = await service.resolve(input).catch(error => odataReadFailure(error))
    expect(result).toMatchObject({ error: "AUTH_REDIRECT", httpStatus: 302 })
    expect(JSON.stringify(result)).not.toMatch(/fake-secret|SAMLResponse/)
  })

  it("bounds provider/login waits without retrying the request", async () => {
    vi.useFakeTimers()
    try {
      request.mockImplementation(() => new Promise(() => {}))
      const running = expect(service.resolve(input)).rejects.toMatchObject({ code: "READ_TIMEOUT" })
      await vi.advanceTimersByTimeAsync(25001)
      await running
      expect(request).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not follow next links and excludes their URLs from projected rows", async () => {
    values = {
      value: [
        {
          ID: "example-id",
          _Items: [{ ItemID: "item-id" }],
          "_Items@odata.nextLink": "https://other.example/items"
        }
      ],
      "@odata.nextLink": "https://other.example/headers"
    }
    const result = await service.query({
      ...(await resolved(service)),
      entitySet: "Headers",
      select: ["ID"],
      expand: [{ navigation: "_Items", select: ["ItemID"] }]
    })
    expect(result).toMatchObject({
      hasMore: true,
      expandedHasMore: ["_Items"],
      paginationFollowed: false
    })
    expect(JSON.stringify(result)).not.toContain("other.example")
    expect(request).toHaveBeenCalledTimes(4)
  })
})

describe("V4 metadata and result boundaries", () => {
  it("rejects unsupported versions, DTD and malformed metadata", () => {
    expect(() => readModel(metadata.replace('Version="4.0"', 'Version="1.0"'))).toThrow(/V4/)
    expect(() =>
      readModel('<!DOCTYPE x [<!ENTITY x SYSTEM "https://other.example">]>' + metadata)
    ).toThrow(/DTD/)
    expect(() => readModel('<Edmx Version="4.0">')).toThrow(/well-formed/)
  })
  it("resolves base keys/properties and rejects inheritance cycles", () => {
    const inherited = metadata.replace(
      '<EntityType Name="Item">',
      '<EntityType Name="Item" BaseType="D.Header">'
    )
    expect(
      readModel(inherited)
        .types.get("Demo.Item")
        ?.properties.map(property => property.name)
    ).toContain("Text")
    const cyclic = metadata
      .replace('<EntityType Name="Header">', '<EntityType Name="Header" BaseType="D.Item">')
      .replace('<EntityType Name="Item">', '<EntityType Name="Item" BaseType="D.Header">')
    expect(() => readModel(cyclic)).toThrow(/Cyclic/)
  })
  it("rejects unsafe Decimal/Int64 numbers and ignored row limits", () => {
    const plan = planQuery(readModel(metadata), {
      entitySet: "Headers",
      select: ["Amount", "Counter"],
      top: 1
    })
    expect(() => projectRows({ value: [{ Amount: 1.25, Counter: "1" }] }, plan)).toThrow(/strings/)
    expect(() =>
      projectRows({ value: [{ Amount: "1", Counter: 9007199254740992 }] }, plan)
    ).toThrow(/strings/)
    expect(() =>
      projectRows(
        {
          value: [
            { Amount: "1", Counter: "1" },
            { Amount: "2", Counter: "2" }
          ]
        },
        plan
      )
    ).toThrow(/row limit/)
    expect(() => projectRows({ value: [{ Counter: "1" }] }, plan)).toThrow(/omitted/)
  })
})
