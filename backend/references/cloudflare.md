# Cloudflare Workers AI — 文生图模型参数

**来源等级：官方文档站（一级）**
抓取日期：2026-10-22

## 文档地址

| 用途 | URL |
|---|---|
| REST 调用入门 | https://developers.cloudflare.com/workers-ai/get-started/rest-api/ |
| 定价总表 | https://developers.cloudflare.com/workers-ai/platform/pricing/ |
| 模型总目录 | https://developers.cloudflare.com/workers-ai/models/ |
| 单模型页 | `https://developers.cloudflare.com/workers-ai/models/{model-slug}/` |

## 端点与认证

```
POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{MODEL_ID}
Authorization: Bearer {API_TOKEN}
Content-Type: application/json
```

`[doc: get-started/rest-api]`

- `ACCOUNT_ID`：Dashboard → Workers AI → Use REST API → "Get Account ID"
- `API_TOKEN`：面板上 "Create a Workers AI API Token"。手工建 token 需要 `Workers AI - Read` + `Workers AI - Edit` 两项权限
- 环境变量约定：`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`

## 响应结构

```json
{ "result": {...}, "success": true, "errors": [], "messages": [] }
```

`[doc: get-started/rest-api]`

**注意：不同模型的 `result` 结构不同**，见各模型章节的"输出"小节。这是 Cloudflare 最容易踩的坑。

---

# 一、`@cf/black-forest-labs/flux-1-schnell`

`[doc: models/flux-1-schnell]` · 任务类型：Text-to-Image · 12B rectified flow transformer

## 输入参数（原文参数表）

| 参数 | 类型 | 必填 | 范围 | 默认 |
|---|---|---|---|---|
| `prompt` | `string` | **是** | minLength 1, maxLength 2048 | — |
| `steps` | `integer` | 否 | maximum 8 | 4 |

原文说明：
- `prompt` — "A text description of the image you want to generate."
- `steps` — "The number of diffusion steps; higher values can improve quality but take longer. Default is 4"

### ⚠️ `seed`：schema 明确不支持，但示例在传

**官方输入 schema**（`schema-input.json`）的原文：

```json
{"type":"object",
 "properties":{"prompt":{...},"steps":{...}},
 "required":["prompt"],
 "additionalProperties":false}
```

`additionalProperties: false` 意味着**未列出的属性不合法**，`seed` 不在 `properties` 里。

但同页的示例代码和 curl 命令都传了 `seed`：

```ts
await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
  prompt: 'a cyberpunk lizard',
  seed: Math.floor(Math.random() * 10)
});
```

```sh
curl ... -d '{ "prompt": "cyberpunk cat", "seed": "Random positive integer" }'
```

**结论：schema 与示例矛盾。** 按 schema，`seed` 不是合法参数；按示例，它能用。
实际行为文档未说明（是否被静默忽略、还是报错）。**不要依赖 `seed` 做可复现性保证。**

### ⚠️ 不支持 `width` / `height`

**同样的 `additionalProperties: false` 意味着 `width`/`height` 不合法。** 它们不在 `properties` 表内。

（如需自定义尺寸，改用本文档第二章起的 SDXL 系模型，它们明确支持 `width`/`height`。）

## 输出

| 字段 | 类型 | 说明 |
|---|---|---|
| `image` | `string` | "The generated image in Base64 format." |

原文注释："is base64 encoded which can be used directly as an `<img src="">` data URI"，格式为 **JPEG**。

即 `result.image` 是 base64 字符串，需自行 decode。示例里的 data URI 前缀是 `data:image/jpeg;charset=utf-8;base64,`。

## 定价

`[doc: platform/pricing]`

| 计费项 | 价格 |
|---|---|
| 每 512×512 tile | $0.0000528 / 4.80 neurons |
| 每 step | $0.0001056 / 9.60 neurons |

---

# 二、`@cf/stabilityai/stable-diffusion-xl-base-1.0`

`[doc: models/stable-diffusion-xl-base-1.0]` · Text-to-Image · Beta · Stability AI

## 输入参数（原文参数表）

| 参数 | 类型 | 必填 | 范围 | 默认 |
|---|---|---|---|---|
| `prompt` | `string` | **是** | minLength 1 | — |
| `negative_prompt` | `string` | 否 | — | — |
| `height` | `integer` | 否 | min 256, max 2048 | — |
| `width` | `integer` | 否 | min 256, max 2048 | — |
| `image[]` | `array` | 否 | 8-bit unsigned int 数组，用于 img2img | — |
| `image_b64` | `string` | 否 | base64 输入图，用于 img2img | — |
| `mask[]` | `array` | 否 | 8-bit unsigned int 数组，用于 inpainting | — |
| `num_steps` | `integer` | 否 | maximum 20 | 20 |
| `strength` | `number` | 否 | 0–1 | 1 |
| `guidance` | `number` | 否 | — | 7.5 |
| `seed` | `integer` | 否 | — | — |

原文说明：
- `height`/`width` — "The height/width of the generated image in pixels"
- `num_steps` — "The number of diffusion steps; higher values can improve quality but take longer"
- `strength` — "A value between 0 and 1 indicating how strongly to apply the transformation during img2img tasks; lower values make the output closer to the input image"
- `guidance` — "Controls how closely the generated image should adhere to the prompt; higher values make the image more aligned with the prompt"
- `seed` — "Random seed for reproducibility of the image generation"

### 🔑 关键：步数参数名是 `num_steps`，不是 `steps`

flux-1-schnell 用 `steps`，SDXL 系用 `num_steps`。混用会导致参数被忽略。

### 🔑 这个模型支持 width/height

范围 256–2048，比 flux-1-schnell 灵活。

## 输出

页面原文："The binding returns a `ReadableStream` with the output (check the model's output schema)."

**输出 schema（`schema-output.json` 原文）：**

```json
{"type":"string","contentType":"image/png","format":"binary",
 "description":"The generated image in PNG format"}
```

**即：PNG 二进制流，不是 JSON 里的 base64 字段。**

官方 schema 文件（可直接抓取）：
`https://developers.cloudflare.com/workers-ai/models/{model-slug}/schema-output.json`

以上结论同样适用于 SDXL-Lightning、dreamshaper-8-lcm、SD1.5-inpainting —— 这四个模型的输出 schema 一致，均为 `image/png` + `format: binary`。

## 定价

"$0.00 per step"

> ⚠️ **聚合计费与单价表对不上。** 实测 1024×1024、steps=4 实扣 **172.8 neurons**，而按单价 `4 × 4.80（tile）+ 4 × 9.60（step）` 算应为 57.6，正好 3 倍。单价本身已核对一致，差异在聚合公式，官方页面未解释。**按 10,000 neurons/天估算可用张数时，实际约 57 张而非 173 张。**

---

# 三、`@cf/bytedance/stable-diffusion-xl-lightning`

`[doc: models/stable-diffusion-xl-lightning]` · Text-to-Image · Beta · ByteDance

## 输入参数（原文参数表）

| 参数 | 类型 | 必填 | 范围 | 默认 |
|---|---|---|---|---|
| `prompt` | `string` | **是** | minLength 1 | — |
| `negative_prompt` | `string` | 否 | — | — |
| `height` | `integer` | 否 | min 256, max 2048 | — |
| `width` | `integer` | 否 | min 256, max 2048 | — |
| `image[]` | `array` | 否 | img2img 用 | — |
| `image_b64` | `string` | 否 | img2img 用 | — |
| `mask[]` | `array` | 否 | inpainting 用 | — |
| `num_steps` | `integer` | 否 | maximum 20 | 20 |
| `strength` | `number` | 否 | 0–1 | 1 |
| `guidance` | `number` | 否 | — | 7.5 |
| `seed` | `integer` | 否 | — | — |

参数语义与 SDXL base 相同。

## 输出

"The binding returns a `ReadableStream` with the output"

## 定价

"$0.00 per step"

---

# 四、`@cf/lykon/dreamshaper-8-lcm`

`[doc: models/dreamshaper-8-lcm]` · Text-to-Image · lykon

## 输入参数（原文参数表）

| 参数 | 类型 | 必填 | 范围 | 默认 |
|---|---|---|---|---|
| `prompt` | `string` | **是** | minLength 1 | — |
| `negative_prompt` | `string` | 否 | — | — |
| `height` | `integer` | 否 | min 256, max 2048 | — |
| `width` | `integer` | 否 | min 256, max 2048 | — |
| `image[]` | `array` | 否 | img2img 用 | — |
| `image_b64` | `string` | 否 | img2img 用 | — |
| `mask[]` | `array` | 否 | inpainting 用 | — |
| `num_steps` | `integer` | 否 | maximum 20 | 20 |
| `strength` | `number` | 否 | 0–1 | 1 |
| `guidance` | `number` | 否 | — | 7.5 |
| `seed` | `integer` | 否 | — | — |

## 输出

"The binding returns a `ReadableStream` with the output"

## 定价

页面未给出定价。参数表亦未标注。

---

# 五、`@cf/runwayml/stable-diffusion-v1-5-inpainting`

`[doc: models/stable-diffusion-v1-5-inpainting]` · Text-to-Image + inpainting · Beta · RunwayML

## 输入参数（原文参数表）

| 参数 | 类型 | 必填 | 范围 | 默认 |
|---|---|---|---|---|
| `prompt` | `string` | **是** | minLength 1 | — |
| `negative_prompt` | `string` | 否 | — | — |
| `height` | `integer` | 否 | min 256, max 2048 | — |
| `width` | `integer` | 否 | min 256, max 2048 | — |
| `image[]` | `array` | 否 | 8-bit unsigned int 数组 | — |
| `image_b64` | `string` | 否 | base64 输入图 | — |
| `mask[]` | `array` | 否 | inpainting mask | — |
| `num_steps` | `integer` | 否 | maximum 20 | 20 |
| `strength` | `number` | 否 | 0–1 | 1 |
| `guidance` | `number` | 否 | — | 7.5 |
| `seed` | `integer` | 否 | — | — |

## 输出

"The binding returns a `ReadableStream` with the output"

## 定价

"$0.00 per step"

---

# 六、`@cf/leonardo/phoenix-1.0`

`[doc: models/phoenix-1.0]` · Text-to-Image · Leonardo.Ai

## 输入参数（原文参数表）

| 参数 | 类型 | 必填 | 范围 | 默认 |
|---|---|---|---|---|
| `prompt` | `string` | **是** | minLength 1 | — |
| `guidance` | `number` | 否 | min 2, max 10 | 2 |
| `seed` | `integer` | 否 | min 0 | — |
| `height` | `integer` | 否 | min 0, max 2048 | 1024 |
| `width` | `integer` | 否 | min 0, max 2048 | 1024 |
| `num_steps` | `integer` | 否 | min 1, max 50 | 25 |
| `negative_prompt` | `string` | 否 | minLength 1 | — |

原文说明：
- `guidance` — "Controls how closely the generated image should adhere to the prompt; higher values make the image more aligned with the prompt"
- `seed` — "Random seed for reproducibility of the image generation"
- `negative_prompt` — "Specify what to exclude from the generated images"

**这是本文档中 `num_steps` 上限最高（50）的模型，且 height/width 有明确默认值 1024。**

## 输出

```json
{"type":"string","contentType":"image/jpeg","format":"binary",
 "description":"The generated image in JPEG format"}
```

**是 JPEG，不是 PNG。** 与 SDXL 系（PNG）不同，不要套用同一个转换假设。

## 定价

"$0.00583 per 512 by 512 tile, $0.00011 per step"（即 530 neurons/tile + 10 neurons/step）

---

# 七、`@cf/leonardo/lucid-origin`

`[doc: models/lucid-origin]` · Text-to-Image · Leonardo.Ai

## 输入参数（原文参数表）

| 参数 | 类型 | 必填 | 范围 | 默认 |
|---|---|---|---|---|
| `prompt` | `string` | **是** | minLength 1 | — |
| `guidance` | `number` | 否 | 0–10 | 4.5 |
| `seed` | `integer` | 否 | min 0 | — |
| `height` | `integer` | 否 | 0–2500 | 1120 |
| `width` | `integer` | 否 | 0–2500 | 1120 |
| `num_steps` | `integer` | 否 | 1–40 | — |
| `steps` | `integer` | 否 | 1–40 | — |

**注意：`num_steps` 和 `steps` 两列同时存在，描述相同。文档未说明二者关系（是否等价、优先级如何）。**

## 输出

| 字段 | 类型 | 说明 |
|---|---|---|
| `image` | `string` | "The generated image in Base64 format." |
| `usage.neurons` | `number` | 本次调用的神经元消耗。**客户端 `cost` 字段即取自这里**（形如 `"172.8 neurons"`） |

实测输出：`1024×1024`、`steps=4` → `usage.neurons = 172.8`。

## 定价

`[doc: platform/pricing]`：每 512×512 tile $0.006996 / 636 neurons；每 step $0.000132 / 12 neurons

---

# 八、`@cf/black-forest-labs/flux-2-klein-4b`

`[doc: models/flux-2-klein-4b]` · Text-to-Image · Partner · BFL

## 输入参数

参数表**只显示**：

> Parameters
> `multipart{}` — `object` — required

**没有列出任何子字段名、取值范围或默认值。**

输入 schema（`schema-input.json`，官方链接）内容：

```json
{"type":"object","properties":{"multipart":{"type":"object","properties":{"body":{"type":"object"},"contentType":{"type":"string"}}}},"required":["multipart"]}
```

**结论：此模型在 Workers AI 上要求 `multipart` 形式的请求体，不是普通 JSON 参数对象。文档未载明 `body` 内部的具体字段。**

## 输出

| 字段 | 类型 | 说明 |
|---|---|---|
| `image` | `string` | "Generated image as Base64 string." |

## 定价

`[doc: platform/pricing]`

| 计费项 | 价格 |
|---|---|
| 输入 512×512 tile | $0.000059 / 5.37 neurons |
| 输出 512×512 tile | $0.000287 / 26.05 neurons |

---

# 九、`@cf/black-forest-labs/flux-2-klein-9b`

`[doc: models/flux-2-klein-9b]` · Text-to-Image + multi-reference editing · Partner · BFL

## 输入参数

同 klein-4b：参数表只有 `multipart{}` / object / required，**无子字段说明**。schema-input.json 与 klein-4b 完全一致。

## 输出

| 字段 | 类型 | 说明 |
|---|---|---|
| `image` | `string` | "Generated image as Base64 string." |

## 定价

`[doc: platform/pricing]`

| 计费项 | 价格 |
|---|---|
| 首个 MP (1024×1024) | $0.015 / 1363.64 neurons |
| 后续每 MP | $0.002 / 181.82 neurons |
| 每输入图片 MP | $0.002 / 181.82 neurons |

---

# 十、`@cf/black-forest-labs/flux-2-dev`

`[doc: models/flux-2-dev]` · Text-to-Image + multi-reference · Partner · BFL

## 输入参数

同前两个 flux-2：只有 `multipart{}` / object / required，**无子字段说明**。schema-input.json 一致。

## 输出

| 字段 | 类型 | 说明 |
|---|---|---|
| `image` | `string` | "Generated image as Base64 string." |

## 定价

`[doc: platform/pricing]`

| 计费项 | 价格 |
|---|---|
| 输入 512×512 tile, 每 step | $0.00021 / 18.75 neurons |
| 输出 512×512 tile, 每 step | $0.00041 / 37.50 neurons |

---

# 汇总对比

## 参数名差异（最容易出错的地方）

| 模型 | 步数参数名 | 支持 width/height | 输出形式 |
|---|---|---|---|
| flux-1-schnell | `steps`（max 8, 默认 4） | ❌ 未列出 | JSON `result.image` base64 |
| SDXL base 1.0 | `num_steps`（max 20, 默认 20） | ✅ 256–2048 | PNG 流 |
| SDXL-Lightning | `num_steps`（max 20, 默认 20） | ✅ 256–2048 | PNG 流 |
| dreamshaper-8-lcm | `num_steps`（max 20, 默认 20） | ✅ 256–2048 | PNG 流 |
| SD1.5-inpainting | `num_steps`（max 20, 默认 20） | ✅ 256–2048 | PNG 流 |
| phoenix-1.0 | `num_steps`（1–50, 默认 25） | ✅ 0–2048, 默认 1024 | **JPEG 流** |
| lucid-origin | `num_steps` + `steps`（均 1–40） | ✅ 0–2500, 默认 1120 | JSON `result.image` base64 |
| flux-2-* | 文档未载明 | 文档未载明 | JSON `result.image` base64 |

## 免费额度

`[doc: platform/pricing]` — 每个账户 **10,000 neurons/天**，Free 计划与 Paid 计划都有，每日 UTC 00:00 重置。超出后 $0.011 / 1,000 neurons。

## 文档未载明的项目（不要猜）

- flux-1-schnell 传入 `seed` / `width` / `height` 的**实际行为**（schema 声明 `additionalProperties: false` 即不合法，但示例代码在传 `seed`，两处矛盾；是静默忽略还是报错，文档未说）
- lucid-origin 的 `num_steps` 与 `steps` 的关系（两个都列、描述相同，优先级未说明）
- flux-2 三个模型 `multipart.body` 内的具体字段
- dreamshaper-8-lcm 的定价（模型页无 Unit Pricing 行，定价页图像表未列该模型）
- SDXL 三兄弟标注 `$0.00 per step` 是否意味着完全免费，还是仅指该计费项

## 已查明、无需再猜的项目

- ✅ SDXL 系四个模型的输出 MIME 类型：**PNG**（见各模型 `schema-output.json`）
- ✅ flux-1-schnell 的 `width`/`height` 是否合法：**不合法**（`additionalProperties: false`）
- ✅ klein-9b 的后续 MP / 输入图片 MP 神经元数：**181.82**
- ✅ 文生图模型总数：**10 个**，与本文档覆盖范围完全一致

## 命名陷阱

`@cf/deepgram/flux` 是**语音识别模型**（Deepgram），与图像 FLUX 无关。按 "flux" 搜索时容易误选。
本文档所有 FLUX 模型都带完整前缀 `@cf/black-forest-labs/`。
