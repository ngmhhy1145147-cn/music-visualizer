/* ================= 扩展设置项 ================= */
/* 外观 */
var dimAmt = loadPref('mv.bgDim', 0.42);
function setDim(v){
  dimAmt = clampN(+v || 0, 0, 0.8);
  bgDim.style.background = 'rgba(5,3,10,' + dimAmt + ')';
  savePref('mv.bgDim', dimAmt);
  stDim.value = dimAmt;
  stDimVal.textContent = Math.round(dimAmt*100) + '%';
}
stDim.addEventListener('input', function(){ setDim(+stDim.value); });

/* 可视化 */
var trailAmt = loadPref('mv.trail', 0.45);
function setTrail(v){
  trailAmt = clampN(+v || 0, 0, 0.6);
  savePref('mv.trail', trailAmt);
  stTrail.value = trailAmt;
  stTrailVal.textContent = Math.round(trailAmt*100) + '%';
  resetVizState();
}
stTrail.addEventListener('input', function(){ setTrail(+stTrail.value); });

var peakSpeed = loadPref('mv.peak', 0.005);
function setPeak(v){
  peakSpeed = clampN(+v || 0, 0, 0.02);
  savePref('mv.peak', peakSpeed);
  stPeak.value = peakSpeed;
  stPeakVal.textContent = peakSpeed.toFixed(3);
}
stPeak.addEventListener('input', function(){ setPeak(+stPeak.value); });

var beatAmt = loadPref('mv.beat', 1);
function setBeat(v){
  beatAmt = clampN(+v || 0, 0, 3);
  savePref('mv.beat', beatAmt);
  stBeat.value = beatAmt;
  stBeatVal.textContent = Math.round(beatAmt*100) + '%';
}
stBeat.addEventListener('input', function(){ setBeat(+stBeat.value); });

var rotAmt = loadPref('mv.rot', 1);
function setRot(v){
  rotAmt = clampN(+v || 0, 0, 4);
  savePref('mv.rot', rotAmt);
  stRot.value = rotAmt;
  stRotVal.textContent = Math.round(rotAmt*100) + '%';
}
stRot.addEventListener('input', function(){ setRot(+stRot.value); });

var orbCount = loadPref('mv.orb', 240)|0;
function setOrb(v){
  orbCount = clampN(Math.round(+v || 240), 60, 600);
  savePref('mv.orb', orbCount);
  stOrb.value = orbCount;
  stOrbVal.textContent = orbCount;
  orbiters.length = 0; /* 重建粒子群 */
  proOrb.length = 0;
  proBurst.length = 0;
}
stOrb.addEventListener('input', function(){ setOrb(+stOrb.value); });

var smoothAmt = loadPref('mv.smooth', 0.8);
function setSmooth(v){
  smoothAmt = clampN(+v || 0.8, 0.5, 0.95);
  if (analyser) analyser.smoothingTimeConstant = smoothAmt;
  savePref('mv.smooth', smoothAmt);
  stSmooth.value = smoothAmt;
  stSmoothVal.textContent = smoothAmt.toFixed(2);
}
stSmooth.addEventListener('input', function(){ setSmooth(+stSmooth.value); });

var reflectOn = loadPref('mv.reflect', 1) === 1;
function setReflect(on){
  reflectOn = !!on;
  stReflect.checked = reflectOn;
  savePref('mv.reflect', reflectOn ? 1 : 0);
}
stReflect.addEventListener('change', function(){ setReflect(stReflect.checked); });

/* ---------- 模式专属设置 ---------- */
/* 频谱：柱宽 / 反射高度 */
var barWidthPct = loadPref('mv.barw', 0.62);
function setBarW(v){
  barWidthPct = clampN(+v || 0.62, 0.25, 0.95);
  savePref('mv.barw', barWidthPct);
  stBarW.value = barWidthPct;
  stBarWVal.textContent = Math.round(barWidthPct*100) + '%';
}
stBarW.addEventListener('input', function(){ setBarW(+stBarW.value); });

var reflectH = loadPref('mv.rh', 0.4);
function setRh(v){
  reflectH = clampN(+v || 0.4, 0.1, 0.8);
  savePref('mv.rh', reflectH);
  stRh.value = reflectH;
  stRhVal.textContent = Math.round(reflectH*100) + '%';
}
stRh.addEventListener('input', function(){ setRh(+stRh.value); });

/* 环形：方向 / 中心圆 / 放射长度 */
var rotDir = loadPref('mv.rotdir', 1) === -1 ? -1 : 1;
function setRotDir(v){
  rotDir = v === '-1' ? -1 : 1;
  savePref('mv.rotdir', rotDir);
  stRotDir.value = String(rotDir);
  waveHist.length = 0;
}
stRotDir.addEventListener('change', function(){ setRotDir(stRotDir.value); });

var radialR0 = loadPref('mv.r0', 0.16);
function setR0(v){
  radialR0 = clampN(+v || 0.16, 0.08, 0.26);
  savePref('mv.r0', radialR0);
  stR0.value = radialR0;
  stR0Val.textContent = Math.round(radialR0*100) + '%';
}
stR0.addEventListener('input', function(){ setR0(+stR0.value); });

var radialLen = loadPref('mv.rlen', 0.30);
function setRLen(v){
  radialLen = clampN(+v || 0.3, 0.15, 0.45);
  savePref('mv.rlen', radialLen);
  stRLen.value = radialLen;
  stRLenVal.textContent = Math.round(radialLen*100) + '%';
}
stRLen.addEventListener('input', function(){ setRLen(+stRLen.value); });

/* 波形：振幅 / 历史层数 / 对称比 */
var waveAmp = loadPref('mv.wamp', 0.28);
function setWAmp(v){
  waveAmp = clampN(+v || 0.28, 0.1, 0.45);
  savePref('mv.wamp', waveAmp);
  stWAmp.value = waveAmp;
  stWAmpVal.textContent = Math.round(waveAmp*100) + '%';
}
stWAmp.addEventListener('input', function(){ setWAmp(+stWAmp.value); });

var waveHistN = loadPref('mv.whist', 7)|0;
function setWHist(v){
  waveHistN = clampN(Math.round(+v || 7), 1, 12);
  savePref('mv.whist', waveHistN);
  stWHist.value = waveHistN;
  stWHistVal.textContent = waveHistN + ' 层';
  while (waveHist.length > waveHistN) waveHist.pop();
}
stWHist.addEventListener('input', function(){ setWHist(+stWHist.value); });

var waveSym = loadPref('mv.wsym', 0.8);
function setWSym(v){
  waveSym = clampN(+v || 0.8, 0.4, 1);
  savePref('mv.wsym', waveSym);
  stWSym.value = waveSym;
  stWSymVal.textContent = Math.round(waveSym*100) + '%';
}
stWSym.addEventListener('input', function(){ setWSym(+stWSym.value); });

/* 星云：流星数量 / 中心辉光 / 轨道环 */
var burstN = loadPref('mv.burst', 26)|0;
function setBurst(v){
  burstN = clampN(Math.round(+v || 26), 0, 60);
  savePref('mv.burst', burstN);
  stBurst.value = burstN;
  stBurstVal.textContent = burstN;
}
stBurst.addEventListener('input', function(){ setBurst(+stBurst.value); });

var cGlowOn = loadPref('mv.cglow', 1) === 1;
function setCGlow(on){
  cGlowOn = !!on;
  stCGlow.checked = cGlowOn;
  savePref('mv.cglow', cGlowOn ? 1 : 0);
}
stCGlow.addEventListener('change', function(){ setCGlow(stCGlow.checked); });

var ringsOn = loadPref('mv.rings', 1) === 1;
function setRings(on){
  ringsOn = !!on;
  stRings.checked = ringsOn;
  savePref('mv.rings', ringsOn ? 1 : 0);
}
stRings.addEventListener('change', function(){ setRings(stRings.checked); });

/* 瀑布：下落速度 / 色彩 / 雾化 */
var fallSpd = loadPref('mv.fspd', 1.5);
function setFSpd(v){
  fallSpd = clampN(+v || 1.5, 1, 6);
  savePref('mv.fspd', fallSpd);
  stFSpd.value = fallSpd;
  stFSpdVal.textContent = '×' + fallSpd;
}
stFSpd.addEventListener('input', function(){ setFSpd(+stFSpd.value); });

var fallColor = loadPref('mv.fcolor', 'theme');
function setFColor(v){
  fallColor = v === 'temp' ? 'temp' : 'theme';
  savePref('mv.fcolor', fallColor);
  stFColor.value = fallColor;
  off = null; proOff = null; /* 重建瀑布底色 */
}
stFColor.addEventListener('change', function(){ setFColor(stFColor.value); });

var fallFade = loadPref('mv.ffade', 0.22);
function setFFade(v){
  fallFade = clampN(+v || 0, 0, 0.4);
  savePref('mv.ffade', fallFade);
  stFFade.value = fallFade;
  stFFadeVal.textContent = Math.round(fallFade*100) + '%';
}
stFFade.addEventListener('input', function(){ setFFade(+stFFade.value); });

/* 可视化栏二级标签切换 */
document.querySelectorAll('.viz-tab').forEach(function(t){
  t.addEventListener('click', function(){
    document.querySelectorAll('.viz-tab').forEach(function(x){ x.classList.remove('active'); });
    document.querySelectorAll('.viz-sub').forEach(function(p){ p.classList.remove('active'); });
    t.classList.add('active');
    var sub = $(t.dataset.viz);
    if (sub) sub.classList.add('active');
  });
});

var dotAnim = loadPref('mv.dot', 1) === 1;
function setDotAnim(on){
  dotAnim = !!on;
  stDot.checked = dotAnim;
  savePref('mv.dot', dotAnim ? 1 : 0);
  var dots = document.querySelectorAll('.bc-dot');
  for (var i = 0; i < dots.length; i++) dots[i].style.animationPlayState = dotAnim ? 'running' : 'paused';
}
stDot.addEventListener('change', function(){ setDotAnim(stDot.checked); });

var marqueeOn = loadPref('mv.marquee', 0) === 1;
var marqueeOffset = 0;
setInterval(function(){ /* 标题跑马灯 */
  if (!marqueeOn || current < 0 || !tracks[current]) return;
  var t = tracks[current].name + '　';
  marqueeOffset = (marqueeOffset + 1) % t.length;
  document.title = t.slice(marqueeOffset) + t.slice(0, marqueeOffset);
}, 500);
function setMarquee(on){
  marqueeOn = !!on;
  stMarquee.checked = marqueeOn;
  savePref('mv.marquee', marqueeOn ? 1 : 0);
  if (!marqueeOn && current >= 0 && tracks[current]){
    document.title = tracks[current].name + ' · 音乐可视化';
  }
}
stMarquee.addEventListener('change', function(){ setMarquee(stMarquee.checked); });

/* 播放 */
var idleDelay = loadPref('mv.idle', 3.5);
function setIdle(v){
  idleDelay = clampN(+v || 0, 0, 10);
  savePref('mv.idle', idleDelay);
  stIdle.value = idleDelay;
  stIdleVal.textContent = idleDelay + 's';
  if (idleDelay === 0) body.classList.remove('idle');
}
stIdle.addEventListener('input', function(){ setIdle(+stIdle.value); });

var autoNext = loadPref('mv.autonext', 1) === 1;
function setAutoNext(on){
  autoNext = !!on;
  stAutoNext.checked = autoNext;
  savePref('mv.autonext', autoNext ? 1 : 0);
}
stAutoNext.addEventListener('change', function(){ setAutoNext(stAutoNext.checked); });

var beatReset = loadPref('mv.beatreset', 1) === 1;
function setBeatReset(on){
  beatReset = !!on;
  stBeatReset.checked = beatReset;
  savePref('mv.beatreset', beatReset ? 1 : 0);
}
stBeatReset.addEventListener('change', function(){ setBeatReset(stBeatReset.checked); });

var barStyle = loadPref('mv.barstyle', 'knob');
function setBarStyle(v){
  barStyle = v === 'plain' ? 'plain' : 'knob';
  pKnob.style.display = barStyle === 'knob' ? '' : 'none';
  savePref('mv.barstyle', barStyle);
  stBarStyle.value = barStyle;
}
stBarStyle.addEventListener('change', function(){ setBarStyle(stBarStyle.value); });

var autoOpenPl = loadPref('mv.autoopen', 1) === 1;
function setAutoOpen(on){
  autoOpenPl = !!on;
  stAutoOpen.checked = autoOpenPl;
  savePref('mv.autoopen', autoOpenPl ? 1 : 0);
}
stAutoOpen.addEventListener('change', function(){ setAutoOpen(stAutoOpen.checked); });

/* 导出（全局默认，video-export.js 读取 localStorage） */
function bindSel(id, key, def){
  var el2 = $(id);
  el2.value = loadPref(key, def);
  el2.addEventListener('change', function(){ savePref(key, el2.value); });
}
function bindRange(id, valId, key, def, fmt){
  var el2 = $(id), vEl = $(valId);
  var v = loadPref(key, def);
  el2.value = v; vEl.textContent = fmt(v);
  el2.addEventListener('input', function(){
    savePref(key, el2.value);
    vEl.textContent = fmt(el2.value);
  });
}
/* 预设选择（stPreset 已在上方元素引用区声明） */
stPreset.value = presetState;
stPreset.addEventListener('change', function(){
  presetState = stPreset.value;
  savePref('mv.preset', presetState);
  applyPreset();
});

bindSel('st-yield', 'mv.exp.yield', '60');
bindSel('st-rc', 'mv.exp.rc', 'constant');
bindRange('st-gop', 'st-gop-val', 'mv.exp.gop', 2, function(v){ return (+v) + 's'; });
bindSel('st-preset', 'mv.exp.preset', 'veryfast');
bindSel('st-chroma', 'mv.exp.chroma', '4:2:0');
/* HDR 由下方 checkbox 单独绑定（bindSel 仅用于下拉框） */
stHdr.checked = loadPref('mv.exp.hdr', 0) === '1';
stHdr.addEventListener('change', function(){ savePref('mv.exp.hdr', stHdr.checked ? '1' : '0'); });
bindRange('st-nits', 'st-nits-val', 'mv.exp.nits', 800, function(v){ return String(v); });
stFastStart.checked = loadPref('mv.exp.faststart', 1) === '1';
stFastStart.addEventListener('change', function(){ savePref('mv.exp.faststart', stFastStart.checked ? '1' : '0'); });
bindSel('st-resample', 'mv.exp.resample', '48000');
bindSel('st-channels', 'mv.exp.channels', '0');
bindSel('st-log', 'mv.exp.log', 'quiet');
stCacheBg.checked = loadPref('mv.exp.cachebg', 1) === '1';
stCacheBg.addEventListener('change', function(){ savePref('mv.exp.cachebg', stCacheBg.checked ? '1' : '0'); });

/* 重置 */
stResetBtn.addEventListener('click', function(){
  try {
    var keep = [];
    for (var i = 0; i < localStorage.length; i++){
      var k = localStorage.key(i);
      if (k && k.indexOf('mv.') === 0) keep.push(k);
    }
    keep.forEach(function(k){ localStorage.removeItem(k); });
  } catch(e){}
  toast('已重置，即将刷新…');
  setTimeout(function(){ location.reload(); }, 900);
});

/* 设置面板标签页切换 */
var stTabs = document.querySelectorAll('.st-tab');
stTabs.forEach(function(t){
  t.addEventListener('click', function(){
    stTabs.forEach(function(x){ x.classList.remove('active'); });
    document.querySelectorAll('.st-pane').forEach(function(p){ p.classList.remove('active'); });
    t.classList.add('active');
    var pane = $(t.dataset.pane);
    if (pane) pane.classList.add('active');
  });
});
function toggleSettings(force){
  var open = typeof force === 'boolean' ? force : !settingsEl.classList.contains('open');
  settingsEl.classList.toggle('open', open);
  stBackdrop.classList.toggle('open', open);
}
btnSettings.addEventListener('click', toggleSettings);
stBackdrop.addEventListener('click', function(){ toggleSettings(false); });
stClose.addEventListener('click', function(){ toggleSettings(false); });
stBgPick.addEventListener('click', function(){ bgInput.click(); });
stBgClear.addEventListener('click', clearBackground);
stBlur.addEventListener('input', function(){ setBlur(+stBlur.value); });
stExtract.addEventListener('change', function(){ setBgExtract(stExtract.checked); });
bgInput.addEventListener('change', function(){
  if (bgInput.files && bgInput.files[0]) applyBackgroundFile(bgInput.files[0]);
  bgInput.value = '';
});

