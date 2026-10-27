vi.mock("vscode", () => ({
  workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn(() => true) })) },
  LanguageModelToolResult: class {
    constructor(public parts: unknown[]) {}
  },
  LanguageModelTextPart: class {
    constructor(public value: string) {}
  }
}))
vi.mock("../../adt/conections", () => ({ getClient: vi.fn() }))
vi.mock("../../lib/externalmodules", () => ({ PasswordVault: { get: vi.fn() } }))
vi.mock("../../scm/abapGit/credentials", () => ({ getDefaultUser: vi.fn() }))
vi.mock("./toolGuard", () => ({ assertToolInvocationAuthorized: vi.fn() }))
vi.mock("./toolRegistry", () => ({ registerToolWithRegistry: vi.fn(() => ({ dispose() {} })) }))

import { readFileSync } from "fs"
import { workspace } from "vscode"
import { AbapGitService, AbapGitToolError } from "../abapGitService"
import { AbapGitTool, abapGitToolNames, registerAbapGitTools } from "./abapGitTools"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { registerToolWithRegistry } from "./toolRegistry"
import { getDefaultUser } from "../../scm/abapGit/credentials"
import { PasswordVault } from "../../lib/externalmodules"
import { getClient } from "../../adt/conections"

describe("abapGit LM and MCP tools", () => {
  beforeEach(() => vi.clearAllMocks())

  it("registers the eight schema-backed tools for MCP", () => {
    const context = { subscriptions: [], workspaceState: { get: vi.fn(() => []), update: vi.fn() } }
    registerAbapGitTools(context as never)
    expect(vi.mocked(registerToolWithRegistry).mock.calls.map(call => call[0])).toEqual([
      ...abapGitToolNames
    ])
    const manifest = JSON.parse(
      readFileSync(new URL("../../../../package.json", import.meta.url), "utf8")
    )
    for (const name of abapGitToolNames) {
      const entry = manifest.contributes.languageModelTools.find(
        (tool: { name: string }) => tool.name === name
      )
      expect(entry.tags).toContain("abap-fs")
      expect(entry.inputSchema.additionalProperties).toBe(false)
      expect(JSON.stringify(entry.inputSchema)).not.toMatch(/password|token/i)
    }
  })

  it("enforces caller authorization inside invoke, including direct MCP calls", async () => {
    const service = { status: vi.fn().mockResolvedValue({ staged: [] }) }
    const tool = new AbapGitTool("abapfs_abapgit_status", service as unknown as AbapGitService)
    const options = { input: { connectionId: "dev100", repoId: "example" } }
    await tool.invoke(options as never)
    expect(assertToolInvocationAuthorized).toHaveBeenCalledWith(options)
    vi.mocked(assertToolInvocationAuthorized).mockImplementationOnce(() => {
      throw new Error("Unauthorized")
    })
    await expect(tool.invoke(options as never)).rejects.toThrow("Unauthorized")
    expect(service.status).toHaveBeenCalledTimes(1)
  })

  it("sanitizes unexpected exceptions while retaining actionable typed errors", async () => {
    const service = { status: vi.fn().mockRejectedValue(new Error("HTTP password=fake-secret")) }
    const tool = new AbapGitTool("abapfs_abapgit_status", service as unknown as AbapGitService)
    const options = { input: { connectionId: "dev100", repoId: "example" } }
    const result = await tool.invoke(options as never)
    expect(JSON.stringify(result)).not.toContain("fake-secret")
    expect(JSON.stringify(result)).toContain("ABAPGIT_REQUEST_FAILED")
    service.status.mockRejectedValue(
      new AbapGitToolError("AUTH_REQUIRED", "Configure stored Git credentials")
    )
    expect(JSON.stringify(await tool.invoke(options as never))).toContain("AUTH_REQUIRED")
  })

  it("blocks commit+push from an already open MCP session when edit exposure is disabled", async () => {
    vi.mocked(workspace.getConfiguration).mockReturnValueOnce({ get: () => false } as never)
    const service = { commitAndPush: vi.fn() }
    const tool = new AbapGitTool(
      "abapfs_abapgit_commit_and_push",
      service as unknown as AbapGitService
    )
    const result = await tool.invoke({
      input: { connectionId: "dev100", repoId: "example", reviewId: "example", confirm: true }
    } as never)
    expect(JSON.stringify(result)).toContain("EDIT_DISABLED")
    expect(service.commitAndPush).not.toHaveBeenCalled()
  })

  it("requires already stored credentials and never opens a hidden prompt", async () => {
    vi.mocked(getDefaultUser).mockReturnValue("example")
    const getPassword = vi.fn().mockResolvedValue(undefined)
    vi.mocked(PasswordVault.get).mockReturnValue({ getPassword } as never)
    const repo = {
      key: "example",
      url: "https://git.example/repo.git",
      links: [{ type: "stage_link", href: "/sap/bc/adt/abapgit/repos/example/stage" }]
    }
    const stageRepo = vi.fn()
    vi.mocked(getClient).mockReturnValue({
      gitRepos: vi.fn().mockResolvedValue([repo]),
      stageRepo
    } as never)
    registerAbapGitTools({
      subscriptions: [],
      workspaceState: { get: () => [], update: vi.fn() }
    } as never)
    const tool = vi
      .mocked(registerToolWithRegistry)
      .mock.calls.find(call => call[0] === "abapfs_abapgit_prepare_commit")![1]
    const result = await tool.invoke(
      {
        input: {
          connectionId: "dev100",
          repoId: "example",
          message: "Example",
          author: { name: "Example", email: "example@example.invalid" },
          files: [{ name: "example", path: "/src/" }]
        }
      } as never,
      {} as never
    )
    expect(JSON.stringify(result)).toContain("AUTH_REQUIRED")
    expect(JSON.stringify(result)).toContain("ABAP FS: Configure abapGit credentials")
    expect(getPassword).toHaveBeenCalledWith(
      "vscode.abapgithttps://git.example/repo.git",
      "example"
    )
    expect(stageRepo).not.toHaveBeenCalled()
  })
})
