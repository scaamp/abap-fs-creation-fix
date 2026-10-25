import { ADTClient } from "abap-adt-api"

// Sprawdza rzeczywistą, spatchowaną zależność używaną przez MCP, bez połączenia z SAP.
describe("packaged API DDLS creation contract", () => {
  it("sends the DDLS metadata media type and keeps its own XML representation", async () => {
    const client = new ADTClient("https://example.invalid", "alias@example.invalid", "unused")
    const request = vi.spyOn(client.httpClient, "request").mockResolvedValue({
      status: 201,
      statusText: "Created",
      headers: {},
      body: ""
    })

    await client.createObject({
      objtype: "DDLS/DF",
      name: "ZI_EXAMPLE",
      description: "Example view",
      parentName: "ZEXAMPLE",
      parentPath: "/sap/bc/adt/packages/zexample",
      responsible: "alias@example.invalid",
      transport: "DEVK900123"
    })

    expect(request).toHaveBeenCalledExactlyOnceWith(
      "/sap/bc/adt/ddic/ddl/sources",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/vnd.sap.adt.ddlSource+xml" },
        qs: { corrNr: "DEVK900123" },
        body: expect.stringContaining("<ddl:ddlSource")
      })
    )
    const body = request.mock.calls[0][1]!.body!
    expect(body).toContain('adtcore:type="DDLS/DF"')
    expect(body).toContain('<adtcore:packageRef adtcore:name="ZEXAMPLE"/>')
    expect(body).not.toContain("class:")
    expect(body).not.toContain("adtcore:responsible=")
  })
})
