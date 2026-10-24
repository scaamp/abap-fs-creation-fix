# Create Objects

Create new ABAP development objects directly from VS Code without opening SAP GUI.

## How to Create an Object

**Option 1 — Command Palette:**

1. Press `Ctrl+Shift+P` to open the Command Palette.
2. Type and select **ABAP FS: Create object**.
3. Follow the wizard prompts (object type, name, description, package).

**Option 2 — Explorer context menu:**

1. Right-click a package or folder in the ABAP Explorer.
2. Select **Create object**.
3. Follow the wizard prompts.

**Option 3 — Via Copilot:**

Ask Copilot in natural language, for example:

> *"Create a new class ZCL_MY_CLASS with description 'My class'"*

Copilot fills in the object details automatically. You will still be prompted to select a transport request.

## Supported Object Types

| Object type | Type code |
|---|---|
| Report / Program | `PROG/P` |
| Class | `CLAS/OC` |
| Interface | `INTF/OI` |
| Function Group | `FUGR/F` |
| Data Element | `DTEL/DE` |
| Domain | `DOMA` |
| Database Table | `TABL/DT` |
| CDS Data Definition | `DDLS/DF` |
| Message Class | `MSAG/N` |
| Package | `DEVC/K` |

Many additional types are supported. If the object type you need is not listed, try the wizard — it shows all types available in your connected system.

## Notes

- A **transport request** dialog always appears for objects that require transport. This step cannot be skipped.
- The new object opens in the editor automatically after creation.
- Objects must be **activated** before they can be used at runtime.

Class creation uses the ADT V4 representation when the class collection advertises
`application/vnd.sap.adt.oo.classes.v4+xml` in discovery. Other systems retain the
legacy representation. A failed creation request is not automatically resent.
Logon aliases containing `@` are not sent as the backend owner in V4; the authenticated
backend determines the owner. No system ID or transport number is inferred from a
connection label. CDS data definitions have their own ADT contract (`DDLS/DF`);
the class representation is never used for them.
