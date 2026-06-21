# GPU加速 & 120fps 滚动优化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WonderfulUI 比赛列表滚动达到 120fps+，GPU 合成层从 ~1000+ 降至 ~15，启动扫描速度提升 3-5x。

**Architecture:** 三阶段增量优化。Phase 1 纯 CSS/DOM 修复消除合成层反模式；Phase 2 Rust 后端引入 rayon 并行 + SQLite WAL/事务优化；Phase 3 DOM 虚拟滚动替换全量渲染 + Canvas 降级事件标记点。

**Tech Stack:** Tauri 2 + Vite + TypeScript + Rust (rayon, rusqlite) + WebView2

## Global Constraints

- Tauri 2, Bun 1.3.14+, Rust 1.77+
- 不引入新前端框架，保持原生 TypeScript/DOM
- 不修改 ACLOS WonderfulDb 文件
- 不破坏现有 `replaceChildren` slot 刷新模式（除 listSlot 外）
- CSS 使用 oklch 色彩、MiSans 字体、DESIGN.md 的设计标记
- 增量改动优先，保持向后兼容

---

## Phase 1: CSS GPU 合成层修复

### Task 1: 图片添加 decoding="async" 属性

**Files:**
- Modify: `packages/gui/src/app.ts:282`
- Modify: `packages/gui/src/app.ts:344`
- Modify: `packages/gui/src/app.ts:501`
- Modify: `packages/gui/src/app.ts:525`（需要查看 montage/moment cover img 位置）

**Produces:** 所有懒加载 `<img>` 统一添加 `decoding="async"` 属性。

- [ ] **Step 1: 修改 matchRow 封面图属性**

在 `packages/gui/src/app.ts:282`，将：
```typescript
const bg = el('img', { class: 'cover-bg', src, alt: '', loading: 'lazy' });
```
改为：
```typescript
const bg = el('img', { class: 'cover-bg', src, alt: '', loading: 'lazy', decoding: 'async', fetchpriority: 'low' });
```

- [ ] **Step 2: 修改 coverImg 属性**

在 `packages/gui/src/app.ts:344`，将：
```typescript
const img = el('img', { class: 'cover-img', src, alt: '', loading: 'lazy' });
```
改为：
```typescript
const img = el('img', { class: 'cover-img', src, alt: '', loading: 'lazy', decoding: 'async' });
```

- [ ] **Step 3: 修改 heroImg 属性**

在 `packages/gui/src/app.ts:497-502`，将：
```typescript
const img = el('img', {
  class: 'hero-img',
  src: convertFileSrc(localPath),
  alt: cnName,
  loading: 'lazy',
});
```
改为：
```typescript
const img = el('img', {
  class: 'hero-img',
  src: convertFileSrc(localPath),
  alt: cnName,
  loading: 'lazy',
  decoding: 'async',
});
```

- [ ] **Step 4: 验证**

```bash
bun run dev:browser
```

打开 `http://localhost:1420/?debug=1`，在 DevTools Elements 面板检查所有 `<img>` 均有 `decoding="async"`。注意：`coverImg()` 函数（line 344）已被 montage 和 moment 卡片复用，无需额外修改。

---

### Task 2: 封面图 filter: brightness → ::after 遮罩

**Files:**
- Modify: `packages/gui/src/style.css:635-658`

**Produces:** 消除 `.cover-bg` 的 `filter: brightness()` 造成的独立 GPU 合成层。

- [ ] **Step 1: 移除 cover-bg 上的 filter**

在 `packages/gui/src/style.css:639`，删除 `filter: brightness(0.92);` 这一行。

- [ ] **Step 2: 加深 ::after 遮罩**

在 `packages/gui/src/style.css:655`，将 `::after` 的 background 加深以补偿移除的 brightness：

```css
/* 当前 (line 655) */
background: radial-gradient(ellipse at bottom right, rgba(0, 0, 0, 0.4) 0%, rgba(0, 0, 0, 0.15) 30%, transparent 60%);

/* 改为 */
background: radial-gradient(ellipse at bottom right, rgba(0, 0, 0, 0.48) 0%, rgba(0, 0, 0, 0.23) 30%, rgba(0, 0, 0, 0.08) 60%, rgba(0, 0, 0, 0.04) 100%);
```

同时给 `.match-cover::after` 添加 `z-index: 1;` 确保遮罩在封面图上方（已有：line 657）。

- [ ] **Step 3: 验证**

DevTools → Layers 面板，确认没有 `.cover-bg` 触发的独立合成层。

---

### Task 3: 移除 backdrop-filter blur

**Files:**
- Modify: `packages/gui/src/style.css:1962`
- Modify: `packages/gui/src/style.css:1980`

**Produces:** 消除 play button 和 resolution chip 上的 `backdrop-filter: blur()` 造成的 backdrop root。

- [ ] **Step 1: 替换 play button 的 backdrop-filter**

在 `packages/gui/src/style.css:1962`，删除：
```css
backdrop-filter: blur(4px);
```
保持 `background: oklch(0 0 0 / 0.55);` 不变。

- [ ] **Step 2: 替换 resolution chip 的 backdrop-filter**

在 `packages/gui/src/style.css:1980`，同样删除 `backdrop-filter: blur(4px);`，保持 `background: oklch(0 0 0 / 0.55);`。

- [ ] **Step 3: 验证**

DevTools → Rendering → Layer borders，确认播放按钮附近不再有橙色边框（backdrop root 标记）。

---

### Task 4: 进度条 width/left → transform

**Files:**
- Modify: `packages/gui/src/style.css:2528`
- Modify: `packages/gui/src/style.css:2538`
- Modify: `packages/gui/src/style.css:1786-1787`
- Modify: `packages/gui/src/player.ts:272-273`（width/left 的 JS 赋值需改为 CSS 变量）

**Produces:** 进度条填充和滑块移动改为纯合成器动画，零 layout 开销。

- [ ] **Step 1: CSS 进度条填充改用 transform scaleX**

在 `packages/gui/src/style.css:2523-2528`，替换整个 `.player-progress-fill` 块：

```css
.player-progress-fill {
  position: absolute; top: 0; left: 0;
  height: 100%;
  width: 100%;
  background: var(--accent);
  border-radius: 2px;
  transform-origin: left center;
  transform: scaleX(0);
  transition: transform 180ms cubic-bezier(0.2, 0, 0, 1);
}
```

- [ ] **Step 2: CSS 进度条滑块改用 transform translateX**

在 `packages/gui/src/style.css:2530-2538`，替换 `.player-progress-thumb` 块：

```css
.player-progress-thumb {
  position: absolute;
  top: 50%;
  left: 0;
  transform: translate(-50%, -50%);
  width: 8px; height: 8px;
  background: var(--accent);
  border-radius: 50%;
  display: none;
  transition: transform 180ms cubic-bezier(0.2, 0, 0, 1);
}
```

注意：`left` 固定为 0，实际位置由 `transform` 中的 `translateX` 控制。

- [ ] **Step 3: CSS 启动进度条改用 transform scaleX**

在 `packages/gui/src/style.css:1782-1788`，替换 `.boot-progress-fill`：

```css
.boot-progress-fill {
  height: 100%;
  width: 100%;
  background: var(--accent);
  border-radius: 999px;
  transform-origin: left center;
  transform: scaleX(0);
  transition: transform 500ms cubic-bezier(0.4, 0, 0.2, 1);
  will-change: transform;
  position: relative;
}
```

- [ ] **Step 4: JS 更新进度条赋值方式**

在 `packages/gui/src/player.ts:272-273`：

```typescript
// 当前
progressFill.style.width = `${pct}%`;
progressThumb.style.left = `${pct}%`;

// 改为
const scaleX = pct / 100;
progressFill.style.transform = `scaleX(${scaleX})`;
progressThumb.style.transform = `translate(calc(${pct}% - 50%), -50%)`;
```

搜索 `player.ts` 中所有 `progressFill.style.width` 和 `progressThumb.style.left` 赋值并替换。通常出现在：
- `wireProgress` 回调（约 line 630-650）
- `wireVideoEvents` 的 timeupdate（约 line 580-600）
- `seekToMarker`（line 272-273）
- `repositionEventMarkers` 的 progress 重置

- [ ] **Step 5: 搜索 scan-progress.ts 中的进度条宽度赋值**

在 `packages/gui/src/scan-progress.ts` 中找到 progress fill 的 width 赋值，改为 `transform: scaleX()`。

- [ ] **Step 6: 验证**

播放视频，拖动进度条，确认填充和滑块动画流畅。DevTools Performance 面板录制 → 确认无 Layout 事件。

---

### Task 5: ECharts 切换 Canvas 渲染器

**Files:**
- Modify: `packages/gui/src/library-stats.ts:304`

**Produces:** 资料库饼图从 SVG DOM 渲染切换到 Canvas GPU 渲染。

- [ ] **Step 1: 修改渲染器**

在 `packages/gui/src/library-stats.ts:303-304`，将：
```typescript
accountVideoChart = echarts.init(host, undefined, {
  renderer: 'svg',
});
```
改为：
```typescript
accountVideoChart = echarts.init(host, undefined, {
  renderer: 'canvas',
});
```

- [ ] **Step 2: 验证**

打开设置 → 资料库概览，确认饼图正常渲染。DevTools Elements → 确认图表面板是 `<canvas>` 而非 `<svg>`。

---

## Phase 2: Rust 后端并行 + SQLite 优化

### Task 6: SQLite WAL 模式 + 显式事务

**Files:**
- Modify: `src-tauri/src/library/db.rs:19`（open_library 中加 WAL pragma）
- Modify: `src-tauri/src/library/scraper.rs:543-565`（主循环包裹事务）

**Produces:** SQL 写入性能 10-50x，GUI 读取不被 scraper 阻塞。

- [ ] **Step 1: 添加 WAL pragma**

在 `src-tauri/src/library/db.rs:19-21`，`open_library()` 函数中，在 `migrate(&conn)` 调用之前添加：

```rust
pub fn open_library() -> std::result::Result<Connection, String> {
    let dir = library_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {}", dir.display(), e))?;
    let path = dir.join("library.db");
    let conn = Connection::open(&path).map_err(|e| format!("open {}: {}", path.display(), e))?;
    // 启用 WAL 模式以支持并发读取
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
        .map_err(|e| format!("pragma {}: {}", path.display(), e))?;
    migrate(&conn).map_err(|e| format!("migrate {}: {}", path.display(), e))?;
    Ok(conn)
}
```

- [ ] **Step 2: 包裹账户事务**

在 `src-tauri/src/library/scraper.rs:543`，在 `match parser::parse_wonderful_db(path, openid)` 之前添加事务开始，在 `}` 闭包之后（约 line 591）添加事务提交。

修改主循环体（约 lines 543-591）：

```rust
// 在 parse 调用之前添加：
conn.execute("BEGIN IMMEDIATE", []).map_err(|e| e.to_string())?;

match parser::parse_wonderful_db(path, openid) {
    Ok(file) => {
        upsert_account(
            conn,
            openid,
            path,
            *source_meta,
            snapshot_meta,
            nick,
            tag,
            &achievements,
            None,
            now,
        )
        .map_err(|e| e.to_string())?;
        for m in &file.matches {
            upsert_match(conn, m, now).map_err(|e| e.to_string())?;
            acc_videos += upsert_videos(conn, m, now).map_err(|e| e.to_string())?;
            acc_events += upsert_events(conn, m).map_err(|e| e.to_string())?;
            acc_matches += 1;
            summary.matches_seen += 1;
        }
        summary.videos_seen += acc_videos;
        summary.events_seen += acc_events;

        // 成功时提交事务
        conn.execute("COMMIT", []).map_err(|e| e.to_string())?;

        let acc_duration = now_ms() - account_start;
        // ... emit 事件保持不变 ...
    }
    Err(e) => {
        // 失败时回滚
        let _ = conn.execute("ROLLBACK", []);

        let message = format!("parse {}: {}", path.display(), e);
        // ... 错误处理保持不变 ...
    }
}
```

**关键点**：成功路径中事务 commit 必须放在 `for m in &file.matches` 循环完成之后、emit 事件之前。错误路径中执行 ROLLBACK。

- [ ] **Step 3: 验证**

```bash
cargo test --release --manifest-path src-tauri/Cargo.toml --lib
```

测试全部通过。

---

### Task 7: Rayon 并行账户解析

**Files:**
- Modify: `src-tauri/Cargo.toml`（添加 rayon 依赖）
- Modify: `src-tauri/src/library/scraper.rs`（主循环改为并行解析 + 串行写入）

**Produces:** 多账户解析并行执行，4 核机器上速度提升 3-4x。

- [ ] **Step 1: 添加 rayon 依赖**

在 `src-tauri/Cargo.toml:33` 之后添加：
```toml
rayon = "1"
```

- [ ] **Step 2: 添加 rayon import**

在 `src-tauri/src/library/scraper.rs:10` 之后（`use uuid::Uuid;` 之后）添加：
```rust
use rayon::prelude::*;
```

- [ ] **Step 3: 重构主循环为解析并行 + 写入串行**

当前代码结构（lines 502-636）是一个 `for` 循环内同时完成解析和写入。需要拆分为两阶段：

**第一阶段：并行解析**（替换 lines 502-536 的循环体前半部分）

```rust
// 并行解析阶段：在 rayon 线程池中同时解析所有账户文件
// 注意：增量模式下需要先检查 freshness，解析前需过滤掉可跳过的账户
type AccountInfo<'a> = (&'a String, &'a std::path::PathBuf, &'a Option<SourceFileMeta>);

let mut to_parse: Vec<(usize, AccountInfo)> = Vec::new();
let mut to_skip: Vec<usize> = Vec::new();

for (idx, (openid, path, source_meta)) in account_files.iter().enumerate() {
    if matches!(mode, ScrapeMode::Incremental) {
        let snapshot_meta = snapshot_file_meta(dir, openid);
        match source_meta
            .map(|meta| account_is_fresh(conn, openid, meta, snapshot_meta))
            .transpose()
        {
            Ok(Some(true)) => {
                to_skip.push(idx);
                continue;
            }
            _ => {}
        }
    }
    to_parse.push((idx, (openid, path, source_meta)));
}

// 跳过不需要解析的账户（保持原有 emit 逻辑）
let total_accounts = account_files.len();
for &idx in &to_skip {
    let (openid, _path, _source_meta) = &account_files[idx];
    summary.skipped_accounts += 1;
    if let Some(a) = app {
        let _ = a.emit("wui://account_finished", AccountFinishedEvent {
            openid: openid.clone(),
            status: "skipped".into(),
            current: idx + 1,
            total: total_accounts,
            size_bytes_done: size_done,
            size_bytes_total: total_size,
            error: None,
        });
    }
}

// 并行解析需要解析的账户
struct ParsedAccount {
    idx: usize,
    openid: String,
    path: std::path::PathBuf,
    source_meta: Option<SourceFileMeta>,
    result: Result<crate::parser::model::WonderfulFile, String>,
    nick: Option<String>,
    tag: Option<String>,
    achievements: Vec<SnapshotAchievement>,
    snapshot_meta: Option<SourceFileMeta>,
}

let parsed: Vec<ParsedAccount> = to_parse
    .par_iter()
    .map(|&(idx, (openid, path, source_meta))| {
        let snapshot_meta = snapshot_file_meta(dir, openid);
        let (nick, tag, achievements) = read_snapshot_for_account(dir, openid);
        let result = parser::parse_wonderful_db(path, openid)
            .map_err(|e| format!("parse {}: {}", path.display(), e));
        ParsedAccount {
            idx,
            openid: (*openid).clone(),
            path: (*path).clone(),
            source_meta: *source_meta,
            result,
            nick,
            tag,
            achievements,
            snapshot_meta,
        }
    })
    .collect();
```

**第二阶段：串行写入**（按原顺序处理解析结果）

```rust
// 按原始索引排序以保持进度顺序
let mut parsed_sorted = parsed;
parsed_sorted.sort_by_key(|a| a.idx);

for pa in parsed_sorted {
    let current = pa.idx + 1;
    // emit account_started
    if let Some(a) = app {
        let _ = a.emit("wui://account_started", AccountStartedEvent {
            openid: pa.openid.clone(),
            current,
            total: total_accounts,
            size_bytes_done: size_done,
            size_bytes_total: total_size,
        });
    }

    let account_start = now_ms();
    let mut acc_matches = 0usize;
    let mut acc_videos = 0usize;
    let mut acc_events = 0usize;

    match pa.result {
        Ok(file) => {
            conn.execute("BEGIN IMMEDIATE", []).map_err(|e| e.to_string())?;
            upsert_account(
                conn, &pa.openid, &pa.path, pa.source_meta, pa.snapshot_meta,
                pa.nick, pa.tag, &pa.achievements, None, now,
            ).map_err(|e| e.to_string())?;
            for m in &file.matches {
                upsert_match(conn, m, now).map_err(|e| e.to_string())?;
                acc_videos += upsert_videos(conn, m, now).map_err(|e| e.to_string())?;
                acc_events += upsert_events(conn, m).map_err(|e| e.to_string())?;
                acc_matches += 1;
                summary.matches_seen += 1;
            }
            summary.videos_seen += acc_videos;
            summary.events_seen += acc_events;
            conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
            // emit ok events ...
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            upsert_account(
                conn, &pa.openid, &pa.path, pa.source_meta, pa.snapshot_meta,
                pa.nick, pa.tag, &pa.achievements, Some(&e), now,
            ).map_err(|e| e.to_string())?;
            summary.errors_seen += 1;
            // emit error events ...
        }
    }
    if let Some(m) = pa.source_meta {
        size_done += m.size_bytes;
    }
}
```

**注意事项**：
1. `ParsedAccount` 必须 impl `Send` —— 确保其所有字段都是 `Send` 的。`PathBuf`、`String`、`Option<T: Send>`、`Vec<T: Send>` 都满足。
2. `crate::parser::model::WonderfulFile` 需要确认是否 `Send` —— 包含 `Account` 和 `Vec<MatchRecord>`，均为 `Send`。
3. rayon 的全局线程池可能与 Tauri 的 `std::thread::spawn` 共存，两者使用不同的线程池，不冲突。
4. `conn` 在 rayon 闭包中不可用 —— 所有 SQLite 操作在串行阶段完成，rayon 仅负责纯解析。

- [ ] **Step 4: 验证**

```bash
cargo test --release --manifest-path src-tauri/Cargo.toml --lib
```

确认所有 test 通过。特别注意 `scraper.rs` 中的测试函数 `scrape_wonderful_dir`。

---

## Phase 3: 虚拟滚动 + Canvas 标记点

### Task 8: 虚拟滚动引擎

**Files:**
- Modify: `packages/gui/src/app.ts:363-427`（listPane 函数）
- Modify: `packages/gui/src/app.ts:1741-1769`（refreshList 函数）
- Modify: `packages/gui/src/style.css`（新增虚拟滚动 CSS）

**Produces:** 比赛列表仅渲染可视区 + 缓冲区行（~12 行 DOM），120fps+ 滚动。

- [ ] **Step 1: 添加虚拟滚动常量**

在 `packages/gui/src/app.ts` 文件顶部，其他常量声明附近添加：

```typescript
/** Virtual scroll constants for match list */
const ROW_HEIGHT = 100;        // 96px min-height + 4px gap
const ROW_BUFFER = 5;          // extra rows above/below viewport
```

- [ ] **Step 2: 添加虚拟滚动状态变量**

在 `packages/gui/src/app.ts` 的 `initApp` 函数内部（约 line 800+），与其他状态变量一起添加：

```typescript
/** Virtual scroll state */
let vscrollLastStart = -1;
let vscrollRafId = 0;
let vscrollFilteredMatches: MatchRecord[] = [];
```

- [ ] **Step 3: 实现 renderVisibleSlice 函数**

在 `packages/gui/src/app.ts` 中 `listPane` 函数附近添加新函数：

```typescript
function renderVisibleSlice(
  vlistRows: HTMLElement,
  vlistSpacer: HTMLElement,
  filteredMatches: MatchRecord[],
  scrollTop: number,
  viewportHeight: number,
  accountLabels: Map<string, string>,
  selectedId: string | null,
  assetPathCache: Map<string, string>,
  matchAchievements: Map<string, { type: 'mvp' | 'svp'; typeStr: string }>,
): void {
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - ROW_BUFFER);
  const endIdx = Math.min(
    filteredMatches.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + ROW_BUFFER,
  );

  // 仅当可见范围变化时才重建 DOM
  if (startIdx === vscrollLastStart) return;
  vscrollLastStart = startIdx;

  vlistRows.replaceChildren();
  for (let i = startIdx; i < endIdx; i++) {
    const m = filteredMatches[i];
    const label = accountLabels.get(m.openID) ?? m.openID;
    const row = matchRow(m, label, m.matches_id === selectedId, assetPathCache, matchAchievements);
    row.style.position = 'absolute';
    row.style.left = '0';
    row.style.right = '0';
    row.style.transform = `translateY(${i * ROW_HEIGHT}px)`;
    row.style.willChange = 'transform';
    vlistRows.appendChild(row);
  }
}
```

- [ ] **Step 4: 修改 listPane 为虚拟滚动 DOM 结构**

在 `packages/gui/src/app.ts` 的 `listPane` 函数中（约 lines 363-427），将当前的全量渲染逻辑改为虚拟滚动容器结构：

**替换** lines 420-424 处的全量渲染：

```typescript
  // --- 虚拟滚动结构 ---
  const vlistSpacer = el('div', { class: 'vlist-spacer' });
  vlistSpacer.style.height = `${filteredMatches.length * ROW_HEIGHT}px`;
  const vlistRows = el('div', { class: 'vlist-rows' });

  // 初始渲染可见范围（scrollTop=0）
  renderVisibleSlice(
    vlistRows,
    vlistSpacer,
    filteredMatches,
    0,
    list.clientHeight || 600,
    accountLabels,
    selectedId,
    assetPathCache,
    matchAchievements,
  );

  list.append(vlistSpacer, vlistRows);

  // 滚动事件监听（passive + rAF 批处理）
  list.addEventListener('scroll', () => {
    if (vscrollRafId) return;
    vscrollRafId = requestAnimationFrame(() => {
      vscrollRafId = 0;
      const newStart = Math.floor(list.scrollTop / ROW_HEIGHT);
      if (newStart !== vscrollLastStart) {
        renderVisibleSlice(
          vlistRows,
          vlistSpacer,
          filteredMatches,
          list.scrollTop,
          list.clientHeight,
          accountLabels,
          selectedId,
          assetPathCache,
          matchAchievements,
        );
      }
    });
  }, { passive: true });
```

**注意**：需要在 `listPane` 函数的参数中已经有 `accountLabels`、`selectedId`、`assetPathCache`、`matchAchievements`，确保它们都被传入 `renderVisibleSlice`。

- [ ] **Step 5: 修改 refreshList 函数**

在 `packages/gui/src/app.ts:1741-1769`，简化 `refreshList` 为仅更新数据源 + 触发重渲染：

```typescript
function refreshList() {
  if (selectedVideo) return;
  const accountMatches = currentAccountMatches();
  const filteredMatches = applyFilters(accountMatches, filters);
  if (selectedMatch && !accountMatches.find(m => m.matches_id === selectedMatch!.matches_id)) {
    selectedMatch = null;
  }
  vscrollFilteredMatches = filteredMatches;

  const listEl = listSlot.querySelector<HTMLElement>('.match-list');
  if (!listEl) return;

  // 重新计算 spacer 高度
  const spacer = listEl.querySelector<HTMLElement>('.vlist-spacer');
  if (spacer) {
    spacer.style.height = `${filteredMatches.length * ROW_HEIGHT}px`;
  }

  // 重置 visible range 强制重建
  vscrollLastStart = -1;
  const rowsEl = listEl.querySelector<HTMLElement>('.vlist-rows');
  if (rowsEl) {
    renderVisibleSlice(
      rowsEl,
      spacer!,
      filteredMatches,
      listEl.scrollTop,
      listEl.clientHeight,
      accountLabels(),
      selectedMatch?.matches_id ?? null,
      assetPathCache,
      matchAchievements,
    );
  }
}
```

这样 `listPane` 只在首次构建时调用一次（构建虚拟滚动容器），后续 filter 变化时 `refreshList` 只更新数据引用 + spacer 高度 + 触发可见区重建。

**实际上**，当前架构中 `refreshList` 每次都调用 `listPane` + `replaceChildren`。虚拟滚动需要改为：首次调 `listPane` 构建容器，后续 `refreshList` 只更新数据。需要通过标志位区分首次/后续。

更好的方案：在 `refreshList` 中检查 `.vlist-rows` 是否存在：

```typescript
function refreshList() {
  if (selectedVideo) return;
  const accountMatches = currentAccountMatches();
  const filteredMatches = applyFilters(accountMatches, filters);
  if (selectedMatch && !accountMatches.find(m => m.matches_id === selectedMatch!.matches_id)) {
    selectedMatch = null;
  }
  vscrollFilteredMatches = filteredMatches;

  const existingRows = listSlot.querySelector<HTMLElement>('.vlist-rows');
  if (existingRows) {
    // 虚拟滚动已初始化，仅更新数据
    const spacer = listSlot.querySelector<HTMLElement>('.vlist-spacer');
    if (spacer) spacer.style.height = `${filteredMatches.length * ROW_HEIGHT}px`;
    vscrollLastStart = -1;
    const listEl = listSlot.querySelector<HTMLElement>('.match-list');
    renderVisibleSlice(
      existingRows,
      spacer!,
      filteredMatches,
      listEl?.scrollTop ?? 0,
      listEl?.clientHeight ?? 600,
      accountLabels(),
      selectedMatch?.matches_id ?? null,
      assetPathCache,
      matchAchievements,
    );
  } else {
    // 首次渲染，走原有 listPane 逻辑（但 listPane 内部已改为虚拟滚动）
    const pane = listPane(
      accountLabels(),
      accountMatches,
      filteredMatches,
      selectedMatch?.matches_id ?? null,
      filters,
      patch => applyFilterPatch(patch, { refreshRail: true }),
      filterBarOpen,
      () => setFilterBarOpen(!filterBarOpen),
      assetPathCache,
      onClearFilter,
      onFocusSection,
      matchAchievements,
    );
    listSlot.className = pane.className;
    listSlot.replaceChildren(...Array.from(pane.childNodes));
  }
}
```

- [ ] **Step 6: 添加虚拟滚动 CSS**

在 `packages/gui/src/style.css` 末尾添加：

```css
/* Virtual scroll */
.vlist-spacer {
  width: 100%;
  pointer-events: none;
}
.vlist-rows {
  position: relative;
  contain: layout style;
}
.match-list {
  overflow-y: auto;
  contain: strict;
  will-change: scroll-position;
}
```

同时修改 `.match-list` 现有样式（如果已有 overflow 属性），确保 `contain: strict` 不冲突。

- [ ] **Step 7: scrollIntoView 适配（如存在）**

搜索 `packages/gui/src/app.ts` 中是否有 `scrollIntoView` 调用。若存在，虚拟滚动下不能直接用原生 `scrollIntoView`，需改为计算 `scrollTop`：

```typescript
// 查找类似这样的代码：
// someRow.scrollIntoView({ block: 'nearest' });

// 改为：
const idx = vscrollFilteredMatches.findIndex(m => m.matches_id === targetId);
if (idx >= 0) {
  const listEl = listSlot.querySelector<HTMLElement>('.match-list');
  if (listEl) listEl.scrollTop = idx * ROW_HEIGHT;
}
```

若不存在 `scrollIntoView` 调用，跳过此步骤。

- [ ] **Step 8: 验证**

```bash
bun run dev:browser
```

在 debug 模式下（有 mock 数据），快速滚动比赛列表，DevTools FPS meter 确认 ≥ 120fps。Elements 面板确认 DOM 中只有 ~12 行 `.match-row`。

---

### Task 9: Canvas 事件标记点降级

**Files:**
- Modify: `packages/gui/src/player-event-markers.ts`（新增 canvas 渲染函数）
- Modify: `packages/gui/src/player.ts:417-475`（buildEventMarkers + renderEventMarkerLayouts + repositionEventMarkers）
- Modify: `packages/gui/src/style.css`（canvas 样式）

**Produces:** 事件计数 >20 时自动切换 Canvas 渲染，GPU 合成层从 50+ 降至 1。

- [ ] **Step 1: 添加 Canvas 降级阈值和类型**

在 `packages/gui/src/player-event-markers.ts` 文件顶部添加：

```typescript
/** Threshold above which event markers switch from DOM to Canvas rendering */
export const CANVAS_MARKER_THRESHOLD = 20;

/** Canvas-rendered marker data (subset used for drawing) */
export interface CanvasMarkerDatum {
  leftPct: number;
  topPx: number;
  stemPx: number;
  type: string;
  isHeadshot: boolean;
  lane: EventMarkerLane;
  timeMs: number;
  playerName: string;
}
```

- [ ] **Step 2: 实现 Canvas 标记点渲染函数**

在 `packages/gui/src/player-event-markers.ts` 文件末尾添加：

```typescript
export function renderCanvasMarkers<T extends EventMarkerInput>(
  canvas: HTMLCanvasElement,
  layouts: EventMarkerLayout<T>[],
): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 色值来源于 CSS 变量，直接硬编码为已解析的 oklch（保持与 CSS 一致）
  const MARKER_BG = 'oklch(0.055 0.006 30 / 0.42)';
  const MARKER_BORDER = 'oklch(0.42 0.012 30 / 0.7)';
  const STEM_COLOR = 'oklch(0.30 0.014 30 / 0.5)';

  for (const layout of layouts) {
    const x = (layout.leftPct / 100) * rect.width;
    const y = layout.topPx;
    const stemLen = layout.stemPx - 2; // overlap with track

    // 茎线
    ctx.strokeStyle = STEM_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y + (layout.displayMode === 'compact' ? 11 : 12)); // 从标记点底部
    ctx.lineTo(x, y + (layout.displayMode === 'compact' ? 11 : 12) + stemLen);
    ctx.stroke();

    // 圆点背景
    const dotSize = layout.displayMode === 'compact' ? 7 : 16;
    const dotR = dotSize / 2;

    // 解析颜色（Canvas 不直接支持 oklch，用 hex fallback）
    ctx.fillStyle = layout.type === 'death'
      ? 'rgba(219, 68, 55, 0.42)'      // defeat 色近似
      : layout.isHeadshot
        ? 'rgba(234, 160, 40, 0.42)'   // alert/headshot 色近似
        : 'rgba(55, 55, 55, 0.42)';    // neutral

    ctx.strokeStyle = 'rgba(128, 128, 128, 0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - dotR, y + 4, dotSize, dotSize, 4);
    ctx.fill();
    ctx.stroke();

    // 简单图标：十字准星（击杀）或 X（死亡）
    ctx.fillStyle = '#c2c2c2'; // dispatch-gray 近似
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const iconY = y + 4 + dotR;
    if (layout.marker.type === 'death') {
      ctx.fillText('✕', x, iconY);
    } else {
      ctx.fillText('✚', x, iconY);
    }
  }
}
```

**注意**：Canvas 不支持 oklch 颜色，需要使用硬编码的 hex 或 rgba 近似值。这些值应与 `DESIGN.md` 和 `style.css` 中的颜色一致。

- [ ] **Step 3: 修改 player.ts 的 buildEventMarkers**

在 `packages/gui/src/player.ts:417-423`，修改 `buildEventMarkers` 为双路径：

```typescript
function buildEventMarkers(markers: EventMarker[], videoDurationMs: number): HTMLElement | null {
  const layouts = layoutEventMarkers(markers, videoDurationMs);
  if (layouts.length === 0) return null;

  if (layouts.length > CANVAS_MARKER_THRESHOLD) {
    return buildCanvasMarkers(layouts, markers);
  }
  return buildDomMarkers(layouts, markers);
}

function buildDomMarkers(layouts: EventMarkerLayout<EventMarker>[], markers: EventMarker[]): HTMLElement {
  const container = el('div', { class: 'player-event-markers' });
  container.dataset.rawMarkers = JSON.stringify(markers);
  renderEventMarkerLayouts(container, layouts);
  return container;
}

function buildCanvasMarkers(layouts: EventMarkerLayout<EventMarker>[], markers: EventMarker[]): HTMLElement {
  const container = el('div', { class: 'player-event-markers is-canvas' });
  container.dataset.rawMarkers = JSON.stringify(markers);
  container.dataset.canvasLayouts = JSON.stringify(layouts);
  const canvas = el('canvas', { class: 'player-event-canvas' }) as HTMLCanvasElement;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.appendChild(canvas);

  // 透明覆盖层用于点击检测
  const overlay = el('div', { class: 'player-event-canvas-overlay' });
  overlay.addEventListener('click', (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const layoutsParsed: EventMarkerLayout[] = JSON.parse(container.dataset.canvasLayouts ?? '[]');
    const hit = layoutsParsed.find(l =>
      Math.abs((l.leftPct / 100) * rect.width - x) < 14
    );
    if (hit) {
      const dot = { dataset: { timeMs: String(hit.marker.timeMs) } };
      // 委托到现有的 seekToMarker 逻辑
      const ce = new CustomEvent('marker-click', { detail: { timeMs: hit.marker.timeMs } });
      container.dispatchEvent(ce);
    }
  });
  container.appendChild(overlay);

  // 初始绘制
  requestAnimationFrame(() => {
    renderCanvasMarkers(canvas, layouts);
  });

  return container;
}
```

- [ ] **Step 4: 修改 player.ts 的 marker 点击处理**

在 `packages/gui/src/player.ts:280-294`，在现有 DOM 标记点击处理之后，添加 Canvas 标记点击处理：

```typescript
// 在现有 markersContainer.addEventListener('click', ...) 之后添加：
markersContainer.addEventListener('marker-click' as any, (e: CustomEvent) => {
  const timeMs = e.detail.timeMs;
  if (!vEl.duration) return;
  const seekMs_val = Math.max(0, timeMs - EVENT_PREROLL_MS);
  const targetSec = Math.min(seekMs_val / 1000, vEl.duration - 0.05);
  const pct = (targetSec / vEl.duration) * 100;

  progressWrap.classList.add('is-marker-seek');
  const scaleX = pct / 100;
  progressFill.style.transform = `scaleX(${scaleX})`;
  progressThumb.style.transform = `translate(calc(${pct}% - 50%), -50%)`;

  vEl.currentTime = targetSec;
  if (vEl.paused) vEl.play().catch(() => {});
  setTimeout(() => progressWrap.classList.remove('is-marker-seek'), 220);
});
```

- [ ] **Step 5: 修改 repositionEventMarkers 支持 Canvas**

在 `packages/gui/src/player.ts:457-475`，修改 `repositionEventMarkers`：

```typescript
function repositionEventMarkers() {
  const container = backdropEl?.querySelector('.player-event-markers') as HTMLElement | null;
  if (!container || !videoEl || !videoEl.duration) return;
  let markers: EventMarker[] = [];
  try {
    const raw = JSON.parse(container.dataset.rawMarkers ?? '[]');
    if (Array.isArray(raw)) markers = raw as EventMarker[];
  } catch {
    return;
  }
  const durationMs = effectiveMarkerDurationMs(markers, 0, videoEl.duration);
  const trackRect = container.getBoundingClientRect();
  const placement = trackRect.top < MARKER_OVERHEAD_PX ? 'bottom' : 'top';
  const layouts = layoutEventMarkers(markers, durationMs, {
    trackWidthPx: trackRect.width,
    placement,
    trackHeightPx: trackRect.height,
  });

  if (container.classList.contains('is-canvas')) {
    const canvas = container.querySelector<HTMLCanvasElement>('.player-event-canvas');
    if (canvas) {
      container.dataset.canvasLayouts = JSON.stringify(layouts);
      renderCanvasMarkers(canvas, layouts);
    }
  } else {
    renderEventMarkerLayouts(container, layouts);
  }
}
```

- [ ] **Step 6: 添加 Canvas 标记点 CSS**

在 `packages/gui/src/style.css` 的事件标记区域（约 line 2550 附近）添加：

```css
.player-event-canvas {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  pointer-events: none;
}
.player-event-canvas-overlay {
  position: absolute; inset: 0;
  pointer-events: auto;
  cursor: pointer;
}
```

- [ ] **Step 7: 验证**

```bash
bun run dev:browser
```

找一场事件较多的比赛（如果 debug mock 数据不够，使用真实数据），打开播放器：
- 标记点数 ≤20 时，DevTools 确认使用 DOM 渲染（`.player-event-marker` 元素存在）
- 标记点数 >20 时，确认使用 Canvas 渲染（`canvas.player-event-canvas` 存在）
- 点击 Canvas 标记点确认能正确 seek
- 全屏/窗口化切换确认 Canvas 重绘

---

## 验证命令

```bash
# Phase 1 验证
bun run dev:browser
# 打开 http://localhost:1420/?debug=1
# DevTools → Layers 面板确认合成层 ≤ 15
# DevTools → Performance 录制滚动 → 确认无 Layout 事件

# Phase 2 验证
cargo test --release --manifest-path src-tauri/Cargo.toml --lib

# Phase 3 验证
bun run dev
# DevTools FPS meter ≥ 120fps
# Elements 面板确认 match-row DOM 节点 ≤ 15
```

## 文件改动总结

| 文件 | Phase | 行数 |
|------|-------|------|
| `packages/gui/src/app.ts` | 1,3 | ~150 行改 |
| `packages/gui/src/style.css` | 1,3 | ~60 行改 |
| `packages/gui/src/player.ts` | 1,3 | ~40 行改 |
| `packages/gui/src/player-event-markers.ts` | 3 | ~100 行加 |
| `packages/gui/src/library-stats.ts` | 1 | 1 行改 |
| `packages/gui/src/scan-progress.ts` | 1 | ~5 行改 |
| `src-tauri/Cargo.toml` | 2 | +1 行 |
| `src-tauri/src/library/db.rs` | 2 | +5 行 |
| `src-tauri/src/library/scraper.rs` | 2 | ~80 行改 |
