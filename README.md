# 本地零和矩阵博弈混合策略求解器

TypeScript + Node.js 实现，只提供本地 JSON API、命令行、SQLite 持久化和自动化测试；不包含网页、联网对战或第三方博弈求解器。

## 依赖

- Windows PowerShell
- Node.js 22.5+（当前开发环境为 Node 25）
- npm
- SQLite 使用 Node 内置实验模块 `node:sqlite`，数据库文件默认位于 `data/game.sqlite`

安装：

```powershell
npm install
```

## 求解规则

- 支持 1×1 到 6×6 的两人有限零和矩阵。
- 行玩家最大化收益，列玩家最小化收益。
- 使用确定性的活动约束顶点枚举求解双方线性规划，不只检查纯策略鞍点。
- 对退化情形枚举可行多面体顶点；多重均衡不冒充唯一解，证书记录枚举到的最优顶点数，并选择字典序最小的策略作为规范结果。
- 每次求解分别计算行玩家保证下界、列玩家保证上界、对偶间隙和全部动作最佳回应；支持集外动作也参与核查。
- 仅当 `upperBound - lowerBound <= tolerance` 才标记 `equilibrium`；预算耗尽时保留已得到的上下界并标记 `unproven`。
- 可选严格纯策略劣策略删除；删除证据、保留动作映射和原编号支持集会写入结果。
- 收益修改创建新版本；旧求解和证书仍绑定旧矩阵哈希，可按原矩阵复核。

## 启动和停止

启动（自动选择端口，仅监听 `127.0.0.1`）：

```powershell
npm start
```

启动后终端显示形如 `http://127.0.0.1:<port>` 的地址。在该 PowerShell 窗口按 `Ctrl+C` 停止，只会停止本项目的 Node 进程。

固定端口可设置本项目终端环境变量：

```powershell
$env:PORT="8080"; npm start
```

## API

常用端点：

- `GET /health`
- `POST /games`
- `GET /games?limit=50&offset=0`
- `GET /games/:id`
- `POST /games/:id/versions`
- `POST /matrix-versions/:id/solve`
- `GET /solves?limit=50&offset=0`
- `GET /solves/:id`
- `POST /validate`
- `POST /certificates/verify`

创建矩阵示例：

```powershell
$body = @'
{
  "name": "matching-pennies",
  "payoffUnit": "utility",
  "rowActions": ["heads", "tails"],
  "columnActions": ["heads", "tails"],
  "matrix": [[1, -1], [-1, 1]]
}
'@
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8080/games -ContentType application/json -Body $body
```

求解体可包含 `tolerance`、`budget`、`reduceStrictDom` 和 `requestId`。相同 `requestId` 重复提交返回同一结果。输入错误返回 4xx 与明确 `error.code`；分页参数为 `limit` 和 `offset`。

## CLI

```powershell
# 创建矩阵
npm run cli -- create examples/matching-pennies.json

# 求解：版本 ID 从创建/查询输出中复制
npm run cli -- solve <versionId> 1e-9 2000 false repeat-request-id

# 查看支持集、最佳回应和劣策略映射
npm run cli -- support <solveId>

# 验证外部给定策略
npm run cli -- validate examples/external-strategy.json

# 修改收益并比较新版本
npm run cli -- compare <gameId> examples/revised-matrix.json "revision note"

# 导出证书
npm run cli -- certificate <solveId>
```

CLI 在创建、修订、求解和验证命令中均以 `before`/`after` 输出关键状态。

## 演示与测试

可重复端到端演示：

```powershell
npm run demo
```

自动化测试：

```powershell
npm test
```

测试覆盖硬币匹配、石头剪刀布、纯鞍点、重复动作、严格劣策略、长方形矩阵、近退化收益、负收益、平移/正比例缩放、行列重排、外部策略、证书篡改、参数失败、事务回滚、幂等和重启持久化。

## 清理

所有运行数据都在项目目录的 `data/`，临时/测试数据库也在该目录。停止服务后可删除：

```powershell
Remove-Item -Recurse -Force .\data
```

构建输出在 `dist/`，需要时删除：

```powershell
Remove-Item -Recurse -Force .\dist
```
