# Vue 组件测试设计

## 背景

WonderfulUI 从原生 TypeScript/DOM 迁移到 Vue 3 后，**19 个 Vue 组件的测试覆盖率为 0%**。现有 118 个测试用例全部针对 `utils/` 下的纯逻辑函数。需要补齐关键组件的烟雾测试。

## 约束

- 不改动现有 118 个用例
- 不引入新的测试运行器，继续用 `bun:test`
- 不单独测试 Pinia store，在组件测试中 mock
- 不测试复杂浏览器 API 组件（PlayerHost、DateRangePicker、ProgressBar），延后处理

## 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| DOM 环境 | `happy-dom` | 轻量，Bun 原生兼容，比 jsdom 快 |
| 组件挂载 | `@vue/test-utils` | Vue 3 官方测试工具 |
| Pinia | `@pinia/testing` 的 `createTestingPinia()` | 注入 mock 状态，不测真实 store 逻辑 |
| Tauri 适配 | `mock.module()` 模块级 mock | 组件通过 `tauri-adapter.ts` 调用 invoke/listen/convertFileSrc |

## 覆盖优先级

### Tier 1 — 核心视图（必须覆盖）

| 组件 | 测试要点 | 预估用例数 |
|---|---|---|
| `HomeView.vue` | 虚拟滚动渲染、过滤联动、空状态、双击播放 | 4-5 |
| `DetailView.vue` | 比赛详情渲染、视频分组、事件按钮状态 | 3-4 |

### Tier 2 — 关键交互组件

| 组件 | 测试要点 | 预估用例数 |
|---|---|---|
| `FilterBar.vue` | 分类 chip 渲染、数值范围交互 | 3-4 |
| `MatchCard.vue` | 卡片内容、MVP 徽章、英雄/地图标签 | 3-4 |
| `EventListModal.vue` | 事件列表渲染、行点击 emit、Escape 关闭 | 2-3 |

### Tier 3 — 延后处理

- `PlayerHost.vue` — 需 mock HTMLVideoElement/Fullscreen/Canvas/localStorage
- `DateRangePicker.vue` — 命令式 DOM 渲染
- `ProgressBar.vue` — 强依赖 Canvas API
- 其余纯包装器组件（WIcon、TopBar、BootOverlay、AccountSidebar、ToastHost、PlayerControls、SettingsView、SettingsModal）

## 文件结构

```
packages/gui/
├── test/
│   ├── setup.ts              # happy-dom 全局注册（新建）
│   ├── mocks/
│   │   └── tauri-adapter.ts   # invoke/listen/convertFileSrc mock（新建）
│   ├── filters.test.ts        # 已有，不变
│   ├── ...（其余 9 个已有文件不变）
│   ├── HomeView.test.ts       # 新建
│   ├── DetailView.test.ts     # 新建
│   ├── FilterBar.test.ts      # 新建
│   ├── MatchCard.test.ts      # 新建
│   └── EventListModal.test.ts # 新建
└── package.json               # 新增 devDeps
```

## 依赖新增

```json
// packages/gui/package.json devDependencies
{
  "@pinia/testing": "^0.1.0",
  "@vue/test-utils": "^2.4.0",
  "happy-dom": "^15.0.0"
}
```

## Mock 策略

### tauri-adapter 模块级 mock

通过 `bun:test` 的 `mock.module()` 在 `setup.ts` 中全局替换：

```ts
mock.module('../../src/tauri-adapter.ts', () => ({
  invoke: async (cmd: string) => {
    // 按命令返回最小 fixture
    const fixtures: Record<string, unknown> = {
      scan_shell: { ... },
      load_library: { matches: [], accounts: [] },
    };
    return fixtures[cmd] ?? null;
  },
  convertFileSrc: (p: string) => p,
  listen: async () => () => {},
}));
```

### Pinia store 初始状态

通过 `createTestingPinia({ initialState: { ... } })` 注入：

- `account` store: 注入 mock 账号列表、选中账号、比赛数据
- `filter` store: 注入空过滤状态
- `detail` store: 注入选中比赛、已加载 rounds
- `player` store: 注入关闭状态

## 测试模式

```ts
// 公用工厂函数放在测试文件内，与现有 utils 测试风格一致
function mkMatch(overrides = {}): MatchRecord { ... }
function mkAccount(overrides = {}): AccountState { ... }

// 每个文件独立管理自己的工厂函数，不创建共享 fixture 库
```

## 验证

```bash
bun test packages/gui   # 所有测试（含新增组件测试）
bun test                # 根目录全部测试
```

## 不做的事

- 不安装 vitest
- 不测试 Pinia store action 中的 invoke 调用链
- 不测试 PlayerHost 播放器状态机（延后）
- 不测试 Canvas 渲染正确性
- 不创建共享 fixture/mock 库（保持每个测试文件自包含）
