const state = vi.hoisted(() => ({
  update: vi.fn(),
  setPassword: vi.fn(),
  getPassword: vi.fn(),
  inputBox: vi.fn()
}))
vi.mock("../../extension", () => ({ context: { globalState: {} } }))
vi.mock("../../adt/conections", () => ({ getClient: vi.fn() }))
vi.mock("../../lib", async () => {
  const tasks =
    await vi.importActual<typeof import("../../lib/rfsTaskEither")>("../../lib/rfsTaskEither")
  const functions =
    await vi.importActual<typeof import("../../lib/functions")>("../../lib/functions")
  return {
    chainTaskTransformers: tasks.chainTaskTransformers,
    createTaskTransformer: tasks.createTaskTransformer,
    fieldReplacer: functions.fieldReplacer,
    createStore: () => ({ get: () => "", update: state.update }),
    PasswordVault: {
      get: () => ({ getPassword: state.getPassword, setPassword: state.setPassword })
    },
    inputBox: state.inputBox
  }
})

import { repoCredentials } from "./credentials"

describe("abapGit credential storage completion", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.update.mockResolvedValue(undefined)
    state.setPassword.mockResolvedValue(undefined)
    state.getPassword.mockResolvedValue(undefined)
    state.inputBox.mockImplementation(options => async () => ({
      _tag: "Right",
      right: options.password ? "example-secret" : "example-user"
    }))
  })

  it("does not report saved credentials before SecretStorage completes", async () => {
    let save!: () => void
    state.setPassword.mockReturnValueOnce(
      new Promise<void>(resolve => {
        save = resolve
      })
    )
    let completed = false
    const result = repoCredentials("https://git.example/repo.git").then(value => {
      completed = true
      return value
    })
    await vi.waitFor(() => expect(state.setPassword).toHaveBeenCalledTimes(1))
    expect(completed).toBe(false)
    save()
    expect(await result).toMatchObject({ _tag: "Some" })
    expect(completed).toBe(true)
  })

  it("does not claim success when SecretStorage rejects a write", async () => {
    state.setPassword.mockRejectedValueOnce(new Error("storage unavailable"))
    expect(await repoCredentials("https://git.example/repo.git")).toEqual({ _tag: "None" })
  })

  it("waits for the username store before attempting the secret write", async () => {
    let save!: () => void
    state.update.mockReturnValueOnce(
      new Promise<void>(resolve => {
        save = resolve
      })
    )
    const result = repoCredentials("https://git.example/repo.git")
    await vi.waitFor(() => expect(state.update).toHaveBeenCalledTimes(1))
    expect(state.setPassword).not.toHaveBeenCalled()
    save()
    expect(await result).toMatchObject({ _tag: "Some" })
  })

  it("does not save a secret when the password prompt is cancelled", async () => {
    state.inputBox.mockImplementation(
      options => async () =>
        options.password
          ? { _tag: "Left", left: { _tag: "None" } }
          : { _tag: "Right", right: "example-user" }
    )
    expect(await repoCredentials("https://git.example/repo.git")).toEqual({ _tag: "None" })
    expect(state.setPassword).not.toHaveBeenCalled()
  })
})
