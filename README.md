# Feishu Bug MCP for Trae

这个 MCP Server 用于读取和更新飞书多维表格中的 Bug 数据，适合接入 Trae / Claude Code / Codex 等支持 MCP 的客户端后，以结构化工具的方式查询 Bug 列表、分析问题、推动修复、更新状态，以及检测重复问题。

## 工具说明

### `list_bugs`

用于查询飞书中的 Bug 列表。

常用参数：

- `bug_id`：查询指定 Bug
- `start_index` / `end_index`：按顺序查询一个范围
- `status`：按状态筛选
- `assignee`：按处理人筛选
- `priority`：按优先级筛选

### `analyze_bug`

用于分析一个或多个 Bug，不会修改代码。

它会：

- 从飞书读取目标 Bug 数据
- 读取你指定的项目工作目录
- 在每个工作目录根下生成或复用 `gsy-fix-read.md`
- 搜索可能相关的代码文件并输出结构化分析结果
- 可选地把分析结论回写到飞书备注字段

重点说明：

- `workspace_directories` 可传可不传
- 如果不传，默认使用当前 Coding IDE 打开的工作目录
- 如果传入多个目录，必须是绝对路径
- 特别适合前后端分离项目，例如同时传前端目录和后端目录

示例：

```json
{
  "bug_ids": ["BUG-001"],
  "workspace_directories": [
    "E:/project/web",
    "E:/project/server"
  ],
  "refresh_project_read": false,
  "write_analysis_remark": true
}
```

### `fix_bugs`

用于先分析 Bug，再由当前正在使用 MCP 的代理直接修复代码。

它会：

- 复用 `analyze_bug` 的多工作目录分析流程
- 先检查 `gsy-fix-read.md` 是否存在，再决定是否重新阅读项目
- 通过 MCP sampling 把 Bug 和分析上下文交给当前代理继续修复
- 把修复备注写回飞书
- 只有当当前代理返回修复成功时，才更新 Bug 状态

重点说明：

- 不支持手动指定代理
- 当前是 Trae 就由 Trae 修
- 当前是 Claude Code 就由 Claude Code 修
- 当前是 Codex 就由 Codex 修
- `workspace_directories` 不传时默认使用当前 IDE 工作目录
- `search_directory` 仍然保留为旧字段兼容兜底

### `update_bug_status`

用于更新 Bug 状态，或者补充验证/处理说明。

常用参数：

- `bug_id`：目标 Bug 编号
- `status`：目标状态
- `verify_fixed`：执行验证流转
- `verification_result`：验证说明
- `resolution_summary`：追加到备注中的处理说明

### `check_duplicate_bugs`

用于按文本相似度查找重复 Bug，并可选地把重复关系标记回飞书备注。

## 工作目录说明

当你使用 `analyze_bug` 或 `fix_bugs` 时，可以显式告诉工具应该读取哪些项目目录。

- `workspace_directories`：推荐字段，支持多个目录
- `search_directory`：`fix_bugs` 的旧字段兼容兜底
- 如果两个都不传：默认使用当前 Coding IDE 所在工作目录

`workspace_directories` 如果传入，必须是绝对路径数组，例如：

```json
{
  "workspace_directories": [
    "E:/project/web",
    "E:/project/server"
  ]
}
```

项目阅读缓存规则：

- 如果工作目录根下已经存在 `gsy-fix-read.md`，工具会直接复用
- 如果文件不存在，或者传了 `refresh_project_read=true`，工具才会重新阅读项目并生成文档

## Trae 调用模板

下面这些内容可以直接复制到 Trae 输入框里使用。示例默认按索引调用，也就是使用 `start_index` 和 `end_index`。

### 1. 修复单条 Bug

```text
调用 fix_bugs，处理第 3 到第 3 条 bug。
workspace_directories:
- E:/project/web
- E:/project/server
```

### 2. 批量修复连续 Bug

```text
调用 fix_bugs，处理第 3 到第 5 条 bug。
workspace_directories:
- E:/project/web
- E:/project/server
```

### 3. 只分析，不修改代码

```text
调用 analyze_bug，分析第 3 到第 3 条 bug。
workspace_directories:
- E:/project/web
- E:/project/server
```

### 4. 强制重新阅读项目

```text
调用 fix_bugs，处理第 3 到第 3 条 bug。
workspace_directories:
- E:/project/web
- E:/project/server
refresh_project_read: true
```

### 5. 不传工作目录，默认使用当前 IDE 目录

```text
调用 fix_bugs，处理第 3 到第 3 条 bug。
```

### 6. 旧项目兼容写法

```text
调用 fix_bugs，处理第 3 到第 3 条 bug。
search_directory: E:/project/web
```

## 返回字段

标准化后的 Bug 字段包括：

- `bug_id`
- `row_index`
- `title`
- `module`
- `priority`
- `status`
- `created_at`
- `resolved_at`
- `verification_result`
- `verification_time`
- `remark`

## 配置说明

必填环境变量：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_APP_TOKEN`
- `FEISHU_TABLE_ID`

可选环境变量：

- `FEISHU_VIEW_ID`
- `FEISHU_FIELD_ID`
- `FEISHU_FIELD_TITLE`
- `FEISHU_FIELD_STATUS`
- `FEISHU_FIELD_PRIORITY`
- `FEISHU_FIELD_MODULE`
- `FEISHU_FIELD_CREATED_AT`
- `FEISHU_FIELD_RESOLVED_AT`
- `FEISHU_FIELD_VERIFICATION_RESULT`
- `FEISHU_FIELD_VERIFICATION_TIME`
- `FEISHU_FIELD_COMMENT`
- `FEISHU_FIELD_REMARK`

字段映射示例：

```env
FEISHU_FIELD_ID=编号
FEISHU_FIELD_TITLE=Bug标题/描述
FEISHU_FIELD_STATUS=解决状态
FEISHU_FIELD_PRIORITY=优先级
FEISHU_FIELD_MODULE=所属模块
FEISHU_FIELD_CREATED_AT=创建时间
FEISHU_FIELD_RESOLVED_AT=解决时间
FEISHU_FIELD_VERIFICATION_RESULT=验证结果
FEISHU_FIELD_VERIFICATION_TIME=验证时间
FEISHU_FIELD_COMMENT=备注
FEISHU_FIELD_REMARK=备注
```

备注字段优先级：

1. `FEISHU_FIELD_REMARK`
2. `FEISHU_FIELD_COMMENT`

## 运行方式

```bash
npm install
npm run build
npm start
```

开发模式：

```bash
npx tsx src/index.ts
```
