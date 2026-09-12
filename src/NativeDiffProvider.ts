import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SnapshotManager } from './SnapshotManager';

/** Scheme serving the read-only snapshot (left) side of a native diff. */
export const SNAPSHOT_SCHEME = 'cc-diff-snapshot';

/** Scheme serving an empty document, used as the right side when the workspace file is gone. */
export const EMPTY_SCHEME = 'cc-diff-empty';

/**
 * Serves file contents for the two virtual schemes above.
 *
 * The left side of every native diff is a snapshot that only exists inside
 * `.claude/cc-diff/snapshots/`, so it needs a virtual document. The right side
 * is normally the real file URI (so it stays editable in the native editor);
 * the empty scheme only backs the deleted-file case, where there is no file to
 * point at.
 */
class SideContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  private _snapshotManager: SnapshotManager;

  constructor(snapshotManager: SnapshotManager) {
    this._snapshotManager = snapshotManager;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    if (uri.scheme === EMPTY_SCHEME) return '';

    // uri.path is already decoded and starts with '/'.
    const filePath = uri.path.replace(/^\/+/, '');
    return this._snapshotManager.getSnapshotContent(filePath) ?? '';
  }

  /**
   * Invalidate cached content for a URI.
   *
   * VS Code caches virtual documents per URI, so without this a diff reopened
   * after an Undo would render the previously read snapshot.
   */
  refresh(uri: vscode.Uri): void {
    this._onDidChange.fire(uri);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

/**
 * Opens file diffs in VS Code's built-in diff editor instead of the custom
 * CC Diff webview panel.
 *
 * The native editor is read-only from our side: it cannot render Keep/Undo
 * buttons, so those stay in the sidebar (see DiffViewerRouter). Its editor-title
 * menu items don't appear either — those are gated on
 * `activeWebviewPanelId == cc-diff.monacoDiff`, which only matches the webview.
 */
export class NativeDiffProvider implements vscode.Disposable {
  private _workspaceRoot: string;
  private _snapshotManager: SnapshotManager;
  private _outputChannel: vscode.OutputChannel;
  private _contentProvider: SideContentProvider;
  private _registrations: vscode.Disposable[] = [];

  /** Workspace-relative key of the file currently shown, or '' when none. */
  private _currentFile = '';

  constructor(
    workspaceRoot: string,
    snapshotManager: SnapshotManager,
    outputChannel: vscode.OutputChannel,
  ) {
    this._workspaceRoot = workspaceRoot;
    this._snapshotManager = snapshotManager;
    this._outputChannel = outputChannel;

    this._contentProvider = new SideContentProvider(snapshotManager);
    this._registrations.push(
      vscode.workspace.registerTextDocumentContentProvider(SNAPSHOT_SCHEME, this._contentProvider),
      vscode.workspace.registerTextDocumentContentProvider(EMPTY_SCHEME, this._contentProvider),
    );
  }

  /** Expose current file for symmetry with MonacoDiffProvider. */
  get currentFile(): string {
    return this._currentFile;
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /** Open the native diff view for the given file */
  openDiff(filePath: string): void {
    this._openDiff(filePath).catch((err) => {
      this._log(`openDiff failed for "${filePath}": ${err}`);
    });
  }

  async keepAll(filePath: string): Promise<void> {
    this._snapshotManager.keepAll(filePath);
    if (this._currentFile === filePath) {
      await this.close();
    }
  }

  async undoAll(filePath: string): Promise<void> {
    const result = this._snapshotManager.undoAll(filePath, this._workspaceRoot);
    if (!result.success) {
      vscode.window.showErrorMessage(
        vscode.l10n.t('CC Diff: Failed to revert "{0}" — {1}', filePath, result.error || '')
      );
      return;
    }
    if (this._currentFile === filePath) {
      await this.close();
    }
  }

  hasActiveDiff(filePath: string): boolean {
    return this._currentFile === filePath && this._findOurTabs().length > 0;
  }

  /** Close the native diff tab we opened, if any. */
  async close(): Promise<void> {
    const tabs = this._findOurTabs();
    this._currentFile = '';
    if (tabs.length > 0) {
      await vscode.window.tabGroups.close(tabs, true);
    }
  }

  dispose(): void {
    void this.close();
    for (const registration of this._registrations) {
      registration.dispose();
    }
    this._registrations = [];
    this._contentProvider.dispose();
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private async _openDiff(filePath: string): Promise<void> {
    // Same file already on screen — leave it alone rather than closing and
    // reopening, which would flicker the tab. _findOurTabs() keeps this honest
    // if the user closed the tab by hand.
    if (this._currentFile === filePath && this._findOurTabs().length > 0) {
      return;
    }

    // Treat missing snapshot as empty (file creation scenario)
    const snapshotContent = this._snapshotManager.getSnapshotContent(filePath) ?? '';

    const absPath = this._snapshotManager.resolveWorkspaceFile(filePath);
    let currentContent = '';
    let currentExists = false;
    try {
      currentContent = fs.readFileSync(absPath, 'utf8');
      currentExists = true;
    } catch {
      // File deleted — treat as empty
    }

    if (snapshotContent === currentContent) {
      vscode.window.showInformationMessage(
        vscode.l10n.t('CC Diff: No changes to display for "{0}".', filePath)
      );
      return;
    }

    // Drop our previous diff first so only one cc-diff diff is ever open,
    // matching the single-panel behaviour of the custom viewer.
    await this.close();

    const relPath = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const leftUri = vscode.Uri.from({ scheme: SNAPSHOT_SCHEME, path: '/' + relPath });
    const rightUri = currentExists
      ? vscode.Uri.file(absPath)
      : vscode.Uri.from({ scheme: EMPTY_SCHEME, path: '/' + relPath });

    // Drop any cached read of this snapshot before showing it again.
    this._contentProvider.refresh(leftUri);

    this._currentFile = filePath;

    const title = vscode.l10n.t('CC Diff: {0} (Snapshot ↔ Current)', path.basename(filePath));
    await vscode.commands.executeCommand(
      'vscode.diff',
      leftUri,
      rightUri,
      title,
      { preview: false }
    );
    this._log(`Opened native diff for "${filePath}" (file exists: ${currentExists})`);
  }

  /** All open diff tabs that belong to us (either side carries our scheme). */
  private _findOurTabs(): vscode.Tab[] {
    const ours: vscode.Tab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (input instanceof vscode.TabInputTextDiff) {
          const schemes = [input.original.scheme, input.modified.scheme];
          if (schemes.includes(SNAPSHOT_SCHEME) || schemes.includes(EMPTY_SCHEME)) {
            ours.push(tab);
          }
        }
      }
    }
    return ours;
  }

  private _log(msg: string): void {
    this._outputChannel.appendLine(`[NativeDiffProvider] ${msg}`);
  }
}
