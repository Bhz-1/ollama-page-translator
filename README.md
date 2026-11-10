# 本地网页翻译 · Ollama

点网页右侧的「译」按钮，用**本机 Ollama 大模型**把整页翻成中文。
译文以绿色小段落显示在**每段原文的正下方**，是页面正常排版的一部分——不用浮层、不绝对定位，所以**永远不会遮挡原文或别的译文**，只会把下面的内容往下顶。

---

## 一、安装（Edge，约 1 分钟，只需一次）

1. 打开 Edge，地址栏输入 `edge://extensions` 回车。
2. 打开左下角的**开发人员模式**开关。
3. 点**加载解压缩的扩展**，选中这个文件夹：

   ```
   E:\dsh，gzq\work\local-page-translator
   ```

4. 列表里出现「本地网页翻译 · Ollama」就装好了。建议点详情把「固定到工具栏」，方便打开设置。

> 不用打包、不用上架商店，改代码后回这个页面点「重新加载」即可生效。

## 二、使用

| 操作 | 效果 |
| --- | --- |
| 点右侧「译」按钮 | 开始翻译整页 |
| 翻译中再点一次 | 停止 |
| 翻完点一次（显示「还原」） | 清除全部译文，回到原文 |
| **右键按钮** | **立刻停止模型、释放显存** |
| 双击按钮 / 点工具栏图标 | 打开设置 |
| Ctrl + Alt + T | 同「点按钮」 |

翻译是**逐段串行**的（本机模型一次只能算一个），页面顶部先翻，进度显示在底部提示条里。
第二次翻同一段会直接命中缓存，几乎瞬间完成。

## 三、设置

点工具栏图标打开设置页，能改：

- **服务地址**：默认 `http://127.0.0.1:11434`
- **模型**：默认 `dsh-qwen25:7b`（本机从 Qwen2.5-7B-Instruct GGUF 导入），点「测试连接」会列出本机所有已下载模型
- **目标语言**：简体中文 / 繁体中文 / English / 日本語 / 한국어
- **译文字号**：默认是原文的 95%，并限制在 13–18px 之间，防止特大标题的译文喧宾夺主
- **翻译中文页面**：默认跳过（避免白跑 8B 模型）
- **跳过导航**：不翻 header/nav/footer
- **悬浮按钮 / 快捷键**：可关
- **翻译完卸载**：默认开——翻完立刻把模型从显存里卸掉（见下节）

## 三·五、显存不够用怎么办（停模型）

模型一加载就占 5GB 显存，窗口一多容易卡。三个办法，从轻到重：

**1. 翻译完自动卸载（默认开）**
翻完立刻调 Ollama 的 `keep_alive: 0`，模型立即卸载、显存马上还回去。实测：翻译完成到 `ollama ps` 变空不到 2 秒。
代价：下次翻译要重新加载模型（4–10 秒）。嫌慢就去设置里关掉。

**2. 右键「译」按钮**
任何时候右键那个绿色按钮，立刻停止模型。提示「已停止模型，显存已释放」。

**3. 设置页按钮**
打开设置 → 「模型 / 显存」→ 「停止本地模型」，会列出当前加载的模型并全部卸载。

**为什么不用关 Ollama 服务本身**：服务进程只占 9MB 内存、不占显存，真正吃显存的是加载的模型。所以卸模型就够了，服务留着下次翻译直接用。

## 四、不遮挡是怎么保证的

代码里卡了这几条，都经过浏览器实测（25 段样本）：

1. 译文是 `<span class="dsh-pt-box" style="display:block">`，`position: static`，**普通文档流块**。
2. 插在原文元素**内部末尾**（不是浮动层），所以原文多高、译文就跟多高往下排。
3. 遇到 `display:flex/grid` 或 `overflow:hidden` 的容器，会**自动提升层级**插到容器外面，避免变成横向 flex 子项或被裁切。
4. 跳过 `position:fixed/absolute` 的浮层、`float` 元素、代码块、输入框、可编辑区、已插入的译文。
5. 所有样式带 `!important`，不受页面 CSS 污染；字号按原文算出来，不会撑爆版心。
6. 不翻译 `<td>` 里的表格结构之外的东西：译文塞进单元格内部，不破坏表格。

实测结果：`position 全部 static / 宽度无溢出 / 视口内被遮挡数 0 / 译文互相重叠 0`。

**下拉菜单、弹层也能翻。** 翻译完成后扩展会挂一个 DOM 监听：浮层一出现就自动翻译里面的条目，不用你操作。实测一个 7 项的菜单，打开后 1 秒内全部翻完。

注意顺序：**先点「译」翻整页，再去打开菜单**。因为点按钮这个动作本身会让菜单失焦关闭，菜单关了就没东西可翻。

## 五、排错

**按钮点了没反应 / 一直「翻译中」**
先确认 Ollama 在跑：

```powershell
Invoke-WebRequest http://127.0.0.1:11434/api/tags -UseBasicParsing
```

不通就双击 `E:\Ollama\serve.cmd`，或启动计划任务 `OllamaServer`（登录时自动启动）。

**报 `Ollama 403`**
Ollama 默认不认浏览器扩展的来源。`E:\Ollama\serve.cmd` 里必须有这行：

```cmd
set OLLAMA_ORIGINS=chrome-extension://*
```

改完重启服务（杀 `ollama.exe` 再跑 serve.cmd）。

**第一段特别慢**
首次要加载 8B 模型（约 30 秒），之后每段 1–3 秒。模型闲置 5 分钟后会卸载，下次重新加载。

**报「扩展上下文已失效」**
扩展被重新加载过，刷新一下页面即可。

## 六、文件结构

```
manifest.json     扩展清单（MV3）
background.js     service worker：代理翻译请求、拉起/卸载 Ollama
content.js        悬浮按钮 + 段落收集 + 译文插入 + 浮层监听
content.css       译文块与按钮样式（全 !important）
options.html/js   设置页
helper/           本地助手（127.0.0.1:11500），让扩展能启动 Ollama
icons/            16/32/48/128 图标
docs/             模型准备等文档
test/             真实浏览器验证脚本（CDP 驱动）
```

## 七、技术要点

- **为什么走 background**：content script 的 fetch 受页面 CORS 限制，交给 service worker 才能带扩展权限访问本机端口。
- **流式输出**：Ollama `/api/chat` 的 NDJSON 流，逐 token 更新译文块，长段落能边生成边看。
- **关思考**：请求带 `think:false`，否则 qwen3 会把推理过程也吐出来。
- **缓存**：内存 Map，键是 `模型|目标语言|原文`。
- **纯本地**：除了 `127.0.0.1:11434` 和本地助手 `127.0.0.1:11500`，不请求任何外部地址。

## 八、Ollama 被游戏挤掉怎么办（点按钮自动拉起）

打游戏时显卡被吃满，Ollama 经常被系统杀掉。现在点「译」按钮会走这套流程：

1. 先探 `127.0.0.1:11434`（2.5 秒）
2. 不通 → 请求本地助手 `POST /ensure`
3. 助手用隐藏方式启动 `E:\Ollama\app\ollama.exe serve`，轮询等它就绪（最多 30 秒）
4. 就绪后扩展继续翻译，提示条会显示「Ollama 已拉起」

**本地助手**（浏览器扩展不能启动进程，必须有它）：

| 项 | 位置 |
| --- | --- |
| 代码 | `work/local-page-translator/helper/ollama-helper.mjs` |
| 启动脚本 | `E:\Ollama\helper-start.vbs`（UTF-16，隐藏窗口） |
| 计划任务 | `OllamaHelper`（登录自启，隐藏） |
| 端口 | `127.0.0.1:11500`，只监听本机 |

接口：`GET /health` 看状态；`POST /ensure` 确保服务在跑；`GET /ensure` 同效。

**助手没跑**：点翻译会提示「Ollama 没在跑，本地助手也没响应」。去「任务计划程序」里手动运行 `OllamaHelper`，或者双击 `E:\Ollama\helper-start.vbs`。

**显存不够**：服务能起来，但模型加载会失败（Ollama 返回 500）。扩展会提示「显存不足，模型加载失败」——先把游戏退了，或者换更小的模型（比如 `qwen3:4b`）。

**为什么不能关那个 cmd 黑框**：Ollama 的 `serve.cmd` 挂在 cmd 下，关窗口会连带杀掉服务。所以现在改成 `wscript` 隐藏启动（`start-hidden.vbs`），没有可见窗口，也不会误关。


## 九、开发和测试

`test/` 里是**真实浏览器**验证脚本（CDP 驱动 Edge，不是 mock）。改完代码建议跑一遍。

### 准备

1. 起静态服务器（8899）：

```bash
node test/serve.js
```

2. 起一个独立 profile 的测试 Edge（别用日常那个）：

```bash
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" \
  --user-data-dir="%TEMP%\dsh-pt-test-profile" \
  --load-extension="<仓库绝对路径>" \
  --disable-extensions-except="<仓库绝对路径>" \
  --remote-debugging-port=9444 \
  --enable-unsafe-extension-debugging \
  http://127.0.0.1:8899/
```

> 端口别用 9333——某些浏览器自动化插件会占它，CDP 会连错实例。脚本统一用 9444。

### 脚本

| 脚本 | 验证什么 | 预期 |
| --- | --- | --- |
| `cdp-translate.mjs` | 整页翻译 + 零遮挡 | 25 段全翻，`position` 全 static、视口内被遮挡 0、译文互相重叠 0 |
| `cdp-menu-test.mjs` | 下拉菜单浮层 | 打开菜单后 1 秒内 7 项全翻 |
| `cdp-unload-test.mjs` | 翻译完自动卸载 | 完成后 `ollama ps` 变空 |
| `cdp-rightclick-test.mjs` | 右键停模型 | 1 秒内卸载，提示「显存已释放」 |
| `cdp-restore.mjs` | 还原 / 停止 / 重翻 | 点一次清空译文，再点重新翻译 |

跑法：

```bash
node test/cdp-translate.mjs
```

### 模型准备

怎么把 Qwen2.5-7B 弄进 Ollama、split GGUF 为什么不能自己合并，见 [docs/model-setup.md](docs/model-setup.md)。
