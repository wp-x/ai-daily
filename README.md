# AI 每日精选

从 90 个顶级技术博客抓取文章，用 AI 评分筛选，生成一份每天值得读的精选日报。

支持 Gemini、OpenAI、豆包等多个 AI 渠道，内置密码保护和加密存储，可以直接部署到自己的服务器上用。

## 功能

- 90 个 RSS 源自动抓取，也可以自己增删管理
- AI 三维评分（相关性、质量、时效性），自动分类打标签
- 中文标题翻译 + 摘要生成 + 今日看点总结
- Top 3 必读推荐，全部精选列表
- 分类筛选、全文搜索
- 亮色/暗色主题切换
- 移动端适配
- 密码保护，API Key 加密存储（AES-256-GCM）
- 定时自动生成
- 公开分享链接（无需登录即可查看）

## 快速开始

### Docker 部署（推荐）

```bash
docker run -d \
  --name ai-daily-web \
  --restart unless-stopped \
  -p 3456:3456 \
  -e SITE_PASSWORD=你的访问密码 \
  -e CONFIG_SECRET=你的加密密钥 \
  -v ai-daily-data:/app/data \
  ai-daily-web:latest
```

或者用 docker-compose：

```bash
git clone https://github.com/vigorX777/ai-daily-web.git
cd ai-daily-web
cp .env.example .env
# 编辑 .env，填入密码和加密密钥
docker compose up -d
```

### 手动部署

```bash
git clone https://github.com/vigorX777/ai-daily-web.git
cd ai-daily-web
npm install
cp .env.example .env
# 编辑 .env
npm start
```

访问 `http://localhost:3456`，输入你设置的密码即可进入。

## 配置

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `SITE_PASSWORD` | 访问密码 | 无（不设则无需登录） |
| `CONFIG_SECRET` | API Key 加密密钥 | 内置默认值（建议自定义） |
| `PORT` | 服务端口 | 3456 |

> `CONFIG_SECRET` 用于加密存储 API Key。如果不设置会使用默认值，安全性较低。建议设置一个随机字符串。

### AI 渠道

进入页面后，点击右上角设置，选择 AI 渠道并填入 API Key：

| 渠道 | 默认模型 | 获取 Key |
|------|----------|----------|
| Google Gemini | gemini-2.0-flash | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| OpenAI | gpt-4o-mini | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| 豆包 Doubao | doubao-seed-1-6-251015 | [console.volcengine.com/ark](https://console.volcengine.com/ark) |
| 自定义 | 自行填写 | 任何 OpenAI 兼容 API |

每个渠道都有「测试连接」按钮，可以验证 Key 是否可用。

### RSS 源管理

设置页面的「RSS 源」标签页可以：
- 查看当前所有订阅源
- 添加自定义 RSS 源（支持测试连通性）
- 删除不需要的源
- 一键恢复默认 90 个精选源

默认源来自 [Hacker News Popularity Contest 2025](https://refactoringenglish.com/tools/hn-popularity/)，由 Andrej Karpathy 推荐。

## 使用

### 生成日报

1. 在设置中配置好 AI 渠道和 Key
2. 点击右上角「生成」按钮
3. 选择时间范围和精选数量
4. 等待 3-5 分钟，页面实时显示进度

### 定时生成

设置页面开启「每日自动生成」，选择时间即可。会使用当前保存的 AI 渠道配置。

### 分享

点击分享按钮生成公开链接，对方无需密码即可查看该期日报。

## 项目结构

```
ai-daily-web/
├── server.mjs              # Express 服务器 + API 路由
├── lib/
│   ├── ai-client.mjs       # 统一 AI 客户端（Gemini/OpenAI/豆包）
│   ├── auth.mjs            # 认证系统（密码、Session、防暴力破解）
│   ├── config.mjs          # 加密配置存储（AES-256-GCM）
│   ├── db.mjs              # JSON 文件数据库
│   ├── feeds.mjs           # RSS 并发抓取
│   ├── scoring.mjs         # AI 评分（批量处理）
│   ├── summarize.mjs       # AI 摘要生成
│   ├── highlights.mjs      # 今日看点生成
│   └── rss-list.mjs        # 默认 90 个 RSS 源
├── public/
│   ├── index.html           # 前端页面
│   ├── app.js               # 前端逻辑
│   └── style.css            # 样式
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## 技术细节

- 后端：Node.js + Express，纯 ESM 模块
- 前端：HTML + TailwindCSS CDN + Vanilla JS，无构建步骤
- 存储：JSON 文件，零外部依赖
- 认证：SHA-256 加盐哈希，5 次错误锁定 15 分钟，Session 有效期 90 天
- 加密：AES-256-GCM 加密 API Key，scrypt 派生密钥
- Session 存储在内存中，容器重启后需要重新登录

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/digest/latest` | 最新日报 |
| GET | `/api/digest/:date` | 指定日期日报 |
| GET | `/api/digests` | 日报列表 |
| GET | `/api/stats` | 统计数据 |
| GET | `/api/status` | 生成进度 |
| POST | `/api/digest/generate` | 触发生成 |
| POST | `/api/digest/share` | 创建分享链接 |
| GET | `/api/share/:token` | 公开访问（无需认证） |
| GET | `/api/rss-sources` | 获取 RSS 源列表 |
| POST | `/api/rss-sources` | 保存自定义 RSS 源 |
| POST | `/api/rss-sources/test` | 测试 RSS 源连通性 |
| POST | `/api/test-connection` | 测试 AI API 连通性 |

## 致谢

- 原始项目：[ai-daily-digest](https://github.com/vigorX777/ai-daily-digest)
- RSS 源列表：[HN Popularity Contest](https://refactoringenglish.com/tools/hn-popularity/)
- AI 模型：[Google Gemini](https://ai.google.dev/) / [OpenAI](https://openai.com/) / [豆包](https://www.volcengine.com/product/doubao)

## 许可证

[MIT](LICENSE)
