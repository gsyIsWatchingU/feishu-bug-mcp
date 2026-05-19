# Feishu Bug MCP for Trae

一个独立运行的 `Feishu MCP Server`，通过飞书多维表格为 Trae 提供结构化 bug 工具，支持稳定范围读取、单条详情查询，以及可选的状态/备注回写。

## 功能

- `list_bugs`
  - 支持 `status`、`assignee`、`priority`、`limit`、`offset`
  - 返回规范化 bug 列表，并附带稳定的 `row_index`
- `get_bug_range`
  - 按稳定编号读取 `start_index ~ end_index`
  - 适合“读取第 7-10 条 bug”
- `get_bug_detail`
  - 按 `bug_id` 读取单条 bug 全字段详情
- `update_bug_status`
  - 更新 bug 状态
  - 可选同时回写处理摘要到备注字段
- `append_bug_comment`
  - 追加处理备注
  - 第一版默认退化为写入配置的备注字段

## 稳定编号规则

- 如果配置了 `FEISHU_VIEW_ID`，优先使用视图返回顺序作为 `row_index`
- 如果没有配置视图，则服务端按 `priority desc, created_at asc` 固定排序

这样模型处理“第 7-10 条 bug”时，可以稳定走：

1. 调用 `get_bug_range`
2. 获得结构化 bug 列表
3. 必要时再调用 `get_bug_detail`

## 目录结构

```text
feishu-bug-mcp/
├─ src/
│  ├─ index.ts
│  ├─ config.ts
│  ├─ types.ts
│  ├─ feishu/
│  │  ├─ auth.ts
│  │  └─ bitable.ts
│  └─ tools/
│     ├─ append-bug-comment.ts
│     ├─ get-bug-detail.ts
│     ├─ get-bug-range.ts
│     ├─ helpers.ts
│     ├─ list-bugs.ts
│     └─ update-bug-status.ts
├─ .env.example
├─ package.json
├─ tsconfig.json
└─ README.md
```

## 环境变量

至少需要：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_APP_TOKEN`
- `FEISHU_TABLE_ID`
- `FEISHU_FIELD_ID`
- `FEISHU_FIELD_TITLE`
- `FEISHU_FIELD_STATUS`
- `FEISHU_FIELD_PRIORITY`

可选：

- `FEISHU_VIEW_ID`
- `FEISHU_FIELD_SEVERITY`
- `FEISHU_FIELD_MODULE`
- `FEISHU_FIELD_REPO_HINT`
- `FEISHU_FIELD_DESCRIPTION`
- `FEISHU_FIELD_REPRO_STEPS`
- `FEISHU_FIELD_EXPECTED_RESULT`
- `FEISHU_FIELD_ACTUAL_RESULT`
- `FEISHU_FIELD_ASSIGNEE`
- `FEISHU_FIELD_ATTACHMENTS`
- `FEISHU_FIELD_CREATED_AT`
- `FEISHU_FIELD_UPDATED_AT`
- `FEISHU_FIELD_COMMENT`

## 安装与启动

先复制环境变量模板：

```bash
cp .env.example .env
```

```bash
npm install
npm run build
npm start
```

开发模式：

```bash
npx tsx src/index.ts
```

## Trae 接入

如果 Trae 支持 `mcpServers` JSON 配置，可参考：

```json
{
  "mcpServers": {
    "feishu-bug-mcp": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/absolute/path/to/feishu-bug-mcp",
      "env": {
        "FEISHU_APP_ID": "cli_xxx",
        "FEISHU_APP_SECRET": "xxx",
        "FEISHU_APP_TOKEN": "bascn_xxx",
        "FEISHU_TABLE_ID": "tbl_xxx",
        "FEISHU_VIEW_ID": "vew_xxx",
        "FEISHU_FIELD_ID": "BugID",
        "FEISHU_FIELD_TITLE": "标题",
        "FEISHU_FIELD_STATUS": "状态",
        "FEISHU_FIELD_PRIORITY": "优先级",
        "FEISHU_FIELD_COMMENT": "处理备注"
      }
    }
  }
}
```

如果 Trae 通过 GUI 添加 MCP：

1. 名称填写 `feishu-bug-mcp`
2. 命令填写 `node`
3. 参数填写 `dist/index.js`
4. 工作目录指向本项目目录
5. 环境变量填入飞书应用与字段映射配置

## 返回结构

所有工具统一返回：

```json
{
  "ok": true,
  "data": {},
  "source_metadata": {
    "app_token": "bascn_xxx",
    "table_id": "tbl_xxx",
    "view_id": "vew_xxx",
    "sort_rule": "view_order"
  }
}
```

失败时：

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "INVALID_RANGE",
    "message": "Requested range 7-10 is out of bounds for 8 bugs"
  },
  "source_metadata": {
    "app_token": "bascn_xxx",
    "table_id": "tbl_xxx",
    "view_id": "vew_xxx",
    "sort_rule": "view_order"
  }
}
```

## 错误约定

- `AUTH_ERROR`
- `NOT_FOUND`
- `CONFIG_ERROR`
- `INVALID_RANGE`
- `VALIDATION_ERROR`
- `WRITE_ERROR`
- `UNKNOWN_ERROR`

## 当前边界

第一版暂不支持：

- 多表聚合
- 多仓库自动路由
- 附件 OCR
- 自动建分支 / PR
- 自动关闭 bug

## 说明

- access token 走内存缓存，并在过期前自动刷新
- 字段映射通过环境变量控制，方便不同项目复用
- 服务不会主动打印 app secret 或 access token
