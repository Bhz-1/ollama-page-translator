# 模型怎么准备（Ollama 本地翻译）

扩展只做两件事：调 `http://127.0.0.1:11434`、把译文插进页面。模型本身由 Ollama 管，这里记一下本机是怎么把 Qwen2.5-7B 弄进去的，以及踩过的坑。

## 方案 A：官方拉取（最省事，但可能很慢）

```bash
ollama pull qwen2.5:7b
```

国内实测约 **1 MB/s**，4.7GB 要一小时。能用，就是慢。

## 方案 B：ModelScope 下 GGUF 再导入（快 6 倍）

ModelScope 实测 **6 MB/s**。Qwen2.5-7B-Instruct 的 GGUF 是分片的：

```
qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf   3993201344 B
qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf    689872288 B
```

下载地址格式：

```
https://modelscope.cn/api/v1/models/Qwen/Qwen2.5-7B-Instruct-GGUF/repo?Revision=master&FilePath=<文件名>
```

脚本：`test/download-gguf.mjs`（带断点续传）。

## 关键坑：split GGUF 不能自己合并

**错误做法**：把两个分片 `cat` 成一个文件再 `FROM` 它。

报错：

```
Error: invalid split GGUF: split GGUF "xxx.gguf" must use llama.cpp split filename pattern
```

原因：GGUF 内部有 split 标记，加载器只读第一个分片的 tensor 表，你合并出来的文件后半截是废的。

**错误做法 2**：只 `FROM` 第一个分片。

报错：

```
Error: invalid split GGUF: split GGUF "xxx-00001-of-00002.gguf" has 1 shards, expected 2
```

**正确做法**：Modelfile 里两个分片都写 `FROM`：

```dockerfile
FROM /path/qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf
FROM /path/qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf
PARAMETER num_ctx 8192
PARAMETER temperature 0.2
```

```bash
ollama create dsh-qwen25:7b -f Modelfile.qwen25-7b
```

## 还有几个坑

- **`ollama pull` 下到一半别 kill 客户端**：Ollama 0.40.9 会直接把服务进程带走，11434 变 ECONNREFUSED。
- **扩展调 Ollama 必须放行来源**：`OLLAMA_ORIGINS=chrome-extension://*`，否则一律 403 空 body（CORS 预检也过不了）。
- **服务别用 cmd 窗口启动**：关窗口会连带杀服务，用 `wscript` 隐藏启动。
