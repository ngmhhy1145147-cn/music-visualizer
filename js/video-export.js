/* ============================================================
 * video-export.js -- 一键离线渲染博主视频
 * 依赖：js/offline-analysis.js（离线频谱）、js/overlay-render.js（信息层）、
 *       index.html 暴露的 window.__MVBRIDGE（渲染桥接）
 * 编码策略：优先 WebCodecs VideoEncoder（GPU 硬件 H.264，速度可达实时数倍），
 *           不可用时自动回退 ffmpeg.wasm x264（CPU，分块控制内存）。
 *           ffmpeg 仅做音频转码与封装（流复制，瞬时完成）。
 * ffmpeg.wasm：优先本地 vendor/（离线可用），缺失时降级 CDN
 * ============================================================ */
(function (global) {
'use strict';

var FFMPEG_VER = '0.12.15';var CORE_VER = '0.12.10';
var CDN = 'https://cdn.jsdelivr.net/npm';
var CDN_BAK = 'https://unpkg.com';
/* worker 以自身脚本目录为基准解析相对路径，必须用根绝对路径避免 /vendor/vendor/ 双拼 */
var VENDOR = '/vendor';

/* ============================================================
 * 日志系统：环形缓冲（默认保留 800 条），分级输出。
 * 高风险操作（GPU 编码/ffmpeg 执行/文件 IO/保存）全部记录 error 级以下全量，
 * 用户在设置-高级-日志详细度可调（quiet/error/verbose）。
 * 导出：渲染对话框结束后可一键下载完整日志 txt。
 * ============================================================ */
var Log = (function(){
  var MAX = 800;
  var buf = [];                 /* {t, level, msg} */
  var LEVELS = { quiet: 0, error: 1, verbose: 2 };
  function threshold(){
    try { return LEVELS[localStorage.getItem('mv.exp.log') || 'quiet'] || 0; }
    catch(e){ return 0; }
  }
  function ts(){
    var d = new Date();
    return d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes() +
      ':' + (d.getSeconds() < 10 ? '0' : '') + d.getSeconds() + '.' +
      (d.getMilliseconds() < 100 ? '0' : '') + (d.getMilliseconds() < 10 ? '0' : '') + d.getMilliseconds();
  }
  function push(level, msg){
    try {
      buf.push({ t: ts(), level: level, msg: String(msg).slice(0, 500) });
      if (buf.length > MAX) buf.shift();
    } catch(e){}
    /* verbose 时同步到控制台，便于开发者实时看 */
    if (threshold() >= 2){
      try { console.log('[MV][' + level + '] ' + msg); } catch(e){}
    }
  }
  return {
    info:  function(m){ if (threshold() >= 1) push('info', m); },
    step:  function(m){ push('step', m); },                       /* 关键步骤：始终记录 */
    warn:  function(m){ push('warn', m); },                       /* 警告：始终记录 */
    error: function(m){ push('error', m); },                      /* 错误：始终记录 */
    dump:  function(){
      return buf.map(function(e){
        return e.t + ' [' + e.level + '] ' + e.msg;
      }).join('\n');
    },
    clear: function(){ buf = []; }
  };
})();
global.__MVLog = Log;

/* 带错误上下文的快捷记录：err 转 message */
function errText(e){
  return e && e.message ? e.message : String(e);
}
/* 读取设置-导出栏的全局默认参数（带兜底默认值） */
function getExportPrefs(){
  function get(k, d){
    try {
      var v = localStorage.getItem(k);
      return v === null ? d : v;
    } catch(e){ return d; }
  }
  return {
    yieldEvery: parseInt(get('mv.exp.yield', '60'), 10) || 60,
    rc: get('mv.exp.rc', 'constant'),
    gopSec: parseFloat(get('mv.exp.gop', '2')) || 2,
    preset: get('mv.exp.preset', 'veryfast'),
    chroma: get('mv.exp.chroma', '4:2:0'),
    hdr: get('mv.exp.hdr', '0') === '1',
    nits: parseInt(get('mv.exp.nits', '800'), 10) || 800,
    faststart: get('mv.exp.faststart', '1') === '1',
    resample: parseInt(get('mv.exp.resample', '48000'), 10) || 0,
    channels: parseInt(get('mv.exp.channels', '0'), 10) || 0,
    logLevel: get('mv.exp.log', 'quiet')
  };
}

var BRIDGE = function(){ return global.__MVBRIDGE; };
var $ = function(id){ return document.getElementById(id); };

/* ---------- 预置规格 ---------- */
var RESOLUTIONS = [
  { id: '4k',    label: '3840×2160 (4K)',    w: 3840,  h: 2160 },
  { id: '1080p', label: '1920×1080 (1080p)', w: 1920,  h: 1080 },
  { id: '720p',  label: '1280×720 (720p)',   w: 1280,  h: 720  },
  { id: '480p',  label: '854×480 (480p)',    w: 854,   h: 480  }
];
var FPS_OPTIONS = [24, 30, 60, 120];
var AUDIO_FORMATS = [
  { id: 'aac',  label: 'AAC (m4a/aac)',  ext: '.m4a',  codec: 'aac',        ffmpeg: true  },
  { id: 'mp3',  label: 'MP3',             ext: '.mp3',  codec: 'libmp3lame', ffmpeg: true  },
  { id: 'opus', label: 'Opus (webm)',     ext: '.opus', codec: 'libopus',    ffmpeg: true  },
  { id: 'copy', label: '不转换（直接复制）', ext: null,  codec: null,        ffmpeg: false }
];
/* level 6.2/6.0 支持 4K/120fps，逐级向下兼容 */
var GPU_CODEC_CANDIDATES = ['avc1.64003E', 'avc1.64003C', 'avc1.640034', 'avc1.640028', 'avc1.4D0028', 'avc1.42E01E'];
/* 恒定码率优先（保证输出码率达标），不支持时回退可变码率 */
var BITRATE_MODES = ['constant', 'variable'];

var el = {};          /* 对话框元素缓存 */
var ffmpeg = null;    /* ffmpeg.wasm 实例 */
var ffmpegLoading = null;
var rendering = false;
var cancelRequested = false;

/* ============================================================
 * 工具
 * ============================================================ */
function toast(msg){
  var t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tm);
  t._tm = setTimeout(function(){ t.classList.remove('show'); }, 2600);
}
function fmtBytes(n){
  if (n >= 1048576) return (n/1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n/1024).toFixed(1) + ' KB';
  return n + ' B';
}
function fmtClock(s){
  s = Math.max(0, Math.floor(s));
  var m = Math.floor(s/60), r = s%60;
  var h = Math.floor(m/60); m -= h*60;
  return (h > 0 ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (r < 10 ? '0' : '') + r;
}
function setStatus(html){ el.status.innerHTML = html; el.status.classList.add('on'); }
function setPhase(text){
  el.phase.textContent = text;
  el.phase.classList.add('on');
}
function setProgress(frac){
  el.prog.classList.add('on');
  el.progFill.style.width = Math.max(0, Math.min(1, frac))*100 + '%';
}
function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
/* 让出主线程：双 rAF 确保浏览器完成一次完整渲染循环（UI 保活） */
function yieldUI(){
  return new Promise(function(r){ requestAnimationFrame(function(){ setTimeout(r, 0); }); });
}
function pad2(n){ return (n < 10 ? '0' : '') + n; }

var START_CODE = new Uint8Array([0, 0, 0, 1]);
function concatU8(parts){
  var n = 0, i;
  for (i = 0; i < parts.length; i++) n += parts[i].length;
  var out = new Uint8Array(n), off = 0;
  for (i = 0; i < parts.length; i++){ out.set(parts[i], off); off += parts[i].length; }
  return out;
}
/* AVCC 帧（4 字节长度前缀 NALU）-> Annex B（起始码 NALU） */
function avccChunkToAnnexB(u8){
  var parts = [], i = 0;
  while (i + 4 <= u8.length){
    var len = (u8[i] << 24) | (u8[i+1] << 16) | (u8[i+2] << 8) | u8[i+3];
    if (len <= 0 || i + 4 + len > u8.length) break;
    parts.push(START_CODE);
    parts.push(u8.subarray(i + 4, i + 4 + len));
    i += 4 + len;
  }
  return concatU8(parts);
}
/* AVCDecoderConfigRecord（SPS/PPS 描述）-> Annex B */
function descToAnnexB(desc){
  var parts = [], p = 6;
  var nSps = desc[5] & 0x1F;
  for (var s = 0; s < nSps && p + 2 <= desc.length; s++){
    var sl = (desc[p] << 8) | desc[p+1]; p += 2;
    if (p + sl > desc.length) break;
    parts.push(START_CODE);
    parts.push(desc.subarray(p, p + sl)); p += sl;
  }
  if (p < desc.length){
    var nPps = desc[p]; p++;
    for (var q = 0; q < nPps && p + 2 <= desc.length; q++){
      var pl = (desc[p] << 8) | desc[p+1]; p += 2;
      if (p + pl > desc.length) break;
      parts.push(START_CODE);
      parts.push(desc.subarray(p, p + pl)); p += pl;
    }
  }
  return concatU8(parts);
}

/* ============================================================
 * ffmpeg.wasm 加载（本地 vendor 优先，CDN 降级）
 * ============================================================ */
function loadScript(src){
  return new Promise(function(resolve, reject){
    var s = document.createElement('script');
    s.src = src;
    s.onload = function(){ resolve(); };
    s.onerror = function(){ reject(new Error('脚本加载失败: ' + src)); };
    document.head.appendChild(s);
  });
}
async function toBlobURL(url, mime){
  var resp = await fetch(url);
  if (!resp.ok) throw new Error('fetch ' + url + ' -> ' + resp.status);
  var buf = await resp.arrayBuffer();
  var u = URL.createObjectURL(new Blob([buf], { type: mime }));
  /* ffmpeg.wasm load 完成后即可释放（编码器已把内容读入 wasm 内存） */
  setTimeout(function(){ URL.revokeObjectURL(u); }, 60000);
  return u;
}
function getFFmpeg(){
  if (ffmpeg) return Promise.resolve(ffmpeg);
  if (ffmpegLoading) return ffmpegLoading;
  ffmpegLoading = (async function(){
    if (!global.FFmpegWASM || !global.FFmpegWASM.FFmpeg){
      await loadScript(VENDOR + '/ffmpeg.js').catch(function(){ return null; })
        .then(function(){
          if (global.FFmpegWASM) return null;
          return loadScript(CDN + '/@ffmpeg/ffmpeg@' + FFMPEG_VER + '/dist/umd/ffmpeg.js');
        });
    }
    if (!global.FFmpegWASM || !global.FFmpegWASM.FFmpeg) throw new Error('ffmpeg 主脚本加载失败');
    var FF = global.FFmpegWASM.FFmpeg;
    var inst = new FF();
    /* 加载源优先级：本地 vendor -> jsdelivr -> unpkg */
    var attempts = [
      { coreURL: VENDOR + '/ffmpeg-core.js', wasmURL: VENDOR + '/ffmpeg-core.wasm' }
    ];
    try {
      attempts.push({
        coreURL: await toBlobURL(CDN + '/@ffmpeg/core@' + CORE_VER + '/dist/umd/ffmpeg-core.js', 'text/javascript'),
        wasmURL: await toBlobURL(CDN + '/@ffmpeg/core@' + CORE_VER + '/dist/umd/ffmpeg-core.wasm', 'application/wasm')
      });
    } catch (e) { /* 离线时 CDN 不可用，仅用本地 */ }
    for (var i = 0; i < attempts.length; i++){
      try { await inst.load(attempts[i]); ffmpeg = inst; return inst; } catch (e) { /* 下一个 */ }
    }
    try {
      await inst.load({
        coreURL: await toBlobURL(CDN_BAK + '/@ffmpeg/core@' + CORE_VER + '/dist/umd/ffmpeg-core.js', 'text/javascript'),
        wasmURL: await toBlobURL(CDN_BAK + '/@ffmpeg/core@' + CORE_VER + '/dist/umd/ffmpeg-core.wasm', 'application/wasm')
      });
      ffmpeg = inst;
      return inst;
    } catch (e) {}
    throw new Error('ffmpeg.wasm 加载失败（本地 vendor 与 CDN 均不可用）');
  })();
  return ffmpegLoading;
}
/* 带退出码检查的 exec：失败立即抛错（避免静默失败后续报错难懂）。
   全量记录调用参数与退出码——ffmpeg 失败排查的第一现场。 */
async function runFF(ff, args){
  var t0 = Date.now();
  var brief = args.filter(function(a){ return String(a)[0] !== '-'; }).slice(0, 4).join(' ');
  Log.info('ffmpeg 开始: ' + brief);
  var code = await ff.exec(args);
  var dt = Date.now() - t0;
  if (code !== 0){
    Log.error('ffmpeg 失败(码 ' + code + ', ' + dt + 'ms): ' + args.join(' ').slice(0, 300));
    throw new Error('ffmpeg 执行失败（退出码 ' + code + '）：' + brief);
  }
  Log.info('ffmpeg OK(' + dt + 'ms): ' + brief);
  return code;
}
async function tryRm(ff, names){
  for (var i = 0; i < names.length; i++){
    if (!names[i]) continue;
    try { await ff.deleteFile(names[i]); } catch (e) {
      Log.warn('删除 FS 文件失败 ' + names[i] + ': ' + errText(e));
    }
  }
}
/* 带 IO 日志的写入：writeFile 会 transfer buffer，是历史 bug 高发区 */
async function writeFileLogged(ff, name, data, what){
  var kb = data.length >= 1048576 ? (data.length/1048576).toFixed(1) + 'MB' : Math.round(data.length/1024) + 'KB';
  try {
    await ff.writeFile(name, data);
    Log.info('写入 ' + (what || name) + ' (' + name + ', ' + kb + ') OK');
  } catch (e){
    Log.error('写入 ' + (what || name) + ' 失败: ' + errText(e));
    throw e;
  }
}

/* ============================================================
 * 渲染对话框
 * ============================================================ */
function ensureDialog(){
  if (el.dialog) return;
  var html =
  '<div class="st-head"><span>渲染视频</span><button id="rd-close">✕</button></div>' +
  '<div class="st-row"><div class="st-label">曲目<span class="st-sub" id="rd-track">-</span></div></div>' +
  '<div class="rd-grid">' +
    '<div class="st-row wide"><div class="st-label">分辨率</div><select id="rd-res" class="rd-select"></select></div>' +
    '<div class="st-row"><div class="st-label">帧率</div><select id="rd-fps" class="rd-select"></select></div>' +
    '<div class="st-row"><div class="st-label">视频码率 (Mbps)</div><input id="rd-vb" class="rd-num" type="number" min="0.5" max="100" step="0.5"></div>' +
    '<div class="st-row"><div class="st-label">音频格式</div><select id="rd-af" class="rd-select"></select></div>' +
    '<div class="st-row"><div class="st-label">音频码率 (kbps)</div><input id="rd-ab" class="rd-num" type="number" min="32" max="512" step="16"></div>' +
    '<div class="st-row wide"><div class="st-label">画面构成<span class="st-sub">与当前界面一致：可视化模式、主题/背景、灵敏度 · 输出恒为博主视频，信息层布局取当前偏好（B 切换/Shift+B 换布局）</span></div></div>' +
  '</div>' +
  '<div id="rd-note">使用 GPU 硬件编码（WebCodecs，Chrome/Edge 最佳），不可用时自动回退 CPU。' +
    '渲染在本机浏览器内离线完成，期间实时可视化暂停，结束后自动恢复。' +
    '4K 渲染需要较大内存（约 1-2GB），低配设备建议 1080p。</div>' +
  '<div id="rd-prog"><div id="rd-prog-fill"></div></div>' +
  '<div id="rd-status"><span id="rd-phase"></span><span id="rd-detail"></span></div>' +
    '<div class="rd-actions">' +
    '<button id="rd-log" class="st-btn" style="margin-right:auto;display:none;">导出日志</button>' +
    '<button id="rd-cancel" class="st-btn">取消</button>' +
    '<button id="rd-save" class="st-btn primary" style="display:none;">保存文件</button>' +
    '<button id="rd-start" class="st-btn primary">开始渲染</button>' +
  '</div>';
  var box = document.createElement('div');
  box.id = 'render-dialog';
  box.innerHTML = html;
  document.body.appendChild(box);

  el.dialog = box;
  el.close = $('rd-close'); el.track = $('rd-track');
  el.res = $('rd-res'); el.fps = $('rd-fps'); el.vb = $('rd-vb'); el.af = $('rd-af'); el.ab = $('rd-ab');
  el.phase = $('rd-phase'); el.detail = $('rd-detail');
  el.prog = $('rd-prog'); el.progFill = $('rd-prog-fill'); el.status = $('rd-status');
  el.start = $('rd-start'); el.cancel = $('rd-cancel');

  RESOLUTIONS.forEach(function(r){
    var o = document.createElement('option');
    o.value = r.id; o.textContent = r.label;
    el.res.appendChild(o);
  });
  FPS_OPTIONS.forEach(function(f){
    var o = document.createElement('option');
    o.value = f; o.textContent = f + ' fps';
    el.fps.appendChild(o);
  });
  AUDIO_FORMATS.forEach(function(f){
    var o = document.createElement('option');
    o.value = f.id; o.textContent = f.label;
    el.af.appendChild(o);
  });
  el.res.value = localStorage.getItem('mv.rd.res') || '1080p';
  el.fps.value = localStorage.getItem('mv.rd.fps') || '30';
  el.vb.value = localStorage.getItem('mv.rd.vb') || '12';
  el.af.value = localStorage.getItem('mv.rd.af') || 'aac';
  el.ab.value = localStorage.getItem('mv.rd.ab') || '192';

  /* 切分辨率时自动建议对应码率（仅当当前值是某档默认值时） */
  var RES_DEFAULT_VB = { '4k': 35, '1080p': 12, '720p': 8, '480p': 4 };
  el.res.addEventListener('change', function(){
    var cur = +el.vb.value;
    if ([4, 8, 12, 35].indexOf(cur) !== -1 || !cur){
      el.vb.value = RES_DEFAULT_VB[el.res.value] || 12;
    }
  });

  el.close.addEventListener('click', function(){ if (!rendering) close(); });
  el.cancel.addEventListener('click', function(){
    if (rendering){ cancelRequested = true; el.cancel.textContent = '正在取消…'; }
    else close();
  });
  el.start.addEventListener('click', startRender);
  /* 日志导出按钮：渲染结束（无论成败）后可见，下载本次全部日志 */
  el.logBtn = $('rd-log');
  el.saveBtn = $('rd-save');
  el.logBtn.addEventListener('click', function(){
    var blob = new Blob(['== 音乐可视化 渲染日志 ==\n时间: ' + new Date().toLocaleString() +
      '\nUA: ' + navigator.userAgent + '\n\n' + Log.dump()], { type: 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mv-render-log-' + Date.now() + '.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 10000);
  });
}

function readSettings(){
  var res = RESOLUTIONS.find(function(r){ return r.id === el.res.value; }) || RESOLUTIONS[0];
  var af = AUDIO_FORMATS.find(function(f){ return f.id === el.af.value; }) || AUDIO_FORMATS[0];
  var s = {
    w: res.w, h: res.h,
    fps: +el.fps.value || 30,
    vBitrateMbps: Math.min(100, Math.max(0.5, +el.vb.value || 12)),
    audio: af,
    aBitrateKbps: Math.min(512, Math.max(32, +el.ab.value || 192))
  };
  localStorage.setItem('mv.rd.res', el.res.value);
  localStorage.setItem('mv.rd.fps', el.fps.value);
  localStorage.setItem('mv.rd.vb', s.vBitrateMbps);
  localStorage.setItem('mv.rd.af', af.id);
  localStorage.setItem('mv.rd.ab', s.aBitrateKbps);
  return s;
}

function open(){
  ensureDialog();
  if (rendering) return;
  var B = BRIDGE();
  var info = B && B.getTrackInfo();
  if (!info){ toast('请先加载音频'); return; }
  el.track.textContent = info.name;
  el.start.disabled = false;
  el.cancel.textContent = '取消';
  el.prog.classList.remove('on');
  el.progFill.style.width = '0';
  el.status.classList.remove('on');
  el.phase.textContent = ''; el.detail.textContent = '';
  el.dialog.classList.add('open');
}
function close(){
  if (rendering) return;
  el.dialog.classList.remove('open');
}
function isOpen(){
  return !!(el.dialog && el.dialog.classList.contains('open'));
}

/* ============================================================
 * WebCodecs GPU 编码探测。HDR：优先 AV1/HEVC 10bit（PQ），
 * H.264 无 HDR 元数据能力；探测失败回退普通 H.264（SDR）并提示。
 * ============================================================ */
var HDR_CANDIDATES = [
  { codec: 'av01.0.13M.10.1.110.09.16.09.0', label: 'AV1 10bit' },
  { codec: 'hev1.2.4.L153.B0', label: 'HEVC Main10' },
  { codec: 'hvc1.2.4.L153.B0', label: 'HEVC Main10' }
];
async function probeWebCodecs(settings, gp){
  if (typeof global.VideoEncoder === 'undefined' || typeof global.VideoFrame === 'undefined') return null;
  gp = gp || getExportPrefs();
  var attempts = [];

  if (gp.hdr){
    HDR_CANDIDATES.forEach(function(h){
      ['prefer-hardware', null].forEach(function(hw){
        ['constant', 'variable'].forEach(function(bm){
          [true, false].forEach(function(annexb){
            attempts.push({ codec: h.codec, label: h.label, hw: hw, annexb: annexb, bm: bm, hdr: true });
          });
        });
      });
    });
  }

  /* H.264 候选：自动（浏览器择优，通常即 NVENC/DGPU）优先，显式 prefer-hardware 兜底 */
  [null, 'prefer-hardware'].forEach(function(hw){
    ['constant', 'variable'].forEach(function(bm){
      GPU_CODEC_CANDIDATES.forEach(function(codec){
        attempts.push({ codec: codec, hw: hw, annexb: true, bm: bm, label: null });
      });
      GPU_CODEC_CANDIDATES.forEach(function(codec){
        attempts.push({ codec: codec, hw: hw, annexb: false, bm: bm, label: null });
      });
    });
  });

  for (var i = 0; i < attempts.length; i++){
    var a = attempts[i];
    var cfg = {
      codec: a.codec, width: settings.w, height: settings.h,
      framerate: settings.fps,
      bitrate: Math.round(settings.vBitrateMbps * 1000000),
      latencyMode: 'quality',
      bitrateMode: a.bm
    };
    if (a.codec.indexOf('av01') === 0){
      cfg.avc = undefined;
    } else if (a.codec.indexOf('hev1') === 0 || a.codec.indexOf('hvc1') === 0){
      cfg.hevc = { format: a.annexb ? 'annexb' : 'avc' };
    } else {
      cfg.avc = { format: a.annexb ? 'annexb' : 'avc' };
    }
    if (a.hdr){
      cfg.transfer = 'pq';
      cfg.colorSpace = { primaries: 'bt2020', transfer: 'pq', matrix: 'bt2020nc' };
    }
    if (a.hw) cfg.hardwareAcceleration = a.hw;

    var tag = (a.label || a.codec) + ' ' + settings.w + 'x' + settings.h + '@' + settings.fps
      + (a.hw === 'prefer-hardware' ? ' HW' : ' 自动') + ' ' + (a.bm === 'constant' ? 'CBR' : 'VBR')
      + (a.hdr ? ' HDR' : '') + ' ' + (a.annexb ? 'annexb' : 'avc');
    try {
      var sup = await global.VideoEncoder.isConfigSupported(cfg);
      if (sup && sup.supported){
        Log.step('GPU 探测命中: ' + tag + (a.hw ? '' : '（浏览器自动择优，通常为硬件编码器）'));
        return { config: cfg, annexb: a.annexb, hw: !!a.hw, hdr: !!a.hdr,
          codecKind: a.codec.indexOf('av01') === 0 ? 'av1' : (a.codec.indexOf('hev1') >= 0 || a.codec.indexOf('hvc1') >= 0 ? 'hevc' : 'avc') };
      }
      if (a.hw === 'prefer-hardware') Log.warn('GPU 显式硬件请求不支持: ' + tag);
      else Log.info('GPU 自动模式不支持: ' + tag);
    } catch (e) {
      Log.warn('GPU 探测异常: ' + tag + ' - ' + errText(e));
    }
  }
  Log.warn('GPU 全部失败，回退 CPU');
  return null;
}

/* ============================================================
 * GPU 路径：逐帧渲染 -> VideoFrame -> 硬件编码 -> H.264 裸流
 * 帧数据全程留在 GPU 侧（无 getImageData 回读），编码异步流水线并行。
 * ============================================================ */
async function encodeVideoGPU(settings, outCv, drawFrameAt, frameCount, probe, gp, onProgress, isCancelled, writePart){
  gp = gp || getExportPrefs();
  /* HDR 模式：ffmpeg 封装时需要为裸流标注色彩元数据 */
  var hdr = !!probe.hdr;
  /* 分块直写 ffmpeg FS：编码输出不整块驻留内存（4K 裸流可达数百 MB） */
  var pending = [];
  var pendingBytes = 0;
  var totalChunks = 0;
  function pushPart(u8){
    pending.push(u8);
    pendingBytes += u8.length;
    totalChunks++;
  }
  var encError = null;
  var encoder = new global.VideoEncoder({
    output: function(chunk, meta){
      try {
        if (!probe.annexb && meta && meta.decoderConfig && meta.decoderConfig.description){
          pushPart(descToAnnexB(new Uint8Array(meta.decoderConfig.description)));
        }
        var u8 = new Uint8Array(chunk.byteLength);
        chunk.copyTo(u8);
        pushPart(probe.annexb ? u8 : avccChunkToAnnexB(u8));
      } catch (e){ if (!encError) encError = e; }
    },
    error: function(e){
      if (!encError) encError = e;
      Log.error('GPU 编码器 error 回调: ' + errText(e));
    }
  });
  var closed = false;
  function safeClose(){
    if (!closed){ closed = true; try { encoder.close(); } catch (e) {} }
  }
  async function flushPending(){
    if (!pending.length) return;
    var block = concatU8(pending);
    pending = []; pendingBytes = 0;
    if (writePart){
      try {
        await writePart(totalChunks - 1, block);
      } catch (e){
        Log.error('裸流分片写入失败(片 ' + (totalChunks-1) + ', ' + block.length + 'B): ' + errText(e));
        throw e;
      }
    }
  }
  try {
    encoder.configure(probe.config);
    Log.step('GPU 编码器配置成功，开始逐帧编码 ' + frameCount + ' 帧');
  } catch (e){
    safeClose();
    Log.error('GPU 编码器配置失败: ' + errText(e));
    throw new Error('GPU 编码器配置失败：' + (e.message || e));
  }
  var gop = Math.max(1, Math.round(settings.fps * gp.gopSec)); /* 关键帧间隔（用户设置） */
  var lastProg = -1;
  /* watchdog：编码器长时间无产出时熔断回退 CPU（宽松阈值，避免误杀慢速编码） */
  var lastActive = Date.now();
  var watchdogId = setInterval(function(){
    if (Date.now() - lastActive > 180000){
      if (!encError) encError = new Error('GPU 编码器超时无响应');
    }
  }, 10000);
  function touch(){ lastActive = Date.now(); }
  try {
  for (var i = 0; i < frameCount; i++){
    if (isCancelled()){ safeClose(); throw new Error('已取消'); }
    if (encError){ safeClose(); throw new Error('GPU 编码失败：' + (encError.message || encError)); }
    /* 背压：在途帧堆满才等待（高上限 = 渲染与编码深流水，GPU/CPU 双满载） */
    while (encoder.encodeQueueSize >= 48 && !encError && !isCancelled()){
      touch();
      await sleep(2);
    }
    drawFrameAt(i);
    var frame = null;
    try {
      frame = new global.VideoFrame(outCv, {
        timestamp: Math.round(i * 1000000 / settings.fps),
        duration: Math.round(1000000 / settings.fps)
      });
      encoder.encode(frame, { keyFrame: i % gop === 0 });
    } finally {
      if (frame) frame.close(); /* 无论成败必关，防 4K 帧累积 OOM */
    }
    /* 攒够 ~32MB 分块落盘控制内存；低频让路（频率可设置）保 UI 心跳即可，
       让路越少 GPU/CPU 越满载 */
    if (pendingBytes > 32*1024*1024) await flushPending();
    if (i % gp.yieldEvery === 0) await yieldUI();
    if (i % 30 === 0){
      touch();
      var p = i / frameCount;
      if (p - lastProg > 0.01){ lastProg = p; onProgress(p); }
    }
  }
  } finally {
    clearInterval(watchdogId);
  }
  if (encError){ safeClose(); throw new Error('GPU 编码失败：' + (encError.message || encError)); }
  Log.step('GPU 帧循环完成（' + totalChunks + ' 个编码分片），flush 中…');
  try {
    await encoder.flush();
  } catch (e){
    Log.error('GPU flush 失败: ' + errText(e));
    safeClose();
    throw new Error('GPU 编码 flush 失败：' + (e.message || e));
  }
  await flushPending();
  safeClose();
  onProgress(1);
  Log.step('GPU 编码完成，共 ' + totalChunks + ' 分片');
  return totalChunks;
}

/* ============================================================
 * CPU 回退路径：分块 rawvideo -> wasm x264 -> concat 拼接
 * 分块大小按 64MB 预算自适应，控制内存峰值（此前 1080p 会到 ~750MB）
 * ============================================================ */
async function encodeVideoCPU(settings, outCv, octx, drawFrameAt, frameCount, ff, gp, onProgress, isCancelled){
  gp = gp || getExportPrefs();
  var pixFmt = gp.chroma === '4:2:2' ? 'yuv422p' : 'yuv420p';
  Log.step('CPU 编码: x264 ' + gp.preset + ' ' + pixFmt);
  var frameBytes = settings.w * settings.h * 4;
  /* 按 ~96MB 预算自适应分块（4K 每帧 33MB，仅 2-3 帧/块），控制内存峰值 */
  var CHUNK_FRAMES = Math.max(2, Math.min(30, Math.floor(96*1024*1024 / frameBytes)));
  var chunks = Math.ceil(frameCount / CHUNK_FRAMES);
  var rawBuf = new Uint8Array(CHUNK_FRAMES * frameBytes);
  var chunkFiles = [];
  for (var c = 0; c < chunks; c++){
    var f0 = c * CHUNK_FRAMES, f1 = Math.min(frameCount, f0 + CHUNK_FRAMES);
    var filled = 0;
    for (var i = f0; i < f1; i++){
      if (isCancelled()){
        await tryRm(ff, chunkFiles);
        throw new Error('已取消');
      }
      drawFrameAt(i);
      var px = octx.getImageData(0, 0, settings.w, settings.h).data;
      rawBuf.set(px, filled);
      filled += frameBytes;
      await yieldUI();
    }
    var outName = 'chunk' + c + '.mp4';
    /* writeFile 会 transfer 传入的 buffer，必须复制一份，rawBuf 才能复用 */
    await writeFileLogged(ff, 'in.raw', rawBuf.slice(0, filled), '帧块#' + c);
    await runFF(ff, [
      '-hide_banner',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', settings.w + 'x' + settings.h,
      '-r', String(settings.fps), '-i', 'in.raw',
      '-c:v', 'libx264', '-preset', gp.preset, '-pix_fmt', pixFmt,
      '-b:v', settings.vBitrateMbps + 'M',
      '-g', String(Math.round(settings.fps * gp.gopSec)),
      '-r', String(settings.fps),
      '-y', outName
    ]);
    await tryRm(ff, ['in.raw']);
    chunkFiles.push(outName);
    onProgress((c+1) / chunks);
  }
  /* concat 分离器流复制拼接（无重编码，瞬时） */
  var list = chunkFiles.map(function(f){ return "file '" + f + "'"; }).join('\n');
  await ff.writeFile('list.txt', new TextEncoder().encode(list));
  await runFF(ff, ['-hide_banner', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '-y', 'video.mp4']);
  await tryRm(ff, chunkFiles.concat(['list.txt']));
  return { file: 'video.mp4', inputArgs: ['-i', 'video.mp4'] };
}

/* ============================================================
 * 校验：帧率/码率是否达标（直接探测 ffmpeg FS 里的输出文件）
 * ============================================================ */
async function verifyOutput(ff, name, settings, duration, audioConverted){
  var html = '';
  var okAll = true;

  var logs = '';
  var collect = function(l){ logs += l.message + '\n'; };
  ff.on('log', collect);
  try {
    await ff.exec(['-hide_banner', '-i', name]);
  } catch (e) { /* -i 无输出参数返回非零属预期，log 已收集 */ }
  ff.off('log', collect);

  var fpsGot = 0, vKbpsGot = 0, aKbpsGot = 0, aCodecGot = '', durGot = 0;
  var lines = logs.split('\n');
  var m;
  var vLine = lines.find(function(l){ return l.indexOf('Video:') !== -1; });
  if (vLine){
    m = vLine.match(/([\d.]+) fps/); if (m) fpsGot = +m[1];
    m = vLine.match(/([\d.]+) kb\/s/); if (m) vKbpsGot = +m[1];
  }
  var aLine = lines.find(function(l){ return l.indexOf('Audio:') !== -1; });
  if (aLine){
    m = aLine.match(/Audio: (\w+)/); if (m) aCodecGot = m[1];
    m = aLine.match(/([\d.]+) kb\/s/); if (m) aKbpsGot = +m[1];
  }
  m = logs.match(/Duration: (\d+):(\d+):([\d.]+)/);
  if (m) durGot = (+m[1])*3600 + (+m[2])*60 + (+m[3]);

  var fpsOk = fpsGot > 0 && Math.abs(fpsGot - settings.fps) <= 1.01;
  var targetVKbps = settings.vBitrateMbps * 1000;
  var vbOk = vKbpsGot >= targetVKbps*0.6;

  html += '<br>时长: ' + (durGot ? durGot.toFixed(1) + 's' : '?');
  html += '<br>帧率: ' + (fpsGot || '?') + ' / ' + settings.fps + ' fps ' + (fpsOk ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>');
  html += '<br>视频码率: ' + (vKbpsGot || '?') + ' kbps（目标 ≥' + Math.round(targetVKbps*0.6) + '） ' + (vbOk ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>');
  if (settings.audio.ffmpeg || audioConverted){
    var abOk = aKbpsGot >= settings.aBitrateKbps*0.8;
    html += '<br>音频: ' + (aCodecGot || '?') + ' ' + (aKbpsGot || '?') + ' kbps（目标 ≥' + Math.round(settings.aBitrateKbps*0.8) + '） ' + (abOk ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>');
    okAll = okAll && abOk;
  }
  okAll = okAll && fpsOk && vbOk;
  if (!okAll){
    html += '<br><span class="bad">部分指标未达标</span>（编码器码率波动属正常；若画面流畅、音画同步，可视为合格）';
  }
  return { html: html, ok: okAll };
}

/* ============================================================
 * 渲染主流程
 * ============================================================ */
async function startRender(){
  if (rendering) return;
  var B = BRIDGE();
  var info = B.getTrackInfo();
  if (!info) return;

  rendering = true; cancelRequested = false;
  el.start.disabled = true;
  setProgress(0);
  setStatus('准备中…');
  var t0 = Date.now();
  Log.clear();
  Log.step('== 渲染开始: ' + info.name + ' ==');
  el.logBtn.style.display = 'none';

  try {
    var settings = readSettings();
    Log.step('参数: ' + settings.w + 'x' + settings.h + '@' + settings.fps + 'fps ' +
      settings.vBitrateMbps + 'Mbps / 音频 ' + settings.audio.id + ' ' + settings.aBitrateKbps + 'kbps');

    /* 1. 音频：读取 + 解码（decodeAudioData 会 transfer，先复制） */
    setPhase('读取音频…');
    try {
      var buf = await fetch(info.url).then(function(r){ return r.arrayBuffer(); });
      Log.info('音频读取 OK: ' + fmtBytes(buf.byteLength));
    } catch (e){
      Log.error('音频读取失败: ' + errText(e));
      throw e;
    }
    var audioBytes = new Uint8Array(buf.slice(0));
    setPhase('解码音频…');
    try {
      var audioBuf = await B.decodeAudio(buf);
      Log.step('解码 OK: ' + audioBuf.duration.toFixed(2) + 's ' + audioBuf.numberOfChannels + 'ch ' + audioBuf.sampleRate + 'Hz');
    } catch (e){
      Log.error('音频解码失败（格式不受支持？）: ' + errText(e));
      throw e;
    }
    var duration = audioBuf.duration;

    /* 2. 并行加载 ffmpeg（用于封装与音频转码） */
    var ffPromise = getFFmpeg();

    /* 3. 离线分析器 */
    if (!global.MVOfflineAnalysis) throw new Error('离线分析模块未加载');
    var analyzer = MVOfflineAnalysis.create(audioBuf, { fps: settings.fps });
    var frameCount = analyzer.frameCount;

    /* 4. 画布分层：vizCv 渲染层（复用主程序渲染管线）+ outCv 合成层。
       背景图+模糊+暗化是静态的，一次性预渲染成 bgCanvas（此前每帧重算 blur 极耗时）。 */
    var vizCv = document.createElement('canvas');
    var outCv = document.createElement('canvas');
    vizCv.width = outCv.width = settings.w;
    vizCv.height = outCv.height = settings.h;
    B.prepareExport(vizCv, settings.w, settings.h);
    var vizCtx = vizCv.getContext('2d');
    var octx = outCv.getContext('2d');
    var bgColor = B.getBgColor();
    var bgState = B.getBgState();
    var bgCanvas = null;
    if (bgState.url){
      var bgImg = await loadImage(bgState.url);
      var blurPx = bgState.blur || 0;
      bgCanvas = document.createElement('canvas');
      bgCanvas.width = settings.w; bgCanvas.height = settings.h;
      var bctx = bgCanvas.getContext('2d');
      if (blurPx > 0){
        bctx.filter = 'blur(' + blurPx + 'px)';
        drawCover(bctx, bgImg, settings.w, settings.h, 1 + blurPx*0.006);
        bctx.filter = 'none';
      } else {
        drawCover(bctx, bgImg, settings.w, settings.h, 1);
      }
      bctx.fillStyle = 'rgba(5,3,10,' + (bgState.dim != null ? bgState.dim : 0.42) + ')';
      bctx.fillRect(0, 0, settings.w, settings.h);
    }
    /* 渲染恒定输出博主视频：信息层始终绘制，布局取当前偏好（分散式/顶部卡片） */
    var layout = B.getBlLayout();
    var accent = B.getAccentColors();
    var renderViz = B.getRenderer();
    var endFrameFn = B.endFrame;
    /* 信息层缩放：分辨率放大 × 用户设置的信息层大小（与实时预览一致） */
    var ovScale = (B.getOverlayScale ? B.getOverlayScale() : 1);
    var ovTotalScale = Math.max(1, settings.w / 1920) * ovScale;

    function drawFrameAt(i){
      var tMs = i * 1000 / settings.fps;
      var fr = analyzer.getFrame(i);
      B.setAnalysisFrame(fr.freq, fr.time, tMs);
      renderViz(tMs);
      endFrameFn(); /* 残影缓冲，保证拖尾与实时一致 */
      var tctx; /* 本帧信息层的目标上下文 */
      if (bgCanvas){
        /* 有背景图：合成层 = 背景 + 可视化 + 信息层 */
        octx.drawImage(bgCanvas, 0, 0);
        octx.drawImage(vizCv, 0, 0);
        tctx = octx;
      } else {
        /* 无背景图：信息层直接画在渲染层上，跳过整帧合成拷贝
           （每帧省 2 次全屏 blit——渲染端最大瓶颈，GPU 编码器吃不饱的主因） */
        tctx = vizCtx;
      }
      if (global.MVOverlayRender && layout){
        tctx.save();
        tctx.scale(ovTotalScale, ovTotalScale);
        MVOverlayRender.draw(tctx, settings.w / ovTotalScale, settings.h / ovTotalScale, layout, {
          title: info.name,
          stateText: '正在播放',
          index: pad2(info.index+1) + ' / ' + pad2(info.count),
          next: info.next ? '下一首 · ' + info.next : '',
          curMs: tMs,
          durMs: duration * 1000,
          colors: accent
        });
        tctx.restore();
      }
    }
    /* 无背景时编码直接用渲染层画布；有背景用合成层 */
    var encCv = bgCanvas ? outCv : vizCv;
    var encCtx = bgCanvas ? octx : vizCtx;

    var ff = await ffPromise;
    Log.step('ffmpeg.wasm 就绪');
    await tryRm(ff, ['in.raw', 'list.txt', 'video.mp4', 'v.h264', 'final.mp4']);

    /* 读取设置-导出中的全局参数（与单次渲染参数合并） */
    var gp = getExportPrefs();

    /* 5. 视频编码：GPU 硬件编码优先（WebCodecs），失败自动回退 CPU */
    setPhase('探测 GPU 编码器…');
    var gpu = await probeWebCodecs(settings, gp);
    if (gp.hdr && gpu && !gpu.hdr){
      Log.warn('HDR 已开启但 GPU 不支持 AV1/HEVC 10bit 编码，本次输出为 SDR');
      toast('显卡不支持 HDR 编码，本次输出 SDR');
    }
    if (gp.hdr && !gpu){
      Log.warn('HDR 开启但 GPU 编码整体不可用（CPU 回退亦为 SDR）');
      toast('GPU 不可用，HDR 无法输出');
    }
    var encRes = null, usedGPU = false;
    if (gpu){
      try {
        setPhase('GPU 渲染编码中…');
        var tEnc = Date.now();
        /* 裸流分片写入 ffmpeg FS，最终用 concat 协议按序读入拼接成单个 v.h264
           （H.264 裸流是纯字节流可直接顺序拼接；不能用 concat demuxer——它只认容器格式） */
        var partNames = [];
        var writePart = async function(idx, block){
          var name = 'vpart' + idx + '.h264';
          await writeFileLogged(ff, name, block, '裸流分片#' + idx);
          partNames.push(name);
        };
        await encodeVideoGPU(settings, encCv, drawFrameAt, frameCount, gpu, gp,
          function(p){ setProgress(0.02 + 0.66*p); },
          function(){ return cancelRequested; }, writePart);
        /* concat 协议：按序读入分片写为单个文件（无重编码，瞬时）。
           HDR（AV1/HEVC）时标注 bt2020/PQ 色彩元数据，播放器才能正确显示 HDR。 */
        var concatUri = 'concat:' + partNames.join('|');
        var vFile = gpu.hdr ? 'v_hdr.bin' : 'v.h264';
        if (gpu.hdr){
          var cArgs = ['-hide_banner', '-i', concatUri,
            '-c', 'copy',
            '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc',
            '-y', vFile];
          await runFF(ff, cArgs);
        } else {
          await runFF(ff, ['-hide_banner', '-i', concatUri, '-c', 'copy', '-y', vFile]);
        }
        await tryRm(ff, partNames);
        var vInput;
        if (gpu.hdr){
          vInput = gpu.codecKind === 'av1'
            ? ['-f', 'ivf', '-i', vFile]
            : ['-f', 'hevc', '-i', vFile];
        } else {
          vInput = ['-f', 'h264', '-framerate', String(settings.fps), '-i', vFile];
        }
        encRes = { file: vFile, inputArgs: vInput, hdr: gpu.hdr, codecKind: gpu.codecKind };
        usedGPU = true;
        Log.step('GPU 编码耗时 ' + ((Date.now()-tEnc)/1000).toFixed(1) + 's' + (gpu.hdr ? '（HDR/PQ ' + gpu.codecKind.toUpperCase() + '）' : ''));
      } catch (e){
        if (cancelRequested) throw e;
        /* GPU 失败：重置渲染状态，回退 CPU */
        Log.warn('GPU 编码失败，回退 CPU: ' + errText(e));
        B.finishExport();
        B.prepareExport(vizCv, settings.w, settings.h);
        toast('GPU 编码不可用，已切换 CPU 编码');
      }
    }
    if (!encRes){
      setPhase('CPU 渲染编码中…');
      var tCpu = Date.now();
      encRes = await encodeVideoCPU(settings, encCv, encCtx, drawFrameAt, frameCount, ff, gp,
        function(p){
          setProgress(0.02 + 0.66*p);
          setPhase('CPU 渲染编码 ' + Math.round(p*100) + '% · ' + fmtClock(duration));
        },
        function(){ return cancelRequested; });
      Log.step('CPU 编码耗时 ' + ((Date.now()-tCpu)/1000).toFixed(1) + 's');
    }
    B.finishExport();

    /* 6. 音频处理（格式转换；所选编码器不可用时自动改 AAC） */
    setPhase('处理音频…');
    setProgress(0.72);
    var af = settings.audio;
    var srcExt = guessExt(audioBytes);
    var audioIn = 'a_src' + srcExt;
    await writeFileLogged(ff, audioIn, audioBytes.slice(0), '源音频'); /* writeFile 会 transfer，复制传入 */
    var audioFile = audioIn;
    var audioConverted = af.ffmpeg;
    /* "不转换"仅对 mp4 兼容格式（aac/mp3/m4a）有效，wav/ogg 必须转 */
    if (!af.ffmpeg && (srcExt === '.wav' || srcExt === '.ogg')){
      audioConverted = true;
      Log.warn('源音频 ' + srcExt + ' 不能直入 MP4，自动转 AAC');
      toast('源音频 ' + srcExt + ' 不能直入 MP4，已自动转为 AAC');
    }
    if (audioConverted){
      var wantCodec = af.ffmpeg ? af.codec : 'aac';
      var wantExt = af.ffmpeg ? af.ext : '.m4a';
      audioFile = 'a_out' + wantExt;
      var aArgs = ['-hide_banner', '-i', audioIn, '-c:a', wantCodec, '-b:a', settings.aBitrateKbps + 'k'];
      if (gp.resample > 0) aArgs = aArgs.concat(['-ar', String(gp.resample)]);
      if (gp.channels > 0) aArgs = aArgs.concat(['-ac', String(gp.channels)]);
      aArgs = aArgs.concat(['-y', audioFile]);
      try {
        await runFF(ff, aArgs);
      } catch (e){
        Log.warn('音频编码器 ' + wantCodec + ' 不可用，改用 AAC');
        audioFile = 'a_out.m4a';
        var aArgs2 = ['-hide_banner', '-i', audioIn, '-c:a', 'aac', '-b:a', settings.aBitrateKbps + 'k'];
        if (gp.resample > 0) aArgs2 = aArgs2.concat(['-ar', String(gp.resample)]);
        if (gp.channels > 0) aArgs2 = aArgs2.concat(['-ac', String(gp.channels)]);
        aArgs2 = aArgs2.concat(['-y', audioFile]);
        await runFF(ff, aArgs2);
        toast('所选音频编码器不可用，已改用 AAC');
      }
      await tryRm(ff, [audioIn]);
    }

    /* 7. 封装（音视频均流复制，瞬时） */
    setPhase('合成视频…');
    setProgress(0.84);
    var muxArgs = ['-hide_banner'].concat(encRes.inputArgs);
    if (audioFile !== audioIn) muxArgs = muxArgs.concat(['-i', audioFile]);
    muxArgs = muxArgs.concat(['-map', '0:v', '-c:v', 'copy']);
    /* HDR：流复制时保留/标注色彩元数据（部分封装器要求显式声明编码器 tag） */
    if (encRes.hdr){
      muxArgs = muxArgs.concat([
        '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc',
        '-tag:v', encRes.codecKind === 'av1' ? 'av01' : 'hvc1'
      ]);
    }
    if (audioFile !== audioIn) muxArgs = muxArgs.concat(['-map', '1:a', '-c:a', 'copy']);
    if (gp.faststart) muxArgs = muxArgs.concat(['-movflags', '+faststart']);
    muxArgs = muxArgs.concat(['-y', 'final.mp4']);
    await runFF(ff, muxArgs);
    await tryRm(ff, [encRes.file].concat([audioFile]));

    /* 8. 校验 + 读取结果 */
    setPhase('校验输出…');
    setProgress(0.92);
    var check = await verifyOutput(ff, 'final.mp4', settings, duration, audioConverted);
    var data = await ff.readFile('final.mp4');
    var file = new Blob([data], { type: 'video/mp4' });
    await tryRm(ff, ['final.mp4']);
    Log.step('输出文件生成: ' + fmtBytes(file.size));

    /* 9. 完成（先恢复 UI，保存按钮等待用户手势触发） */
    var elapsed = Math.round((Date.now() - t0)/1000);
    rendering = false;
    el.start.disabled = false;
    setProgress(1);
    setStatus('<span class="ok">✓ 渲染完成</span> · ' + fmtBytes(file.size) +
      ' · 耗时 ' + elapsed + 's（' + (usedGPU ? 'GPU 编码 WebCodecs' : 'CPU 编码') + '）' + check.html);
    setPhase('渲染完成，等待保存');
    el.logBtn.style.display = '';
    Log.step('== 渲染完成，总耗时 ' + elapsed + 's ==');

    /* 10. 等待用户点击「保存文件」按钮（点击 = 用户手势，弹窗有效）
       用 Promise 挂起，渲染函数整体完成后再 await 它 */
    var safeName = info.name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
    var fileName = safeName + '_' + settings.w + 'x' + settings.h + '_' + settings.fps + 'fps.mp4';
    var savedFile = file, savedName = fileName;
    el.saveBtn.style.display = '';
    await new Promise(function(resolve){
      el.saveBtn.onclick = async function(){
        el.saveBtn.style.display = 'none';
        try {
          await saveFile(savedFile, savedName);
        } catch (e){
          Log.warn('保存失败: ' + errText(e));
        }
        resolve();
      };
      el.cancel.onclick = function(){
        el.saveBtn.style.display = 'none';
        close();
        resolve();
      };
    });
  } catch (err){
    var B2 = BRIDGE();
    try { B2.finishExport(); } catch (e) {}
    Log.error('渲染失败: ' + errText(err));
    setStatus('<span class="bad">✕ ' + (err && err.message ? err.message : '渲染失败') + '</span>');
    setPhase('失败');
    setProgress(0);
  } finally {
    el.logBtn.style.display = '';
    el.saveBtn.style.display = 'none';
    rendering = false;
    el.start.disabled = false;
    el.cancel.textContent = '关闭';
  }
}

/* ============================================================
 * 辅助
 * ============================================================ */
function guessExt(src){
  var u = src.subarray(0, 12);
  if (u[0] === 0x52 && u[8] === 0x57) return '.wav';                 /* RIFF....WAVE */
  if (u[4] === 0x66 && u[5] === 0x74 && u[6] === 0x79 && u[7] === 0x70) return '.m4a'; /* ftyp */
  if (u[0] === 0x4F && u[1] === 0x67 && u[2] === 0x67 && u[3] === 0x53) return '.ogg';
  return '.mp3';
}
function loadImage(url){
  return new Promise(function(resolve, reject){
    var img = new Image();
    img.onload = function(){ resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}
function drawCover(ctx, img, W, H, scale){
  var s = Math.max(W/img.width, H/img.height) * scale;
  var w = img.width*s, h = img.height*s;
  ctx.drawImage(img, (W-w)/2, (H-h)/2, w, h);
}
/* File System Access API 优先，退化到下载 */
async function saveFile(blob, fileName){
  if (window.showSaveFilePicker){
    try {
      Log.step('保存: 等待用户选择位置…');
      var handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'MP4 视频', accept: { 'video/mp4': ['.mp4'] } }]
      });
      var ws = await handle.createWritable();
      await ws.write(blob);
      await ws.close();
      Log.step('保存完成: ' + fileName + ' (' + fmtBytes(blob.size) + ')');
      toast('已保存');
      return;
    } catch (e){
      if (e && e.name === 'AbortError'){
        Log.warn('用户取消保存');
        throw new Error('已取消保存（文件仍在，可重试）');
      }
      Log.warn('showSaveFilePicker 失败，退化为下载: ' + errText(e));
      /* 其它错误退化为下载 */
    }
  }
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 30000);
  Log.step('已触发浏览器下载: ' + fileName);
  toast('已开始下载');
}

/* ============================================================
 * 导出 API
 * ============================================================ */
global.MVExport = {
  open: open,
  close: close,
  isOpen: isOpen,
  /* 供测试/调试 */
  _internals: {
    probeWebCodecs: probeWebCodecs,
    getFFmpeg: getFFmpeg
  }
};

})(typeof window !== 'undefined' ? window : globalThis);
