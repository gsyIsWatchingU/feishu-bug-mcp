# Feishu Bug MCP for Trae

这个 MCP Server 用于读取和更新飞书多维表格中的 Bug 数据，适合接入 Trae / MCP 客户端后，以结构化工具的方式查询 bug 列表、读取详情、按范围读取，以及更新状态和备注。

## 已适配的默认中文表头

如果你的飞书表格表头就是下面这套名称，默认无需再额外配置字段映射：

- `编号`
- `功能模块`
- `Bug问题描述`
- `优先级`
- `解决状态`
- `提交时间`
- `解决日期`
- `验证结果`
- `验证时间`
- `备注`

## 提供的工具

- `list_bugs`
- `get_bug_range`
- `get_bug_detail`
- `update_bug_status`
- `append_bug_comment`

## 标准化输出字段

当前会输出这些核心字段：

- `bug_id`
- `title`
- `module`
- `priority`
- `status`
- `created_at`
- `resolved_at`
- `verification_result`
- `verification_time`
- `remark`

此外仍保留 `severity`、`description`、`repro_steps`、`expected_result`、`actual_result`、`assignee`、`attachments`、`updated_at`、`raw_fields` 等扩展字段。

## 环境变量

必填：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_APP_TOKEN`
- `FEISHU_TABLE_ID`

可选：

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
- 以及其他扩展字段映射

如果不填写上述字段映射，程序会默认按这套中文表头查找：

```env
FEISHU_FIELD_ID=编号
FEISHU_FIELD_TITLE=Bug问题描述
FEISHU_FIELD_STATUS=解决状态
FEISHU_FIELD_PRIORITY=优先级
FEISHU_FIELD_MODULE=功能模块
FEISHU_FIELD_CREATED_AT=提交时间
FEISHU_FIELD_RESOLVED_AT=解决日期
FEISHU_FIELD_VERIFICATION_RESULT=验证结果
FEISHU_FIELD_VERIFICATION_TIME=验证时间
FEISHU_FIELD_COMMENT=备注
FEISHU_FIELD_REMARK=备注
```

## 启动

```bash
npm install
npm run build
npm start
```

开发模式：

```bash
npx tsx src/index.ts
```
