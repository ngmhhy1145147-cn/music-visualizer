# 音乐可视化程序 - 技术记忆文档

> 本文档完整记录该程序的功能、架构与代码位置，供后续开发/维护时快速恢复上下文。
> 最后更新：2026-08-19

---

## 一、产品概述

**本地网页音乐可视化程序**：加载本地音频文件，实时渲染 5 种可视化模式，支持博主模式（录屏界面）、背景图/主题定制、一键离线渲染导出 MP4 视频（GPU 加速编码）。纯前端，无后端，无网络依赖（ffmpeg.wasm 已本地化）。

**入口**：`启动.bat` → 本地 8080 端口服务器（python http.server）→ 浏览器打开 `http://127.0.0.1:8080`。
**不可用 file:// 协议直接打开**（多文件结构 + fetch 受限）。

---

## 二、文件结构

```
glm5.3/
├── 启动.bat              # 启动脚本（GBK 编码！端口 8080，netstat 检测已运行则直接开浏览器）
├── start.sh              # Linux/macOS 启动脚本（python3/python，xdg-open/open 开浏览器）
├── index.html            # 主程序：UI + 可视化渲染 + 设置面板 + 桥接接口（~2600 行）
├── js/
│   ├── offline-analysis.js    # 离线音频频谱分析（FFT，AnalyserNode 等效复刻）
│   ├── offline-analysis.test.js  # 上述模块的 Node 单元测试
│   ├── overlay-render.js      # 博主信息层的 canvas 绘制（导出视频用，复刻 DOM 版）
│   ├── overlay-render.test.js # 上述模块的 Node 单元测试
│   ├── video-export.js        # 视频渲染导出（WebCodecs GPU 编码 + ffmpeg.wasm 封装）
│   └── ve.js                  # video-export.js 的缓存破解副本（index.html 引用的是它！改完必须同步）
├── vendor/                # ffmpeg.wasm 本地化文件（离线可用）
│   ├── ffmpeg.js          # @ffmpeg/ffmpeg@0.12.15 UMD 主包（加载 814 chunk）
│   ├── 814.ffmpeg.js      # webpack chunk（UMD 主包运行时会请求它，缺了必挂）
│   ├── ffmpeg-core.js     # @ffmpeg/core@0.12.10
│   └── ffmpeg-core.wasm   # 32MB wasm 核心
└── 记忆.md                # 本文档
```

**⚠ 关键坑：`index.html` 引用 `js/ve.js` 而非 `js/video-export.js`**（为破解浏览器 JS 缓存曾物理改名）。修改导出逻辑后必须：`cp js/video-export.js js/ve.js && touch js/ve.js`。

---

## 三、核心架构

### 3.1 实时播放管线（index.html）

```
音频文件(拖入/选择) → URL.createObjectURL → <audio> 元素
    → AudioContext.createMediaElementSource → AnalyserNode(fftSize=2048)
    → 每帧 getByteFrequencyData / getByteTimeDomainData
    → 对数分频(computeBands, BANDS=96) × 灵敏度(sens, 默认0.75)
    → 节拍检测(detectBeat, 低频能量 vs 滑动平均)
    → 渲染器数组 renderers[mode](now) 绘制到主 canvas
```

**关键代码位置（index.html 内）**：
- 音频管线/ensureAudio/buildBandEdges/computeBands：搜索 `function ensureAudio`
- 节拍检测：搜索 `function detectBeat`
- 渲染主循环：搜索 `function frame`（`exporting` 时跳出让位给导出）
- 5 个渲染器：`drawBars` / `drawRadial` / `drawWave` / `drawParticles` / `drawWaterfall`
- 反馈残影系统：`beginFrame(retain)` / `endFrame()`（trailCv 上一帧按 alpha 回叠；**retain 必须 <0.5** 否则 8bit 舍入不收敛留永久灰印）
- **频谱模式例外**：drawBars 用 `beginFrame(0)` 全清屏 + 专属尾迹 `trailVals[]`（拖尾只影响条上方尾迹，不改变条形亮度——用户明确要求）
- 状态重置：`resetVizState()`（切模式/导出准备时清 peaks/trailVals/waveHist/orbiters/bassHist）

### 3.2 残影/拖尾机制（重要，改动前必读）

- 模式 2/3/4/5（环形/波形/星云/瀑布）用全局反馈：`beginFrame(trailAmt)` 把 trailCv（上一帧）按 `trailAmt` 透明度叠回，产生运动拖尾。
- 模式 1（频谱）**不用**全局反馈（`beginFrame(0)`），拖尾由每根条独立的 `trailVals[i]` 缓慢回落实现（`trailFall = 0.06 - trailAmt*0.09`），只画在条形上方。
- `endFrame()` 每帧把当前画布拷回 trailCv；导出时画布切换由桥接的 prepareExport/finishExport 管理。
- 交换画布时 `endFrame` 用 `ctx.canvas`（跟随当前 ctx），不是固定主画布——导出复用渲染管线的关键。

### 3.3 博主模式（录屏界面）

- 按 `B` 开关，`Shift+B` 切换布局（`blLayout`: 'dispersed' 分散式 | 'top' 顶部卡片），body 加 `.blogger` class 隐藏操作 UI，只留信息层。
- DOM 版信息层：`#blogger-card`（顶部卡片）/ `#blogger-dispersed`（四角小条+底部进度条），CSS 中 `--ov-scale` 变量控制整体缩放（设置面板"博主信息层大小"滑条）。
- 导出视频时用 `js/overlay-render.js` 在 canvas 上复刻同样式（`MVOverlayRender.draw`），规格与 CSS 逐值对应（chip 圆角10/背景rgba(13,12,24,.55)/呼吸圆点周期1.6s 等）。
- **导出恒定输出博主视频**：无论博主模式是否开启，导出时始终绘制信息层（用户需求："点击渲染就会输出博主视频"）。
- 信息层缩放：导出时 `总缩放 = max(1, W/1920) × ovScale`（4K 等比放大保持与同分辨率录屏一致的相对大小）。

### 3.4 视频导出管线（js/video-export.js）

```
startRender() 主流程（9 步）：
1. fetch 音频 → decodeAudioData（会 transfer ArrayBuffer！先 slice 复制留底）
2. getFFmpeg()（vendor 优先 → jsdelivr → unpkg；VENDOR='/vendor' 根绝对路径，相对路径会被 worker 拼成 /vendor/vendor/ 404）
2.5 probeWebCodecs() 探测编码器
3. MVOfflineAnalysis.create(audioBuf, {fps}) 离线逐帧频谱
4. 画布分层：vizCv(渲染层,桥接接管) + outCv(合成层,有背景图时用) + bgCanvas(背景+模糊+压暗,一次性预渲染)
   drawFrameAt(i) = 分析帧→渲染器→endFrame→[合成]→信息层
5. GPU 编码 encodeVideoGPU：VideoFrame 直取画布（无 getImageData 回读）
   → H.264 裸流分片(~32MB/片)写入 ffmpeg FS → concat 协议拼成 v.h264
   失败自动回退 CPU：encodeVideoCPU（rawvideo 块→x264 分块→concat demuxer）
6. 音频转码（选中编码器失败自动改 AAC；wav/ogg 不能直入 mp4 自动转）
7. 封装（音视频均 -c copy 流复制，HDR 时加 bt2020/PQ 色彩标签 + tag:v）
8. verifyOutput（ffmpeg -i 探测输出文件的帧率/码率，判达标线：fps±1 / 视频≥目标60% / 音频≥目标80%）
9. 完成恢复 UI → 等"保存文件"按钮点击（用户手势）→ saveFile
```

**关键坑（改导出逻辑前必读）**：
- `ff.writeFile` 会 **transfer** 传入的 buffer（原 buffer 被 detach）——复用缓冲必须传 `.slice(0)` 副本。
- `decodeAudioData(buf)` 同样 transfer buf——解码前先 `buf.slice(0)` 复制给后续 ffmpeg 用。
- concat **demuxer**（-f concat）不能拼裸 H.264 流（会挂死）——裸流用 **concat 协议**（`-i "concat:a.h264|b.h264"`）。
- `showSaveFilePicker` 需用户手势上下文——渲染耗时数分钟早脱离手势，所以完成后显示「保存文件」按钮，点击（新手势）再弹窗。
- GPU 编码探测：Edge/Chromium 对显式 `prefer-hardware` 常一律拒绝（isConfigSupported=false），**不指定 hardwareAcceleration（自动）时浏览器自动选 NVENC**。顺序：自动优先。
- 导出主循环让路频率：`gp.yieldEvery`（设置可调，默认每 60 帧 yieldUI 一次双 rAF）。

### 3.5 离线分析模块（js/offline-analysis.js）

- `MVOfflineAnalysis.create(audioBuffer, {fps, fftSize=2048, smoothing=0.8, minDb=-100, maxDb=-30})`
- 逐帧计算与 AnalyserNode 等效的 freq(1028)/time(2048) 字节数组：Blackman 窗 → radix-2 FFT → 幅度→dB→字节 → EMA 平滑（跳帧重置 EMA）。
- 纯确定性（无 AudioContext/performance），浏览器/Node 双端可用。测试：`node js/offline-analysis.test.js`（11 项）。

### 3.6 桥接接口（index.html 的 `window.__MVBRIDGE`）

导出模块通过它复用主程序渲染管线（不复制代码）：
- `prepareExport(canvas,w,h)`：接管全局 ctx/W/H/dpr=1、重置全部渲染状态、暂停主循环（exporting=true）
- `setAnalysisFrame(freq,time,tMs)`：注入离线分析数据（等价于实时 AnalyserNode 每帧输出）
- `getRenderer()` / `endFrame` / `finishExport()`（恢复主画布+重启主循环）
- `getTrackInfo/getBgState(含dim)/getAccentColors/getBlLayout/getOverlayScale/getVizState(实时可视化参数)`

### 3.7 日志系统（video-export.js 的 `Log`）

- 环形缓冲 800 条，分级：step/warn/error 恒记录，info 受"设置→高级→日志详细度"控制（localStorage `mv.exp.log`: quiet/error/verbose）。
- 高风险操作全覆盖：GPU 探测逐条（含不支持原因）、ffmpeg 每次调用（参数+耗时+退出码）、FS 读写、音频解码、保存流程、各阶段耗时。
- 渲染结束（成败均可）对话框出现「导出日志」按钮 → 下载完整 txt。排查问题第一现场。

---

## 四、设置系统

**存储**：localStorage，键 `mv.*`（如 mv.mode/mv.theme/mv.sens/mv.trail...导出参数 mv.exp.*）。
**面板**：`S` 键开关，左导航 5 栏（index.html 搜索 `st-tab`）：

| 栏 | 内容 | 关键变量 |
|---|---|---|
| 外观 | 背景图/模糊/压暗(dimAmt)/提取主题色/信息层大小(ovScale)/圆点动画 | setBgState 系列 |
| 可视化 | 拖尾(trailAmt)/峰值帽速度(peakSpeed,0-0.02)/节拍强度(beatAmt)/环形转速(rotAmt)/粒子数(orbCount)/频谱平滑(smoothAmt)/地面反射(reflectOn)/跑马灯 | setTrail/setPeak 等 |
| 播放 | 隐藏延时(idleDelay)/自动下一首(autoNext)/切歌重置节拍(beatReset)/进度条样式(barStyle)/自动展开列表(autoOpenPl) | |
| 导出视频 | 让路频率(yieldEvery)/码率模式(rc)/GOP(gopSec)/CPU preset/色彩(chroma)/HDR(hdr)+峰值亮度(nits)/faststart/重采样(resample)/声道(channels) | getExportPrefs() 读取 |
| 高级 | 日志详细度/背景缓存开关/一键重置(清 mv.* 后刷新)/快捷键速查 | |

**渲染对话框**（R 键）的单次参数：分辨率(4k/1080p/720p/480p)/帧率(24/30/60/120)/视频码率(≤100Mbps)/音频格式/音频码率——存 mv.rd.*。

---

## 五、快捷键

`空格`播放暂停 · `←→`快退快进5s · `↑↓`音量 · `1-5`模式 · `B`博主模式 · `Shift+B`切布局 · `R`渲染对话框 · `S`设置 · `F`全屏 · `L`播放列表 · `[`/`]`灵敏度 · `Esc`关设置→退博主→关列表

---

## 六、已知怪癖与经验教训

0. **Pro 预设系统**：presetState('classic'/'pro')，renderers/renderersPro 两套渲染器数组；Shift+数字切换；桥接 getRenderer 自动跟随。Pro 环形=双层反向旋转+频段跳动点+发光；Pro 星云=频段轨道环+彗尾流星（与经典自由粒子完全不同）。⚠ Pro 环形必须保留经典的核心元素（内圈波形环+中心脉冲点），曾因丢失被用户批评"死板"。
1. **浏览器 JS 缓存极顽固**：304/touch/换端口都未必生效；最终方案=物理改名（video-export.js→ve.js）。改导出代码后必须同步 ve.js。
2. **批处理文件编码**：中文 bat 必须 GBK+CRLF（`iconv -f UTF-8 -t GBK` + `sed -i 's/$/\r/'`），否则 cmd 按 GBK 解析 UTF-8 会劈碎命令。
3. **ZCode 内嵌浏览器**：reload 后点击事件常失效（需关标签重开）；GPU 长时编码会挂渲染进程（真机 Chrome/Edge 无此问题）——在内嵌浏览器测出的"GPU 崩溃"结论不可信，教训深刻。
4. **4K/120 H.264**：codec 字符串需 level 6.x（avc1.64003E=6.2）。低于此 level 的探测在 4K@120 会失败。
5. **HDR**：WebCodecs H.264 不支持 HDR 元数据；需 AV1/HEVC 10bit + PQ（探测失败自动回退 SDR 并提示）。输出属"SDR 内容映射到 HDR 容器"，非原生 HDR 素材。
6. **瀑布图模式**（drawWaterfall）：自带离屏 canvas 历史，不依赖 trailCv；`off=null` 触发按新分辨率重建。
7. **切分辨率自动建议码率**：仅在当前值恰为某档默认值(4/8/12/35)时替换，不覆盖用户自定义值。

---

## 七、测试方法

- **单元测试**（Node）：`node js/offline-analysis.test.js`（11 项）；`node js/overlay-render.test.js`（15 项）
- **语法校验**：`node --check js/video-export.js`；index.html 的内嵌脚本：`sed -n '/^<script>$/,/^<\/script>$/p' index.html | sed '1d;$d' > .c.js && node --check .c.js`
- **端到端**：启动服务器，用测试台 iframe 注入音频（render-test.html 模式，测试完删除），或直接真实使用流程手动测。
- **渲染问题排查**：让用户点「导出日志」发回 txt——含全量 ffmpeg 参数/退出码/GPU 探测明细。

---

## 八、常用修改定位速查

| 想改什么 | 去哪里 |
|---|---|
| 可视化模式画面 | index.html `drawBars/drawRadial/drawWave/drawParticles/drawWaterfall` |
| 频谱条/尾迹/峰值帽参数 | `drawBars`（trailVals/trailFall/capH/peakSpeed） |
| 主题色 | index.html `THEMES` 数组（4 套，colors[0..2] 三段渐变 + bg 底色） |
| 信息层样式 | DOM 版：index.html CSS（#blogger-card/#bd-*）；导出版：js/overlay-render.js（两处需同步改） |
| 导出编码参数 | video-export.js `getExportPrefs()`（读设置）+ `probeWebCodecs`（GPU 候选）+ `encodeVideoGPU/CPU` |
| 导出主流程步骤 | video-export.js `startRender()`（步骤 1-10 注释齐全） |
| 新增设置项 | index.html：settings 面板 HTML 加行 → 加 var/set 函数 → 初始化调用 → 需要时桥接暴露给导出 |
| 灵敏度/节拍/分频 | index.html `computeBands`（sens 乘法在末行）/ `detectBeat` |
