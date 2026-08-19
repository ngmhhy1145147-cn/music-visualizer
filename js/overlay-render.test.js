/* overlay-render.test.js —— node js/overlay-render.test.js */
'use strict';
require('./overlay-render.js');
var MVO = globalThis.MVOverlayRender;

var pass = 0, fail = 0;
function check(name, cond, detail){
  if (cond){ pass++; console.log('PASS ' + name + (detail ? ' (' + detail + ')' : '')); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' (' + detail + ')' : '')); }
}

/* ---------- mock ctx ---------- */
function makeMockCtx(){
  var calls = { fillText: [], fillRect: 0, strokeRect: 0, arc: 0, save: 0, restore: 0, drawImage: 0 };
  var ctx = new Proxy({
    measureText: function(t){ return { width: String(t).length * 8 }; },
    createLinearGradient: function(){ return { addColorStop: function(){} }; },
    save: function(){ calls.save++; },
    restore: function(){ calls.restore++; },
    fillText: function(t, x, y){ calls.fillText.push(String(t)); },
    fillRect: function(){ calls.fillRect++; },
    beginPath: function(){},
    closePath: function(){},
    moveTo: function(){},
    lineTo: function(){},
    arcTo: function(){},
    arc: function(){ calls.arc++; },
    stroke: function(){},
    fill: function(){},
    shadowBlur: 0,
    shadowColor: '',
    globalAlpha: 1,
    letterSpacing: '0px'
  }, {
    get: function(target, prop){
      if (prop in target) return target[prop];
      return function(){}; /* 任意未知方法 no-op */
    },
    set: function(target, prop, v){ target[prop] = v; return true; }
  });
  return { ctx: ctx, calls: calls };
}

var INFO = {
  title: '测试歌曲', stateText: '正在播放', index: '01 / 05',
  next: '下一首 · 下一首歌', curMs: 65000, durMs: 180000,
  colors: ['#3b82f6', '#6366f1']
};

/* ---------- 测试 1：layout=null 不绘制 ---------- */
(function(){
  var m = makeMockCtx();
  MVO.draw(m.ctx, 1920, 1080, null, INFO);
  check('1.1 null 布局零绘制', m.calls.fillText.length === 0 && m.calls.arc === 0 && m.calls.fillRect === 0 && m.calls.strokeRect === 0);
})();

/* ---------- 测试 2：两种布局正常绘制 ---------- */
(function(){
  var m1 = makeMockCtx();
  MVO.draw(m1.ctx, 1920, 1080, 'dispersed', INFO);
  check('2.1 dispersed 不抛异常', true);
  check('2.2 dispersed fillText ≥ 2', m1.calls.fillText.length >= 2, 'got ' + m1.calls.fillText.length);
  check('2.3 dispersed 有 arc（圆点/旋钮）', m1.calls.arc >= 2, 'got ' + m1.calls.arc);
  check('2.4 dispersed restore ≥ save', m1.calls.restore >= m1.calls.save, m1.calls.save + '/' + m1.calls.restore);

  var m2 = makeMockCtx();
  MVO.draw(m2.ctx, 1920, 1080, 'top', INFO);
  check('2.5 top 不抛异常', true);
  check('2.6 top fillText ≥ 2', m2.calls.fillText.length >= 2, 'got ' + m2.calls.fillText.length);
  check('2.7 top 有 arc', m2.calls.arc >= 1, 'got ' + m2.calls.arc);
  check('2.8 top restore ≥ save', m2.calls.restore >= m2.calls.save, m2.calls.save + '/' + m2.calls.restore);
})();

/* ---------- 测试 3：超长歌名截断 ---------- */
(function(){
  var longInfo = Object.assign({}, INFO, { title: '曲'.repeat(500) });
  var m = makeMockCtx();
  MVO.draw(m.ctx, 1920, 1080, 'dispersed', longInfo);
  var longest = Math.max.apply(null, m.calls.fillText.map(function(t){ return t.length; }));
  check('3.1 超长歌名被截断（< 500）', longest < 500, 'longest=' + longest);

  var m2 = makeMockCtx();
  MVO.draw(m2.ctx, 1920, 1080, 'top', longInfo);
  var longest2 = Math.max.apply(null, m2.calls.fillText.map(function(t){ return t.length; }));
  check('3.2 top 超长歌名被截断', longest2 < 500, 'longest=' + longest2);
})();

/* ---------- 测试 4：状态污染复位 ---------- */
(function(){
  var m = makeMockCtx();
  MVO.draw(m.ctx, 1920, 1080, 'dispersed', INFO);
  check('4.1 shadowBlur 复位为 0', m.ctx.shadowBlur === 0, 'got ' + m.ctx.shadowBlur);
  check('4.2 globalAlpha 复位为 1', m.ctx.globalAlpha === 1, 'got ' + m.ctx.globalAlpha);
  check('4.3 letterSpacing 复位', m.ctx.letterSpacing === '0px', 'got ' + m.ctx.letterSpacing);
})();

/* ---------- 测试 5：空 next/index 分支 ---------- */
(function(){
  var bare = Object.assign({}, INFO, { next: '', index: '' });
  var m = makeMockCtx();
  MVO.draw(m.ctx, 1920, 1080, 'dispersed', bare);
  check('5.1 空 next/index 正常', m.calls.fillText.length >= 2);
})();

console.log('\n结果: ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
