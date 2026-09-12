// Copy webview HTML templates from src/webview/ to out/webview/, plus
// Monaco's min/vs assets from node_modules into out/webview/vs.
//
// This is needed because .vscodeignore excludes src/** and node_modules/**
// from the VSIX package, while MonacoDiffProvider loads the editor at runtime
// from <extension>/out/webview/vs/loader.js.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'webview');
const OUT = path.join(ROOT, 'out', 'webview');
const MONACO_VS = path.join(ROOT, 'node_modules', 'monaco-editor', 'min', 'vs');
const OUT_VS = path.join(OUT, 'vs');

// Ensure output directory exists
if (!fs.existsSync(OUT)) {
  fs.mkdirSync(OUT, { recursive: true });
}

// Copy all files from src/webview/ to out/webview/
const files = fs.readdirSync(SRC);
for (const file of files) {
  // Skip TS files (they get compiled), only copy static assets
  if (/\.(html|css|js|json|png|svg|woff2?)$/i.test(file)) {
    const src = path.join(SRC, file);
    const dest = path.join(OUT, file);
    fs.copyFileSync(src, dest);
    console.log(`[copy-webview] Copied ${path.relative(ROOT, src)} -> ${path.relative(ROOT, dest)}`);
  }
}

// Copy Monaco's min/vs (~13 MB) so the packaged extension carries the editor
// assets on its own. Copied unconditionally: a stale out/webview/vs from an
// older monaco-editor version would silently mis-match the webview template.
if (!fs.existsSync(MONACO_VS)) {
  console.error(`[copy-webview] ERROR: ${path.relative(ROOT, MONACO_VS)} not found — run npm install`);
  process.exit(1);
}
fs.rmSync(OUT_VS, { recursive: true, force: true });
fs.cpSync(MONACO_VS, OUT_VS, { recursive: true });
console.log(`[copy-webview] Copied monaco-editor/min/vs -> ${path.relative(ROOT, OUT_VS)}`);

console.log('[copy-webview] Done');
