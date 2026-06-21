# GPU加速 & 120fps 滚动优化设计文档

Date: 2026-06-21
Status: approved
Scope: WonderfulUI 全栈性能优化 —— CSS 合成层、虚拟滚动、Rust 后端并行

## 1. 目标

- 比赛列表滚动稳定 ≥ 120fps（高刷新率显示器）
- 启动扫描速度提升 3-5x（多账户场景）
- GPU 合成层从当前 ~1000+ 降至 ~12
- 不引入新框架、不破坏现有架构、不修改 ACLOS 文件

## 2. 现状问题

### 2.1 前端渲染反模式

| 问题 | 位置 | 影响 |
|------|------|------|
| 比赛列表全量 DOM 渲染（500 场 = ~9000 节点） | `app.ts:420-424` | 滚动帧率 30fps |
| `.cover-bg { filter: brightness(0.92) }` 每张图触发独立 GPU 合成层 | `style.css:639` | 500+ 合成层 |
| 进度条用 `transition: width/left` 触发 layout | `style.css:2528-2538` | 每帧 layout thrashing |
| 启动进度条 `will-change: width` 反模式 | `style.css:1787` | 每次宽度变化重建 layer |
| `backdrop-filter: blur(4px)` 创建 backdrop root | `style.css:1962,1980` | 额外的纹理捕获 |
| 事件标记点 50+ 个 DOM 节点各带 `filter: drop-shadow()` | `player-event-markers.ts` | 50+ 合成层 |
| ECharts 用 SVG 渲染器 | `library-stats.ts:303` | 大量 SVG DOM 节点 |
| 图片缺少 `decoding="async"` | 多处 `<img>` | 主线程解码阻塞 |

### 2.2 Rust 后端瓶颈

| 问题 | 位置 | 影响 |
|------|------|------|
| 每个 INSERT/DELETE 是独立隐式事务（每个账户数百次 fsync） | `scraper.rs:543-565` | SQL 写入极慢 |
| 默认 journal_mode=DELETE，写入阻塞读取 | `db.rs` | GUI 读取等待 scraper |
| 账户串行解析（AES + JSON） | `scraper.rs:502` | 多核浪费 |

## 3. 设计方案

### 3.1 Phase 1: CSS GPU 合成层修复（1-2天，零风险）

#### 3.1.1 进度条 width/left → transform

```
当前（触发布局重排）：
  .player-progress-fill { transition: width 180ms; }
  .player-progress-thumb  { transition: left 180ms; }
  .boot-progress-fill     { will-change: width; }

改为（合成器线程执行）：
  .player-progress-fill {
    transform: scaleX(calc(var(--pct) / 100));
    transform-origin: left center;
    transition: transform 180ms;
  }
  .player-progress-thumb {
    transform: translateX(calc(var(--pct) * 1%));
    transition: transform 180ms;
  }
  .boot-progress-fill {
    will-change: transform;
    transform: scaleX(...);
  }
```

#### 3.1.2 封面图 filter → ::after 遮罩

当前 `.cover-bg` 的 `filter: brightness(0.92)` 为每张图创建独立 GPU 合成层。改为加深已有的 `::after` 伪元素：

```css
.cover-bg { filter: none; }
.cover-img-wrap::after {
  background: oklch(0 0 0 / 0.08);  /* 原 0.04，加深到 0.08 等效 brightness(0.92) */
}
```

#### 3.1.3 移除 backdrop-filter blur

```css
.btn-play, .resolution-chip {
  backdrop-filter: none;
  background: oklch(0 0 0 / 0.55);
}
```

#### 3.1.4 图片 decoding="async"

所有懒加载 `<img>` 统一添加 `decoding="async"`，必要时加 `fetchpriority="low"`：

| 选择器 | 属性 |
|--------|------|
| `.cover-bg` | `decoding="async" fetchpriority="low"` |
| `.cover-img` (montage/moment) | `decoding="async"` |
| `.hero-img` | `decoding="async"` |
| `.mode-icon` | `decoding="async"` |

#### 3.1.5 ECharts 切 Canvas 渲染器

`library-stats.ts:303`: `renderer: 'svg'` → `renderer: 'canvas'`

#### 3.1.6 验证标准

Chrome DevTools → Layers 面板确认合成层数量 ≤ 15（12 个可见 matchRow 行 + 少量 UI 元素）。

### 3.2 Phase 2: Rust 后端并行（2-3天）

#### 3.2.1 SQLite 显式事务

在 `scraper.rs` 每个账户处理循环体外包裹事务：

```rust
for account in accounts {
    conn.execute("BEGIN IMMEDIATE", [])?;
    upsert_account(...);
    for match in matches {
        upsert_match(...);
        upsert_videos(...);
        upsert_events(...);
    }
    conn.execute("COMMIT", [])?;
}
```

预期：SQL 写入从 ~500ms/账户 → ~20ms/账户。

#### 3.2.2 WAL 模式

`db.rs:open_library()` 启动时执行：

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;
```

WAL 允许 GUI 读取与 scraper 写入并发。

#### 3.2.3 并行账户解析

引入 `rayon = "1"` 依赖。解析并行，写入串行：

```rust
let parsed_results: Vec<_> = account_files
    .par_iter()
    .map(|(openid, path, _)| parse_wonderful_db(path, openid))
    .collect();

for (idx, parsed) in parsed_results.iter().enumerate() {
    conn.execute("BEGIN IMMEDIATE", [])?;
    // ... upserts ...
    conn.execute("COMMIT", [])?;
}
```

#### 3.2.4 simd-json（可选）

仅在 `load_library_view` 批量反序列化时使用。如果事务 + WAL + rayon 已满足性能目标则跳过。

#### 3.2.5 改动文件

| 文件 | 改动 |
|------|------|
| `src-tauri/Cargo.toml` | +`rayon = "1"` |
| `src-tauri/src/library/db.rs` | WAL pragma +5行 |
| `src-tauri/src/library/scraper.rs` | 事务包裹 + rayon ~40行 |

### 3.3 Phase 3: 虚拟滚动 + Canvas 标记点（2-3天）

#### 3.3.1 虚拟滚动引擎

**数据结构：**

```
ROW_HEIGHT = 100px  (96px min-height + 4px gap)
BUFFER     = 5      (上下额外行，避免快速滚动白屏)

startIdx = floor(scrollTop / ROW_HEIGHT) - BUFFER
endIdx   = ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + BUFFER
totalVirtualHeight = filteredMatches.length * ROW_HEIGHT
```

**DOM 结构：**

```html
<main class="list-slot" style="contain: strict; will-change: scroll-position">
  <div class="vlist-spacer" style="height: {totalVirtualHeight}px"></div>
  <div class="vlist-rows" style="contain: layout style">
    <!-- 仅可视区 matchRow，每个用 position: absolute + transform: translateY() -->
  </div>
</main>
```

**帧预算控制（8.3ms @ 120fps）：**

```typescript
let lastStartIdx = -1;
let rafId = 0;

listSlot.addEventListener('scroll', () => {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    const newStart = Math.floor(listSlot.scrollTop / ROW_HEIGHT);
    if (newStart !== lastStartIdx) {
      lastStartIdx = newStart;
      renderVisibleSlice();  // ~12 行 DOM 重建，耗时 < 2ms
    }
  });
}, { passive: true });
```

**与现有架构集成：**

- `refreshList()` 不再 `replaceChildren` 全部行，改为更新 `filteredMatches` 引用 + 调用 `renderVisibleSlice()`
- `matchRow()` 函数保持原样，虚拟滚动复用
- filter/search 变更时重置 `lastStartIdx = -1`，强制重建
- `scrollIntoView` 改为 `listSlot.scrollTo({ top: idx * ROW_HEIGHT })`

**CSS：**

```css
.list-slot {
  overflow-y: auto;
  contain: strict;
  will-change: scroll-position;
}
.vlist-rows {
  position: relative;
  contain: layout style;
}
.match-row {
  position: absolute;
  left: 0;
  right: 0;
  will-change: transform;  /* 仅 ~12 行，合成层开销可控 */
}
```

#### 3.3.2 Canvas 事件标记点降级

双路径策略：

```typescript
const CANVAS_THRESHOLD = 20;

function renderMarkers(events, container) {
  if (events.length <= CANVAS_THRESHOLD) {
    renderDomMarkers(events, container);   // 保持现有 DOM 路径
  } else {
    renderCanvasMarkers(events, container); // 切换 Canvas
  }
}
```

Canvas 渲染：1 个 `<canvas>` 绘制所有标记点的茎线、圆点、图标，一次性 `drawImage` 提交。交互通过透明 `<div>` 覆盖层 + 坐标 hit-test。

| 指标 | DOM 模式（50标记点） | Canvas 模式 |
|------|---------------------|------------|
| DOM 节点 | 50 div + 100 伪元素 | 1 canvas + 1 overlay |
| GPU 合成层 | 50+ | 1 |
| 绘制调用 | 50+ | 1 |

#### 3.3.3 改动文件

| 文件 | 改动类型 | 预计行数 |
|------|---------|---------|
| `packages/gui/src/app.ts` | 虚拟滚动 + 图片属性 | ~200行改 |
| `packages/gui/src/style.css` | 虚拟滚动 CSS + CSS 修复 | ~60行改 |
| `packages/gui/src/player-event-markers.ts` | Canvas 降级路径 | ~100行加 |

## 4. 关键指标目标

| 指标 | 当前 | 目标 |
|------|------|------|
| 500 场比赛列表滚动帧率 | ~30fps | ≥ 120fps |
| DOM 节点数（比赛列表） | ~9000 | ≤ 300 |
| GPU 合成层数 | ~1000+ | ≤ 15 |
| 5 账户全量扫描耗时 | ~2500ms | ≤ 500ms |
| 启动后台刷新阻塞 GUI | 是 | 否（WAL 并发读） |

## 5. 风险与回退

| 风险 | 应对 |
|------|------|
| 虚拟滚动行高不一致（长文本） | ResizeObserver 测量首批可见行，若不均回退固定高度 |
| rayon 与 Tauri std::thread 冲突 | rayon 全局线程池与 Tauri 不冲突；若不通过改用 `std::thread::scope` |
| Canvas 字体与 MiSans 不一致 | Canvas `font` 显式指定 `"380 12px MiSans"` |
| 低端集显达不到 120fps | 虚拟滚动 + CSS 修复保障最低 60fps；`content-visibility: auto` 后备 |
| 虚拟滚动破坏现有 replaceChildren 模式 | 仅 listSlot 特殊处理，其他 slot（account、filter、detail）保持不变 |

## 6. 测试策略

- Phase 1: Chrome DevTools Performance + Layers 面板验证
- Phase 2: `cargo test --release --manifest-path src-tauri/Cargo.toml --lib` + `bun test packages/parser`
- Phase 3: DevTools FPS meter，500 场 mock 数据滚动验证
- 回归测试: 现有 `bun test` + `cargo test` 全部通过
- 手动验证: 筛选、搜索、详情切换、播放器、事件列表均正常
