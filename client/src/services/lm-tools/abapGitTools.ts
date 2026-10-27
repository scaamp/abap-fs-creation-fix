import * as vscode from "vscode"
import { getClient } from "../../adt/conections"
import { PasswordVault } from "../../lib/externalmodules"
import { getDefaultUser } from "../../scm/abapGit/credentials"
import {
  AbapGitService,
  AbapGitToolError,
  type CommitInput,
  type FileKey,
  type GitOperation,
  type PrepareCommitInput,
  type RepoInput
} from "../abapGitService"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { registerToolWithRegistry } from "./toolRegistry"

export const abapGitToolNames = [
  "abapfs_abapgit_capabilities",
  "abapfs_abapgit_repositories",
  "abapfs_abapgit_status",
  "abapfs_abapgit_diff",
  "abapfs_abapgit_remote_refs",
  "abapfs_abapgit_prepare_commit",
  "abapfs_abapgit_commit_and_push",
  "abapfs_abapgit_operation"
] as const
type ToolName = (typeof abapGitToolNames)[number]
type Input = RepoInput &
  Partial<PrepareCommitInput & CommitInput> & { operationId?: string; files?: FileKey[] }

export class AbapGitTool implements vscode.LanguageModelTool<Input> {
  constructor(
    private name: ToolName,
    private service: AbapGitService
  ) {}

  async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<Input>) {
    if (this.name === "abapfs_abapgit_commit_and_push")
      return {
        invocationMessage: "Submitting the reviewed ABAP commit and push",
        confirmationMessages: {
          title: "Commit and push ABAP objects",
          message: new vscode.MarkdownString(
            `Submit reviewed change ${options.input.reviewId} to repository ${options.input.repoId}? This creates a remote Git commit. It does not activate SAP objects.`
          )
        }
      }
    return { invocationMessage: "Reading abapGit repository information" }
  }

  async invoke(options: vscode.LanguageModelToolInvocationOptions<Input>) {
    assertToolInvocationAuthorized(options)
    let result: unknown
    try {
      if (
        this.name === "abapfs_abapgit_commit_and_push" &&
        !options.toolInvocationToken &&
        !vscode.workspace.getConfiguration("abapfs.mcpServer").get("exposeEditTool", true)
      )
        throw new AbapGitToolError(
          "EDIT_DISABLED",
          "abapGit commit+push is disabled for MCP by exposeEditTool"
        )
      const input = options.input
      switch (this.name) {
        case "abapfs_abapgit_capabilities":
          result = await this.service.capabilities(input)
          break
        case "abapfs_abapgit_repositories":
          result = await this.service.repositories(input.connectionId)
          break
        case "abapfs_abapgit_status":
          result = await this.service.status(input)
          break
        case "abapfs_abapgit_diff":
          result = await this.service.diff({ ...input, files: input.files || [] })
          break
        case "abapfs_abapgit_remote_refs":
          result = await this.service.remoteRefs(input)
          break
        case "abapfs_abapgit_prepare_commit":
          result = await this.service.prepareCommit(input as PrepareCommitInput)
          break
        case "abapfs_abapgit_commit_and_push":
          result = await this.service.commitAndPush(input as CommitInput)
          break
        case "abapfs_abapgit_operation":
          result = this.service.operation(input)
          break
      }
    } catch (error) {
      // Nie zwracaj surowego błędu HTTP: może zawierać konfigurację lub credentiale Git.
      result =
        error instanceof AbapGitToolError
          ? { error: error.code, message: error.message }
          : {
              error: "ABAPGIT_REQUEST_FAILED",
              message:
                "abapGit request failed. Check backend capability, SAP permissions and Git credentials in the ABAP FS abapGit panel. No automatic retry was performed."
            }
    }
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(result))
    ])
  }
}

export function registerAbapGitTools(context: vscode.ExtensionContext) {
  const service = new AbapGitService({
    client: getClient,
    credentials: async (repo, required) => {
      const user = getDefaultUser(repo.url)
      const password = user
        ? (await PasswordVault.get().getPassword(`vscode.abapgit${repo.url}`, user)) || ""
        : ""
      if (required && (!user || !password))
        throw new AbapGitToolError(
          "AUTH_REQUIRED",
          "Run ABAP FS: Configure abapGit credentials in the same VS Code profile first. Tools never request passwords/tokens in model parameters or wait for a hidden credential dialog."
        )
      return { user, password }
    },
    loadOperations: () => context.workspaceState.get<GitOperation[]>("abapGitMcpOperations", []),
    saveOperations: async operations => {
      await context.workspaceState.update("abapGitMcpOperations", operations)
    }
  })
  for (const name of abapGitToolNames)
    context.subscriptions.push(registerToolWithRegistry(name, new AbapGitTool(name, service)))
}
