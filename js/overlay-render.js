/* ============================================================
 * overlay-render.js —— 博主模式信息层的离线 canvas 复刻
 * 将 DOM+CSS 实现的博主模式信息层（dispersed 分散式 / top 顶部卡片）
 * 用 2D 绘图复刻到导出视频的每一帧上，规格与 index.html 内 CSS 一致。
 * ============================================================ */
(function (global) {
'use strict';

var FONT = "'Microsoft YaHei','PingFang SC',sans-serif";

function hexToRgb(h){
  var c = [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  return c;
}

/* 文字截断：超 maxWidth 时截断并加省略号 */
function clipText(ctx, text, maxWidth){
  if (ctx.measureText(text).width <= maxWidth) return text;
  var ell = '…';
  var lo = 0, hi = text.length;
  while (lo < hi){
    var mid = (lo + hi) >> 1;
    if (ctx.measureText(text.slice(0, mid) + ell).width <= maxWidth) lo = mid + 1;
    else hi = mid;
  }
  return text.slice(0, Math.max(0, lo - 1)) + ell;
}

/* m:ss 格式化（与主程序 fmt 一致） */
function fmtClock(s){
  s = Math.max(0, Math.floor(s));
  var m = Math.floor(s/60), r = s%60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}

/* 玻璃小条（对应 .bd-chip） */
function chip(ctx, x, y, w, h){
  ctx.beginPath();
  /* +0.5 对齐像素，1px 描边不发虚 */
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 10);
  ctx.fillStyle = 'rgba(13,12,24,0.55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r){
  if (w < 2*r) r = w/2;
  if (h < 2*r) r = h/2;
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* 呼吸圆点（对应 .bc-dot，周期 1600ms） */
function drawDot(ctx, cx, cy, color, curMs){
  var phi = 2*Math.PI * (curMs % 1600) / 1600;
  var r = 3.5 * (0.975 + 0.175*Math.sin(phi));
  var alpha = 0.675 + 0.325*Math.sin(phi);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();
}

/* 设置字距（Chromium 支持 ctx.letterSpacing），返回复位函数 */
function setSpacing(ctx, px){
  if (!('letterSpacing' in ctx)) return function(){};
  ctx.letterSpacing = px + 'px';
  return function(){ ctx.letterSpacing = '0px'; };
}

/* 进度条（轨道 + 渐变填充，可选旋钮） */
function progressBar(ctx, x, y, w, pct, c1, c2, knob){
  var h = 4, r = 2;
  /* 轨道 */
  ctx.beginPath();
  roundRect(ctx, x, y - h/2, w, h, r);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fill();
  /* 填充 */
  var fw = Math.max(0, Math.min(1, pct)) * w;
  if (fw > 0){
    var g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.save();
    ctx.shadowColor = c2;
    ctx.shadowBlur = 10;
    ctx.fillStyle = g;
    ctx.beginPath();
    roundRect(ctx, x, y - h/2, fw, h, r);
    ctx.fill();
    ctx.restore();
  }
  /* 旋钮 */
  if (knob){
    var kx = x + Math.max(0, Math.min(1, pct)) * w;
    ctx.save();
    ctx.shadowColor = c2;
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(kx, y, 6, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
}

/* ============================================================
 * dispersed：四角分散 + 底部悬浮进度条
 * ============================================================ */
function drawDispersed(ctx, W, H, info){
  var c1 = info.colors[0], c2 = info.colors[1];
  var curS = info.curMs/1000, durS = info.durMs/1000;

  /* --- 底部悬浮进度条（先画，最底层） --- */
  var pw = Math.min(860, 0.72*W);
  var py = H - 42;
  progressBar(ctx, (W - pw)/2, py, pw, durS > 0 ? curS/durS : 0, c1, c2, true);

  /* --- 左上：状态 + 歌名 --- */
  var padV = 9, padH = 16, gap = 10;
  ctx.font = '10px ' + FONT;
  var stW = ctx.measureText(info.stateText).width;
  ctx.font = 'bold 18px ' + FONT;
  var maxTitleW = 0.46*W - padH*2 - 14 - gap - stW - gap;
  var title = clipText(ctx, info.title, Math.max(30, maxTitleW));
  var tw = ctx.measureText(title).width;
  var chipW = padH*2 + 14 + gap + stW + gap + tw;
  var chipH = 18 + padV*2; /* 文字 18px 行高 + 内边距 */
  chip(ctx, 24, 20, chipW, chipH);
  var cy = 20 + chipH/2;
  drawDot(ctx, 24 + padH + 7, cy, c2, info.curMs);
  var tx = 24 + padH + 14 + gap;
  var reset = setSpacing(ctx, 2);
  ctx.font = '10px ' + FONT;
  ctx.fillStyle = c2;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(info.stateText, tx, cy + 0.5);
  reset();
  ctx.font = 'bold 18px ' + FONT;
  ctx.fillStyle = '#ffffff';
  ctx.save();
  ctx.shadowColor = c1;
  ctx.shadowBlur = 16;
  ctx.fillText(title, tx + stW + gap, cy + 1);
  ctx.restore();

  /* --- 右上：序号 --- */
  if (info.index){
    ctx.font = '12px ' + FONT;
    ctx.fillStyle = '#cfcbe4';
    var iw = ctx.measureText(info.index).width;
    chip(ctx, W - 24 - iw - 24, 24, iw + 24, 12 + 12);
    ctx.textAlign = 'center';
    ctx.fillText(info.index, W - 24 - (iw + 24)/2, 24 + 12 + 0.5);
  }

  /* --- 左下：时间 --- */
  var timeText = fmtClock(curS) + ' / ' + fmtClock(durS);
  ctx.font = '12px ' + FONT;
  ctx.fillStyle = '#e6e2f7';
  var tw2 = ctx.measureText(timeText).width;
  var ty = H - 18 - 24;
  chip(ctx, 24, ty, tw2 + 24, 24);
  ctx.textAlign = 'center';
  ctx.fillText(timeText, 24 + (tw2 + 24)/2, ty + 12 + 0.5);

  /* --- 右下：下一首 --- */
  if (info.next){
    ctx.font = '11px ' + FONT;
    ctx.fillStyle = '#9b96b8';
    var maxNw = 0.44*W - 24;
    var next = clipText(ctx, info.next, maxNw);
    var nw = ctx.measureText(next).width;
    var ny = H - 18 - 24;
    chip(ctx, W - 24 - nw - 24, ny, nw + 24, 24);
    ctx.textAlign = 'center';
    ctx.fillText(next, W - 24 - (nw + 24)/2, ny + 12 + 0.5);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/* ============================================================
 * top：顶部居中卡片
 * ============================================================ */
function drawTopCard(ctx, W, H, info){
  var c1 = info.colors[0], c2 = info.colors[1];
  var curS = info.curMs/1000, durS = info.durMs/1000;

  var cw = Math.min(640, 0.88*W);
  var cx0 = (W - cw)/2;
  var cardH = 18 + 11 + 8 + 24 + 13 + 4 + 6 + 11 + 11 + 12 + 16;
  /* 卡片背景 */
  ctx.beginPath();
  roundRect(ctx, cx0 + 0.5, 34 + 0.5, cw - 1, cardH - 1, 18);
  ctx.fillStyle = 'rgba(10,9,20,0.55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.stroke();

  var padH = 28;
  var x = cx0 + padH;
  var innerW = cw - padH*2;
  var y = 34 + 18; /* 内容起点（内边距上 18） */

  /* 第一行：圆点 + 状态 */
  drawDot(ctx, x + 7, y + 5, c2, info.curMs);
  var reset = setSpacing(ctx, 3);
  ctx.font = '11px ' + FONT;
  ctx.fillStyle = c2;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(info.stateText, x + 14 + 7, y + 5.5);
  reset();
  y += 11 + 8;

  /* 歌名 */
  ctx.font = 'bold 24px ' + FONT;
  var title = clipText(ctx, info.title, innerW);
  ctx.fillStyle = '#ffffff';
  ctx.save();
  ctx.shadowColor = c1;
  ctx.shadowBlur = 22;
  ctx.fillText(title, x, y + 12);
  ctx.restore();
  y += 24 + 13;

  /* 进度条（无旋钮） */
  progressBar(ctx, x, y, innerW, durS > 0 ? curS/durS : 0, c1, c2, false);
  y += 4 + 6;

  /* 时间行 */
  ctx.font = '11px ' + FONT;
  ctx.fillStyle = '#9b96b8';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(fmtClock(curS), x, y + 8);
  ctx.textAlign = 'right';
  ctx.fillText(fmtClock(durS), x + innerW, y + 8);
  y += 11 + 11;

  /* 元信息行 */
  ctx.font = '12px ' + FONT;
  ctx.fillStyle = '#8b86a8';
  ctx.textAlign = 'left';
  if (info.index) ctx.fillText(info.index, x, y + 9);
  if (info.next){
    ctx.textAlign = 'right';
    var next = clipText(ctx, info.next, innerW*0.62);
    ctx.fillText(next, x + innerW, y + 9);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/* ============================================================
 * 入口
 * ============================================================ */
function draw(ctx, W, H, layout, info){
  if (!layout) return;
  if (!info || !info.colors || info.colors.length < 2) return;
  ctx.save();
  try {
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    if (layout === 'dispersed') drawDispersed(ctx, W, H, info);
    else if (layout === 'top') drawTopCard(ctx, W, H, info);
  } finally {
    ctx.restore();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha = 1;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }
}

global.MVOverlayRender = { draw: draw };

})(typeof window !== 'undefined' ? window : globalThis);
