---
name: image-gen-hub
description: 生图渠道统一入口，覆盖四个渠道，默认降级顺序 ModelScope 魔搭 → SenseNova 商汤日日新 → Pollinations → Cloudflare Workers AI。当用户要"生图/AI 画图/免费生图/白嫖生图/不花钱出图/用魔搭生图/用 Cloudflare 生图/用 Pollinations 生图/用商汤生图/SenseNova 生图"，或问某个渠道的文生图参数（字段名、取值范围、默认值）时使用。给出可直接运行的调用例子与尺寸规则。
---

# Image Gen Hub

四个生图渠道的统一入口。**照抄下面的例子就能出图，参数不要凭记忆写。**

| 渠道 | 计费 |
|---|---|
| modelscope | 免费 |
| sensenova | 免费 |
| pollinations | 免费 |
| cloudflare | 免费 |

默认顺序（`DEFAULT_ORDER`，代码里写死）：`modelscope → sensenova → pollinations → cloudflare`。
任一失败自动切下一个，不需要自己判断。

---

## 快速开始

```python
import os, sys
# 指向本仓库的 backend/ 目录（或你的 skill 安装位置）
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))
import free_image_gen as fig

# 1. 标准出图（默认 1024×1024，自动落盘）
r = fig.generate("一只穿宇航服的橘猫，插画风格", out_dir="/tmp/out")

# 2. 竖版 2:3（魔搭实测可用尺寸）
r = fig.generate("写实人像，红裙女性站在窗边", width=1360, height=2040, out_dir="/tmp/out")

# 3. 大图 2048 以上（只有 sensenova 能到 4096）
r = fig.sensenova_generate("哥特式教堂内部，彩色玻璃窗，电影感布光",
                           width=2048, height=2048,
                           model="sensenova-u1.5-lite",
                           response_format="b64_json")

# 4. 图生图 / 图像编辑（只有 sensenova 支持参考图，最多 5 张，第一张为主图）
r = fig.sensenova_generate("把背景换成冰川",
                           images=["换成你自己的图片地址"],   # 公网 https URL 或 data:image/xxx;base64,...
                           response_format="b64_json")

# 5. 只要魔搭，不降级
r = fig.modelscope_generate("东方美女人像，旗袍，柔和侧光，浅景深", width=1664, height=1664)
```

`response_format="b64_json"` 是 sensenova 的稳妥取值，避免走 URL 下载路径。

## 调用约定

- 所有函数**只有一个位置参数 `prompt`，其余必须写参数名**。位置传参会 `TypeError`。
- `generate()` 默认 `save=True`，每次成功都写两个文件到磁盘：
  - 图片：`<UTC时间戳>-<backend>.<jpg|png>`
  - 元信息：同名 `.meta.json`
- 默认目录是 **Python 进程的 cwd** 下的 `generated-images/`（不是会话目录），务必显式传 `out_dir=`。同秒多次调用自动加 `-1` `-2` 后缀。
- 底层 `*_generate()` 是纯函数、不落盘；要文件就把返回值传给 `fig.save_result(r, out_dir=...)`。
- **直接调底层函数时不会有 `requested_size` 和 `degraded`**（只有 `generate()` 填）。要判断有没有被缩图，自己拿 `r["size"]` 和请求值比。

## 返回值必读字段

```python
r["ok"]         # 是否成功
r["backend"]    # 实际出图的渠道
r["size"]       # 实际输出像素（永远读这个，不要假设等于请求值）
r["file"]       # 图片绝对路径
r["meta_file"]  # 元信息 json 路径
r["saved"]      # True 表示已落盘
r["task_id"]    # 魔搭任务 id，可凭它重拉结果
```

**要文件产物直接读 `r["file"]`，不要再自己保存一遍。**

## 按需求选模型

| 需求 | 渠道 | 模型 / 写法 |
|---|---|---|
| 默认出图 | modelscope | `Qwen/Qwen-Image-2.1-Turbo` |
| 要 2048 以上的大图 | sensenova | `sensenova-u1.5-lite`，最大 4096 |
| 要图生图 / 图像编辑 | sensenova | 传 `images=[...]`，仅此渠道支持 |
| 要风格迁移 / 细节增强 | modelscope | 基础模型 + `loras` 参数（见 `references/modelscope.md` §二） |
| 要透明背景 | pollinations | `openai/gpt-image-2.5-flare` 或 `sunburst` |
| 只出 1024 且魔搭不可用 | cloudflare | `@cf/black-forest-labs/flux-1-schnell` |
| 要非 1:1 比例且魔搭不可用 | cloudflare | SDXL 系（支持 width/height 256–2048） |
| 要 gpt-image-2 / MAI / seedream | pollinations | 见 `references/pollinations.md` 模型清单 |

## 尺寸规则（防参数错误）

| 渠道 | 取值范围 |
|---|---|
| modelscope | 单边 **64–2048**，超了直接 `ValueError`；宽高自动向下对齐 16 的倍数。Qwen-Image 族官方上限 1664，2.1-Turbo 实测 2048 可出 |
| sensenova | **512–4096**，必须 **32 的倍数**，长宽比 **≤3:1** |
| cloudflare（flux-1-schnell） | **固定 1024×1024**，不接受 width/height |
| cloudflare（SDXL 系） | 256–2048 |
| pollinations | 单边 **≤1920**，超了 400；flux.1-schnell 实际固定输出 **768×1280**（不论请求多少） |

sensenova 官方推荐档位：`2048×2048` `2720×1536` `1536×2720` `1664×2496` `2496×1664` `4096×4096`

常用取值：默认 **1024×1024**；竖版 2:3 用 **1360×2040**（魔搭）；大图用 sensenova 的 **1664×2496** 或 **2048×2048**。

**pollinations 的 prompt 必须用英文。** 中文 prompt 会静默返回不相干的画面（实测输入旗袍人像，输出夜市街景），
且 `ok=True`、尺寸正常，没有任何报错。同一 prompt 改成英文即恢复正常。

## Cloudflare 模型族参数差异

`cloudflare_generate` 按模型族分派，步数参数名不同，写错会被拒绝或静默丢弃：

| 模型族 | 步数参数 | 范围 | width/height |
|---|---|---|---|
| flux-1-schnell | `steps` | 1–8（默认 4） | ❌ 不接受，其他参数全部丢弃 |
| SDXL 四兄弟 | `num_steps` | 1–20（默认 20） | 256–2048 |
| phoenix-1.0 | `num_steps` | 1–50（默认 25） | 0–2048，guidance 2–10 |
| lucid-origin | `num_steps` | 1–40 | 0–2500，guidance 0–10 |

## 凭据

已配置在 `credentials.env`，脚本自动读取，**无需每次设置**。

```python
import free_image_gen as fig
print(fig.credential_status())
# {'CLOUDFLARE_ACCOUNT_ID': True, 'CLOUDFLARE_API_TOKEN': True, ...}
```

只返回布尔值，不泄露内容。

**凭据处理纪律：**

- 不要 `cat`、不要 `Read` `credentials.env`，不要把它读进对话上下文。
- 确认是否就绪只调 `credential_status()`。
- 不要把这个文件内容写进任何文档、示例或回复。
- 这个文件不应进入 git 仓库。

参考文件（按需查阅，不要整份读入）：

| 渠道 | 参考文件 | 关键章节 |
|---|---|---|
| modelscope | `references/modelscope.md` | §二 文生图参数表 |
| cloudflare | `references/cloudflare.md` | 对应模型章节 |
| pollinations | `references/pollinations.md` | §一 GET /image/{prompt} 参数表 |
| sensenova | `references/sensenova.md` | §一 文生图 / §二 编辑参数 |

## 两条纪律

1. **参数只从 references 取。** 不从记忆、不从示例、不从另一个渠道类推。字段名有真实差异：Cloudflare 的 flux 用 `steps`、SDXL 系用 `num_steps`；Pollinations 的 GET 端点用 `width`/`height`、POST 端点用 `size`。
2. **不做"探测式"调用。** 不要为了确认某个参数是否支持而发真实请求。参数以文档为准，文档没写就说不确定。
