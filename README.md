# Codeforces Tool

一个 Edge / Chrome（Manifest V3）浏览器扩展：在 Codeforces 题目页点击「翻译」按钮翻译题面，在博客页点击「翻译全文」翻译整篇博客，用 DeepSeek API 翻译成简体中文，数学公式用 KaTeX 渲染。

## 安装

1. 打开 `edge://extensions`（Chrome 为 `chrome://extensions`）。
2. 打开右上角「开发人员模式」。
3. 点击「加载解压缩的扩展」，选择本目录 `codeforces-tool`。
4. 点击浏览器工具栏中的插件图标，打开设置页，填入 DeepSeek API Key（在 [platform.deepseek.com](https://platform.deepseek.com) 获取），保存。

## 使用

- 打开任意 Codeforces 题目页（`/problemset/problem/...`、`/contest/.../problem/...`、`/gym/...` 等）。
- 题面被拆成四部分，各自带一个「翻译」按钮，译文插入在对应部分正下方，互不影响：
  - **题面**（正文，按钮在标题右上角）
  - **Input 说明**（输入格式）
  - **Output 说明**（输出格式）
  - **样例解释 / Note**
- 再次点击按钮可收起/展开对应译文。
- 打开任意 Codeforces 博客页（`/blog/entry/...`），正文顶部会出现「翻译全文」按钮，点击后整篇博客的译文插入在正文下方。

## 说明

- **API Key 存储**：保存在浏览器扩展的本地存储（`chrome.storage.local`），仅发送给 DeepSeek 官方接口。
- **公式保留**：扩展会在 MathJax 渲染前抓取题面原始 HTML，把 `$$$...$$$`（行内）/ `$$$$...$$$$`（块级）公式替换为占位符再送翻译；译文用 `marked` 编译 Markdown、用 `KaTeX` 把占位符渲染成公式，因此不依赖页面自带的 MathJax。
- **目标语言 / 模型 / 接口地址**：均可在设置页调整。

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `manifest.json` | 扩展清单（MV3） |
| `background.js` | 后台 Service Worker，调用 DeepSeek 接口 |
| `content.js` | 内容脚本，抓取题面与博客、注入翻译按钮、渲染译文 |
| `content.css` | 按钮与译文框样式 |
| `options.html` / `options.js` | 设置页（API Key、模型、语言等） |
| `lib/marked.min.js` | Markdown 编译器（Markdown → HTML） |
| `lib/katex.min.js` / `katex.min.css` | KaTeX 公式渲染器 |
| `lib/fonts/*.woff2` | KaTeX 字体 |
| `prompt-problem.txt` / `prompt-blog.txt` | 发给 DeepSeek 的系统提示词（题面 / 博客，可直接编辑） |

## 常见问题

- **提示「尚未配置 API Key」**：点击工具栏插件图标打开设置，填入 Key 后保存。
- **返回 401**：API Key 错误或已失效，请检查。
- **返回 402**：账户余额不足。
- **公式未渲染**：偶尔需刷新页面重试；扩展依赖 Codeforces 页面自带的 MathJax。
