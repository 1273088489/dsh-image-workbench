# SenseNova（商汤日日新）

**付费渠道。** 按 token 计费，不是免费额度。这是本技能唯一需要花钱的 backend，默认降级链里不包含它，必须显式指定。

- API 站点：`https://platform.sensenova.cn/docs`（控制台）／ `https://token.sensenova.cn/v1`（调用）
- 模型：`sensenova-u1.5-lite`（质量优先）、`sensenova-u1.5-fast`（速度优先）
- 架构：Neo-unify，生成与编辑同一个模型

---

## 一、文生图参数表

`POST https://token.sensenova.cn/v1/images/generations`

`[doc: platform.sensenova.cn/docs · SenseNova U1.5 Lite/Fast 章节]`

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `model` | string | ✅ | — | `sensenova-u1.5-lite` 或 `sensenova-u1.5-fast` |
| `prompt` | string | ✅ | — | 图像描述。**上限 32000 字符（实测）**，见下方「prompt 长度实测」 |
| `size` | string | — | `auto` | `WIDTHxHEIGHT`。宽高须为 **32 的倍数**，范围 **512–4096**，最大比例 **3:1** |
| `n` | integer | — | `1` | **仅支持 1** |
| `watermark` | boolean | — | `true` | 官方 Logo 水印。`false` 去水印 |
| `response_format` | string | — | `b64_json` | `b64_json` 或 `url`（`url` 有效期 **24 小时**） |
| `output_format` | string | — | `png` | `png` / `jpeg` / `webp` |
| `prompt_extend` | boolean | — | `true` | 官方提示词自动润色。失败则回退原 prompt |

### 官方推荐分辨率

`[doc: 同上，两个模型的推荐表一致]`

| 分辨率 | 比例 | 等级 |
|---|---|---|
| `2048 x 2048` | 1:1 | 2K |
| `2720 x 1536` | 16:9 | 2K |
| `1536 x 2720` | 9:16 | 2K |
| `1664 x 2496` | 2:3 | 2K |
| `2496 x 1664` | 3:2 | 2K |
| `4096 x 4096` | 1:1 | 4K |

**注意**：文档示例里出现 `1024x1024`，但 512–4096 区间内任意 32 倍数都合法。默认 `auto` 由模型自适应。

### prompt 长度实测（2026-11-09，7 次付费请求）

官方只说「3–4K 上下文」，**不是字符上限**。实测 `1024x1024`：

| 模型 | 输入字符数 | 结果 | billed_tokens |
|---|---|---|---|
| u1.5-lite | 4,001 | ✅ 成功 | 6,098 |
| u1.5-lite | 8,000 | ✅ 成功 | 5,630 |
| u1.5-lite | 16,000 | ✅ 成功 | 5,943 |
| u1.5-lite | 32,000 | ✅ 成功 | 6,206 |
| u1.5-lite | 64,000 | ❌ 400 | 未计费 |
| **u1.5-fast** | **32,001** | ❌ 400 | 未计费 |
| **u1.5-fast** | **32,000** | ✅ 成功 | 5,582 |

拒绝原文（两个模型完全一致）：

```
field Prompt invalid, should be at most 32000
```

**结论：两个模型的硬上限都是 32000 字符**，与文档的「3–4K 上下文」无关（后者指模型上下文预算，不是输入校验）。

**附带的三个副作用**：

1. **超限不计费。** 两次 400 都在 0.2–0.3 秒内返回，`usage` 为 null，没有产生 token。这意味着**探边界用「超一字符」的请求是免费的**，可以放心先用它定位上限。
2. **`prompt_extend=true` 会显著压缩长提示词 —— 已用对照实验证实。** 见下方「prompt_extend 压缩对照实测」。
3. **`-fast` 与 `-lite` 的唯一差别是速度与输出 token。** 同尺寸下 fast 用 11.1 秒 / 5582 tokens，lite 用 19 秒 / 6098 tokens（同为 32000 字符）。上限、错误文案、字段表完全一致。

### prompt_extend 压缩对照实测（2026-11-09，另 2 次付费请求）

**问题**：`input_tokens` 几乎不随提示词长度增长（u1.5-lite 的 4001 与 32000 字符都是约 2.2K），但当时无法确定原因——是 `prompt_extend` 在改写，还是服务端另有截断、或 tokenizer 压缩了重复填充文本。

**对照设计**：固定 `sensenova-u1.5-lite` / `1024x1024` / `response_format=b64_json`，**只把 `prompt_extend` 设为 `false`**，再跑同样两个长度。

| `prompt_extend` | 4,001 字符 | 32,000 字符 | 增长 |
|---|---|---|---|
| `true`（默认） | 2,129 | 2,237 | **≈1.05×（几乎不变）** |
| `false` | 1,510 | **8,603** | **5.7×** |

**结论：`prompt_extend=true` 确实把长提示词压缩/改写掉了。** 关掉它，`text_tokens` 才随长度真实增长（8,603 ≈ 32,000 英文字符的合理 token 量）。

推论：

- **写长提示词想让它原样生效，必须显式传 `prompt_extend=false`。** 默认状态下，3 万字的细节几乎不会进入模型——服务端会先把它压成约 2K token 的版本。
- **反过来，短提示词用默认值更好。** `prompt_extend=true` 时的 4001 字符反而是 2,129 tokens（比关闭时的 1,510 更多），说明它在扩写短提示词——这正是这个功能的设计意图。
- **关掉后耗时显著变长**：4,001 字符 62 秒（开启时 19 秒），32,000 字符 162 秒。长提示词按原样处理确实更贵更慢，32,000 字符那次账单 12,572 tokens（开启时仅 6,206）。

---

## 二、图生图 / 编辑参数表

`POST https://token.sensenova.cn/v1/images/edits`

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `model` | string | ✅ | — | 同上 |
| `images` | array | ✅ | — | 每个元素含 `image_url`。**第一张为主图**，最多 **5 张**参考图 |
| `images[].image_url` | string | ✅ | — | 公网 HTTP/HTTPS URL，或 `data:image/{fmt};base64,{data}` |
| `prompt` | string | ✅ | — | 描述期望的最终画面，不只是改什么 |
| `n` | integer | — | `1` | 仅支持 1 |
| `size` | string | — | `auto` | `auto` 自适应主图；也可显式指定 |
| `response_format` | string | — | `b64_json` | 同文生图 |
| `output_format` | string | — | `png` | `png` / `jpg` / `jpeg` / `webp` |
| `watermark` | boolean | — | `true` | 同文生图 |
| `prompt_extend` | boolean | — | `true` | 同文生图 |

**使用限制**：必须至少一张输入图；Base64 必须带完整 `data:` 前缀，裸 Base64 会被拒；URL 不可达或无法解码则请求失败。

---

## 三、API 侧没有的参数（重要边界）

`[实测观察 + 官方文档核对]`

SenseNova **REST API 不暴露采样参数**。以下参数只存在于**本地部署**（HuggingFace 权重）的推理脚本：

| 参数 | 官方参考值 | 出处 | 是否可用于 API |
|---|---|---|---|
| `cfg_scale` | `4.0` | `docs/u1.5_preview.md` | ❌ 不支持 |
| `timestep_shift` | `3.0` | 同上 | ❌ 不支持 |
| `num_steps` / `steps` | `50` | 同上 | ❌ 不支持 |
| `seed` | — | 未提供 | ❌ 不支持 |
| `image_cfg` | `1.0` | ComfyUI 节点文档 | ❌ 不支持 |
| `cfg_norm` | `none` | ComfyUI 节点文档 | ❌ 不支持 |

**这就是为什么必须把提示词写好**：API 侧无法用 cfg/步数调精细度，唯一的质量杠杆是 `prompt` 和 `size`。

---

## 四、提高精细度的唯一路径：结构化 Render JSON

官方 Gallery 的 6 条示例**全部使用结构化 JSON 提示词**，而不是自然语言长句。
`[src: 一级 · examples/t2i/data/u1_5_gallery.jsonl]`

字段骨架（16 类，按需省略）：

```json
{
  "type": "整体类型",
  "theme": "主题一句话",
  "language": "none",
  "canvas": {"aspect_ratio": "2:3", "orientation": "portrait",
             "resolution_hint": "high-resolution", "safe_margin": "哪些元素不能贴边"},
  "image_reading": {"first_impression": "", "core_visual_hook": "", "narrative": ""},
  "main_subject": {"subject": "", "position": "", "scale": "", "pose_or_action": "",
                   "appearance": "", "wardrobe_or_materials": "",
                   "distinctive_details": ["", ""]},
  "secondary_elements": [{"element": "", "location": "", "visual_role": "", "details": ""}],
  "background_environment": {"setting": "", "foreground": "", "midground": "",
                             "background": "", "atmosphere": "", "spatial_depth": ""},
  "composition_layout": {"overall_structure": "", "visual_hierarchy": "", "balance": "",
                         "leading_lines": "", "cropping": "", "negative_space": ""},
  "style": {"overall": "", "medium": "", "art_direction": "", "visual_tone": "",
            "references": [], "color_palette": [], "saturation": "", "contrast": "",
            "texture": []},
  "lighting": {"type": "", "direction": "", "quality": "", "shadows": "",
               "highlights": "", "color_temperature": ""},
  "camera_or_rendering": {"viewpoint": "", "shot_type": "", "lens_feel": "",
                          "depth_of_field": "", "perspective": "", "render_finish": ""},
  "typography": {"only_if_text_exists": false, "visible_text": []},
  "generation_instructions": {"must_keep": [], "should_avoid": [], "text_policy": ""},
  "quality_tags": [],
  "negative_prompt": []
}
```

**`must_keep` 与 `should_avoid` 是提高命中率的关键**：把“必须保留什么”和“必须避免什么”逐条写死，比堆叠形容词有效。实测中「玫瑰长绿茎」「坐姿露腿」这类偏差，写进 `should_avoid` 即可规避。

**注意**：`negative_prompt` 在 JSON 里是一个字段，但**不是** API 的顶层参数——它随 prompt 一起提交，是给模型读的语义字段。

---

## 五、官方 Image PE（提示词增强）流程

`[src: 一级 · docs/u1.5_best_practices_CN.md · Recipe 1]`

官方**强烈建议**把 Image PE 作为生成前的默认步骤：把简短需求转成上述 Render JSON。

- 官方脚本：`src/sensenova_u1_5/image_pe.py`（本地仓库内）
- 推荐重写模型：`gpt-5.6-terra`
- 该流程**不在 API 内**，需要自己调用一个 LLM 完成重写
- API 的 `prompt_extend` 是另一回事：它是服务端自动扩写，**不产出 Render JSON**，控制粒度低于 Image PE

**Editing PE** 同理，针对编辑任务，会明确"改什么"和"什么必须不变"。

---

## 六、接进本技能时的调用约定

```python
import free_image_gen as fig

# 文生图（付费，必须显式指定 backend）
r = fig.generate("...", width=1664, height=2496,
                 backends=("sensenova",), model="sensenova-u1.5-lite")

# 编辑 / 图生图（唯一支持参考图的后端）
r = fig.sensenova_generate("把背景换成冰川", images=["https://.../a.png"])
```

| 项目 | 值 |
|---|---|
| 凭据变量 | `SENSENOVA_API_KEY`（放 `credentials.env`） |
| 默认 `response_format` | `url`（便于统一下载落盘；`b64_json` 也可） |
| 默认 `watermark` | `False` |
| 默认 `prompt_extend` | `True` |
| 尺寸校验 | 512–4096、32 倍数、比例 ≤3:1，**调用前本地校验**，不浪费请求 |
| 返回字段 | `billed_tokens` 记录 `usage.total_tokens`，用于成本核算 |

**降级链**：`sensenova` **不在** `DEFAULT_ORDER` 里。它有质量优势但会花钱，必须显式放进去：

```python
fig.generate(p, backends=("sensenova", "modelscope"))   # 先付费求质量，失败再降免费
```

---

## 七、计费

`[实测观察，非文档]` 单张实测消耗：

| 任务 | model | total_tokens |
|---|---|---|
| 1280×1920 文生图 | u1.5-lite | 4,979 |
| 1280×1920 文生图 | u1.5-fast | 4,758 |
| 1664×2528 图生图 | u1.5-lite | 13,116（含图像输入 8,192） |

**单价未在本文档核实**，请以 platform.sensenova.cn 控制台为准。图生图比文生图贵约 2.6 倍，因为输入图按 image_tokens 计费。

---

## 八、速率与失败

`[doc: 官方文档未载明]` 官方文档**没有公布** RPM/TPM 限额、并发上限、重试建议。遇到 429 时按通用退避处理，不要假定具体阈值。

| 错误 | 处理 |
|---|---|
| 401 | `SENSENOVA_API_KEY` 无效或缺失 |
| 429 | 限流，退避或切其他 backend |
| 400 + size 相关 | 尺寸不合规（非 32 倍数 / 超范围 / 比例过大） |
| 400 + images 相关 | 参考图 URL 不可达，或 Base64 缺 `data:` 前缀 |
