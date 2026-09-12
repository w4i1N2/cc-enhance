# Changelog

## TODO

## Unreleased

- 新增 `cc-diff.diffViewer` 配置项，可选 `custom`（内置 CC Diff 面板，默认）或 `native`（VS Code 原生 diff 编辑器）
  - 原生模式下为只读查看，无 hunk 级操作，接受/撤销请使用侧边栏
  - 原生模式右上角不显示 CC Diff 的菜单项
  - 切换配置后立即生效，会关闭当前已打开的 diff 视图
- 「切换双列/单列模式」图标从 `$(split-horizontal)` 改为 `$(diff-multiple)`，避免与「拆分编辑器」混淆

## 0.2.1

- 优化文件内容
- 折叠未修改的部分

## 0.2.0

- hunk块显示算法统一，从git diff改成monaco diff编辑器的算法
- 优化

## 0.1.3

- 优化
  - 界面优化
  - 切换hunk优化
- license

## 0.1.2

- monaco diff部分页面按钮用editor/title 菜单项替换
- git分支切换优化
- 图标
- 快照+当前文件都不存在时，从列表中删除
- 国际化

## 0.1.1

- diff webview支持语法高亮
- 点击切换到原始文件
- 增加上下切换键，切换到不同hunk
- 快照文件区分git分支，在分支切换时向用户确认是否保留快照
- 文件新建/删除场景优化diff内容

## 0.1.0

- cc diff主体功能：hook脚本+diff窗口
