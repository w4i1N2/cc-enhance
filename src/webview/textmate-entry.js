// Bundled into out/webview/textmate.js exposing window.TextMate.
import { Registry } from 'vscode-textmate';
import { loadWASM, createOnigScanner, createOnigString } from 'vscode-oniguruma';
export { Registry, loadWASM, createOnigScanner, createOnigString };
