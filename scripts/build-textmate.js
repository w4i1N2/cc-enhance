// Bundle vscode-textmate + vscode-oniguruma for the Monaco webview,
// and copy the oniguruma WASM into the served webview directory.
const { build } = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'out', 'webview');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  await build({
    entryPoints: [path.join(ROOT, 'src', 'webview', 'textmate-entry.js')],
    bundle: true,
    format: 'iife',
    globalName: 'TextMate',
    outfile: path.join(OUT, 'textmate.js'),
    target: ['es2018'],
  });

  // Copy oniguruma WASM (sibling of the package.json we can resolve reliably)
  const wasmDir = path.dirname(require.resolve('vscode-oniguruma/package.json'));
  const wasmSrc = path.join(wasmDir, 'release', 'onig.wasm');
  fs.copyFileSync(wasmSrc, path.join(OUT, 'onig.wasm'));
  console.log('[build-textmate] wrote out/webview/textmate.js + onig.wasm');
}

main().catch((e) => { console.error(e); process.exit(1); });
