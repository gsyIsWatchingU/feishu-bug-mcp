# 多工作目录使用说明

## 总体原则

- 不支持手动指定代理
- 当前通过 MCP 使用的是哪个代理，就由哪个代理继续修复 Bug
- 如果没有传 `workspace_directories`，默认使用当前 Coding IDE 所在工作目录

## `analyze_bug`

`analyze_bug` 会读取一个或多个工作目录，在每个工作目录根下生成或复用 `gsy-fix-read.md`，搜索可能相关的实现文件，并返回以下结构化结果：

- `conclusion`
- `evidence`
- `suspected_components`
- `workspace_reads`
- `remark_updated`

它不会修改代码。默认情况下，它会把分析结论追加回飞书备注字段。

示例：

```json
{
  "bug_ids": ["BUG-001"],
  "workspace_directories": [
    "E:/repo/web",
    "E:/repo/server"
  ],
  "refresh_project_read": false,
  "write_analysis_remark": true
}
```

## `fix_bugs`

`fix_bugs` 会先复用同一套分析流程，再把上下文交给当前使用 MCP 的代理继续修复。

- `workspace_directories` 是推荐传入的正式字段
- `search_directory` 仍支持，但只是兼容旧用法
- 如果两个都不传，默认使用当前 IDE 工作目录
- 只有当前代理返回修复成功时，才会更新 Bug 状态
- 如果修复失败，只会追加失败备注，不会改状态

示例：

```text
调用 fix_bugs，处理第 3 到第 3 条 bug。
workspace_directories:
- E:/repo/web
- E:/repo/server
```
