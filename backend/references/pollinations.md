# Pollinations — 文生图模型参数

**来源等级：官方文档（一级）**
抓取日期：2026-10-22 · 文档版本 `0.3.0` · OpenAPI `3.1.0`

## 文档地址

| 用途 | URL |
|---|---|
| 完整 API 文档（Markdown 全文） | https://github.com/pollinations/pollinations/blob/main/APIDOCS.md |
| 文档站 | https://gen.pollinations.ai/docs |
| 模型列表（只读） | https://gen.pollinations.ai/image/models |
| 密钥 / 余额面板 | https://enter.pollinations.ai |

## 域名分工

| 域名 | 用途 | 依据 |
|---|---|---|
| `pollinations.ai` | 主站、playground（`/play`） | APIDOCS + README |
| **`gen.pollinations.ai`** | **所有生成请求的 base URL** | `"Base URL: https://gen.pollinations.ai"` |
| `enter.pollinations.ai` | Dashboard、登录、建 key、计费 | APIDOCS |
| `media.pollinations.ai` | 存储地址。`response_format: "url"` 返回的媒体 URL 在此域名 | APIDOCS |

**`enter.pollinations.ai` 不是 API base URL。** 它只是面板。

## 认证

```
Authorization: Bearer YOUR_API_KEY
```
GET 端点亦可用查询参数：`?key=YOUR_API_KEY`

密钥类型：

| 类型 | 前缀 | 用途 | 速率限制 |
|---|---|---|---|
| Secret key | `sk_` | 服务端调用 | **None**（密钥类型层面；模型级 `per_user_rpm` 仍生效） |
| App key (BYOP) | `pk_` + redirect URI | 客户端 OAuth flow | App key 本身不限速 |
| Raw publishable | `pk_` 无绑定 | 遗留，不建议新建 | 1 pollen / IP / 小时 |

环境变量约定：`POLLINATIONS_API_KEY`

---

# 一、`GET /image/{prompt}` — 文生图（推荐）

```
GET https://gen.pollinations.ai/image/{URL编码的prompt}?model=...&width=...&height=...
```

返回**原始图片二进制**，Content-Type 为 `image/jpeg`、`image/png` 或 `image/svg+xml`。

## 参数（原文参数表）

| 参数 | 位置 | 类型 | 说明 |
|---|---|---|---|
| `prompt` * | path | `string` | 要生成图像的文字描述 |
| `model` | query | `string` | 默认 `"tongyi-mai/z-image-turbo"` |
| `width` | query | `integer` | 默认 `1024` |
| `height` | query | `integer` | 默认 `1024` |
| `seed` | query | `integer` | 默认 `0`，范围 `-1…2147483647`，`-1` 表示随机 |
| `safe` | query | `any` | 逗号分隔：privacy, secrets, sexual, violence, shield, true, nsfw |
| `quality` | query | `"low"`\|`"medium"`\|`"high"`\|`"hd"` | 默认 `"medium"`，仅部分模型支持 |
| `image` | query | `string` | 参考图 URL（编辑/风格参考），多张用 `\|` 或 `,` 分隔 |
| `reference_images` | query | `string` | 仅视频模型 |
| `reference_videos` | query | `string` | 仅视频模型 |
| `reference_audios` | query | `string` | 仅视频模型 |
| `transparent` | query | `boolean` | 透明背景，仅部分模型支持 |
| `resolution` | query | enum (8) | `1k`、`2k`、`360p`、`480p`、`720p`、`768p`、`1080p`、`4k`。首个声明档位为默认 |

`*` = 必填

### 模型级限制（原文）

**`width`/`height`**：
- `flux-2-pro`、`flux-2-flex`、`microsoft/mai-image-2.6-flash` 要求 **16 的倍数**
- 其中 MAI 还需每边 ≥ **768 px**、总像素 ≤ **2,359,296**
- `black-forest-labs/flux.1.1-pro` 要求每边 **256–1440 px**、**32 的倍数**、总像素 ≤ **1.6 MP**

**单边上限 1920（实测）。** 请求 `1360x2040` 直接 400：

```
height: Input should be less than or equal to 1920
```

这条限制**不在 flux.1-schnell 的模型文档里**，是服务端校验层拦的。

**⚠️ 实测：flux.1-schnell 固定输出 `768x1280`，与请求值无关。**
请求 `1280x1920`（比例 0.6667）→ 返回 `768x1280`（比例 0.6）；
请求 `1152x2048`（比例 0.5625）→ 同样返回 `768x1280`。
**不是等比缩放，是落到固定桶**（早先"比例保持、缩到 2/3"的说法是错的）。

客户端会检测这种偏差并写进返回值的 `degraded` 字段（仅 `generate()` 会填，直接调 `pollinations_generate()` 时为 `None`）：

```
pollinations: requested 1280x1920, service returned 768x1280
```

**调用方必须读 `size` 而不是假设它等于请求值。**

**中文 prompt 会跑偏（实测）。** 同一段旗袍人像提示词，中文输入返回夜市街景，改英文即正常，
且 `ok=True` 无任何报错。**pollinations 一律用英文 prompt。**

**`seed`** 只被以下 6 个模型支持，**其他模型忽略该参数**：
`black-forest-labs/flux.1-schnell`、`black-forest-labs/flux.1.1-pro`、`tongyi-mai/z-image-turbo`、`bytedance/seedream-4.0`、`black-forest-labs/flux.2-klein-4b`、`bytedance/seedance-2.0`

**`quality`** 仅：`gptimage`、`gptimage-large`、`gpt-image-2`、`grok-imagine-image-2.0`

**`transparent`** 仅：`gptimage`、`gptimage-large`、`openai/gpt-image-2.5-flare`、`openai/gpt-image-2.5-sunburst`。其他模型**返回 400**。

### 异步模式（易漏）

长耗时生成可加请求头 `Prefer: respond-async`，服务端返回 `202 Accepted` 与 `id`、`status: "pending"`、`status_url`。
**默认是同步返回，但存在这个异步分支。** 详见 APIDOCS 的 long-running generation 小节。

## 响应

```
200 · image/jpeg | image/png | image/svg+xml
```

## 示例（原文）

```bash
curl "https://gen.pollinations.ai/image/a%20beautiful%20sunset%20over%20mountains?model=tongyi-mai%2Fz-image-turbo&width=1024" \
  -H "Authorization: Bearer $POLLINATIONS_KEY"
```

---

# 二、`POST /v1/images/generations` — OpenAI 兼容

```
POST https://gen.pollinations.ai/v1/images/generations
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

返回 JSON（`CreateImageResponse`）。

## 请求体（原文参数表）

| 字段 | 类型 | 说明 |
|---|---|---|
| `prompt` * | `string` | 长度 `1…32000` |
| `model` | `string` | 默认 `"black-forest-labs/flux.1-schnell"` |
| `n` | `integer` | 当前最大 1，默认 1，范围 `1…1` |
| `size` | `string` | `WIDTHxHEIGHT`，如 `1024x1024`、`512x512`。默认 `"1024x1024"` |
| `quality` | `"standard"`\|`"hd"`\|`"low"`\|`"medium"`\|`"high"` | OpenAI 的 standard/hd 映射到 Pollinations 档位。默认 `"medium"` |
| `seed` | `integer` \| `null` | `-1` 映射到稳定的兼容种子 |
| `response_format` | `"url"` \| `"b64_json"` | 默认 `"b64_json"` |
| `user` | `string` | 终端用户标识 |
| `image` | `string` \| `string[]` | 参考图 URL（Pollinations 扩展） |
| `reference_images` / `reference_videos` / `reference_audios` | `any` | 视频模型用 |
| `resolution` | enum | 按分辨率计价的模型用 |
| `safe` | `any` | 同 GET |

`*` = 必填

## 示例（原文）

```bash
curl -X POST "https://gen.pollinations.ai/v1/images/generations" \
  -H "Authorization: Bearer $POLLINATIONS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a serene mountain landscape at sunset","model":"black-forest-labs/flux.1-schnell","size":"1024x1024"}'
```

---

# 三、`POST /v1/images/edits` — 图像编辑

接受 JSON（图片 URL）或 `multipart/form-data`（文件上传）。

## 请求体（原文参数表）

| 字段 | 类型 | 说明 |
|---|---|---|
| `prompt` * | `string` | 长度 `1…32000` |
| `image` * | `string` \| `object[]` | URL 字符串，或 `{image_url}` 对象数组（OpenAI 格式） |
| `model` | `string` | 默认 `"black-forest-labs/flux.1-schnell"` |
| `n` | `integer` | 最大 1 |
| `size` | `string` | `WIDTHxHEIGHT` |
| `quality` | enum | 同上 |
| `seed` | `integer` \| `null` | — |
| `response_format` | `"url"` \| `"b64_json"` | 默认 `"b64_json"` |
| `resolution` | enum | — |
| `safe` | `any` | — |

---

# 四、模型清单与定价

来源：`GET https://gen.pollinations.ai/image/models`（无需认证，只读）。
**这是实时数据，每次调用都应重新获取，不要依赖本文档的快照。**

字段：`pricing.completionImageTokens`（每张图消耗 pollen）、`paid_only`、`per_user_rpm`、`health.status`。

### 数据快照（2026-10-22）

- 该端点返回 **93～95 条**（含视频模型），其中 `category: "image"` **70～72 条**。实测两次分别得到 93/70 与 95/72，说明**列表本身在变**
- 加 `?reliability=all` 参数则返回 114 条（含健康度不达标的模型）
- 默认视图会**过滤掉 health 不达标的模型**（如 `success_rate` 低于阈值的）

**「多少个模型」这个数字不要背，每次调接口取。**

### 免费档（`paid_only: false`，默认视图，节选按单价升序）

| 模型 | pollen/张 | per_user_rpm |
|---|---|---|
| `openai/gpt-image-1-mini` | 0.000006 | — |
| `microsoft/mai-image-2.6-flash` | 0.00001425 | 12 |
| `openai/gpt-image-2` | 0.0000225 | — |
| `community/tomdacatto/gpt-image-2.5-sunburst` | 0.0000225 | — |
| `openai/gpt-image-1.5` | 0.000024 | — |
| `microsoft/mai-image-2.6` | 0.0000285 | 12 |
| `lykon/dreamshaper-8-lcm` | 0.0001 | 300 |
| `black-forest-labs/flux.1-schnell` | 0.002 | 60 |
| `tongyi-mai/z-image-turbo`（默认） | 0.004 | 60 |
| `black-forest-labs/flux.2-klein-4b` | 0.005 | 60 |
| `community/sharktide/inferenceport-ai-lightning-image-turbo` | 0.02 | — |
| `black-forest-labs/flux.1.1-pro` | 0.03 | — |
| `black-forest-labs/flux.1-kontext-pro` | 0.03 | — |
| `community/vendouple/grok-imagine` | 0.05 | — |
| `community/tomdacatto/grok-imagine` | 0.05 | — |
| `community/vendouple/lucid-origin` | 0.085 | — |
| `community/tomdacatto/gpt-image-2.5-flare` | 0.25 | — |
| `community/sharktide/inferenceport-ai-lightning-image-plus` | 0.25 | — |
| `community/tomdacatto/nano-banana-pro` | 0.25 | — |

**这是节选，不是穷举。** 完整清单以实时接口为准。另有若干 `community/*` 免费模型（如 `MarcosFRG/sdxl-lightning` 0.0012、`Spit-fires/flux-schnell` 0.001、`JustScriptzz/qwen-image-2.1-turbo` 0.05）。

### 付费档（`paid_only: true`，节选）

| 模型 | pollen/张 |
|---|---|
| `google/gemini-2.5-flash-image` | 0.00003 |
| `google/gemini-3.1-flash-image` | 0.00006 |
| `google/gemini-3-pro-image` | 0.00012 |
| `black-forest-labs/flux.2-pro` | 0.01125 |
| **`qwen/qwen-image-2.1-turbo`** | **0.016** |
| `x-ai/grok-imagine-image` | 0.02 |
| `openai/gpt-image-2.5-flare` | 0.0000225 |
| `black-forest-labs/flux.2-max` | 0.03 |
| `bytedance/seedream-4.0` | 0.03 |
| `qwen/qwen-image` | 0.025 |
| `qwen/qwen-image-3` | 0.04 |
| `bytedance/seedream-5.0-pro` | 0.09 |
| `ideogram-ai/ideogram-v4-quality` | 0.1 |

**注意**：`qwen/qwen-image-2.1-turbo` 在 Pollinations 上是付费档，而它在魔搭上是免费的。同一模型在两个平台定价策略完全不同。

---

# 五、计价单位与免费额度

### 计价

`$1 ≈ 1 Pollen`（官方 FAQ 口径）。

### ⚠️ 免费档额度：官方文档确实未载明

已在以下位置全文检索 `Spore` / `Seed` / `Flower` / `Nectar` / `1.5` / `pollen/week` / `per week` / `weekly`，**均无命中**：

- `APIDOCS.md`（273,740 字符）
- `gen.pollinations.ai/docs`（82,690 字节）
- `gen.pollinations.ai/openapi.json`（706,044 字节）
- `gen.pollinations.ai/llms-full.txt`（170,425 字节）
- `enter.pollinations.ai/POLLEN_FAQ.md`

`APIDOCS.md` 中 `tier` 一词只出现在 `/account/balance` 的 `accountBalance.tier`（含义是 "Quest Pollen remaining"）和 `meter_source: 'tier'`，**不是 Spore/Seed/Flower 这类账号档位**。

官方 FAQ 唯一相关表述：
> Create an account, complete eligible Quests, and claim the rewards to receive Quest Pollen

**"Spore = 1.5 Pollen/周" 来自第三方汇总站，官方文档无此说法。**
实际额度到 https://enter.pollinations.ai 账户页确认为准。

### 速率限制的准确表述

- `sk_` 密钥类型本身**不限速**
- 但**模型级 `per_user_rpm` 仍生效**（如 `z-image-turbo` 60、`mai-image-2.6` 12、`dreamshaper-8-lcm` 300）
- 文档未说明付费能豁免模型级 rpm

### ⚠️ `x-usage-completion-image-tokens` 响应头的单位未经验证

客户端返回值里有个 `usage_header` 字段，取自响应头 `x-usage-completion-image-tokens`。

实测 flux.1-schnell（官方单价 0.002 pollen/张）时该头返回 **`1`**，与单价对不上，差约 500 倍。

**这个头不在 `APIDOCS.md` 也不在 `gen.pollinations.ai/openapi.json` 中，单位语义没有官方定义。**
字段名特意从 `cost` 改成了 `usage_header`，就是为了避免被当成 pollen 消费额。
需要真实花费时，按 `单价 × 张数` 自己算，不要用这个头。

---

# 六、错误码

| 状态码 | 含义（原文） |
|---|---|
| `401 UNAUTHORIZED` | Missing or invalid API key |
| `402 PAYMENT_REQUIRED` | Insufficient pollen balance or API key budget exhausted |

---

# 七、文档未载明的项目（不要猜）

- 各账号 tier 的名称、额度数值、重置周期
- 免费档与付费档在排队优先级上的差异
- `quality` 参数对各模型输出分辨率的实际影响
- `GET /image/{prompt}` 与 `POST /v1/images/generations` 是否走同一计费路径
- 各模型的健康度阈值（默认视图过滤的具体标准）
