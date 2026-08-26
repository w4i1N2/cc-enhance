import type * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface GrammarInfo {
  scopeName: string;
  format: 'json' | 'plist';
  content: string;
  languageId?: string;
}

export interface LanguageContribution {
  id?: string;
  extensions?: string[];
  filenames?: string[];
}

/**
 * Lazily access the vscode module. `vscode` is only available inside the
 * extension host, so a guarded require keeps this module loadable from plain
 * Node (used to unit-test the pure helpers in test/grammar-manager.test.js)
 * while behaving identically within the extension.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
function vscodeApi(): typeof import('vscode') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('vscode') as typeof import('vscode');
}

/** Map contributed extensions/filenames → language id (third-party language packs). */
export function buildExtensionMap(extensions: Array<{ packageJSON: any }>): Map<string, string> {
  const map = new Map<string, string>();
  for (const ext of extensions) {
    const langs: LanguageContribution[] | undefined = ext.packageJSON?.contributes?.languages;
    if (!langs) continue;
    for (const lang of langs) {
      if (!lang.id) continue;
      for (const e of lang.extensions || []) map.set(e.toLowerCase(), lang.id);
      for (const f of lang.filenames || []) map.set(f.toLowerCase(), lang.id);
    }
  }
  return map;
}

/** Escape a glob to a RegExp source (supports *, **, ?). */
function globToRegExp(glob: string): RegExp {
  const src = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp('^' + src + '$');
}

export function globMatch(pattern: string, p: string): boolean {
  return globToRegExp(pattern).test(p);
}

/** Match a path against files.associations globs; most-specific first. */
export function matchAssociations(
  associations: Record<string, string | { language: string }>,
  relPath: string
): string | null {
  const rel = relPath.replace(/\\/g, '/');
  const keys = Object.keys(associations || {}).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (!globMatch(key, rel)) continue;
    const val = associations[key];
    if (typeof val === 'string') return val;
    if (val && typeof val.language === 'string') return val.language;
  }
  return null;
}

export class GrammarManager {
  resolveLanguageId(filePath: string, workspaceRoot: string): string {
    const vs = vscodeApi();
    const uri = vs.Uri.file(path.resolve(workspaceRoot, filePath));
    const assoc = vs.workspace
      .getConfiguration('files', uri)
      .get<Record<string, string | { language: string }>>('associations', {});
    const relPath = filePath.replace(/\\/g, '/');
    const fromAssoc =
      matchAssociations(assoc, relPath) ?? matchAssociations(assoc, path.basename(filePath));
    if (fromAssoc) return fromAssoc;

    const map = buildExtensionMap(vs.extensions.all as any);
    const ext = path.extname(filePath).toLowerCase();
    if (ext && map.has(ext)) return map.get(ext)!;
    const base = path.basename(filePath).toLowerCase();
    if (map.has(base)) return map.get(base)!;

    return ''; // signal: webview falls back to its hardcoded map
  }

  findGrammar(languageIdOrScope: string): GrammarInfo | null {
    const vs = vscodeApi();
    for (const ext of vs.extensions.all) {
      const grammars = ext.packageJSON?.contributes?.grammars;
      if (!grammars) continue;
      for (const g of grammars) {
        const isLang = g.language === languageIdOrScope;
        const isScope = g.scopeName === languageIdOrScope;
        if (!isLang && !isScope) continue;
        const absPath = path.join(ext.extensionPath, g.path);
        if (!fs.existsSync(absPath)) continue;
        const content = fs.readFileSync(absPath, 'utf8');
        const format: 'json' | 'plist' = content.trimStart().startsWith('{') ? 'json' : 'plist';
        return { scopeName: g.scopeName, format, content, languageId: g.language };
      }
    }
    return null;
  }
}
