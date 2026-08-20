/* ================= 启动 ================= */
btnPrev.innerHTML = ICONS.prev;
btnNext.innerHTML = ICONS.next;
btnPl.innerHTML = ICONS.list;
$('btn-add').innerHTML = ICONS.plus;
$('btn-add').addEventListener('click', function(){ fileInput.click(); });
btnFs.innerHTML = ICONS.fs;
btnSens.innerHTML = ICONS.signal;
btnBlogger.innerHTML = ICONS.video;
btnSettings.innerHTML = ICONS.gear;
btnRender.innerHTML = ICONS.film;
var btnPreset = $('btn-preset');
btnPreset.innerHTML = ICONS.star;
btnPreset.classList.toggle('on', presetState === 'pro');
btnPreset.addEventListener('click', function(){
  presetState = presetState === 'pro' ? 'classic' : 'pro';
  savePref('mv.preset', presetState);
  applyPreset();
  btnPreset.classList.toggle('on', presetState === 'pro');
  stPreset.value = presetState;
  toast(presetState === 'pro' ? '预设: Pro（高级视觉）' : '预设: 经典');
});
buildModeButtons();
buildThemeDots();
setMode(mode);
setTheme(themeIdx);
setVol(clampN(loadPref('mv.vol', 0.85), 0, 1));
setSens(sens);
setBlur(blurAmt);
setDim(dimAmt);
setTrail(trailAmt);
setPeak(peakSpeed);
setBeat(beatAmt);
setRot(rotAmt);
setOrb(orbCount);
setSmooth(smoothAmt);
setReflect(reflectOn);
setBarW(barWidthPct);
setRh(reflectH);
setRotDir(String(rotDir));
setR0(radialR0);
setRLen(radialLen);
setWAmp(waveAmp);
setWHist(waveHistN);
setWSym(waveSym);
setBurst(burstN);
setCGlow(cGlowOn);
setRings(ringsOn);
setFSpd(fallSpd);
setFColor(fallColor);
setFFade(fallFade);
setDotAnim(dotAnim);
setMarquee(marqueeOn);
setIdle(idleDelay);
setAutoNext(autoNext);
setBeatReset(beatReset);
setBarStyle(barStyle);
setAutoOpen(autoOpenPl);
setOvScale(ovScale);
setBgExtract(bgExtract);
try {
  var savedBg = localStorage.getItem('mv.bg');
  if (savedBg) setBgDataUrl(savedBg, true);
} catch(e){}
if (loadPref('mv.blogger', 0)){
  bloggerOn = true;
  body.classList.add('blogger');
  btnBlogger.classList.add('on');
}
applyBlLayout();
updatePlayBtn();
updateVolUI();
updateSongInfo();
renderPlaylist();
resize();
requestAnimationFrame(frame);

