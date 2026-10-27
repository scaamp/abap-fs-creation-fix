# abapGit Integration

abapGit integration lets you manage Git version control for ABAP objects directly in VS Code, without leaving the editor.

## MCP tools (2.13.0 preview)

This preview adds a structured interface to the existing SAP-side abapGit adapter. It does not invoke Eclipse, execute local Git commands, or install an abapGit backend. Discover capabilities again for each system/repository; the presence of an ADT collection does not prove authorization or support for all object types.

First published together in **2.13.2 MCP preview 3**. [Live acceptance, installation and limits](../mcp-preview-validation.md) include an independently verified exact two-file commit+push; other backend/system combinations still require verification.

| Tool | Effect |
| --- | --- |
| `abapfs_abapgit_repositories` | Read linked backend IDs, packages, URLs, branches and advertised links |
| `abapfs_abapgit_capabilities` | Read adapter limits and advertised preview/commit+push support |
| `abapfs_abapgit_status` | Read staged, unstaged and ignored serialized file identities |
| `abapfs_abapgit_diff` | Read selected local/remote serialized versions; `null` means no version link, while an empty response alone does not prove that a remote file exists |
| `abapfs_abapgit_remote_refs` | Read remote branches and SHAs through SAP; no Git objects are fetched into a local checkout |
| `abapfs_abapgit_prepare_commit` | Build a short-lived exact review, with file contents, message, identities and remote SHA; no Git commit is created |
| `abapfs_abapgit_commit_and_push` | Submit the reviewed combined backend commit+push after explicit authorization |
| `abapfs_abapgit_operation` | Read persisted local metadata of attempts, including after timeout/restart |

### Commit, push, fetch and merge are different operations

The implemented ADT adapter advertises a combined **commit and push** operation. There is no implemented standalone local-commit or merge contract. Preparing a commit only prepares a review; it does not create a Git object. Remote refs are not a full `git fetch`. Import/pull, branch switching, repository creation/unlinking and merge are deliberately outside this first MCP interface. Existing interactive VS Code features are unchanged.

The SAP backend performs serialization and Git communication. A raw ABAP source download is not an abapGit export: metadata and serialized sidecar files matter. Do not substitute local `git add` for backend staging.

### Read and review workflow

1. Call `repositories` with an explicit `connectionId`; use its exact `repoId` in later calls. Check the package, URL, branch and `capabilities`. This adapter requires standard HTTPS Git repository URLs without userinfo, query or fragment, and relative ADT links confined to that repository.
2. Inspect `status`, `remote_refs` and `diff`. `files` is an explicit array of `{ "path": "/src/", "name": "zexample.clas.abap" }` selected from status; no wildcard or implicit stage-all is accepted. The local version is the backend serialization, not unsaved editor text or a promise about inactive sources.
3. Run **ABAP FS: Configure abapGit credentials** from the Command Palette in the same profile. Tools use the existing VS Code secret storage; they never accept passwords/PATs in their schemas and never wait on a hidden credential dialog. Missing write credentials return `AUTH_REQUIRED`. Anonymous reads may work for public repositories. Eclipse's credential store is separate.
4. Call `prepare_commit` with exact files, `message`, `author: { name, email }`, and optionally a distinct `committer`. Identity fields are explicit; the Git login is not silently reused as the commit email. Deletions require `allowDeletions: true`. Review the returned complete versions, target SHA, identities and message with the user. Backend-visible inactive changes in selected objects/components block export; these tools never activate objects. Visibility is limited to the backend's inactive-object response, not other users' unsaved editor buffers.
5. Only after authorization of that exact review call `commit_and_push` with the same connection/repository, its `reviewId` and `confirm: true`. The review expires after 10 minutes, survives neither use nor extension restart, and stores hashes rather than source copies. Serialized file contents, staging metadata, repository identity, target SHA and inactive changes are rechecked before submission. Any change requires a new review. Unselected files remain unselected.
6. Inspect the result, then read `operation`, `remote_refs` and `status`. `accepted` means the backend returned without error, **not** that the exact commit is verified complete. `unknown` means the POST outcome could not be established. Do not automatically repeat it. Read recorded attempts when the MCP caller timed out and did not receive an operation ID. Reconcile against the remote repository and SAP staging before deciding on further action.

There is no atomic compare-and-swap guarantee against another Eclipse/VS Code client in this ADT contract. The adapter rechecks immediately before submission and serializes its own push operations; it cannot lock out other clients. A remote SHA change alone is not proof that this particular commit succeeded. No force-push, activation, service publication or SAP import is performed by these tools.

Each review is limited to 50 files, 128 KiB per serialized version and 512 KiB total. Oversized reviews fail before submission; use smaller batches. At most 100 attempt records are kept in workspace state, without credentials or source bodies. Their status is a local observation, not authoritative Git history.

Git credentials can travel in abapGit-specific `Username`/`Password` headers and XML fields. The accompanying API patch redacts those log fields and escapes commit XML, including multiline messages. File contents, paths and commit identities may still contain private business metadata; inspect output before sharing it.

Setting `abapfs.mcpServer.exposeEditTool=false` hides commit+push from new MCP sessions and blocks its execution through already open MCP sessions. Read/prepare tools remain available. This setting is not a global read-only policy for every existing ABAP FS tool; native Copilot access is unchanged.

### Validation and first live test

Automated tests use mocked ADT responses. They cover exact selection, changes during review, missing credentials, inactive objects, link boundaries, size limits, single-use/expired reviews, concurrent submission, credential redaction and ambiguous POST results. A successful build is not proof of write compatibility with an arbitrary Cloud/ECC backend.

Use the isolated Extension Development Host or a separate profile to first test only `repositories`, `capabilities`, `status`, `remote_refs` and a small `diff` against an existing repository. Then inspect a `prepare_commit` review without submitting it. Test `commit_and_push` separately, only with explicit authorization for the reviewed export and a suitable test repository/branch. Verify the resulting remote commit and serialized files independently. Do not use `pull` as rollback: it imports into SAP. To roll back the extension, reinstall the stable v5 VSIX and reload; a remote Git commit is not undone by reinstalling an extension.

## Opening the abapGit Panel

1. Click the **ABAP FS** icon in the Activity Bar (left sidebar).
2. Expand the **abapGit** section.

### Configure Git credentials without starting a commit

Run **ABAP FS: Configure abapGit credentials** from the Command Palette (`Ctrl+Shift+P`). Select a linked repository, enter your Git username and put the repository access token in the hidden **Password** field. Existing stored credentials are reused. Secrets stay in this VS Code profile's SecretStorage; never pass them to MCP tools or paste them into a chat. The command saves credentials only: it does not stage, commit, push, pull, activate or change a branch. The success message confirms storage, not that the remote server has accepted the credentials. An initial SAP login may still be needed to discover linked repositories.

Credentials held in Eclipse, a browser, a separate Git client or another VS Code profile do not automatically populate this store. When MCP returns `AUTH_REQUIRED`, run this command in the profile that serves that MCP endpoint. Cancel either prompt to leave the operation without a commit or push.

## Common Tasks

### Link an existing repository

1. In the abapGit panel, click **Link Repository**.
2. Enter the Git URL and select the SAP package to link.

### Create a new repository

1. Click **Create Repository**.
2. Provide the Git URL and target package.

### View staged/unstaged changes

The abapGit panel lists all changed ABAP objects. Each entry shows whether it is staged or unstaged.

### Stage and commit (Push)

1. Select objects to stage, or stage all changes.
2. Click **Push** — this commits and pushes to the remote Git repository.
3. Enter a commit message when prompted.

### Pull (update from Git)

1. Click **Pull** on the linked repository.
2. **Note:** Pull overwrites local ABAP objects with the version from Git. Unsaved local changes will be lost.

### Register with VS Code Source Control

Click **Register in VS Code SCM** to surface the repository in VS Code's built-in Source Control view (`Ctrl+Shift+G`), enabling diffs and history browsing alongside the ABAP FS panel.

An explicit registration refreshes even a repository restored after restart and opens Source Control. Connection IDs differing only in case share one entry. Registration/read errors are shown instead of being left in an unobserved background task.

#### SCM diff documents

ABAP FS registers the document provider used by these diffs when the extension activates. Repositories previously added to VS Code Source Control are restored from workspace state when their SAP connection is available. Only the SAP connection ID, repository key, and optional user name are stored in workspace state; passwords/tokens are held separately in SecretStorage.

### Unlink a repository

Click the **Unlink** icon next to the repository to remove the connection without deleting any code.

## Tips

- Use **Pull** to sync a fresh system with an existing codebase stored in Git.
- The abapGit panel respects the active SAP connection — switch connections in the ABAP FS panel first if you work with multiple systems.
