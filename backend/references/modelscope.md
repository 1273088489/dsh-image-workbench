# ModelScope 魔搭 — 文生图模型参数

**全部参数均来自官方文档站原文。**
抓取日期：2026-10-22 · 文档版本 `20261020182350`

## 文档地址（一级来源，可直接抓取）

魔搭文档站是 SPA，`modelscope.cn/docs/...` 抓不到正文。但官方文档的 Markdown 原件在 CDN 上，可通过版本指针定位：

```
# 1. 取当前版本号
GET https://www.modelscope.cn/api/v1/document/main_doc_CN_prod
→ {"Data":{"TargetPrefix":"https://resouces.modelscope.cn/document/docdata/2026-10-20_18-23-CN",
          "Version":"20261020182350"}}

# 2. 拼接 /dist/{path} 取 Markdown
{TargetPrefix}/dist/model-service/API-Inference/intro/intro_CN.md
{TargetPrefix}/dist/model-service/API-Inference/limits/limits_CN.md
```

英文版把 `-CN` 换成 `-EN`。

已验证可用的直链：

| 文档 | URL |
|---|---|
| API 推理介绍（含完整参数表） | https://resouces.modelscope.cn/document/docdata/2026-10-20_18-23-CN/dist/model-service/API-Inference/intro/intro_CN.md |
| 使用限制（额度口径） | https://resouces.modelscope.cn/document/docdata/2026-10-20_18-23-CN/dist/model-service/API-Inference/limits/limits_CN.md |
| 英文版 intro | https://resouces.modelscope.cn/document/docdata/2026-10-20_18-23-EN/dist/model-service/API-Inference/intro/intro_EN.md |

**版本号会变。** 硬编码上述 URL 前先调一次版本指针接口取 `TargetPrefix`。

## 其他官方来源

| 用途 | URL |
|---|---|
| 模型页 Markdown 版 | `https://www.modelscope.cn/models/{owner}/{name}.md` |
| 公开 OpenAPI（64 个 path，无推理端点） | https://www.modelscope.cn/.well-known/openapi.json |
| AIGC 专区模型库 | https://www.modelscope.cn/aigc/models |
| 令牌管理 | https://www.modelscope.cn/my/myaccesstoken |
| 官方 llms.txt | https://modelscope.cn/llms.txt |

---

# 一、调用流程

`[doc: intro_CN.md · AIGC模型]`

```
POST https://api-inference.modelscope.cn/v1/images/generations
GET  https://api-inference.modelscope.cn/v1/tasks/{task_id}
```

官方示例原文（节选结构）：

```python
base_url = 'https://api-inference.modelscope.cn/'
common_headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json",
}

response = requests.post(
    f"{base_url}v1/images/generations",
    headers={**common_headers, "X-ModelScope-Async-Mode": "true"},
    data=json.dumps({"model": "Qwen/Qwen-Image", "prompt": "A golden cat"},
                    ensure_ascii=False).encode('utf-8')
)
task_id = response.json()["task_id"]

while True:
    result = requests.get(
        f"{base_url}v1/tasks/{task_id}",
        headers={**common_headers, "X-ModelScope-Task-Type": "image_generation"},
    )
    data = result.json()
    if data["task_status"] == "SUCCEED":
        image = Image.open(BytesIO(requests.get(data["output_images"][0]).content))
        break
    elif data["task_status"] == "FAILED":
        break
    time.sleep(5)
```

### 两个请求头

| 请求头 | 用于 |
|---|---|
| `X-ModelScope-Async-Mode: true` | 提交时 |
| `X-ModelScope-Task-Type: image_generation` | 轮询时 |

官方参数表**没有**把这两个头列为参数项，它们只出现在代码示例中。取值 `image_generation` 的枚举范围文档未说明。

### 响应

提交响应含 `task_id`；轮询响应含 `task_status`（`SUCCEED` / `FAILED`）与 `output_images` 数组。

`task_status: "SUCCEED"` 在提交响应中的确切语义（"已接受"还是"已完成"）文档未说明。

---

# 二、文生图参数表（官方原文）

`[doc: intro_CN.md · 更多参数说明]`

| 参数名 | 参数说明 | 必须 | 类型 | 示例 | 取值范围 |
|---|---|---|---|---|---|
| `model` | 模型 id | **是** | string | `MAILAND/majicflus_v1` | ModelScope 上的 AIGC 模型 ID |
| `prompt` | 正向提示词，大部分模型建议使用英文提示词效果较好 | **是** | string | `A mysterious girl walking down the corridor.` | 长度小于 **2000** |
| `negative_prompt` | 负向提示词 | 否 | string | `lowres, bad anatomy, bad hands, text, error, missing fingers, ...` | 长度小于 **4000** |
| `size` | 生成图像分辨率大小 | 否 | string | `1024x1024` | 见下表（按模型族） |
| `seed` | 随机种子 | 否 | int | `12345` | `[0, 2^31-1]` |
| `steps` | 采样步数 | 否 | int | `30` | `[1, 100]` |
| `guidance` | 提示词引导系数 | 否 | float | `3.5` | `[1.5, 20]` |
| `image_url` | 待编辑图片的 url 地址（或编码过的 base64 数据）。**只适用于支持图片编辑的模型** | 否 | string | `https://resources.modelscope.cn/aigc/image_edit.png` | 确保公网可访问（或 base64） |
| `loras` | LoRA 模型，用于风格迁移或细节增强 | 否 | string \| dict | 单个：`"<lora-repo-id>"`<br>多个：`{"<id1>": 0.6, "<id2>": 0.4}` | 多 LoRA 权重总和须为 1.0，最多 6 个 |

### ⚠️ `negative_prompt` 上限是 4000，不是 2000

英文版文档写 `less than 2000`，中文版原文写 `长度小于4000`。**以中文版为准（4000）。** 两版存在不一致，此处记录在案。

### `size` 的取值范围（官方原文，按模型族）

| 模型族 | 分辨率范围 |
|---|---|
| SD 系列 | `[64x64, 2048x2048]` |
| FLUX | `[64x64, 1024x1024]` |
| Qwen-Image | `[64x64, 1664x1664]` |
| Z-Image-Turbo | `[512x512, 2048x2048]` |

**格式为 `宽x高`（`WxH`）**，示例 `1024x1024`。

### ⚠️ 客户端有 16 倍数对齐，这不是官方规定

`free_image_gen.py` 在提交前会做：

```python
size = f"{width - width % 16}x{height - height % 16}"
```

即**向下取整到 16 的倍数**。请求 `1023x1023` 会被改成 `1008x1008`。

**这是客户端行为，官方文档里没有任何对齐规则。** 保留它的理由是多数扩散模型内部要求 8/16 对齐，不对齐可能被服务端拒绝；代价是不对齐的请求会被静默调整。

返回值的 `size` 字段解析自图像头，会如实反映实际输出，不会让调用方看到错误尺寸。需要精确控制时，直接传 16 的倍数（如 `1024x1024`、`2048x2048`）。

### `loras` 用法（官方原文）

```
- for Single LoRA:   "loras": "<lora-repo-id>"
- for Multiple LoRAs: "loras": {"<lora-repo-id1>": 0.6, "<lora-repo-id2>": 0.4}
- Upto 6 LoRAs, all weight-coeffients must sum to 1.0
```

**LoRA 通过 `loras` 参数传入，不是替换 `model`。** 这是常见误解。

### 编辑接口的 `image_url`

同一张参数表适用。"对于图像编辑模型，输入的图片建议使用线上托管的图像 URL 地址。"

本地文件用 base64 data URL 形式传入：

```python
"image_url": [image_to_data_url("path/to/local/image.jpg")]
```

### ⚠️ `image_url` 的类型矛盾（官方文档自身）

参数表把 `image_url` 的类型写为 **`string`**，但同页的 Base64 示例传的是**数组**：

```python
"image_url": [image_to_data_url("path/to/local/image.jpg")]
```

文档未解释。按示例传数组更保险，但这是文档自身的不一致，不是外部猜测。

### 关于 `images` 字段

某些第三方文章列出的 `images`（base64 数组）字段，**在官方文档中不存在**。官方只承认 `image_url`。
不要使用 `images`。

---

# 三、本地图片转 base64

`[doc: intro_CN.md · Base64 本地图片编码工具函数]`

官方提供：

```python
import os, mimetypes, base64

def image_to_data_url(image_path):
    if not os.path.isfile(image_path):
        raise FileNotFoundError(f"Image file not found: {image_path}")
    with open(image_path, "rb") as f:
        image_data = f.read()
    mime_type, _ = mimetypes.guess_type(image_path)
    if mime_type is None or not mime_type.startswith('image/'):
        mime_type = 'image/png'
    return f"data:{mime_type};base64,{base64.b64encode(image_data).decode('utf-8')}"
```

---

# 四、模型 ID 与许可

`[doc: 模型页 .md + /api/v1/models 元信息接口]`

| 模型 | 参数量 | LicenseName | 任务 |
|---|---|---|---|
| `Qwen/Qwen-Image-2.1-Turbo` | 16.2B（front matter） | `qwen-research` | text-to-image-synthesis |
| `Qwen/Qwen-Image-2.1` | — | `qwen-research` | txt2img |
| `Qwen/Qwen-Image` | — | `apache-2.0` | txt2img |

### 参数量的两种口径

模型页 front matter 写 `parameters: 16.2B`，而 README 写 `same 7B visual generation architecture`、"7B parameters in its visual generation component (32 Single-Stream DiT layers)"。前者是含文本编码器的总参数，后者是视觉生成组件。**引用时说明是哪个口径。**

### 许可

`qwen-research` **不是开源商用许可**。商用前需单独确认授权。
同系列里只有老版 `Qwen/Qwen-Image` 是 `apache-2.0`。

---

# 五、额度与限流

`[doc: limits_CN.md]`

**官方原文没有"每日 2000 次"或"单模型 200 次"这类固定次数额度。** 第三方文章流传的数字在官方文档中查不到。

官方现行口径（原文）：

> API-Inference 对于使用额度和并发会进行一定限制，同时根据实时资源使用情况，会实时进行动态调整。

> 不同模型允许的调用并发，会根据平台的压力进行动态的速率限制调整，原则上以保障开发者单并发正常使用为目标。

> 支持使用魔粒兑换 API-Inference 调用，魔粒余额充足即可调用任意次数。根据所需的基础算力和模型规模，魔粒扣减分为三档：**轻量模型（0.5 魔粒/次），主流模型（1 魔粒/次），旗舰模型（2 魔粒/次）**。

> 请勿用于需要高并发以及 SLA 保障的线上任务

### 前置条件（原文）

> 免费推理 API 由阿里云提供算力支持，要求您的 ModelScope 账号必须首先**绑定阿里云账号**。同时为了防止滥用，对应云账号需已通过**实名认证**后，才可正常使用 API-Inference。

### 关于响应头中的额度字段

`modelscope-ratelimit-*` 系列字段**不在官方文档中**，也不在 `intro_CN.md` / `limits_CN.md` 中。第三方资料有提及，但无官方出处。不要依赖这些头做容量规划。

---

# 六、支持模型范围的判断方法

`[doc: limits_CN.md]`

官方原文：

> 开发者可根据模型页面的过滤条件直接筛选，根据标记有"蓝绿色闪电"的 API-Inference logo 来判断。
> 同时在模型详情页面右侧，对于支持 API-Inference 的模型，也会展示使用入口和对应的代码范例。

**没有可编程的"哪些模型支持 API-Inference"接口。**
`GET https://api-inference.modelscope.cn/v1/models` 无需鉴权即可访问，但只返回 37 个 LLM/MLLM，**不含任何图像生成模型**。

---

# 七、文档未载明的项目（不要猜）

- 提交响应中 `task_status: "SUCCEED"` 的确切语义
- `X-ModelScope-Task-Type` 除 `image_generation` 外的其他取值
- `steps` 对 `Qwen-Image-2.1-Turbo` 是否生效（模型 README 说明本地 Diffusers 的 8 步计划已烘焙、`num_inference_steps` 不覆盖，但 API 层未说明）
- `image_url` 参数的确切类型（参数表写 string，示例传 array）
- 各模型在 API-Inference 上的实时可用性清单
- 动态限流的具体数值（官方明确说"实时动态调整"，不公布固定值）
