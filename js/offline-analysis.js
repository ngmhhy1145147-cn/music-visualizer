/* ============================================================
 * offline-analysis.js —— 离线音频分析（与 AnalyserNode 等效）
 * 实时播放用 AnalyserNode(fftSize=2048, smoothing=0.8,
 * minDecibels=-100, maxDecibels=-30)；本模块对 AudioBuffer 按帧
 * 纯数学复算同样的 freq/time 字节数组，供离线视频渲染使用。
 * 确定性：无 AudioContext / performance / Date 依赖。
 * ============================================================ */
(function (global) {
'use strict';

/* 每个实例缓存一份 FFT 表（位反转 + 旋转因子） */
var fftTables = {};

function getFftTables(N){
  if (fftTables[N]) return fftTables[N];
  /* 位反转表 */
  var rev = new Uint32Array(N);
  var bits = Math.round(Math.log2(N));
  for (var i = 0; i < N; i++){
    var r = 0, x = i;
    for (var b = 0; b < bits; b++){ r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r;
  }
  /* 旋转因子表：cos/sin 按 k*N/4 索引（0..N/4-1 覆盖 [0,π/2)） */
  var cosT = new Float64Array(N/4), sinT = new Float64Array(N/4);
  for (var k = 0; k < N/4; k++){
    var a = 2*Math.PI*k/N;
    cosT[k] = Math.cos(a); sinT[k] = Math.sin(a);
  }
  var t = { rev: rev, cosT: cosT, sinT: sinT };
  fftTables[N] = t;
  return t;
}

/* 原地迭代 radix-2 FFT（re/im 长度 N，N 为 2 的幂） */
function fftInPlace(re, im, N){
  var T = getFftTables(N), rev = T.rev, cosT = T.cosT, sinT = T.sinT;
  var i, j, k;
  for (i = 0; i < N; i++){
    j = rev[i];
    if (j > i){
      var tr = re[i]; re[i] = re[j]; re[j] = tr;
      var ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  /* 蝶形：len = 2,4,8...N */
  for (var len = 2; len <= N; len <<= 1){
    var half = len >> 1, step = N/len;
    for (i = 0; i < N; i += len){
      for (k = 0; k < half; k++){
        /* 角度 θ = -2πk/len；查表：θ ∈ [0,2π) 等价 N/4*k*step 位置 */
        var idx = k * step;
        var c, s;
        if (idx < N/4){ c = cosT[idx]; s = -sinT[idx]; }
        else { var q = idx - N/4; c = -sinT[q]; s = -cosT[q]; } /* θ∈[π/2,π) */
        var xr = re[i+k+half]*c - im[i+k+half]*s;
        var xi = re[i+k+half]*s + im[i+k+half]*c;
        re[i+k+half] = re[i+k] - xr;
        im[i+k+half] = im[i+k] - xi;
        re[i+k] += xr;
        im[i+k] += xi;
      }
    }
  }
}

function clampN(v, a, b){ return v < a ? a : v > b ? b : v; }

function create(audioBuffer, options){
  if (!audioBuffer || !audioBuffer.getChannelData) throw new Error('audioBuffer 无效');
  options = options || {};
  var fps = +options.fps;
  if (!fps || fps <= 0) throw new Error('fps 必填');
  var fftSize = options.fftSize || 2048;
  if (fftSize < 16 || (fftSize & (fftSize-1)) !== 0) throw new Error('fftSize 必须是 2 的幂');
  var tau = clampN(options.smoothingTimeConstant == null ? 0.8 : +options.smoothingTimeConstant, 0, 1);
  var minDb = options.minDecibels == null ? -100 : +options.minDecibels;
  var maxDb = options.maxDecibels == null ? -30 : +options.maxDecibels;

  var sampleRate = audioBuffer.sampleRate;
  var length = audioBuffer.length;
  var duration = audioBuffer.duration != null ? audioBuffer.duration : length/sampleRate;
  var nCh = audioBuffer.numberOfChannels || 1;
  var channels = [];
  for (var c = 0; c < nCh; c++) channels.push(audioBuffer.getChannelData(c));

  var half = fftSize >> 1;
  var frameCount = Math.ceil(duration * fps);

  var samples = new Float64Array(fftSize); /* 加窗前样本 */
  var windowed = new Float64Array(fftSize);
  var re = new Float64Array(fftSize), im = new Float64Array(fftSize);
  /* Blackman 窗 */
  var win = new Float64Array(fftSize);
  for (var i = 0; i < fftSize; i++){
    win[i] = 0.42 - 0.5*Math.cos(2*Math.PI*i/(fftSize-1)) + 0.08*Math.cos(4*Math.PI*i/(fftSize-1));
  }

  var prevS = new Float64Array(half);   /* 上一帧 EMA 状态（浮点） */
  var freqOut = new Uint8Array(half);
  var timeOut = new Uint8Array(fftSize);
  var lastIdx = -2; /* 检测跳帧：期望上次为 i-1 */

  function getFrame(i){
    if (i < 0 || i >= frameCount) throw new Error('帧号越界: ' + i);
    var fresh = (i !== lastIdx + 1); /* 首帧或跳帧：EMA 重置 */
    lastIdx = i;

    /* 1. 取样本（窗口右端对齐 t，越界补 0，多声道平均） */
    var t = i / fps;
    var end = Math.round(t * sampleRate);
    var start = end - fftSize;
    for (var j = 0; j < fftSize; j++){
      var idx = start + j;
      if (idx >= 0 && idx < length){
        var v = 0;
        for (var c2 = 0; c2 < nCh; c2++) v += channels[c2][idx];
        samples[j] = v / nCh;
      } else {
        samples[j] = 0;
      }
    }

    /* 2. 时域（不加窗，对应 getByteTimeDomainData） */
    for (j = 0; j < fftSize; j++){
      timeOut[j] = clampN(Math.round(128 + samples[j]*128), 0, 255);
    }

    /* 3. 频域：加窗 → FFT → dB → 字节 → EMA */
    for (j = 0; j < fftSize; j++){
      windowed[j] = samples[j] * win[j];
      re[j] = windowed[j];
      im[j] = 0;
    }
    fftInPlace(re, im, fftSize);

    for (var k = 0; k < half; k++){
      var mag = 2 * Math.sqrt(re[k]*re[k] + im[k]*im[k]) / fftSize;
      var db = 20 * Math.log10(Math.max(mag, 1e-12));
      var b;
      if (db <= minDb) b = 0;
      else if (db >= maxDb) b = 255;
      else b = (db - minDb) / (maxDb - minDb) * 255;
      var s = fresh ? b : tau*prevS[k] + (1-tau)*b; /* 对应 smoothingTimeConstant */
      prevS[k] = s;
      freqOut[k] = clampN(Math.round(s), 0, 255);
    }

    return { freq: freqOut, time: timeOut };
  }

  return { frameCount: frameCount, getFrame: getFrame };
}

global.MVOfflineAnalysis = { create: create };

})(typeof window !== 'undefined' ? window : globalThis);
