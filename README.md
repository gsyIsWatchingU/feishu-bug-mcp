# Feishu Bug MCP for Trae

这个 MCP Server 用于读取和更新飞书多维表格中的 Bug 数据，适合接入 Trae / MCP 客户端后，以结构化工具的方式查询 bug 列表、批量修复、更新状态和检测重复。

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

### 1. list_bugs - 列出bug

支持多种筛选方式查询bug列表。

**参数：**
- `bug_id` (可选): 字符串，查询指定编号的bug
- `start_index` (可选): 数字，范围查询起始索引
- `end_index` (可选): 数字，范围查询结束索引
- `status` (可选): 字符串，按状态筛选
- `assignee` (可选): 字符串，按负责人筛选
- `priority` (可选): 字符串，按优先级筛选
- `limit` (可选): 数字，返回数量限制
- `offset` (可选): 数字，分页偏移量

**使用示例：**
```json
// 查询指定编号的bug
{"bug_id": "BUG-001"}

// 查询编号范围的bug（第7-10条）
{"start_index": 7, "end_index": 10}

// 查询所有待处理的bug
{"status": "处理中"}
```

### 2. fix_bugs - 批量修复bug

批量将bug状态设置为"已修复待验证"。

**参数：**
- `bug_ids` (可选): 字符串数组，指定多个bug编号
- `start_index` (可选): 数字，范围修复起始索引
- `end_index` (可选): 数字，范围修复结束索引
- `resolution_summary` (可选): 字符串，修复摘要说明

**使用示例：**
```json
// 批量修复指定编号的bug
{"bug_ids": ["BUG-001", "BUG-002", "BUG-003"], "resolution_summary": "已修复内存泄漏问题"}

// 批量修复编号范围的bug（第7-10条）
{"start_index": 7, "end_index": 10}
```

### 3. update_bug_status - 更新bug状态

更新bug状态或验证bug是否修复。

**参数：**
- `bug_id` (必填): 字符串，bug编号
- `status` (可选): 字符串，新状态（处理中/已修复待验证/无法复现/需人工确认）
- `verify_fixed` (可选): 布尔值，验证bug是否已修复
- `verification_result` (可选): 字符串，验证结果备注
- `resolution_summary` (可选): 字符串，解决方案摘要

**使用示例：**
```json
// 更新bug状态
{"bug_id": "BUG-001", "status": "处理中"}

// 验证bug修复（需先设置为"已修复待验证"状态）
{"bug_id": "BUG-001", "verify_fixed": true, "verification_result": "验证通过，问题已解决"}
```

### 4. check_duplicate_bugs - 检查重复bug

通过文本相似度分析检测重复bug，并自动在备注列添加提示。

**参数：**
- `threshold` (可选): 数字(0-1)，相似度阈值，默认0.7
- `auto_mark` (可选): 布尔值，是否自动标记重复，默认true

**使用示例：**
```json
// 检测重复bug并自动标记
{"auto_mark": true}

// 仅检测不标记，使用更高相似度阈值
{"threshold": 0.8, "auto_mark": false}
```

**功能说明：**
- 使用Jaccard相似度和词重叠算法进行文本比较
- 比较字段包括：标题、描述、复现步骤、预期结果、实际结果、功能模块
- 对于重复组，除第一个bug外，其余bug的备注列会添加："该bug与第xx条bug一样"

## 标准化输出字段

当前会输出这些核心字段：

- `bug_id`: bug编号
- `row_index`: 表格行索引
- `title`: bug标题/描述
- `module`: 功能模块
- `priority`: 优先级
- `status`: 解决状态
- `created_at`: 提交时间
- `resolved_at`: 解决日期
- `verification_result`: 验证结果
- `verification_time`: 验证时间
- `remark`: 备注

此外仍保留扩展字段：`severity`、`description`、`repro_steps`、`expected_result`、`actual_result`、`assignee`、`attachments`、`updated_at`、`raw_fields`。

## 环境变量

### 必填：

- `FEISHU_APP_ID`: 飞书应用ID
- `FEISHU_APP_SECRET`: 飞书应用密钥
- `FEISHU_APP_TOKEN`: 飞书多维表格APP_TOKEN
- `FEISHU_TABLE_ID`: 飞书多维表格TABLE_ID

### 可选字段映射：

- `FEISHU_VIEW_ID`: 视图ID
- `FEISHU_FIELD_ID`: 编号字段名
- `FEISHU_FIELD_TITLE`: 标题字段名
- `FEISHU_FIELD_STATUS`: 状态字段名
- `FEISHU_FIELD_PRIORITY`: 优先级字段名
- `FEISHU_FIELD_MODULE`: 模块字段名
- `FEISHU_FIELD_CREATED_AT`: 创建时间字段名
- `FEISHU_FIELD_RESOLVED_AT`: 解决时间字段名
- `FEISHU_FIELD_VERIFICATION_RESULT`: 验证结果字段名
- `FEISHU_FIELD_VERIFICATION_TIME`: 验证时间字段名
- `FEISHU_FIELD_COMMENT`: 评论字段名
- `FEISHU_FIELD_REMARK`: 备注字段名

### 默认字段映射：

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

## 支持的状态值

- `处理中`: bug正在处理
- `已修复待验证`: bug已修复，等待验证
- `无法复现`: 无法复现该bug
- `需人工确认`: 验证通过，需人工最终确认