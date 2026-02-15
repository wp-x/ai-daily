# GitHub Actions Docker 构建配置指南

## 功能特性

✅ **自动触发**
- 推送到 `main` 分支时自动构建
- 创建 `v*.*.*` 格式的 tag 时构建发布版本
- PR 时构建测试（不推送）
- 支持手动触发

✅ **多平台支持**
- `linux/amd64` (x86_64)
- `linux/arm64` (ARM64/Apple Silicon)

✅ **多镜像仓库**
- Docker Hub: `docker.io/your-username/ai-daily-web`
- GitHub Container Registry: `ghcr.io/your-username/ai-daily-web`

✅ **智能标签**
- `latest` - 最新 main 分支构建
- `v1.2.3` - 完整语义化版本
- `v1.2` - 主次版本
- `v1` - 主版本
- `main-sha123456` - 分支+commit SHA

✅ **构建优化**
- GitHub Actions 缓存加速
- 多阶段构建
- 层缓存复用

## 配置步骤

### 1. 配置 Docker Hub（可选）

如果要推送到 Docker Hub：

1. 登录 [Docker Hub](https://hub.docker.com/)
2. 进入 **Account Settings** → **Security** → **New Access Token**
3. 创建 token，权限选择 `Read, Write, Delete`
4. 复制生成的 token

在 GitHub 仓库中添加 Secrets：
- 进入仓库 **Settings** → **Secrets and variables** → **Actions**
- 添加以下 secrets：
  - `DOCKERHUB_USERNAME`: 你的 Docker Hub 用户名
  - `DOCKERHUB_TOKEN`: 刚才创建的 access token

### 2. 配置 GitHub Container Registry（自动）

GHCR 使用 `GITHUB_TOKEN` 自动认证，无需额外配置。

### 3. 启用 GitHub Actions

1. 进入仓库 **Settings** → **Actions** → **General**
2. 确保 **Actions permissions** 设置为 `Allow all actions`
3. 确保 **Workflow permissions** 设置为 `Read and write permissions`

### 4. 触发构建

**方式 1：推送代码到 main 分支**
```bash
git add .
git commit -m "feat: add new feature"
git push origin main
```

**方式 2：创建版本 tag**
```bash
git tag v1.0.0
git push origin v1.0.0
```

**方式 3：手动触发**
- 进入仓库 **Actions** 标签页
- 选择 **Build and Push Docker Image** 工作流
- 点击 **Run workflow**

## 使用构建的镜像

### 从 Docker Hub 拉取
```bash
docker pull your-username/ai-daily-web:latest
docker pull your-username/ai-daily-web:v1.0.0
```

### 从 GitHub Container Registry 拉取
```bash
docker pull ghcr.io/your-username/ai-daily-web:latest
docker pull ghcr.io/your-username/ai-daily-web:v1.0.0
```

### 运行容器
```bash
docker run -d \
  --name ai-daily-web \
  --restart unless-stopped \
  -p 3456:3456 \
  -e SITE_PASSWORD=your-password \
  -e CONFIG_SECRET=your-secret \
  -v ai-daily-data:/app/data \
  your-username/ai-daily-web:latest
```

## 版本发布流程

1. **开发完成后，更新版本号**
   ```bash
   # 编辑 package.json，更新 version 字段
   vim package.json
   ```

2. **提交并打 tag**
   ```bash
   git add package.json
   git commit -m "chore: bump version to 1.0.0"
   git tag v1.0.0
   git push origin main
   git push origin v1.0.0
   ```

3. **GitHub Actions 自动构建并推送**
   - 构建多平台镜像
   - 推送到 Docker Hub 和 GHCR
   - 生成以下标签：
     - `latest`
     - `v1.0.0`
     - `v1.0`
     - `v1`

## 查看构建状态

1. 进入仓库 **Actions** 标签页
2. 查看最新的工作流运行
3. 点击查看详细日志

## 故障排查

### 构建失败：权限不足
- 检查 **Settings** → **Actions** → **Workflow permissions**
- 确保设置为 `Read and write permissions`

### 推送失败：Docker Hub 认证错误
- 检查 `DOCKERHUB_USERNAME` 和 `DOCKERHUB_TOKEN` secrets 是否正确
- 确认 token 权限包含 `Read, Write, Delete`

### 推送失败：GHCR 认证错误
- 检查仓库是否为 public（private 仓库需要额外配置）
- 确认 workflow permissions 正确

### 多平台构建慢
- 首次构建会较慢（需要下载 QEMU）
- 后续构建会使用缓存加速

## 高级配置

### 仅推送到 Docker Hub
删除 `.github/workflows/docker-build.yml` 中的 GHCR 相关部分：
```yaml
# 删除这些行
- name: Log in to GitHub Container Registry
  ...
```

### 添加更多平台
修改 `platforms` 字段：
```yaml
platforms: linux/amd64,linux/arm64,linux/arm/v7
```

### 自定义标签规则
修改 `tags` 字段：
```yaml
tags: |
  type=raw,value=stable
  type=raw,value={{date 'YYYYMMDD'}}
```

## 参考资料

- [Docker Build Push Action](https://github.com/docker/build-push-action)
- [Docker Metadata Action](https://github.com/docker/metadata-action)
- [GitHub Container Registry 文档](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
