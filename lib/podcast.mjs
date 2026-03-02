/**
 * podcast.mjs — NotebookLM 播客生成模块
 * 通过 notebooklm-py CLI 调用 Google NotebookLM 非官方 API
 */

import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const PODCAST_DIR = join(DATA_DIR, 'podcasts');
const COOKIE_FILE = join(DATA_DIR, 'notebooklm-storage.json');

mkdirSync(PODCAST_DIR, { recursive: true });

// In-memory task store
const tasks = new Map();

export function getPodcastTask(taskId) {
  return tasks.get(taskId) || null;
}

export function listPodcastTasks() {
  return [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
}

// Save / load Google cookie (storage_state.json content)
export function saveCookieStorage(jsonContent) {
  // Validate it's valid JSON with cookies array
  const parsed = JSON.parse(jsonContent);
  if (!parsed.cookies || !Array.isArray(parsed.cookies)) {
    throw new Error('无效的 Cookie 格式：需要包含 cookies 数组');
  }
  writeFileSync(COOKIE_FILE, JSON.stringify(parsed, null, 2));
  return true;
}

export function loadCookieStorage() {
  if (!existsSync(COOKIE_FILE)) return null;
  try {
    const raw = readFileSync(COOKIE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return { configured: true, cookieCount: parsed.cookies?.length || 0 };
  } catch {
    return null;
  }
}

export function isCookieConfigured() {
  return existsSync(COOKIE_FILE);
}

// Check if notebooklm-py is installed
async function checkNotebookLM() {
  return new Promise(resolve => {
    execFile('notebooklm', ['--version'], { timeout: 5000 }, (err, stdout) => {
      resolve(!err);
    });
  });
}

// Run notebooklm CLI command, returns { ok, stdout, stderr }
function runNLM(args, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const env = { ...process.env, NOTEBOOKLM_HOME: DATA_DIR };
    const fullArgs = ['--storage', COOKIE_FILE, ...args];
    execFile('notebooklm', fullArgs, { timeout: timeoutMs, env, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && err.killed) {
        resolve({ ok: false, stdout, stderr, error: '命令执行超时' });
      } else if (err) {
        resolve({ ok: false, stdout, stderr, error: err.message });
      } else {
        resolve({ ok: true, stdout, stderr });
      }
    });
  });
}

// Parse notebook ID from `notebooklm create` output
function parseNotebookId(stdout) {
  // Output format: "Created notebook: <id>" or JSON
  const match = stdout.match(/notebook[_\s]id[:\s]+([a-zA-Z0-9_-]+)/i) ||
                stdout.match(/Created[^:]*:\s*([a-zA-Z0-9_-]{10,})/i) ||
                stdout.match(/([a-zA-Z0-9_-]{20,})/);
  return match ? match[1].trim() : null;
}

// Parse task ID from generate audio output
function parseTaskId(stdout) {
  const match = stdout.match(/task[_\s]id[:\s]+([a-zA-Z0-9_-]+)/i) ||
                stdout.match(/Task[^:]*:\s*([a-zA-Z0-9_-]{8,})/i);
  return match ? match[1].trim() : null;
}

const STYLE_MAP = {
  'deep-dive': 'deep-dive',
  'brief': 'brief',
  'critique': 'critique',
  'debate': 'debate',
};

const LANG_MAP = {
  'zh': 'Chinese',
  'en': 'English',
};

// ── 默认播客生成提示词 ────────────────────────────────────────────
export const DEFAULT_PODCAST_PROMPT = `# 《灵感回路》播客生成提示词 v1.0

## 节目身份
这是一档 AI 科技深度精读播客《灵感回路》。
口号：在海量噪音中提取最具价值的科技前沿信号，每天用一杯咖啡的时间完成一次认知硬核升级。
目标听众：AI 从业者、技术爱好者、关注 AI 产业趋势的决策者。

---

## 强制时长约束（最高优先级）
目标时长：30 分钟以上（约 7000-9000 字对话文本）。
实现方式：对每篇来源文章进行深度精读式解析，而非概览式总结。
在所有来源文章完成逐篇深度拆解之前，禁止进入总结环节。
每篇文章精读时长不低于 5 分钟。

---

## 主持人设定

### 主持人 A — 「晓峰」（技术解析者）
- 理工科出身，做过工程师，喜欢把复杂系统拆成积木讲清楚
- 习惯用类比和反例解释技术原理
- 偶尔较真，会追问"等等，这个数据的测试条件是什么"
- 说话节奏略快，热情时会打断对方补充

### 主持人 B — 「思远」（行业观察者）
- 产品和商业视角，常年关注 AI 产业格局
- 擅长把技术事件放入竞争和历史坐标系里解读
- 会适时泼冷水，问"这对普通开发者真的有用吗"
- 语速稳，善于用一句话点出核心矛盾

两人关系：老朋友，可以互相吐槽，分歧时不强行达成共识。

---

## 对话风格要求
- 真实对话感：有插话、追问、补充、有理有据的争论，不是轮流念稿
- 有信息量的过渡：不说"接下来聊聊X"，而说"说到这个，它和上个月 OpenAI 的做法形成了直接对比——"
- 术语处理：技术名词首次出现时用一句话解释，后续正常使用，不重复解释
- 数据要读活：不只念数字，要说"这意味着什么"
- 情绪是真实的：遇到真正有突破性的内容，可以表现出兴奋；遇到过誉炒作，可以表现出怀疑
- 禁止附和：思远说"对对对""没错""很有道理"超过两次视为违规

---

## 内容结构

### 一、开场（约 2 分钟）
- 简短介绍本期主题氛围（今天是信息密集的一期，还是有一两篇特别炸裂的）
- 逐篇用一句话介绍文章核心看点，让听众形成期待
- 如果几篇文章有共同主题或有趣关联，点出来
- 给出"这期值得听完"的钩子

### 二、逐篇深度精读（核心，占总时长 70% 以上）

每篇文章必须完整经历以下四个层次：

**1. 背景与语境（1-2 分钟）**
- 这件事发生在什么技术演进和行业竞争的背景下
- 听众需要哪些前置知识

**2. 核心内容逐层拆解（3-5 分钟）**
- 文章每一个关键信息点都必须被覆盖，禁止用"等等""诸如此类"跳过
- 技术原理三问：解决什么问题？工作机制是什么？比现有方案好在哪里？
- 文章中的所有具体数据、指标、对比结果必须引用并解读其意义

**3. 双人观点碰撞（2-3 分钟）**
- 各自判断：真正的技术突破，还是渐进优化？行业拐点，还是常规迭代？
- 对不同角色分别意味着什么：研究者 / 开发者 / 普通用户 / 投资者
- 潜在风险、局限性、被忽视的问题
- 允许两人得出不同结论，不强行统一

**4. 关联与延伸（1-2 分钟）**
- 和近期其他事件或技术的连接点
- 可能引发的后续连锁反应

### 三、跨文章综合分析（约 4 分钟）
- 把今天所有文章放在一起看，能拼出什么更大的图景
- 反映了 AI 领域什么趋势或转向
- 如果几篇文章之间有矛盾或张力，重点展开

### 四、收尾（约 2 分钟）
- 晓峰：今天技术层面最让他震动的一个细节
- 思远：今天行业层面最值得关注的一个信号
- 留一个开放性问题给听众带走思考
- 简短的下期预告式结尾

---

## 禁止事项
- 禁止"由于时间关系我们简单提一下"或任何缩减内容的表述
- 禁止对来源文章做概括性一笔带过，每篇都必须深入
- 禁止一个主持人沦为纯附和角色
- 禁止跳过来源中的技术细节或具体数据
- 禁止在所有文章完成精读前进入总结
- 禁止生成少于 6000 字的对话文本

---

## 输出格式
直接输出对话脚本，格式如下：

晓峰：……
思远：……
晓峰：（打断）等等，你刚才说的那个数字——
思远：对，就是这里，……`;


/**
 * Generate podcast async:
 * articles = [{ title, link, content? }]
 * style = 'deep-dive' | 'brief' | 'critique' | 'debate'
 * lang = 'zh' | 'en'
 */
export async function generatePodcast({ articles, style = 'deep-dive', lang = 'zh', instructions = '' }) {
  const taskId = randomBytes(8).toString('hex');
  const task = {
    taskId,
    status: 'pending',
    progress: 0,
    message: '初始化中...',
    createdAt: Date.now(),
    articles: articles.map(a => ({ title: a.title, link: a.link })),
    style,
    lang,
    notebookId: null,
    mp3Path: null,
    error: null,
  };
  tasks.set(taskId, task);

  // Run async
  runPodcastPipeline(task).catch(err => {
    task.status = 'failed';
    task.error = err.message;
    task.message = '生成失败';
  });

  return taskId;
}

async function runPodcastPipeline(task) {
  const update = (status, progress, message) => {
    task.status = status;
    task.progress = progress;
    task.message = message;
  };

  try {
    // Step 1: Check CLI
    update('running', 5, '检查 notebooklm-py...');
    const installed = await checkNotebookLM();
    if (!installed) throw new Error('notebooklm-py 未安装，请先在服务器上安装：pip install notebooklm-py');
    if (!isCookieConfigured()) throw new Error('未配置 Google Cookie，请在设置中填写');

    // Step 2: Create notebook
    update('running', 10, '创建 Notebook...');
    const notebookName = `灵感回路-${new Date().toISOString().slice(0, 10)}-${task.taskId.slice(0, 4)}`;
    const createRes = await runNLM(['create', notebookName]);
    if (!createRes.ok) throw new Error(`创建 Notebook 失败: ${createRes.error || createRes.stderr}`);

    // Parse notebook ID: "Created notebook: <id> - <name>"
    const notebookId = (createRes.stdout + createRes.stderr).match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/)?.[1];
    if (!notebookId) throw new Error(`无法解析 Notebook ID，输出: ${createRes.stdout}`);
    task.notebookId = notebookId;

    // Step 3: Add sources — 正确命令格式: source add --notebook <ID> <URL>
    update('running', 20, `添加文章来源 (${task.articles.length} 篇)...`);
    let added = 0;
    for (const article of task.articles) {
      const addRes = await runNLM(
        ['source', 'add', '--notebook', notebookId, article.link],
        60000
      );
      if (addRes.ok) {
        added++;
        console.log(`[podcast] 添加成功: ${article.title}`);
      } else {
        console.warn(`[podcast] 添加失败: ${article.link} — ${addRes.error || addRes.stderr}`);
      }
      update('running', 20 + Math.floor((added / task.articles.length) * 30),
        `已添加 ${added}/${task.articles.length} 篇...`);
      // 间隔1秒，避免速率限制
      await new Promise(r => setTimeout(r, 1000));
    }
    if (added === 0) throw new Error('所有文章添加失败，请检查链接是否有效');

    // Step 4: Generate audio — 正确命令: generate audio --notebook <ID> --format <style> --language zh --length long --wait "<prompt>"
    update('running', 55, '开始生成播客音频（可能需要 10-20 分钟）...');
    const styleArg = STYLE_MAP[task.style] || 'deep-dive';
    const userExtra = task.instructions ? `\n\n## 本期额外要求\n${task.instructions}` : '';
    const customInstructions = DEFAULT_PODCAST_PROMPT + userExtra;

    const genRes = await runNLM([
      'generate', 'audio',
      '--notebook', notebookId,
      '--format', styleArg,
      '--language', 'zh',
      '--length', 'long',
      '--wait',
      customInstructions,
    ], 25 * 60 * 1000); // 25min timeout

    if (!genRes.ok) throw new Error(`生成音频失败: ${genRes.error || genRes.stderr}`);

    // Step 5: Download MP3 — 正确命令: download audio --notebook <ID> --latest <path>
    update('running', 85, '下载 MP3...');
    const filename = `podcast-${task.taskId}.mp3`;
    const mp3Path = join(PODCAST_DIR, filename);

    const dlRes = await runNLM([
      'download', 'audio',
      '--notebook', notebookId,
      '--latest',
      '--force',
      mp3Path,
    ], 5 * 60 * 1000);

    if (!dlRes.ok) throw new Error(`下载 MP3 失败: ${dlRes.error || dlRes.stderr}`);
    if (!existsSync(mp3Path)) throw new Error('MP3 文件未找到，下载可能未完成');

    task.mp3Path = mp3Path;
    task.mp3Filename = filename;
    update('completed', 100, '播客生成完成！');

  } catch (err) {
    task.status = 'failed';
    task.error = err.message;
    task.message = `失败: ${err.message}`;
    throw err;
  }
}
