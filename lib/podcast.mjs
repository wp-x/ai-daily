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
    const env = {
      ...process.env,
      NOTEBOOKLM_HOME: DATA_DIR,
    };
    // Point storage to our cookie file
    const fullArgs = ['--storage', COOKIE_FILE, ...args];
    const proc = execFile('notebooklm', fullArgs, { timeout: timeoutMs, env, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
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
    const notebookName = `播客-${new Date().toISOString().slice(0, 10)}-${task.taskId.slice(0, 4)}`;
    const createRes = await runNLM(['create', notebookName]);
    if (!createRes.ok) throw new Error(`创建 Notebook 失败: ${createRes.error || createRes.stderr}`);

    const notebookId = parseNotebookId(createRes.stdout + createRes.stderr);
    if (!notebookId) throw new Error(`无法解析 Notebook ID，输出: ${createRes.stdout}`);
    task.notebookId = notebookId;

    // Step 3: Add sources
    update('running', 20, `添加文章来源 (${task.articles.length} 篇)...`);
    let added = 0;
    for (const article of task.articles) {
      const addRes = await runNLM(['use', notebookId, '&&', 'source', 'add', article.link], 30000);
      // Continue even if individual article fails
      if (addRes.ok) added++;
      update('running', 20 + Math.floor((added / task.articles.length) * 30), `已添加 ${added}/${task.articles.length} 篇...`);
    }
    if (added === 0) throw new Error('所有文章添加失败，请检查链接是否有效');

    // Step 4: Generate audio
    update('running', 55, '开始生成播客音频（可能需要 5-15 分钟）...');
    const langLabel = LANG_MAP[task.lang] || 'Chinese';
    const styleArg = STYLE_MAP[task.style] || 'deep-dive';
    const customInstructions = task.lang === 'zh'
      ? `请用中文（普通话）生成播客。风格：${styleArg}。${task.instructions || ''}`
      : task.instructions || '';

    const genArgs = ['use', notebookId, '&&', 'generate', 'audio'];
    if (customInstructions) genArgs.push(customInstructions);
    genArgs.push('--wait');

    const genRes = await runNLM(genArgs, 20 * 60 * 1000); // 20 min timeout
    if (!genRes.ok) throw new Error(`生成音频失败: ${genRes.error || genRes.stderr}`);

    // Step 5: Download MP3
    update('running', 85, '下载 MP3...');
    const filename = `podcast-${task.taskId}.mp3`;
    const mp3Path = join(PODCAST_DIR, filename);
    const dlRes = await runNLM(['use', notebookId, '&&', 'download', 'audio', mp3Path], 5 * 60 * 1000);
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
