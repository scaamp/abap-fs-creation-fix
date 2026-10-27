/**
 * Tests for views/abapgit.ts
 * Covers confirmPull, packageUri, AbapGit class methods, and AbapGitProvider.
 */

vi.mock("fp-ts/lib/Either", () => ({
  isRight: vi.fn(function (v: any) {
    return v && v._tag === "Right"
  })
}))

vi.mock("fp-ts/lib/Option", () => ({
  isNone: vi.fn(function (v: any) {
    return !v || v._tag === "None"
  }),
  none: { _tag: "None" },
  isSome: vi.fn(function (v: any) {
    return v && v._tag === "Some"
  })
}))

vi.mock("vscode", () => ({
  TreeItem: class TreeItem {
    constructor(
      public label?: any,
      public collapsibleState?: number
    ) {}
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EventEmitter: vi.fn().mockImplementation(function () {
    return {
      event: {},
      fire: vi.fn()
    }
  }),
  workspace: {
    workspaceFolders: [],
    onDidChangeWorkspaceFolders: vi.fn(function () {
      return { dispose: vi.fn() }
    })
  },
  Uri: {
    parse: vi.fn(function (s: string) {
      return {
        toString: () => s,
        authority: s.replace(/.*?:\/\//, "").split("/")[0] ?? "",
        scheme: s.split(":")[0]
      }
    })
  },
  ProgressLocation: { Notification: 15 },
  commands: { executeCommand: vi.fn() },
  env: { openExternal: vi.fn() }
}))

vi.mock("../commands", () => ({
  command: () => (target: any, key: string, descriptor: any) => descriptor,
  AbapFsCommands: {
    refreshAbapGit: "abapfs.refreshAbapGit",
    openRepo: "abapfs.openRepo",
    addScm: "abapfs.addScm"
  }
}))

vi.mock("../adt/operations/AdtObjectCreator", () => ({
  PACKAGE: "DEVC/K"
}))

vi.mock("../adt/AdtTransports", () => ({
  selectTransport: vi.fn()
}))

vi.mock("../lib", () => ({
  chainTaskTransformers: vi.fn(),
  dependFieldReplacer: vi.fn(),
  log: vi.fn(),
  createTaskTransformer: vi.fn(),
  caughtToString: vi.fn(function (e: any) {
    return String(e)
  }),
  quickPick: vi.fn()
}))

vi.mock("../services/funMessenger", () => ({
  funWindow: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    withProgress: vi.fn()
  }
}))

vi.mock("../scm/abapGit", () => ({
  addRepo: vi.fn(),
  repoCredentials: vi.fn()
}))

vi.mock("../adt/conections", () => ({
  getClient: vi.fn(),
  ADTSCHEME: "adt",
  getOrCreateClient: vi.fn()
}))

vi.mock("../adt/operations/AdtObjectFinder", () => ({
  AdtObjectFinder: vi.fn().mockImplementation(function () {
    return {
      vscodeUri: vi.fn()
    }
  }),
  createUri: vi.fn()
}))

vi.mock("uuid", () => ({
  v1: vi.fn(function () {
    return "test-uuid"
  })
}))

import { abapGitProvider, confirmPull, packageUri } from "./abapgit"
import { commands, workspace } from "vscode"
import { getClient, getOrCreateClient } from "../adt/conections"
import { addRepo, repoCredentials } from "../scm/abapGit"
import { quickPick } from "../lib"
import { funWindow as window } from "../services/funMessenger"
import type { Mocked, Mock } from "vitest"

const mockedWindow = window as Mocked<typeof window>

describe("abapGit setup and opening", () => {
  const repo = {
    key: "example",
    sapPackage: "ZEXAMPLE",
    url: "https://git.example/repo.git",
    branch_name: "refs/heads/main",
    links: []
  }

  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(workspace, {
      workspaceFolders: [
        { uri: { scheme: "adt", authority: "DEV100" } },
        { uri: { scheme: "adt", authority: "dev100" } }
      ]
    })
    vi.mocked(getClient).mockReturnValue({
      featureDetails: vi.fn().mockResolvedValue(true),
      gitRepos: vi.fn().mockResolvedValue([repo])
    } as never)
    vi.mocked(quickPick).mockReturnValue(async () => ({ _tag: "Right", right: { repo } }) as never)
    vi.mocked(repoCredentials).mockResolvedValue({ _tag: "None" })
  })

  afterEach(() => {
    Object.assign(workspace, { workspaceFolders: [] })
  })

  it("deduplicates connection casing before offering repositories", async () => {
    await abapGitProvider.configureCredentials()
    expect(getOrCreateClient).toHaveBeenCalledTimes(1)
    expect(getOrCreateClient).toHaveBeenCalledWith("dev100")
    expect(quickPick).toHaveBeenCalledWith(
      [expect.objectContaining({ label: "dev100 / ZEXAMPLE", repo })],
      expect.any(Object)
    )
    expect(repoCredentials).toHaveBeenCalledWith(repo.url)
    expect(addRepo).not.toHaveBeenCalled()
    expect(commands.executeCommand).not.toHaveBeenCalled()
  })

  it("does not prompt for credentials when repository selection is cancelled", async () => {
    vi.mocked(quickPick).mockReturnValueOnce(async () => ({ _tag: "Left", left: {} }) as never)
    await abapGitProvider.configureCredentials()
    expect(repoCredentials).not.toHaveBeenCalled()
    expect(mockedWindow.showInformationMessage).not.toHaveBeenCalled()
  })

  it("reports saved credentials without returning or displaying the secret", async () => {
    vi.mocked(repoCredentials).mockResolvedValueOnce({
      _tag: "Some",
      value: { user: "example", password: "example-secret" }
    })
    const result = await abapGitProvider.configureCredentials()
    expect(result).toBeUndefined()
    expect(mockedWindow.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("No commit, push, pull or activation")
    )
    expect(JSON.stringify(mockedWindow.showInformationMessage.mock.calls)).not.toContain(
      "example-secret"
    )
  })

  it("does not claim success after credential entry is cancelled", async () => {
    await abapGitProvider.configureCredentials()
    expect(mockedWindow.showInformationMessage).not.toHaveBeenCalled()
  })

  it("reports unavailable repositories without starting credential entry", async () => {
    Object.assign(workspace, { workspaceFolders: [] })
    await abapGitProvider.configureCredentials()
    expect(repoCredentials).not.toHaveBeenCalled()
    expect(mockedWindow.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("No linked abapGit repositories")
    )
  })

  it("sanitizes setup errors instead of exposing HTTP credential details", async () => {
    vi.mocked(repoCredentials).mockRejectedValueOnce(new Error("password=example-secret"))
    await abapGitProvider.configureCredentials()
    expect(mockedWindow.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("Could not configure")
    )
    expect(JSON.stringify(mockedWindow.showErrorMessage.mock.calls)).not.toContain("example-secret")
  })

  it("waits for SCM refresh before showing Source Control and exposes failures", async () => {
    const item = (await abapGitProvider.getChildren())[0]
    const repoItem = (await abapGitProvider.getChildren(item))[0]
    const provider = abapGitProvider as unknown as {
      addScm(item: unknown): Promise<void>
    }
    let complete!: () => void
    vi.mocked(addRepo).mockReturnValueOnce(
      new Promise(resolve => {
        complete = () => resolve({} as never)
      })
    )
    const opening = provider.addScm(repoItem)
    expect(commands.executeCommand).not.toHaveBeenCalled()
    complete()
    await opening
    expect(commands.executeCommand).toHaveBeenCalledWith("workbench.view.scm")
    vi.mocked(addRepo).mockRejectedValueOnce(new Error("private-http-detail"))
    await provider.addScm(repoItem)
    expect(mockedWindow.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("Could not load abapGit changes")
    )
    expect(JSON.stringify(mockedWindow.showErrorMessage.mock.calls)).not.toContain(
      "private-http-detail"
    )
  })
})

describe("confirmPull", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns true when user confirms", async () => {
    ;(mockedWindow.showInformationMessage as Mock).mockResolvedValue("Confirm")
    const result = await confirmPull("ZPKG")
    expect(result).toBe(true)
    expect(mockedWindow.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("ZPKG"),
      "Confirm",
      "Cancel"
    )
  })

  it("returns false when user cancels", async () => {
    ;(mockedWindow.showInformationMessage as Mock).mockResolvedValue("Cancel")
    const result = await confirmPull("ZPKG")
    expect(result).toBe(false)
  })

  it("returns false when user dismisses (undefined)", async () => {
    ;(mockedWindow.showInformationMessage as Mock).mockResolvedValue(undefined)
    const result = await confirmPull("ZPKG")
    expect(result).toBe(false)
  })
})

describe("packageUri", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns objectPath when collectionFeatureDetails succeeds (truthy)", async () => {
    const mockClient = {
      collectionFeatureDetails: vi.fn().mockResolvedValue(true)
    } as any
    const result = await packageUri(mockClient, "ZMYPKG")
    expect(result).toContain("ZMYPKG")
  })

  it("falls back to vit URL when collectionFeatureDetails returns falsy", async () => {
    const mockClient = {
      collectionFeatureDetails: vi.fn().mockResolvedValue(null)
    } as any
    const result = await packageUri(mockClient, "ZMYPKG")
    expect(result).toContain("ZMYPKG")
    expect(result).toContain("devck")
  })

  it("encodes special characters in package name", async () => {
    const mockClient = {
      collectionFeatureDetails: vi.fn().mockResolvedValue(null)
    } as any
    const result = await packageUri(mockClient, "Z/PKG")
    expect(result).not.toContain("Z/PKG")
    expect(result).toContain("Z%2FPKG")
  })
})
