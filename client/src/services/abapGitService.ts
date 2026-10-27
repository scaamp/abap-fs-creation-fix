import { createHash, randomUUID } from "crypto"
import type { ADTClient, GitRepo, GitStaging, GitStagingObject, GitUser } from "abap-adt-api"

export type AbapGitClient = Pick<
  ADTClient,
  | "gitRepos"
  | "stageRepo"
  | "gitExternalRepoInfo"
  | "getObjectSource"
  | "pushRepo"
  | "inactiveObjects"
>
export interface RepoInput {
  connectionId: string
  repoId: string
}
export interface FileKey {
  path: string
  name: string
}
interface Credentials {
  user: string
  password: string
}
export interface PrepareCommitInput extends RepoInput {
  files: FileKey[]
  message: string
  author: GitUser
  committer?: GitUser
  allowDeletions?: boolean
}
export interface CommitInput extends RepoInput {
  reviewId: string
  confirm: boolean
}
export interface GitOperation extends RepoInput {
  operationId: string
  reviewId: string
  startedAt: string
  state: "unknown" | "accepted"
  branch: string
  remoteBefore: string
  remoteAfter?: string
  files: FileKey[]
}
export interface AbapGitDependencies {
  client(connectionId: string): AbapGitClient
  credentials(repo: GitRepo, required: boolean): Promise<Credentials>
  loadOperations(): GitOperation[]
  saveOperations(operations: GitOperation[]): Promise<void>
  now?: () => number
}
interface FileSnapshot extends FileKey {
  local: string | null
  remote: string | null
  deletion: boolean
}
interface Review {
  input: PrepareCommitInput
  expiresAt: number
  fingerprint: string
  remoteSha: string
}

const MAX_FILES = 50
const MAX_FILE_BYTES = 128 * 1024
const MAX_REVIEW_BYTES = 512 * 1024
const REVIEW_TTL = 10 * 60 * 1000
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const key = (file: FileKey) => JSON.stringify([file.path, file.name])
function fail(code: string, message: string): never {
  throw new AbapGitToolError(code, message)
}

export class AbapGitToolError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

// Łącza pochodzą wyłącznie z odpowiedzi wskazanego repozytorium, nigdy z parametrów modelu.
function repoPath(repo: GitRepo, href: string) {
  if (!/^[\w.-]+$/.test(repo.key)) fail("INVALID_REPOSITORY", "Invalid backend repository key")
  if (!href.startsWith("/sap/bc/adt/abapgit/") || /[\\#]/.test(href))
    fail("UNSAFE_LINK", "Expected a relative abapGit ADT link")
  const parsed = new URL(href, "https://adt.invalid")
  const path = decodeURIComponent(parsed.pathname)
  if (/[\\%]/.test(path) || path.split("/").some(segment => segment === "." || segment === ".."))
    fail("UNSAFE_LINK", "Invalid encoded repository path")
  const base = `/sap/bc/adt/abapgit/repos/${repo.key}`
  if (path !== base && !path.startsWith(base + "/"))
    fail("UNSAFE_LINK", "Backend link belongs to a different repository")
  return href
}

function validateRepo(repo: GitRepo) {
  const url = new URL(repo.url)
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    fail(
      "UNSAFE_REPOSITORY_URL",
      "Use an HTTPS repository URL without embedded credentials, query or fragment"
    )
}

const allFiles = (staging: GitStaging) =>
  [...staging.staged, ...staging.unstaged].flatMap(object =>
    object.abapGitFiles.map(file => ({ object, file }))
  )

function selected(staging: GitStaging, keys: FileKey[]) {
  if (!keys.length || keys.length > MAX_FILES)
    fail("INVALID_SELECTION", `Select between 1 and ${MAX_FILES} exact file paths`)
  if (new Set(keys.map(key)).size !== keys.length)
    fail("INVALID_SELECTION", "Duplicate file selection")
  return keys.map(wanted => {
    const matches = allFiles(staging).filter(({ file }) => key(file) === key(wanted))
    if (matches.length !== 1)
      fail("INVALID_SELECTION", "A selected file is missing, ignored or ambiguous; refresh status")
    return matches[0]
  })
}

function identity(user: GitUser) {
  if (
    !user?.name?.trim() ||
    user.name.length > 200 ||
    /[\x00-\x1f]/.test(user.name) ||
    !/^[^\s<>@]+@[^\s<>@]+$/.test(user.email || "") ||
    user.email.length > 254
  )
    fail("INVALID_IDENTITY", "Supply an explicit author/committer name and valid email")
}

function stagingForPush(staging: GitStaging, input: PrepareCommitInput): GitStaging {
  const wanted = new Set(input.files.map(key))
  const partition = (include: boolean) =>
    [...staging.staged, ...staging.unstaged]
      .map(object => ({
        ...object,
        abapGitFiles: object.abapGitFiles.filter(file => wanted.has(key(file)) === include)
      }))
      .filter(object => object.abapGitFiles.length)
  return {
    ...staging,
    staged: partition(true),
    unstaged: partition(false),
    comment: input.message,
    author: input.author,
    committer: input.committer || input.author
  }
}

export class AbapGitService {
  private reviews = new Map<string, Review>()
  private busy = new Set<string>()
  private now: () => number

  constructor(private dependencies: AbapGitDependencies) {
    this.now = dependencies.now || Date.now
  }

  private async repo(input: RepoInput) {
    const connectionId = input.connectionId.trim().toLowerCase()
    if (!connectionId || !input.repoId)
      fail("INVALID_REPOSITORY", "Specify connectionId and repoId")
    const client = this.dependencies.client(connectionId)
    const matches = (await client.gitRepos()).filter(repo => repo.key === input.repoId)
    if (matches.length !== 1) fail("REPOSITORY_NOT_FOUND", "Refresh the backend repository list")
    const repo = matches[0]
    validateRepo(repo)
    return { client, repo, connectionId }
  }

  async repositories(connectionId: string) {
    const repos = await this.dependencies.client(connectionId.trim().toLowerCase()).gitRepos()
    return repos.map(repo => {
      validateRepo(repo)
      return {
        repoId: repo.key,
        packageName: repo.sapPackage,
        url: repo.url,
        branch: repo.branch_name,
        status: repo.status,
        statusText: repo.status_text,
        canPreview: repo.links.some(link => link.type === "stage_link"),
        canCommitAndPush: repo.links.some(link => link.type === "push_link")
      }
    })
  }

  async capabilities(input: RepoInput) {
    const { repo } = await this.repo(input)
    return {
      repoId: repo.key,
      preview: repo.links.some(link => link.type === "stage_link"),
      commitAndPush: repo.links.some(link => link.type === "push_link"),
      remoteRefs: true,
      standaloneCommit: false,
      fetchGitObjects: false,
      merge: false,
      pullExposed: false,
      branchSwitchExposed: false,
      explanation:
        "This ADT adapter supports serialized staging and combined commit+push. Remote refs are not a local Git fetch. No standalone commit or merge endpoint is implemented. Import/pull and branch switching are not exposed by these tools. Advertised links do not prove authorization."
    }
  }

  private async staging(input: RepoInput, requiredCredentials = false) {
    const state = await this.repo(input)
    const { repo, client } = state
    const link = repo.links.find(link => link.type === "stage_link")
    if (!link) fail("UNSUPPORTED", "Backend does not advertise staging for this repository")
    repoPath(repo, link.href)
    const credentials = await this.dependencies.credentials(repo, requiredCredentials)
    const staging = await client.stageRepo(repo, credentials.user, credentials.password)
    return { ...state, credentials, staging }
  }

  async status(input: RepoInput) {
    const { repo, staging } = await this.staging(input)
    const summarize = (objects: GitStagingObject[]) =>
      objects.flatMap(object =>
        object.abapGitFiles.map(file => ({
          path: file.path,
          name: file.name,
          state: file.localState,
          objectName: object.name,
          objectType: object.type,
          hasLocalVersion: file.links.some(link => /localversion/.test(link.rel)),
          hasRemoteVersion: file.links.some(link => /remoteversion/.test(link.rel))
        }))
      )
    return {
      repoId: repo.key,
      packageName: repo.sapPackage,
      branch: repo.branch_name,
      staged: summarize(staging.staged),
      unstaged: summarize(staging.unstaged),
      ignored: summarize(staging.ignored),
      note: "Backend staging is serialized ABAP, not unsaved editor text or an activation result."
    }
  }

  private async snapshot(state: Awaited<ReturnType<AbapGitService["staging"]>>, files: FileKey[]) {
    let size = 0
    const result: FileSnapshot[] = []
    for (const { file } of selected(state.staging, files)) {
      const read = async (version: "localversion" | "remoteversion") => {
        const links = file.links.filter(link => link.rel.endsWith(version))
        if (links.length > 1) fail("INVALID_LINKS", "Ambiguous backend file version")
        if (!links.length) return null
        const source = await state.client.getObjectSource(repoPath(state.repo, links[0].href), {
          gitUser: state.credentials.user,
          gitPassword: state.credentials.password
        })
        const bytes = Buffer.byteLength(source, "utf8")
        size += bytes
        if (bytes > MAX_FILE_BYTES || size > MAX_REVIEW_BYTES)
          fail("REVIEW_TOO_LARGE", "Review fewer/smaller serialized files in one operation")
        return source
      }
      const local = await read("localversion")
      const remote = await read("remoteversion")
      if (local === null && remote === null)
        fail("INVALID_LINKS", "Neither serialized file version is available")
      result.push({
        path: file.path,
        name: file.name,
        local,
        remote,
        deletion: local === null || /^D(?:ELETED?)?$/i.test(file.localState)
      })
    }
    return result
  }

  async diff(input: RepoInput & { files: FileKey[] }) {
    const state = await this.staging(input)
    return { files: await this.snapshot(state, input.files), repoId: state.repo.key }
  }

  async remoteRefs(input: RepoInput) {
    const { client, repo } = await this.repo(input)
    const credentials = await this.dependencies.credentials(repo, false)
    const info = await client.gitExternalRepoInfo(repo.url, credentials.user, credentials.password)
    return {
      repoId: repo.key,
      branch: repo.branch_name,
      accessMode: info.access_mode,
      branches: info.branches,
      fetchPerformed: false
    }
  }

  private async remoteHead(state: Awaited<ReturnType<AbapGitService["staging"]>>) {
    const info = await state.client.gitExternalRepoInfo(
      state.repo.url,
      state.credentials.user,
      state.credentials.password
    )
    const branch = state.repo.branch_name.replace(/^\/?refs\/heads\//, "")
    const matches = info.branches.filter(
      item => item.name.replace(/^\/?refs\/heads\//, "") === branch && item.type !== "TAG"
    )
    if (matches.length !== 1 || !/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(matches[0].sha1))
      fail("REMOTE_HEAD_UNKNOWN", "Cannot determine the exact target branch SHA")
    return matches[0].sha1
  }

  private fingerprint(repo: GitRepo, staging: GitStaging, snapshots: FileSnapshot[]) {
    return digest({
      repo: {
        key: repo.key,
        sapPackage: repo.sapPackage,
        url: repo.url,
        branch: repo.branch_name,
        links: repo.links
      },
      staging,
      snapshots: snapshots.map(file => ({
        ...file,
        local: digest(file.local),
        remote: digest(file.remote)
      }))
    })
  }

  private async requireActive(
    state: Awaited<ReturnType<AbapGitService["staging"]>>,
    files: FileKey[]
  ) {
    const objects = selected(state.staging, files).map(item => item.object)
    const pending = (await state.client.inactiveObjects()).flatMap(record =>
      record.object ? [record.object] : []
    )
    if (
      pending.some(item =>
        objects.some(object => {
          const nameMatches = item["adtcore:name"].toUpperCase() === object.name.toUpperCase()
          const typeMatches = item["adtcore:type"].split("/")[0] === object.type.split("/")[0]
          const uri = item["adtcore:uri"]
          const parent = item["adtcore:parentUri"]
          const uriMatches =
            !!object.uri &&
            [uri, parent].some(
              path => path === object.uri || path?.startsWith(object.uri.replace(/\/$/, "") + "/")
            )
          return (nameMatches && typeMatches) || uriMatches
        })
      )
    )
      fail(
        "INACTIVE_CHANGES",
        "Selected objects have backend-visible inactive changes. Review and activate separately before export; these tools never activate."
      )
  }

  // Przygotowanie niczego nie wysyła: wybór i stan źródeł są ważne tylko przez krótki czas.
  async prepareCommit(input: PrepareCommitInput) {
    identity(input.author)
    if (input.committer) identity(input.committer)
    if (
      !input.message?.trim() ||
      input.message.length > 4000 ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.message)
    )
      fail("INVALID_MESSAGE", "Supply a nonempty commit message of at most 4000 characters")
    const state = await this.staging(input, true)
    const push = state.repo.links.find(link => link.type === "push_link")
    if (!push) fail("UNSUPPORTED", "Backend does not advertise commit+push")
    repoPath(state.repo, push.href)
    const remoteSha = await this.remoteHead(state)
    await this.requireActive(state, input.files)
    const files = await this.snapshot(state, input.files)
    if (files.every(file => file.local === file.remote))
      fail("NO_CHANGES", "Selected serialized files have no content changes")
    if (files.some(file => file.deletion) && !input.allowDeletions)
      fail("DELETION_REQUIRES_REVIEW", "Review deletions and explicitly set allowDeletions")
    if ((await this.remoteHead(state)) !== remoteSha)
      fail("STALE_REVIEW", "Remote branch changed during review; prepare again")
    for (const [id, review] of this.reviews)
      if (review.expiresAt < this.now()) this.reviews.delete(id)
    if (this.reviews.size >= 100) fail("TOO_MANY_REVIEWS", "Too many unexpired reviews")
    const reviewId = randomUUID()
    const expiresAt = this.now() + REVIEW_TTL
    this.reviews.set(reviewId, {
      input: structuredClone({ ...input, connectionId: state.connectionId }),
      expiresAt,
      remoteSha,
      fingerprint: this.fingerprint(state.repo, state.staging, files)
    })
    return {
      reviewId,
      expiresAt: new Date(expiresAt).toISOString(),
      branch: state.repo.branch_name,
      remoteSha,
      message: input.message,
      author: input.author,
      committer: input.committer || input.author,
      files,
      effect:
        "No commit, push, import or activation has occurred. Confirm this exact review before commit+push."
    }
  }

  // Identyfikator próby zapisujemy przed POST; po utracie odpowiedzi nie ponawiamy zapisu.
  async commitAndPush(input: CommitInput) {
    if (input.confirm !== true)
      fail("CONFIRM_REQUIRED", "Explicitly confirm the reviewed commit+push")
    const review = this.reviews.get(input.reviewId)
    if (!review || review.expiresAt <= this.now())
      fail(
        "REVIEW_EXPIRED",
        "Prepare and review the commit again; review tokens do not survive restart"
      )
    const connectionId = input.connectionId.trim().toLowerCase()
    if (review.input.connectionId !== connectionId || review.input.repoId !== input.repoId)
      fail("REVIEW_MISMATCH", "Review belongs to a different connection or repository")
    // Serializacja zapisów zapobiega także utracie wpisów wspólnego dziennika prób.
    const lock = "commit-and-push"
    if (this.busy.has(lock))
      fail("REPOSITORY_BUSY", "Another abapGit commit+push is running in this extension host")
    this.busy.add(lock)
    this.reviews.delete(input.reviewId)
    try {
      const state = await this.staging(review.input, true)
      const files = await this.snapshot(state, review.input.files)
      const remoteBefore = await this.remoteHead(state)
      await this.requireActive(state, review.input.files)
      if (
        remoteBefore !== review.remoteSha ||
        this.fingerprint(state.repo, state.staging, files) !== review.fingerprint
      )
        fail("STALE_REVIEW", "SAP files, staging, repository or remote SHA changed; review again")
      const operation: GitOperation = {
        connectionId,
        repoId: input.repoId,
        reviewId: input.reviewId,
        operationId: randomUUID(),
        startedAt: new Date(this.now()).toISOString(),
        state: "unknown",
        branch: state.repo.branch_name,
        remoteBefore,
        files: review.input.files
      }
      const save = async () => {
        const operations = this.dependencies
          .loadOperations()
          .filter(item => item.operationId !== operation.operationId)
        await this.dependencies.saveOperations([...operations, operation].slice(-100))
      }
      await save()
      try {
        await state.client.pushRepo(
          state.repo,
          stagingForPush(state.staging, review.input),
          state.credentials.user,
          state.credentials.password
        )
        operation.state = "accepted"
      } catch {
        // Brak pewności co do skutku POST, także przy timeout; nie ujawniamy surowego wyjątku.
      }
      try {
        operation.remoteAfter = await this.remoteHead(state)
      } catch {
        // Odczyt kontrolny nie może zamienić zaakceptowanego żądania w ponowny POST.
      }
      await save()
      return {
        ...operation,
        note: "Accepted means the backend returned without error, not verified commit completion. Unknown requires reconciliation. Check remote refs and staging; never automatically retry this POST. The backend API has no compare-and-swap guarantee against concurrent clients."
      }
    } finally {
      this.busy.delete(lock)
    }
  }

  operation(input: RepoInput & { operationId?: string }) {
    const operations = this.dependencies
      .loadOperations()
      .filter(
        item =>
          item.connectionId === input.connectionId.trim().toLowerCase() &&
          item.repoId === input.repoId
      )
    if (!input.operationId) return { operations }
    const operation = operations.find(item => item.operationId === input.operationId)
    if (!operation)
      fail("OPERATION_NOT_FOUND", "No recorded operation with this ID in this repository")
    return operation
  }
}
