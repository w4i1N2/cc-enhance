# CLAUDE.md

## 项目概述

cc-diff 是一个 VSCode 扩展，在 Claude Code 对话结束后自动展示文件修改 diff，提供文件级别和 Hunk 级别的 Keep（接受）/ Undo（还原）控制，类似 Copilot 的 diff 功能。

## 架构

```
Claude Code Hooks                     VSCode 扩展
─────────────────                     ──────────
pre-tool-use.js   ──快照──▶  .claude/cc-diff/  ──监听──▶  extension.ts
post-tool-use.js  ──校验──▶  snapshots/<safeFile>.snap      ├─ SnapshotManager.ts
session-end.js    ──清理──▶  index.json (v2)                ├─ DiffViewerRouter.ts
                                                            ├─ MonacoDiffProvider.ts
                                                            ├─ NativeDiffProvider.ts
                                                            ├─ WebviewProvider.ts
                                                            └─ HooksManager.ts
```

- **Hook 脚本** (CJS, Node.js)：PreToolUse 保存快照，PostToolUse / Stop 校验并清理已还原的条目
- **VSCode 扩展** (TypeScript)：监听 `index.json` 信号文件 → 侧边栏 Webview 展示 diff → Keep/Undo
- **通信方式**：通过 `<workspace>/.claude/cc-diff/` 目录进行文件系统通信

## 数据模型

快照按文件扁平存储，`index.json` v2 记录被跟踪的文件。**不持久化 diff**，diff 在渲染时对照快照实时计算：

```
.claude/cc-diff/
  index.json                 ← { version: 2, files: IndexEntryV2[] }
  snapshots/
    src-MonacoDiffProvider.ts.snap
```

- `safeFile`：文件路径中的 `/` `\` `:` 替换为 `-`，用作快照文件名
- `file` 字段是 POSIX 相对路径；工作区外的文件记为绝对 POSIX 路径，避免 basename 歧义
- `index.json` 使用写临时文件 → rename 保证原子性，防止并发写入损坏

## 开发命令

```bash
# 编译（tsc + 拷贝 webview 静态资源与 Monaco min/vs 到 out/）
npm run build

# 类型检查（不输出文件）
npx tsc --noEmit

# 打包 VSIX
npx vsce package
powershell -File scripts/package.ps1        # 等价流程，可用 -Version 顺带改版本号

# F5 调试
在 VSCode 中打开本目录，按 F5 启动扩展开发宿主
```

## 关键文件

| 文件 | 用途 |
|------|------|
| `src/extension.ts` | 扩展入口：激活、命令注册、监听 `index.json` |
| `src/SnapshotManager.ts` | 核心状态管理：加载 index.json、Keep/Undo、写回快照与文件 |
| `src/lineOps.ts` | 行级 diff 工具：按行区间提取 / 替换文本 |
| `src/DiffViewerRouter.ts` | 按 `cc-diff.diffViewer` 设置在两种 diff 视图间路由 |
| `src/MonacoDiffProvider.ts` | 内置 Monaco diff 面板（webview） |
| `src/NativeDiffProvider.ts` | VS Code 原生 diff 编辑器（只读虚拟文档） |
| `src/WebviewProvider.ts` | 侧边栏 Webview UI |
| `src/HooksManager.ts` | Hook 部署和自动更新 |
| `hooks/pre-tool-use.js` | PreToolUse hook：编辑前保存快照 |
| `hooks/post-tool-use.js` | PostToolUse hook：条目内容已还原时移除跟踪 |
| `hooks/session-end.js` | Stop hook：扫描跟踪文件，清理无变更的条目 |
| `scripts/copy-webview.js` | 拷贝 webview 静态资源 + Monaco `min/vs` 到 `out/` |

## 数据流

1. Claude Code 编辑文件前 → `pre-tool-use.js` 保存原始内容到 `.claude/cc-diff/snapshots/<safeFile>.snap`，并在 `index.json` v2 中登记
2. 编辑后 → `post-tool-use.js` 校验内容是否已还原；会话 Stop → `session-end.js` 扫描跟踪文件清理无变更条目
3. 扩展的 `FileSystemWatcher` 检测到 `index.json` 变化 → `SnapshotManager.loadFiles()` → `WebviewProvider.refresh()`
4. 用户操作：
   - **Keep**（Hunk）→ 把该 hunk 的当前内容写回**快照**，使其不再显示为变更
   - **Undo**（Hunk）→ 用快照内容写回**工作区文件**，还原该 hunk
5. 全部 hunk 处理完后条目自动清理

## 技术栈

- Hook 脚本：Node.js CJS
- VSCode 扩展：TypeScript strict，VSCode API ^1.85
- Webview：HTML + CSS + Vanilla JS + Monaco（`monaco-editor/min/vs`），全部使用 `var(--vscode-*)` CSS 变量
- 构建：`tsc` + `scripts/copy-webview.js`
- 打包：`@vscode/vsce`

## 注意事项

- Hook 脚本永远不能阻塞编辑器（所有错误 → exit 0）
- Webview CSS 绝不硬编码颜色，必须使用 VSCode CSS 变量
- `.vscodeignore` 排除 `node_modules/**`，因此 Monaco 资源必须由 `npm run build`（`copy-webview.js`）拷进 `out/webview/vs`；运行时从 `<extension>/out/webview/vs/loader.js` 加载
- `index.json` 中 `file` 字段使用 POSIX 正斜杠（hooks 生成），加载时需处理路径兼容
- Windows 上 `Join-Path` 只接受两个参数，多级路径需要嵌套调用
