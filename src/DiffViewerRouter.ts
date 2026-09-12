import * as vscode from 'vscode';
import { MonacoDiffProvider } from './MonacoDiffProvider';
import { NativeDiffProvider } from './NativeDiffProvider';

export type DiffViewerMode = 'custom' | 'native';

const CONFIG_SECTION = 'cc-diff';
const CONFIG_KEY = 'diffViewer';

/** Read the configured viewer. Anything unrecognised falls back to the custom panel. */
export function getDiffViewerMode(): DiffViewerMode {
  const value = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>(CONFIG_KEY);
  return value === 'native' ? 'native' : 'custom';
}

/**
 * Fronts both diff viewers and dispatches on the `cc-diff.diffViewer` setting.
 *
 * Consumers (the sidebar) only ever talk to this router, so the two
 * implementations stay behind a single surface with identical semantics.
 */
export class DiffViewerRouter implements vscode.Disposable {
  private _custom: MonacoDiffProvider;
  private _native: NativeDiffProvider;
  private _outputChannel: vscode.OutputChannel;
  private _configListener: vscode.Disposable;

  constructor(
    custom: MonacoDiffProvider,
    native: NativeDiffProvider,
    outputChannel: vscode.OutputChannel,
  ) {
    this._custom = custom;
    this._native = native;
    this._outputChannel = outputChannel;

    this._configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(`${CONFIG_SECTION}.${CONFIG_KEY}`)) return;
      const mode = getDiffViewerMode();
      // Close whatever is open rather than re-rendering it: an open custom panel
      // would otherwise linger alongside a newly-configured native tab.
      this._outputChannel.appendLine(
        `[DiffViewerRouter] diffViewer changed to "${mode}" — closing open views`
      );
      this._custom.dispose();
      void this._native.close();
    });
  }

  /** Workspace-relative key of the file shown in whichever viewer is active. */
  get currentFile(): string {
    return getDiffViewerMode() === 'native' ? this._native.currentFile : this._custom.currentFile;
  }

  openDiff(filePath: string): void {
    if (getDiffViewerMode() === 'native') {
      this._native.openDiff(filePath);
    } else {
      this._custom.openDiff(filePath);
    }
  }

  async keepAll(filePath: string): Promise<void> {
    if (getDiffViewerMode() === 'native') {
      await this._native.keepAll(filePath);
    } else {
      await this._custom.keepAll(filePath);
    }
  }

  async undoAll(filePath: string): Promise<void> {
    if (getDiffViewerMode() === 'native') {
      await this._native.undoAll(filePath);
    } else {
      await this._custom.undoAll(filePath);
    }
  }

  hasActiveDiff(filePath: string): boolean {
    return getDiffViewerMode() === 'native'
      ? this._native.hasActiveDiff(filePath)
      : this._custom.hasActiveDiff(filePath);
  }

  dispose(): void {
    this._configListener.dispose();
    this._native.dispose();
  }
}
