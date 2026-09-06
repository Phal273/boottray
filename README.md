# Boottray

## Edits should wipe their feet

Edits are useful. Silent inserts are not.

Boottray gives every staged selection a place to land before it touches your files. Staged selections sit in a small review tray beside the editor. You can open the diff, accept the selection, or reject it. Nothing slips into the document before you say yes.

This is the missing mini PR for the editor. Blunt, visible, reversible.

## What is here

- `Boottray: Open` opens the tray in the activity bar.
- `Boottray: Stage Selection` parks the current selection, or the whole file when there is no selection.
- Accept or reject a staged selection with a real `WorkspaceEdit`.
- A status bar count keeps the queue in view.

## Run it

Requirements: Node.js and VS Code.

Open this folder in VS Code or Cursor, then press `F5`. A new Extension Development Host opens.

1. Select text in the editor and run `Boottray: Stage Selection`.
2. Open the Boottray icon in the activity bar.
3. Expand the proposal and inspect the hunk.
4. Click `Accept` to apply it, or `Reject` to discard it. The editor stays unchanged until you accept.
## Screenshots

Screenshots belong here. The UI is intentionally dark ink, warm paper, and boot brown. No clutter.

- `docs/boottray-empty.png` - clean tray
- `docs/boottray-diff.png` - staged hunk review

## Why it exists

I got tired of cleaning up edits I never explicitly approved. The editor should not become a suggestion landfill. Boottray treats each selection like a patch from a teammate: show the work, let me inspect it, then let me say yes.

No silent inserts. No mystery changes. Just a tray and a decision.
## Development

Run the TypeScript watcher with the compile command from package.json.

The project uses the VS Code Extension API and TypeScript. It has no remote, no service, and no model dependency.
