import type { GitRepo, GitStaging, GitStagingFile } from "abap-adt-api"
import {
  AbapGitService,
  type AbapGitClient,
  type GitOperation,
  type PrepareCommitInput
} from "./abapGitService"

const input = { connectionId: "DEV100", repoId: "example" }
const file = (name: string): GitStagingFile => ({
  path: "/src/",
  name,
  localState: "M",
  links: [
    { href: `/sap/bc/adt/abapgit/repos/example/local/${name}`, rel: "localversion" },
    { href: `/sap/bc/adt/abapgit/repos/example/remote/${name}`, rel: "remoteversion" }
  ]
})
const a = file("zexample.clas.abap")
const b = file("zexample.clas.xml")
const repo: GitRepo = {
  key: "example",
  sapPackage: "ZEXAMPLE",
  url: "https://git.example/repo.git",
  branch_name: "refs/heads/main",
  created_by: "example",
  created_at: new Date(0),
  links: [
    { href: "/sap/bc/adt/abapgit/repos/example/stage", rel: "stage", type: "stage_link" },
    { href: "/sap/bc/adt/abapgit/repos/example/push", rel: "push", type: "push_link" }
  ]
}
const prepare: PrepareCommitInput = {
  ...input,
  files: [{ path: a.path, name: a.name }],
  message: "Update example",
  author: { name: "Example author", email: "author@example.invalid" },
  committer: { name: "Example committer", email: "committer@example.invalid" }
}

describe("abapGit service", () => {
  let service: AbapGitService
  let staging: GitStaging
  let client: {
    [K in keyof AbapGitClient]: ReturnType<typeof vi.fn<AbapGitClient[K]>>
  }
  let time: number
  let operations: GitOperation[]
  let saveOperations: ReturnType<typeof vi.fn<(items: GitOperation[]) => Promise<void>>>

  beforeEach(() => {
    time = 1000
    operations = []
    staging = {
      staged: [],
      unstaged: [
        {
          wbkey: "CLAS ZEXAMPLE",
          uri: "/example",
          type: "CLAS",
          name: "ZEXAMPLE",
          abapGitFiles: [structuredClone(a), structuredClone(b)]
        }
      ],
      ignored: [],
      comment: "",
      author: { name: "", email: "" },
      committer: { name: "", email: "" }
    }
    client = {
      gitRepos: vi.fn().mockImplementation(async () => [structuredClone(repo)]),
      stageRepo: vi.fn().mockImplementation(async () => structuredClone(staging)),
      getObjectSource: vi
        .fn()
        .mockImplementation(async path => (path.includes("/local/") ? "new source" : "old source")),
      gitExternalRepoInfo: vi.fn().mockResolvedValue({
        access_mode: "PRIVATE",
        branches: [
          {
            name: "refs/heads/main",
            sha1: "a".repeat(40),
            type: "BRANCH",
            display_name: "main",
            is_head: true
          }
        ]
      }),
      pushRepo: vi.fn().mockResolvedValue(undefined),
      inactiveObjects: vi.fn().mockResolvedValue([])
    }
    saveOperations = vi.fn(async items => {
      operations = structuredClone(items)
    })
    service = new AbapGitService({
      client: id => {
        expect(id).toBe("dev100")
        return client
      },
      credentials: async () => ({ user: "example", password: "fake-secret" }),
      loadOperations: () => structuredClone(operations),
      saveOperations,
      now: () => time
    })
  })

  const commit = async (svc: AbapGitService) => {
    const review = await svc.prepareCommit(prepare)
    return { ...input, reviewId: review.reviewId, confirm: true }
  }

  it("reports actual adapter limits and backend links without invoking write APIs", async () => {
    expect(await service.capabilities(input)).toMatchObject({
      commitAndPush: true,
      standaloneCommit: false,
      fetchGitObjects: false,
      merge: false,
      pullExposed: false
    })
    expect(await service.repositories(input.connectionId)).toEqual([
      expect.objectContaining({
        repoId: "example",
        packageName: "ZEXAMPLE",
        branch: "refs/heads/main"
      })
    ])
    expect(await service.remoteRefs(input)).toMatchObject({
      fetchPerformed: false,
      branches: [expect.objectContaining({ sha1: "a".repeat(40) })]
    })
    expect(client.pushRepo).not.toHaveBeenCalled()
  })

  it("returns serialized file identity and complete diff versions without staging or push", async () => {
    expect(await service.status(input)).toMatchObject({
      unstaged: [
        expect.objectContaining({ path: "/src/", name: a.name }),
        expect.objectContaining({ name: b.name })
      ]
    })
    expect(await service.diff({ ...input, files: prepare.files })).toMatchObject({
      files: [{ ...prepare.files[0], local: "new source", remote: "old source", deletion: false }]
    })
    expect(client.pushRepo).not.toHaveBeenCalled()
  })

  it("prepares full versions, target SHA and exact identities without a write", async () => {
    const review = await service.prepareCommit(prepare)
    expect(review).toMatchObject({
      author: prepare.author,
      committer: prepare.committer,
      message: prepare.message,
      remoteSha: "a".repeat(40),
      files: [expect.objectContaining({ local: "new source", remote: "old source" })]
    })
    expect(client.pushRepo).not.toHaveBeenCalled()
    expect(operations).toEqual([])
  })

  it("pushes only reviewed files, preserves excluded files as unstaged and records the attempt before POST", async () => {
    client.pushRepo.mockImplementation(async (_repo, selected) => {
      expect(operations).toHaveLength(1)
      expect(operations[0].state).toBe("unknown")
      expect(selected.staged[0].abapGitFiles).toEqual([a])
      expect(selected.unstaged[0].abapGitFiles).toEqual([b])
      expect(selected.author).toEqual(prepare.author)
      expect(selected.committer).toEqual(prepare.committer)
    })
    const request = await commit(service)
    const result = await service.commitAndPush(request)
    expect(result.state).toBe("accepted")
    expect(client.pushRepo).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toContain("fake-secret")
    await expect(service.commitAndPush(request)).rejects.toMatchObject({ code: "REVIEW_EXPIRED" })
  })

  it.each(["source", "remote", "selection", "branch", "url"])(
    "rejects stale %s before writing",
    async kind => {
      const request = await commit(service)
      if (kind === "source") client.getObjectSource.mockResolvedValue("changed during review")
      if (kind === "remote")
        client.gitExternalRepoInfo.mockResolvedValue({
          access_mode: "PRIVATE",
          branches: [
            {
              name: "refs/heads/main",
              sha1: "b".repeat(40),
              type: "BRANCH",
              display_name: "main",
              is_head: true
            }
          ]
        })
      if (kind === "selection") staging.unstaged[0].abapGitFiles.push(file("new-file.xml"))
      if (kind === "branch")
        client.gitRepos.mockResolvedValue([{ ...repo, branch_name: "refs/heads/other" }])
      if (kind === "url")
        client.gitRepos.mockResolvedValue([{ ...repo, url: "https://git.example/other.git" }])
      await expect(service.commitAndPush(request)).rejects.toMatchObject({
        code: kind === "branch" ? "REMOTE_HEAD_UNKNOWN" : "STALE_REVIEW"
      })
      expect(client.pushRepo).not.toHaveBeenCalled()
    }
  )

  it("requires confirmation and binds a review to its exact connection and repository", async () => {
    const request = await commit(service)
    await expect(service.commitAndPush({ ...request, confirm: false })).rejects.toMatchObject({
      code: "CONFIRM_REQUIRED"
    })
    await expect(service.commitAndPush({ ...request, repoId: "different" })).rejects.toMatchObject({
      code: "REVIEW_MISMATCH"
    })
    await expect(
      service.commitAndPush({ ...request, connectionId: "other" })
    ).rejects.toMatchObject({ code: "REVIEW_MISMATCH" })
    time += 10 * 60 * 1000
    await expect(service.commitAndPush(request)).rejects.toMatchObject({ code: "REVIEW_EXPIRED" })
    expect(client.pushRepo).not.toHaveBeenCalled()
  })

  it("does not invalidate a review when only repository display status or dates refresh", async () => {
    const request = await commit(service)
    client.gitRepos.mockResolvedValue([
      { ...repo, created_at: new Date(100000), status_text: "Refreshed", status: "updated" }
    ])
    expect(await service.commitAndPush(request)).toMatchObject({ state: "accepted" })
    expect(client.pushRepo).toHaveBeenCalledTimes(1)
  })

  it("blocks concurrent pushes including different reviews of the same repository", async () => {
    const one = await commit(service)
    const two = await commit(service)
    let finish!: () => void
    const waiting = new Promise<void>(resolve => {
      finish = resolve
    })
    client.pushRepo.mockImplementation(async () => waiting)
    const running = service.commitAndPush(one)
    await vi.waitFor(() => expect(client.pushRepo).toHaveBeenCalledTimes(1))
    await expect(service.commitAndPush(two)).rejects.toMatchObject({ code: "REPOSITORY_BUSY" })
    finish()
    await running
    expect(client.pushRepo).toHaveBeenCalledTimes(1)
  })

  it("records unknown after a failed POST and never automatically retries", async () => {
    const request = await commit(service)
    client.pushRepo.mockRejectedValue(new Error("timeout fake-secret"))
    const result = await service.commitAndPush(request)
    expect(result.state).toBe("unknown")
    expect(service.operation({ ...input, operationId: result.operationId })).toMatchObject({
      state: "unknown"
    })
    expect(service.operation({ ...input, connectionId: "other" })).toEqual({ operations: [] })
    expect(JSON.stringify(result)).not.toContain("fake-secret")
    expect(client.pushRepo).toHaveBeenCalledTimes(1)
  })

  it("does not submit POST when the attempt cannot be persisted", async () => {
    const request = await commit(service)
    saveOperations.mockRejectedValue(new Error("local storage unavailable"))
    await expect(service.commitAndPush(request)).rejects.toThrow("local storage unavailable")
    expect(client.pushRepo).not.toHaveBeenCalled()
  })

  it.each([[[]], [[{ path: "/src/", name: "missing" }]], [[prepare.files[0], prepare.files[0]]]])(
    "rejects empty, missing and duplicate selections",
    async files => {
      await expect(service.prepareCommit({ ...prepare, files })).rejects.toMatchObject({
        code: "INVALID_SELECTION"
      })
      expect(client.pushRepo).not.toHaveBeenCalled()
    }
  )

  it("requires explicit review of deletions and distinguishes missing from empty versions", async () => {
    staging.unstaged[0].abapGitFiles[0].links = [a.links[1]]
    await expect(service.prepareCommit(prepare)).rejects.toMatchObject({
      code: "DELETION_REQUIRES_REVIEW"
    })
    expect(await service.prepareCommit({ ...prepare, allowDeletions: true })).toMatchObject({
      files: [{ ...prepare.files[0], local: null, remote: "old source", deletion: true }]
    })
    staging.unstaged[0].abapGitFiles[0].links = [a.links[0]]
    client.getObjectSource.mockResolvedValue("")
    expect(await service.prepareCommit(prepare)).toMatchObject({
      files: [{ ...prepare.files[0], local: "", remote: null, deletion: false }]
    })
  })

  it.each([
    "https://other.example/source",
    "/sap/bc/adt/abapgit/repos/different/source",
    "/sap/bc/adt/abapgit/repos/example/../../other",
    "/sap/bc/adt/abapgit/repos/example/%2e%2e/other"
  ])("refuses untrusted backend source link %s without sending credentials", async href => {
    staging.unstaged[0].abapGitFiles[0].links[0].href = href
    await expect(service.prepareCommit(prepare)).rejects.toMatchObject({ code: "UNSAFE_LINK" })
    expect(client.getObjectSource).not.toHaveBeenCalled()
    expect(client.pushRepo).not.toHaveBeenCalled()
  })

  it("fails closed on oversized file versions, invalid identity, no changes and missing remote SHA", async () => {
    await expect(
      service.prepareCommit({ ...prepare, author: { name: "", email: "bad" } })
    ).rejects.toMatchObject({ code: "INVALID_IDENTITY" })
    client.getObjectSource.mockResolvedValue("x".repeat(128 * 1024 + 1))
    await expect(service.prepareCommit(prepare)).rejects.toMatchObject({ code: "REVIEW_TOO_LARGE" })
    client.getObjectSource.mockResolvedValue("same")
    await expect(service.prepareCommit(prepare)).rejects.toMatchObject({ code: "NO_CHANGES" })
    client.gitExternalRepoInfo.mockResolvedValue({ access_mode: "PUBLIC", branches: [] })
    await expect(service.prepareCommit(prepare)).rejects.toMatchObject({
      code: "REMOTE_HEAD_UNKNOWN"
    })
    expect(client.pushRepo).not.toHaveBeenCalled()
  })

  it.each([
    "https://example:fake-secret@git.example/repo.git",
    "https://git.example/repo.git?access_token=fake-secret"
  ])(
    "rejects credential-bearing repository URL %s before requesting Git credentials",
    async url => {
      client.gitRepos.mockResolvedValue([{ ...repo, url }])
      await expect(service.repositories(input.connectionId)).rejects.toMatchObject({
        code: "UNSAFE_REPOSITORY_URL"
      })
      expect(client.stageRepo).not.toHaveBeenCalled()
    }
  )

  it("refuses selected inactive objects without activating or pushing them", async () => {
    client.inactiveObjects.mockResolvedValue([
      {
        object: {
          "adtcore:name": "ZEXAMPLE",
          "adtcore:type": "CLAS/OC",
          "adtcore:uri": "/class",
          "adtcore:parentUri": "",
          user: "example",
          deleted: false
        }
      }
    ])
    await expect(service.prepareCommit(prepare)).rejects.toMatchObject({ code: "INACTIVE_CHANGES" })
    expect(client.pushRepo).not.toHaveBeenCalled()
  })

  it("rechecks inactive components appearing after review", async () => {
    const request = await commit(service)
    client.inactiveObjects.mockResolvedValue([
      {
        object: {
          "adtcore:name": "METHOD",
          "adtcore:type": "CLAS/OM",
          "adtcore:uri": "/example/method",
          "adtcore:parentUri": "/example",
          user: "example",
          deleted: false
        }
      }
    ])
    await expect(service.commitAndPush(request)).rejects.toMatchObject({ code: "INACTIVE_CHANGES" })
    expect(client.pushRepo).not.toHaveBeenCalled()
  })
})
