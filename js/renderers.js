/* ================= 渲染：通用 ================= */
/* 反馈式残影：主画布每帧先涂满不透明底色，再以 retain 透明度叠回上一帧。
   retain 必须 < 0.5 —— 8bit 舍入下才能保证亮度差最终衰减到 0，不留永久灰印。 */
var trailCv = document.createElement('canvas');
var trailCtx = trailCv.getContext('2d');
function beginFrame(retain){
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  if (bgUrl){ /* 有背景图：画布保持透明，让 CSS 背景层透出 */
    ctx.clearRect(0, 0, W, H);
  } else {
    ctx.fillStyle = rgbStr(getBg(), 1);
    ctx.fillRect(0, 0, W, H);
  }
  /* 残影回叠：trailCv 与主画布物理尺寸一致，用物理像素 1:1 拷贝。
     注意先把 ctx 变换重置为单位阵，否则 dpr 缩放会把回叠图再放大，
     导致残影以左上角为锚偏移播散（拖尾方向乱偏的根因）。 */
  if (trailCv.width > 0 && trailCv.height > 0){
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = retain;
    ctx.drawImage(trailCv, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
function endFrame(){
  trailCtx.setTransform(1, 0, 0, 1, 0, 0); /* trailCtx 保持单位阵，1:1 物理拷贝 */
  trailCtx.clearRect(0, 0, trailCv.width, trailCv.height);
  trailCtx.drawImage(ctx.canvas, 0, 0); /* 跟随当前 ctx（实时主画布或导出画布） */
}

/* ---------- 模式 1：频谱柱状 ---------- */
var trailVals = new Float32Array(BANDS); /* 频谱专属尾迹值：跟随条形缓慢回落的残影 */
function drawBars(){
  /* 频谱不使用全局反馈残影：条形亮度恒定不受拖尾设置影响，
     拖尾效果由每根条上方独立的渐隐尾迹表现 */
  beginFrame(0);
  var baseline = H*0.88, usable = H*0.72;
  var bw = W/BANDS, barW = Math.max(2, bw*barWidthPct);
  var capH = Math.max(3, Math.round(barW*0.22)); /* 峰值帽厚度随条宽缩放（4K 下可见） */
  var trailFall = 0.06 - trailAmt*0.09;          /* 尾迹回落速度：拖尾越强回落越慢 */
  ctx.globalCompositeOperation = 'lighter';
  for (var i = 0; i < BANDS; i++){
    var v = bandsArr[i]*(1 + 0.10*beatPulse*beatAmt);
    var h = v*usable;
    var x = i*bw + bw/2;
    var t = i/(BANDS-1)*0.9;
    /* 专属尾迹：条形回落时残影从峰顶缓慢跟随，只出现在条形上方 */
    if (v >= trailVals[i]) trailVals[i] = v;
    else trailVals[i] = Math.max(v, trailVals[i] - trailFall);
    if (trailAmt > 0 && trailVals[i] > v){
      ctx.globalAlpha = trailAmt*0.55;
      ctx.fillStyle = colorAt(t);
      ctx.fillRect(x-barW/2, baseline - trailVals[i]*usable, barW, (trailVals[i]-v)*usable);
    }
    /* 主体条形：恒定亮度 */
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = colorAt(t);
    ctx.fillRect(x-barW/2, baseline-h, barW, h);
    /* 地面反射 */
    ctx.globalAlpha = 0.13;
    var rh = reflectOn ? Math.min(h*reflectH, H-baseline-2) : 0;
    if (rh > 0) ctx.fillRect(x-barW/2, baseline+2, barW, rh);
    /* 峰值帽：底边精确锚定在峰值位置 */
    if (peaks[i] < v) peaks[i] = v;
    else peaks[i] = Math.max(0, peaks[i]-peakSpeed);
    ctx.globalAlpha = 1;
    ctx.fillStyle = colorAt(t, 0.95);
    ctx.fillRect(x-barW/2, baseline - peaks[i]*usable - capH, barW, capH);
  }
  ctx.globalCompositeOperation = 'source-over';
}

/* ---------- 模式 2：环形频谱 ---------- */
function radialLine(cx, cy, a, r1, r2){
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(a)*r1, cy + Math.sin(a)*r1);
  ctx.lineTo(cx + Math.cos(a)*r2, cy + Math.sin(a)*r2);
  ctx.stroke();
}
function drawRadial(now){
  beginFrame(trailAmt);
  var cx = W/2, cy = H/2, R = Math.min(W, H);
  var r0 = R*radialR0*(1 + 0.14*beatPulse*beatAmt);
  var maxLen = R*radialLen;
  var half = BANDS >> 1;
  rot += (0.0016 + energy*0.004) * rotAmt * rotDir;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  var lw = Math.max(1.5, (Math.PI*r0/half)*0.42);
  ctx.lineWidth = lw;
  var seam = 0.05; /* 上下接缝处留出的角度空隙 */
  for (var i = 0; i < half; i++){
    var v = bandsArr[i];
    var t = i/(half-1);
    var base = -Math.PI/2 + seam + t*(Math.PI - seam*2);
    var len = v*maxLen*(1 + 0.25*beatPulse*beatAmt) + 2;
    ctx.strokeStyle = colorAt(t*0.85, 0.55 + v*0.45);
    /* 左右两侧镜像，且共用同一个 rot，整环朝同一方向旋转 */
    radialLine(cx, cy, base + rot, r0+5, r0+5+len);
    radialLine(cx, cy, Math.PI - base + rot, r0+5, r0+5+len);
  }
  /* 内圈波形环 */
  var td = timeData || fakeTime;
  ctx.beginPath();
  var n = 180;
  for (i = 0; i <= n; i++){
    var ang = (i/n)*Math.PI*2;
    var s = (td[Math.floor(i/n*(td.length-1))] - 128)/128;
    var r = r0*0.72 + s*r0*0.25;
    var px = cx + Math.cos(ang)*r, py = cy + Math.sin(ang)*r;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.strokeStyle = colorAt(0.7, 0.85);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  /* 内圈描边与中心脉冲 */
  ctx.strokeStyle = colorAt(0.15, 0.9);
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, r0-2, 0, Math.PI*2); ctx.stroke();
  ctx.fillStyle = colorAt(0.5, 0.5 + 0.4*beatPulse);
  ctx.beginPath(); ctx.arc(cx, cy, 3 + beatPulse*9 + level*5, 0, Math.PI*2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

/* ---------- 模式 3：波形律动 ---------- */
var waveHist = [];
function drawWave(){
  beginFrame(trailAmt);
  var td = timeData || fakeTime;
  if (frameCount % 2 === 0){
    waveHist.unshift(Float32Array.from(td));
    if (waveHist.length > waveHistN) waveHist.pop();
  }
  if (!waveHist.length) return;
  var cy = H/2;
  var amp = H*waveAmp*1.07*(0.55 + 0.45*level + 0.22*beatPulse);
  var N = 240;
  for (var li = waveHist.length-1; li >= 0; li--){
    var snap = waveHist[li];
    var isTop = li === 0;
    var k = 1 - li*0.07;
    ctx.beginPath();
    for (var i = 0; i <= N; i++){
      var idx = Math.floor(i/N*(snap.length-1));
      var v = (snap[idx]-128)/128;
      var x = i/N*W;
      if (i) ctx.lineTo(x, cy - v*amp*k); else ctx.moveTo(x, cy - v*amp*k);
    }
    for (i = N; i >= 0; i--){
      idx = Math.floor(i/N*(snap.length-1));
      v = (snap[idx]-128)/128;
      ctx.lineTo(i/N*W, cy + v*amp*k*waveSym);
    }
    ctx.closePath();
    if (isTop){
      var g = ctx.createLinearGradient(0, cy-amp, 0, cy+amp);
      g.addColorStop(0, colorAt(0, 0.30));
      g.addColorStop(0.5, colorAt(0.5, 0.22));
      g.addColorStop(1, colorAt(1, 0.30));
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = colorAt(0.5, 1);
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.strokeStyle = colorAt(0.5, 0.28*(1 - li/waveHist.length));
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

/* ---------- 模式 4：粒子星云 ---------- */
var orbiters = [], bursts = [];
var ORBIT_N = 240; /* 兼容保留（实际数量由 orbCount 控制） */
function spawnOrbiter(){
  orbiters.push({
    band: (Math.random()*BANDS)|0,
    a: Math.random()*Math.PI*2,
    r: 0.35 + Math.random()*0.6,
    av: (0.002 + Math.random()*0.01)*(Math.random() < 0.5 ? -1 : 1),
    size: 1 + Math.random()*2.2,
    tw: Math.random()*Math.PI*2,
    fresh: true, lx: 0, ly: 0
  });
}
function drawParticles(now){
  beginFrame(Math.max(0.4, trailAmt));
  var cx = W/2, cy = H/2, R = Math.min(W, H)/2;
  while (orbiters.length < orbCount) spawnOrbiter();
  while (orbiters.length > orbCount) orbiters.pop();
  var spd = 0.5 + energy*2.2 + beatPulse*1.6;
  ctx.globalCompositeOperation = 'lighter';
  for (var i = 0; i < orbiters.length; i++){
    var p = orbiters[i];
    var v = bandsArr[p.band];
    p.a += p.av*spd*(1 + v);
    var rad = p.r*R*0.85 + v*R*0.22 + Math.sin(now*0.001 + p.tw)*6;
    var x = cx + Math.cos(p.a)*rad, y = cy + Math.sin(p.a)*rad*0.92;
    var s = p.size*(0.6 + v*1.8);
    var al = Math.min(1, 0.25 + v*0.75);
    if (!p.fresh){ /* 运动拖尾：与上一帧位置连线 */
      ctx.strokeStyle = colorAt(p.band/BANDS);
      ctx.globalAlpha = al*0.45;
      ctx.lineWidth = s*1.3;
      ctx.beginPath(); ctx.moveTo(p.lx, p.ly); ctx.lineTo(x, y); ctx.stroke();
    }
    p.fresh = false; p.lx = x; p.ly = y;
    ctx.fillStyle = colorAt(p.band/BANDS);
    ctx.globalAlpha = al*0.22; /* 外圈辉光 */
    ctx.beginPath(); ctx.arc(x, y, s*2.6, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = al;
    ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI*2); ctx.fill();
  }
  if (newBeat){ /* 节拍迸发 */
    for (var k = 0; k < burstN; k++){
      var ba = Math.random()*Math.PI*2;
      var bsp = (2 + Math.random()*6)*(R/400);
      bursts.push({ x:cx, y:cy, vx:Math.cos(ba)*bsp, vy:Math.sin(ba)*bsp, life:1, size:1 + Math.random()*2.5, c:Math.random(), fresh:true, lx:cx, ly:cy });
    }
  }
  for (i = bursts.length-1; i >= 0; i--){
    var b = bursts[i];
    b.x += b.vx; b.y += b.vy;
    b.vx *= 0.965; b.vy *= 0.965;
    b.life -= 0.02;
    if (b.life <= 0){ bursts.splice(i, 1); continue; }
    if (!b.fresh){
      ctx.strokeStyle = colorAt(b.c);
      ctx.globalAlpha = b.life*0.5;
      ctx.lineWidth = Math.max(0.5, b.size*b.life);
      ctx.beginPath(); ctx.moveTo(b.lx, b.ly); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    b.fresh = false; b.lx = b.x; b.ly = b.y;
    ctx.fillStyle = colorAt(b.c);
    ctx.globalAlpha = b.life*0.9;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.size*b.life + 0.4, 0, Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  if (cGlowOn){ /* 中心辉光（可设置关闭） */
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R*0.25);
    g.addColorStop(0, colorAt(0.5, 0.10 + 0.12*beatPulse*beatAmt));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - R*0.25, cy - R*0.25, R*0.5, R*0.5);
  }
}

/* ---------- 模式 5：瀑布热图 ---------- */
var off = null, octx = null, rowH = 2;
function ensureOff(){
  var pw = Math.max(2, Math.round(W*dpr)), ph = Math.max(2, Math.round(H*dpr));
  if (off && off.width === pw && off.height === ph) return;
  off = document.createElement('canvas');
  off.width = pw; off.height = ph;
  octx = off.getContext('2d');
  if (!bgUrl){
    octx.fillStyle = rgbStr(getBg(), 1);
    octx.fillRect(0, 0, pw, ph);
  }
  rowH = Math.max(2, Math.round(1.5*dpr));
}
function drawWaterfall(){
  ensureOff();
  var pw = off.width;
  var rows = Math.max(1, Math.round(fallSpd)); /* 下落速度：每帧移 N 行 */
  octx.drawImage(off, 0, rows*rowH); /* 历史下移 rows 行 */
  /* 移出的区域立即重绘本帧行（避免速度>1 时出现空白带） */
  for (var r2 = rows-1; r2 >= 1; r2--) octx.drawImage(off, 0, (r2-1)*rowH, pw, rowH, 0, r2*rowH, pw, rowH);
  var bandW = pw/BANDS;
  for (var i = 0; i < BANDS; i++){
    var v = bandsArr[i];
    var x = Math.floor(i*bandW), w = Math.ceil(bandW)+1;
    if (v < 0.02){
      if (bgUrl) octx.clearRect(x, 0, w, rowH);
      else { octx.fillStyle = rgbStr(getBg(), 1); octx.fillRect(x, 0, w, rowH); }
    } else {
      /* 色彩模式：主题色渐变（经典）或色温映射（与 Pro 共享设置） */
      if (fallColor === 'temp'){
        var hue = (1-v)*25 + v*210;
        octx.fillStyle = 'hsl('+hue+','+(50+v*35)+'%,'+(40+v*30)+'%)';
      } else {
        octx.fillStyle = colorAt(Math.pow(v, 0.8));
      }
      octx.fillRect(x, 0, w, rowH);
    }
  }
  ctx.drawImage(off, 0, 0, W, H);
}

var renderers = [drawBars, drawRadial, drawWave, drawParticles, drawWaterfall];

/* ============================================================
 * 预设状态与切换
 * classic=经典（当前渲染器），pro=高级预设（Pro 渲染器）。
 * Shift+数字键切换同模式的预设（不占数字键）。
 * ============================================================ */
var presetState = loadPref('mv.preset', 'classic'); /* 'classic' | 'pro' */
function applyPreset(){
  /* 重建 Pro 粒子群（模式切换时 resetVizState 已清空） */
  if (presetState === 'pro') proOrb.length = 0;
}
function getCurrentRenderer(){
  return presetState === 'pro' ? renderersPro : renderers;
}

/* ============================================================
 * Pro 预设渲染器（在经典预设基础上升级，视觉更精致）
 * 模式 1 Pro: 频谱 - 多色渐变条 + 柔光晕 + 条形侧面高光
 * 模式 2 Pro: 环形 - 渐变放射 + 中心脉冲光环 + 强拖尾
 * 模式 3 Pro: 波形 - 双层填充交织 + 呼吸缩放 + 交替填充色
 * 模式 4 Pro: 粒子 - 呼吸脉动 + 低频粒子连线 + 彗尾
 * 模式 5 Pro: 瀑布 - 暖色温渐变 + 底部渐隐 + 中线高光
 * ============================================================ */

/* ---- Pro 频谱：多色渐变条 + 柔和光晕 ---- */
var proTrail = new Float32Array(BANDS);
function drawBarsPro(){
  beginFrame(0); /* 全清（无全局反馈，条形亮度恒定） */
  var baseline = H*0.88, usable = H*0.72;
  var bw = W/BANDS, barW = Math.max(2, bw*barWidthPct);
  var capH = Math.max(4, Math.round(barW*0.24));
  var trailFall = 0.06 - trailAmt*0.09;
  /* 每帧构建一次多色渐变缓存（按频率分布），避免逐条重复构建 */
  var gradMap = [];
  for (var j = 0; j < BANDS; j++){
    var gj = ctx.createLinearGradient(0, baseline-usable, 0, baseline);
    gj.addColorStop(0,   colorAt(j/(BANDS-1) * 0.35 + 0.02));
    gj.addColorStop(0.5, colorAt(j/(BANDS-1) * 0.35 + 0.18));
    gj.addColorStop(1,   colorAt(j/(BANDS-1) * 0.35 + 0.34));
    gradMap.push(gj);
  }
  ctx.globalCompositeOperation = 'lighter';
  for (var i = 0; i < BANDS; i++){
    var v = bandsArr[i]*(1 + 0.10*beatPulse*beatAmt);
    var h = v*usable;
    var x = i*bw + bw/2;
    /* 尾迹 */
    if (v >= proTrail[i]) proTrail[i] = v;
    else proTrail[i] = Math.max(v, proTrail[i] - trailFall);
    if (trailAmt > 0 && proTrail[i] > v){
      ctx.globalAlpha = trailAmt*0.4;
      ctx.fillStyle = colorAt(i/(BANDS-1)*0.35 + 0.18);
      ctx.fillRect(x-barW/2, baseline-proTrail[i]*usable, barW, (proTrail[i]-v)*usable);
    }
    /* 主条：多色垂直渐变（暗底→亮中→稍暗顶） */
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = gradMap[i];
    ctx.fillRect(x-barW/2, baseline-h, barW, h);
    /* 侧面高光（条右侧 2px 亮线，制造立体感） */
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x+barW/2-1.5, baseline-h, 1.5, h);
    /* 峰值帽 */
    if (proTrail[i] < v) proTrail[i] = v;
    else proTrail[i] = Math.max(0, proTrail[i]-peakSpeed);
    ctx.globalAlpha = 1;
    ctx.fillStyle = colorAt(i/(BANDS-1)*0.35 + 0.17);
    ctx.fillRect(x-barW/2, baseline-proTrail[i]*usable-capH, barW, capH);
  }
  ctx.globalCompositeOperation = 'source-over';
}
/* ---- Pro 环形：渐变放射 + 中心脉冲光环 + 强拖尾 ---- */
/* ---- Pro 环形：经典全部元素 + 双层反向旋转 + 频段跳动点 + 发光增强 ---- */
function drawRadialPro(now){
  beginFrame(0.35); /* 残影拖尾，转动的条会留下弧形光痕 */
  var cx = W/2, cy = H/2, R = Math.min(W, H);
  var r0 = R*radialR0*(1 + 0.14*beatPulse*beatAmt);
  var maxLen = R*radialLen;
  var half = BANDS >> 1;
  /* 双层反向旋转：外层频谱正转，整体产生齿轮咬合般的动态张力 */
  rot += (0.0016 + energy*0.004) * rotAmt * rotDir;
  var innerRot = -rot*1.6;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  /* 1. 外层频谱放射条（经典布局：上弧+下弧镜像）+ 发光层 + 顶端跳动点 */
  for (var i = 0; i < half; i++){
    var v = bandsArr[i];
    var t = i/(half-1);
    var base = -Math.PI/2 + 0.05 + t*(Math.PI - 0.1);
    var aR = base + rot;
    var aL = Math.PI - base + rot;
    var len = v*maxLen*(1 + 0.25*beatPulse*beatAmt) + 2;
    var lw = Math.max(1.5, (Math.PI*r0/half)*0.42);
    var c = colorAt(t*0.85, 0.55 + v*0.45);
    /* 发光层（宽线低透明度） */
    if (v > 0.06){
      ctx.globalAlpha = v*0.22;
      ctx.lineWidth = lw*2.8;
      ctx.strokeStyle = c;
      radialLine(cx, cy, aR, r0+4, r0+4+len);
      radialLine(cx, cy, aL, r0+4, r0+4+len);
      ctx.globalAlpha = 1;
    }
    /* 主体条 */
    ctx.lineWidth = lw;
    ctx.strokeStyle = c;
    radialLine(cx, cy, aR, r0+5, r0+5+len);
    radialLine(cx, cy, aL, r0+5, r0+5+len);
    /* 频段跳动点：跟随条顶端的能量光点，节拍时放大 */
    if (v > 0.12){
      var dotR = 1.5 + v*3.5 + beatPulse*beatAmt*1.5;
      ctx.fillStyle = colorAt(t*0.85, 0.9);
      var tx = cx + Math.cos(aR)*(r0+5+len), ty = cy + Math.sin(aR)*(r0+5+len);
      ctx.beginPath(); ctx.arc(tx, ty, dotR, 0, Math.PI*2); ctx.fill();
      var tx2 = cx + Math.cos(aL)*(r0+5+len), ty2 = cy + Math.sin(aL)*(r0+5+len);
      ctx.beginPath(); ctx.arc(tx2, ty2, dotR, 0, Math.PI*2); ctx.fill();
    }
  }
  /* 2. 内圈波形环（经典核心元素！随波形起伏的闭合环，反向旋转） */
  var td = timeData || fakeTime;
  var n = 180;
  var waveR = r0*0.66;
  ctx.beginPath();
  for (i = 0; i <= n; i++){
    var ang = (i/n)*Math.PI*2 + innerRot;
    var s = (td[Math.floor(i/n*(td.length-1))] - 128)/128;
    var rr = waveR + s*waveR*0.5;
    var px = cx + Math.cos(ang)*rr, py = cy + Math.sin(ang)*rr;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.strokeStyle = colorAt(0.7, 0.85);
  ctx.lineWidth = 2;
  ctx.shadowColor = colorAt(0.7, 0.6);
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;
  /* 3. 中层细环（内圈波形环外的静态参照环，随节拍呼吸） */
  ctx.beginPath();
  ctx.arc(cx, cy, r0*0.88, 0, Math.PI*2);
  ctx.strokeStyle = colorAt(0.25, 0.3 + beatPulse*beatAmt*0.25);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  /* 4. 内圈描边（频谱条基座） */
  ctx.beginPath();
  ctx.arc(cx, cy, r0-2, 0, Math.PI*2);
  ctx.strokeStyle = colorAt(0.15, 0.9);
  ctx.lineWidth = 2;
  ctx.stroke();
  /* 5. 中心脉冲点（经典元素，节拍时爆发） */
  var pulseR = 3 + beatPulse*beatAmt*9 + level*5;
  ctx.fillStyle = colorAt(0.5, 0.5 + 0.4*beatPulse*beatAmt);
  ctx.beginPath();
  ctx.arc(cx, cy, pulseR, 0, Math.PI*2);
  ctx.fill();
  /* 中心点光晕 */
  var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseR*4);
  g.addColorStop(0, colorAt(0.5, 0.35));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, pulseR*4, 0, Math.PI*2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}
/* ---- Pro 波形：双层填充交织 + 呼吸缩放 ---- */
function drawWavePro(){
  beginFrame(0.3);
  var td = timeData || fakeTime;
  if (frameCount % 2 === 0){ waveHist.unshift(Float32Array.from(td)); if (waveHist.length > waveHistN+2) waveHist.pop(); }
  if (!waveHist.length) return;
  var cy = H/2;
  var breathe = 1 + level*0.08 + beatPulse*beatAmt*0.05;
  var baseAmp = H*waveAmp;
  /* 交替绘色（奇偶历史层用不同渐变，形成交织） */
  for (var li = waveHist.length-1; li >= 0; li--){
    var snap = waveHist[li];
    var isTop = li === 0;
    var k = (1 - li*0.06) * breathe;
    var amp = baseAmp*k;
    ctx.beginPath();
    var N = 240;
    for (var i = 0; i <= N; i++){
      var v = (snap[Math.floor(i/N*(snap.length-1))]-128)/128;
      if (i) ctx.lineTo(i/N*W, cy - v*amp); else ctx.moveTo(i/N*W, cy - v*amp);
    }
    for (i = N; i >= 0; i--){
      var v2 = (snap[Math.floor(i/N*(snap.length-1))]-128)/128;
      ctx.lineTo(i/N*W, cy + v2*amp*waveSym);
    }
    ctx.closePath();
    if (isTop){
      var g = ctx.createLinearGradient(0, cy-amp, 0, cy+amp);
      g.addColorStop(0,   colorAt(0, 0.35));
      g.addColorStop(0.3, colorAt(0.35, 0.15));
      g.addColorStop(0.7, colorAt(0.35, 0.15));
      g.addColorStop(1,   colorAt(0.7, 0.35));
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = colorAt(0.5, 0.9);
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      var alpha = 0.18*(1-li/waveHist.length);
      ctx.strokeStyle = colorAt(0.5+li*0.05, alpha);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}
/* ---- Pro 粒子：呼吸脉动 + 低频连线 + 彗尾 ---- */
var proOrb = [], proBurst = [];
var PRO_ORB_N = 280;
function spawnProOrb(){
  proOrb.push({
    band: (Math.random()*BANDS)|0, a: Math.random()*Math.PI*2,
    r: 0.35+Math.random()*0.6, av: (0.002+Math.random()*0.01)*(Math.random()<0.5?-1:1),
    size: 1+Math.random()*2.4, tw: Math.random()*Math.PI*2,
    phase: Math.random()*Math.PI*2, // 脉动相位
    depth: 0.4+Math.random()*0.6,   // 深度层次（0远1近）
    drift: (Math.random()-0.5)*0.04, // 轨道微漂移（极小，只打破完全对齐的机械感）
    fresh: true, lx: 0, ly: 0
  });
}
/* ---- Pro 星云：频段轨道环 + 自由漂移粒子 + 彗尾流星群 ----
   轨道环给出层次结构，粒子保留经典的自由感（随机漂移 + 强能量外推）。 */
function drawParticlesPro(now){
  beginFrame(Math.max(0.4, trailAmt)); /* 与经典同强度的全局拖尾 */
  var cx = W/2, cy = H/2, R = Math.min(W, H)/2;
  while (proOrb.length < orbCount) spawnProOrb();
  while (proOrb.length > orbCount) proOrb.pop();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  /* 1. 频段轨道弧：按频段能量画出发光的弧段（唱片层次环）
     只画有能量的频段，弧的位置随时间缓慢流转（可在设置中关闭） */
  var ringGap = R*0.062;
  var orbSpd = 0.4 + energy*1.8 + beatPulse*beatAmt*1.5;
  if (ringsOn) for (var b2 = 0; b2 < BANDS; b2 += 4){ /* 每 4 个频段一道环 */
    var bv = bandsArr[b2];
    if (bv < 0.03) continue;
    var ringR = R*0.22 + (b2/BANDS)*R*0.62;
    var arcLen = 0.25 + bv*1.8;               /* 弧长随能量 */
    var arcPhase = b2*0.7 + now*0.00035*(b2%8<4?1:-1); /* 正反交替流转 */
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, arcPhase, arcPhase+arcLen);
    /* 轨道弧是背景层次，透明度低于粒子，起衬托作用 */
    ctx.strokeStyle = colorAt(b2/BANDS, 0.06 + bv*0.20);
    ctx.lineWidth = 1 + bv*1.8;
    ctx.stroke();
  }
  /* 2. 轨道粒子：频段环给出层次，微漂移打破机械感
     粒子本体 = 强化版（用户确认的参数）：能量膨胀 + 三层光晕 + 白色过曝核 */
  for (var i = 0; i < proOrb.length; i++){
    var p = proOrb[i];
    var v = bandsArr[p.band];
    p.a += p.av*orbSpd*(0.6+v*2);
    /* 轨道半径 = 频段环 ×（1+微漂移）+ 能量外推 + 呼吸微动 */
    var bandR = R*0.22 + (p.band/BANDS)*R*0.62;
    var rad = bandR*(1+p.drift) + v*R*0.12 + Math.sin(now*0.001+p.tw)*4;
    var x = cx+Math.cos(p.a)*rad, y = cy+Math.sin(p.a)*rad*0.94;
    /* 强化版尺寸：能量膨胀系数 0.8+v×2.2，depth 微调层次 */
    var s = p.size*(0.6 + p.depth*0.5)*(0.8 + v*2.2);
    var al = Math.min(1, (0.25+p.depth*0.6)*(0.35+v*0.65));
    /* 彗尾（强化版：阈值 0.03、随能量增亮、尾宽加大）
       方向必须沿「上一帧真实位置 → 当前位置」反向延长（经典同款做法），
       不能按轨道角度推算尾起点 —— Pro 粒子半径随能量外推（v*R*0.12），
       能量起伏时半径逐帧跳动，角度推算的起点会脱离真实轨迹，尾方向乱偏 */
    if (!p.fresh && v > 0.03){
      var mdx = x - p.lx, mdy = y - p.ly;
      var md = Math.sqrt(mdx*mdx + mdy*mdy);
      if (md > 0.3){ /* 几乎静止时不画尾，避免原地长尾 */
        var tl = md*(1.6 + v*4);
        var tx = x - mdx/md*tl, ty = y - mdy/md*tl;
        ctx.strokeStyle = colorAt(p.band/BANDS);
        ctx.globalAlpha = Math.min(1, al*(0.15+v*0.6));
        ctx.lineWidth = s*1.3;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
      }
    }
    p.fresh = false; p.lx = x; p.ly = y;
    /* 三层光晕 + 亮核（强化版） */
    var col = colorAt(p.band/BANDS);
    ctx.fillStyle = col;
    /* 外层大光晕（4.2 倍半径，能量越足越大越亮） */
    ctx.globalAlpha = al*0.10*(0.5+v);
    ctx.beginPath(); ctx.arc(x, y, s*4.2, 0, Math.PI*2); ctx.fill();
    /* 中层光晕 */
    ctx.globalAlpha = al*0.22*(0.6+v*0.6);
    ctx.beginPath(); ctx.arc(x, y, s*2.4, 0, Math.PI*2); ctx.fill();
    /* 亮核 */
    ctx.globalAlpha = al;
    ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI*2); ctx.fill();
    /* 白色过曝核：能量 >35% 时中心叠白，发光感的关键 */
    if (v > 0.35){
      ctx.globalAlpha = al*(v-0.35)*1.2;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y, s*0.55, 0, Math.PI*2); ctx.fill();
    }
  }
  /* 3. 节拍流星环：节拍时从中心射出一圈流星（旋转散射） */
  if (newBeat && burstN > 0){
    var meteorBase = Math.random()*Math.PI*2;
    var meteorN = Math.max(8, Math.round(burstN*0.85));
    for (var k = 0; k < meteorN; k++){
      var mAng = meteorBase + (k/meteorN)*Math.PI*2;
      proBurst.push({
        x: cx, y: cy,
        vx: Math.cos(mAng)*(1.5+Math.random()*4)*(R/400),
        vy: Math.sin(mAng)*(1.5+Math.random()*4)*(R/400),
        life: 1, size: 1.2+Math.random()*2.6, c: 0.2+Math.random()*0.6,
        fresh: true, lx: cx, ly: cy
      });
    }
  }
  for (i = proBurst.length-1; i >= 0; i--){
    var mb = proBurst[i];
    mb.x+=mb.vx; mb.y+=mb.vy; mb.vx*=0.965; mb.vy*=0.965; mb.life-=0.016;
    if (mb.life<=0){ proBurst.splice(i,1); continue; }
    /* 流星尾 */
    if (!mb.fresh){
      ctx.strokeStyle = colorAt(mb.c);
      ctx.globalAlpha = mb.life*0.55;
      ctx.lineWidth = mb.size*mb.life*0.9;
      ctx.beginPath(); ctx.moveTo(mb.lx, mb.ly); ctx.lineTo(mb.x, mb.y); ctx.stroke();
    }
    mb.fresh=false; mb.lx=mb.x; mb.ly=mb.y;
    ctx.fillStyle = colorAt(mb.c);
    ctx.globalAlpha = mb.life*0.9;
    ctx.beginPath(); ctx.arc(mb.x, mb.y, mb.size*mb.life, 0, Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  /* 4. 中心辉光（节拍呼吸，可设置关闭） */
  if (cGlowOn){
    var g = ctx.createRadialGradient(cx,cy,0,cx,cy,R*0.20);
    g.addColorStop(0, colorAt(0.5, 0.12 + beatPulse*beatAmt*0.18));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx-R*0.20, cy-R*0.20, R*0.4, R*0.4);
  }
}
/* ---- Pro 瀑布：暖色温渐变 + 底部渐隐 ---- */
var proOff = null, proOctx = null, proRowH = 2;
function ensureProOff(){
  var pw = Math.max(2, Math.round(W*dpr)), ph = Math.max(2, Math.round(H*dpr));
  if (proOff && proOff.width === pw && proOff.height === ph) return;
  proOff = document.createElement('canvas');
  proOff.width = pw; proOff.height = ph;
  proOctx = proOff.getContext('2d');
  if (!bgUrl){ proOctx.fillStyle = rgbStr(getBg(),1); proOctx.fillRect(0,0,pw,ph); }
  proRowH = Math.max(2, Math.round(1.5*dpr));
}
function drawWaterfallPro(){
  ensureProOff();
  var pw = proOff.width;
  var rows = Math.max(1, Math.round(fallSpd)); /* 下落速度（设置） */
  proOctx.drawImage(proOff, 0, rows*proRowH);
  for (var r2 = rows-1; r2 >= 1; r2--) proOctx.drawImage(proOff, 0, (r2-1)*proRowH, pw, proRowH, 0, r2*proRowH, pw, proRowH);
  var bandW = pw/BANDS;
  for (var i = 0; i < BANDS; i++){
    var v = bandsArr[i];
    var x = Math.floor(i*bandW), w = Math.ceil(bandW)+1;
    if (v < 0.02){
      if (bgUrl) proOctx.clearRect(x,0,w,proRowH);
      else { proOctx.fillStyle = rgbStr(getBg(),1); proOctx.fillRect(x,0,w,proRowH); }
    } else if (fallColor === 'temp'){
      /* 暖色温映射：高频用浅蓝，低频用暖橙，饱和度随能量增强 */
      var hue = (1-v)*25 + v*210;  /* 25°(橙)~210°(蓝) */
      var sat = 50 + v*35;
      var lit = 40 + v*30;
      proOctx.fillStyle = 'hsl('+hue+','+sat+'%,'+lit+'%)';
      proOctx.fillRect(x, 0, w, proRowH);
    } else {
      /* 主题色渐变（设置可选，与经典共享） */
      proOctx.fillStyle = colorAt(Math.pow(v, 0.8));
      proOctx.fillRect(x, 0, w, proRowH);
    }
  }
  /* 底部渐隐遮罩：高度可设置（0 = 关闭） */
  if (fallFade > 0.01){
    var fadeH = Math.round(proOff.height * fallFade);
    var fg = proOctx.createLinearGradient(0, proOff.height-fadeH, 0, proOff.height);
    var bgc = getBg();
    fg.addColorStop(0, 'rgba('+bgc[0]+','+bgc[1]+','+bgc[2]+',0)');
    fg.addColorStop(1, 'rgba('+bgc[0]+','+bgc[1]+','+bgc[2]+',1)');
    proOctx.fillStyle = fg;
    proOctx.fillRect(0, proOff.height-fadeH, proOff.width, fadeH);
  }
  /* 中线高光 */
  var midY = Math.round(proOff.height*0.48);
  var mG = proOctx.createLinearGradient(0, midY-2, 0, midY+2);
  mG.addColorStop(0, 'rgba(255,255,255,0)');
  mG.addColorStop(0.5, 'rgba(255,255,255,0.07)');
  mG.addColorStop(1, 'rgba(255,255,255,0)');
  proOctx.fillStyle = mG;
  proOctx.fillRect(0, midY-2, proOff.width, 4);
  ctx.drawImage(proOff, 0, 0, W, H);
}
/* renderersPro 数组 */
var renderersPro = [drawBarsPro, drawRadialPro, drawWavePro, drawParticlesPro, drawWaterfallPro];
