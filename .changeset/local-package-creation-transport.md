---
"vscode-abap-remote-fs": patch
---

Read the target package's change-recording flag before creation transport selection. Skip transport dialogs, checks and request creation when recording is explicitly disabled, for both the wizard and MCP. Keep existing-object handling and unknown/legacy package fallback unchanged. Expose the same package check in read-only creation diagnostics.
