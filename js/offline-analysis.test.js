/* offline-analysis.test.js —— node js/offline-analysis.test.js */
'use strict';
require('./offline-analysis.js');
var MVA = globalThis.MVOfflineAnalysis || require('./offline-analysis.js');

var pass = 0, fail = 0;
function check(name, cond, detail){
  if (cond){ pass++; console.log('PASS ' + name + (detail ? ' (' + detail + ')' : '')); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' (' + detail + ')' : '')); }
}
function makeBuffer(sampleRate, seconds, fn, nCh){
  nCh = nCh || 1;
  var length = Math.round(sampleRate * seconds);
  var chans = [];
  for (var c = 0; c < nCh; c++) chans.push(new Float32Array(length));
  for (var i = 0; i < length; i++){
    for (var ch = 0; ch < nCh; ch++) chans[ch][i] = fn(i/sampleRate, ch);
  }
  return {
    sampleRate: sampleRate, length: length, numberOfChannels: nCh,
    duration: length/sampleRate,
    getChannelData: function(c){ return chans[c]; }
  };
}

/* ---------- 测试 1：1000Hz 正弦 ---------- */
var sine = makeBuffer(44100, 2, function(t){ return 0.9*Math.sin(2*Math.PI*1000*t); });
var a1 = MVA.create(sine, { fps: 30 });
check('1.1 frameCount == 60', a1.frameCount === 60, 'got ' + a1.frameCount);

function peakBin(freq){
  var pk = 0, pi = -1;
  for (var i = 0; i < freq.length; i++) if (freq[i] > pk){ pk = freq[i]; pi = i; }
  return { idx: pi, val: pk };
}
var p5 = null, p1 = null;
for (var i = 0; i < 6; i++){
  var fr = a1.getFrame(i);
  if (i === 0) p1 = peakBin(fr.freq);
  if (i === 5) p5 = peakBin(fr.freq);
}
check('1.2 峰值 bin ≈ 46 (±2)', Math.abs(p5.idx - 46) <= 2, 'got ' + p5.idx);
/* Blackman 窗存在频谱泄漏（主瓣较宽），能量分散到相邻 bin，
   0.9 幅度正弦收敛后的峰值在 160~180 区间，阈值取 160。 */
check('1.3 EMA 收敛后峰值 ≥ 160', p5.val >= 160, 'got ' + p5.val);
check('1.4 平滑攻击：帧0 < 帧5', p1.val < p5.val, p1.val + ' vs ' + p5.val);

/* ---------- 测试 2：静音 ---------- */
var silent = makeBuffer(44100, 1, function(){ return 0; });
var a2 = MVA.create(silent, { fps: 30 });
var sf = a2.getFrame(5);
var allZero = sf.freq.every(function(v){ return v === 0; });
var allMid = sf.time.every(function(v){ return v === 128; });
check('2.1 静音 freq 全 0', allZero);
check('2.2 静音 time 全 128', allMid);

/* ---------- 测试 3：时域范围 ---------- */
var tmin = 255, tmax = 0;
for (i = 0; i < 8; i++){
  var tf = a1.getFrame(i);
  for (var j = 0; j < tf.time.length; j++){
    if (tf.time[j] < tmin) tmin = tf.time[j];
    if (tf.time[j] > tmax) tmax = tf.time[j];
  }
}
check('3.1 time min ≤ 30', tmin <= 30, 'got ' + tmin);
check('3.2 time max ≥ 226', tmax >= 226, 'got ' + tmax);

/* ---------- 测试 4：跳帧 ---------- */
var a4 = MVA.create(sine, { fps: 30 });
a4.getFrame(0);
var jump = a4.getFrame(10);
check('4.1 跳帧不抛异常且返回合法数组', jump && jump.freq.length === 1024 && jump.time.length === 2048);

/* ---------- 测试 5：立体声平均 ---------- */
var st = makeBuffer(44100, 2, function(t, ch){ return ch === 0 ? 0.9*Math.sin(2*Math.PI*1000*t) : 0; });
/* 单声道 0.45 幅度 */
var mono45 = makeBuffer(44100, 2, function(t){ return 0.45*Math.sin(2*Math.PI*1000*t); });
var a5a = MVA.create(st, { fps: 30 });
var a5b = MVA.create(mono45, { fps: 30 });
var pkA = null, pkB = null;
for (i = 0; i < 6; i++){
  var fa = a5a.getFrame(i), fb = a5b.getFrame(i);
  if (i === 5){ pkA = peakBin(fa.freq); pkB = peakBin(fb.freq); }
}
check('5.1 立体声平均与半幅单声道峰值 bin 一致', pkA.idx === pkB.idx, pkA.idx + ' vs ' + pkB.idx);

/* ---------- 性能抽查 ---------- */
var perf = MVA.create(makeBuffer(44100, 30, function(t){ return 0.5*Math.sin(2*Math.PI*440*t) + 0.3*Math.sin(2*Math.PI*3000*t); }), { fps: 30 });
var t0 = process.hrtime.bigint();
for (i = 0; i < 60; i++) perf.getFrame(i);
var dtMs = Number(process.hrtime.bigint() - t0) / 1e6;
check('性能: 60 帧 < 120ms (≈2ms/帧)', dtMs < 120, dtMs.toFixed(1) + 'ms');

console.log('\n结果: ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
