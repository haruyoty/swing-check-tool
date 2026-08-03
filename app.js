/* ============================================================================
 * app.js — 画面の制御
 * ==========================================================================*/

const $ = id => document.getElementById(id);

const els = {
  dropzone: $('dropzone'),
  fileInput: $('fileInput'),
  video: $('video'),
  analyzeBtn: $('analyzeBtn'),
  progress: $('progress'),
  barFill: $('barFill'),
  progressText: $('progressText'),
  error: $('error'),
  setup: $('setup'),
  result: $('result'),
  captureBtn: $('captureBtn'),
  captureInput: $('captureInput'),
  videoInput: $('videoInput'),
  photoInput: $('photoInput'),
  photoGrid: $('photoGrid'),
  phases: $('phases'),
  videoSlot: $('videoSlot'),
  videoCard: $('videoCard'),
  videoHolder: $('videoHolder'),
  videoNav: $('videoNav'),
  videoNotes: $('videoNotes'),
  rangeBox: $('rangeBox'),
  rangeReadout: $('rangeReadout'),
  setStart: $('setStart'),
  setEnd: $('setEnd'),
  autoRange: $('autoRange'),
  clearRange: $('clearRange'),
  scoreRing: $('scoreRing'),
  scoreNum: $('scoreNum'),
  summaryTitle: $('summaryTitle'),
  summaryBody: $('summaryBody'),
  modeNote: $('modeNote'),
  priorities: $('priorities'),
  contactLinks: $('contactLinks'),
  contactPhoto: $('contactPhoto'),
  contactPhotoImg: $('contactPhotoImg'),
  lessonCard: $('lessonCard'),
  lessonFor: $('lessonFor'),
  lessonHolder: $('lessonHolder'),
  clubName: $('clubName'),
  refNote: $('refNote'),
  refTable: $('refTable'),
  refFrame: $('refFrame'),
  wholeItems: $('wholeItems'),
  rediagnoseBox: $('rediagnoseBox'),
  rediagnoseBtn: $('rediagnoseBtn'),
  resetBtn: $('resetBtn')
};

/** 1 回の診断で紹介するレッスン動画の本数（優先課題のいちばん上から） */
const MAX_LESSONS = 1;

/** キーフレームを表示する順番 */
const PHASE_ORDER = ['address', 'takeaway', 'backswing', 'top', 'downswing', 'impact', 'follow', 'finish'];

let poseInstance = null;
let videoReady = false;

/** 写真モードで読み込んだ画像。{ address: HTMLImageElement, ... } */
const photos = {};

/** 手で指定した解析範囲（秒）。null なら自動で探す */
let manualRange = null;

/** 診断結果の状態。キーフレームを手で直したときに再計算するために保持する */
let current = null;

/* --------------------------- 参考レッスン動画の選択 -----------------------
 * 同じ項目でも解析するたびに違う動画を出します。ランダムだと連続して同じものが
 * 出ることがあるので、前回どこまで出したかをブラウザに覚えさせて順に送ります。
 * 1回の解析の中では固定し、コマ送りで診断し直しても動画は変わりません。
 * ------------------------------------------------------------------------*/
let lessonPicks = {};

function newLessonRotation() { lessonPicks = {}; }

function pickLesson(id, status) {
  const key = `${id}:${status}`;
  if (!(key in lessonPicks)) lessonPicks[key] = lessonVideo(id, status, advanceLesson(key));
  return lessonPicks[key];
}

/** その項目を何回目に出すかを返し、次回のために 1 つ進める */
function advanceLesson(key) {
  const store = 'swingTool.lesson.' + key;
  let n = 0;
  try {
    n = parseInt(localStorage.getItem(store), 10);
    if (!isFinite(n)) n = 0;
    localStorage.setItem(store, String(n + 1));
  } catch (e) {
    n = Math.floor(Math.random() * 1000);   // localStorage が使えない環境ではランダムに
  }
  return n;
}

const selected = name => document.querySelector(`input[name="${name}"]:checked`).value;

/* ------------------------------ 入力方法の切替 ---------------------------- */

document.querySelectorAll('input[name="mode"]').forEach(r =>
  r.addEventListener('change', switchMode));

function switchMode() {
  const photoMode = selected('mode') === 'photo';
  els.videoInput.hidden = photoMode;
  els.photoInput.hidden = !photoMode;
  hideError();
  updateAnalyzeButton();
}

function updateAnalyzeButton() {
  els.analyzeBtn.disabled = selected('mode') === 'photo' ? !photos.address : !videoReady;
}

/* --------------------------- 写真スロットの組み立て ----------------------- */

function buildPhotoSlots() {
  els.photoGrid.innerHTML = '';
  for (const phase of PHASE_ORDER) {
    const slot = document.createElement('label');
    slot.className = 'photo-slot';
    slot.dataset.phase = phase;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.hidden = true;
    input.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) loadPhoto(phase, file, slot);
    });

    const thumb = document.createElement('span');
    thumb.className = 'ps-thumb';
    thumb.textContent = '＋';

    const label = document.createElement('span');
    label.className = 'ps-label';
    label.textContent = PHASE_LABELS[phase];
    if (phase === 'address') {
      const req = document.createElement('em');
      req.textContent = '必須';
      label.appendChild(req);
    }

    slot.append(input, thumb, label);
    els.photoGrid.appendChild(slot);
  }
}
buildPhotoSlots();

/* ------------------------------ 解析範囲の指定 ---------------------------- */

const fmtSec = t => `${t.toFixed(1)} 秒`;

function setRange(from, to, label) {
  if (from > to) [from, to] = [to, from];
  manualRange = { from, to, scanned: false, manual: true, label };
  showRange();
}

function showRange() {
  if (!manualRange) {
    els.rangeReadout.textContent = '範囲の指定なし（解析するときに自動で探します）';
    els.rangeReadout.classList.remove('set');
    return;
  }
  const { from, to } = manualRange;
  els.rangeReadout.textContent =
    `${manualRange.label || '解析範囲'}: ${fmtSec(from)} 〜 ${fmtSec(to)}（${(to - from).toFixed(1)} 秒間）`;
  els.rangeReadout.classList.add('set');
}

els.setStart.addEventListener('click', () => {
  const to = manualRange ? manualRange.to : Math.min(els.video.duration, els.video.currentTime + 4.5);
  setRange(els.video.currentTime, to, '手で指定');
});
els.setEnd.addEventListener('click', () => {
  const from = manualRange ? manualRange.from : Math.max(0, els.video.currentTime - 4.5);
  setRange(from, els.video.currentTime, '手で指定');
});
els.clearRange.addEventListener('click', () => { manualRange = null; showRange(); });

els.autoRange.addEventListener('click', async () => {
  els.autoRange.disabled = true;
  els.rangeReadout.textContent = '骨格検出モデルを読み込んでいます…';
  try {
    const pose = await getPose();
    pose.setOptions({ smoothLandmarks: false });
    const r = await findSwingWindow(els.video, pose, p => {
      els.rangeReadout.textContent = `スイングの位置を探しています… ${Math.round(p * 100)}%`;
    });
    setRange(r.from, r.to, r.scanned ? '自動検出' : '動画全体');
    // 見つかった位置を確認できるよう、その頭に頭出しする
    els.video.currentTime = r.from;
  } catch (e) {
    showError('スイングの位置を探せませんでした。手で範囲を指定してください。');
    showRange();
  } finally {
    els.autoRange.disabled = false;
  }
});

function loadPhoto(phase, file, slot) {
  if (!file.type.startsWith('image/')) {
    showError('画像ファイルを選んでください。');
    return;
  }
  hideError();
  const img = new Image();
  img.onload = () => {
    photos[phase] = img;
    const thumb = slot.querySelector('.ps-thumb');
    thumb.textContent = '';
    thumb.style.backgroundImage = `url("${img.src}")`;
    slot.classList.add('filled');
    updateAnalyzeButton();
  };
  img.onerror = () => showError(`${PHASE_LABELS[phase]} の画像を読み込めませんでした。`);
  img.src = URL.createObjectURL(file);
}

/* ------------------------------ ファイル選択 ------------------------------ */

els.dropzone.addEventListener('click', () => els.fileInput.click());

['dragenter', 'dragover'].forEach(ev =>
  els.dropzone.addEventListener(ev, e => { e.preventDefault(); els.dropzone.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev =>
  els.dropzone.addEventListener(ev, e => { e.preventDefault(); els.dropzone.classList.remove('over'); }));

els.dropzone.addEventListener('drop', e => {
  const file = e.dataTransfer.files[0];
  if (file) loadVideo(file);
});
els.fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) loadVideo(file);
});

/* --------------------------- カメラで撮って取り込む -----------------------
 * capture 付きの入力は、対応端末ではカメラが直接開きます。パソコンでは
 * ただのファイル選択になって紛らわしいので、カメラがある端末だけに出します。
 * ------------------------------------------------------------------------*/
const hasCamera = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));   // iPadOS 対策

if (hasCamera) els.captureBtn.hidden = false;

els.captureInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) loadVideo(file);
});

function loadVideo(file) {
  if (!file.type.startsWith('video/')) {
    showError('動画ファイルを選んでください。');
    return;
  }
  hideError();
  videoReady = false;
  updateAnalyzeButton();

  els.video.src = URL.createObjectURL(file);
  els.video.hidden = false;
  els.video.onloadedmetadata = () => {
    videoReady = true;
    manualRange = null;
    els.rangeBox.hidden = false;
    showRange();
    updateAnalyzeButton();
    els.dropzone.classList.add('has-file');
    els.dropzone.querySelector('.dz-main').textContent = file.name;
    els.dropzone.querySelector('.dz-sub').textContent =
      `${els.video.videoWidth}×${els.video.videoHeight} / ${els.video.duration.toFixed(1)}秒　（クリックで選び直し）`;
  };
  els.video.onerror = () => showError('この動画は読み込めませんでした。mp4 形式でお試しください。');
}

/* -------------------------------- 解析 ----------------------------------- */

els.analyzeBtn.addEventListener('click', run);

async function run() {
  const mode = selected('mode');
  if (mode === 'photo' ? !photos.address : !videoReady) return;

  hideError();
  els.analyzeBtn.disabled = true;
  els.progress.hidden = false;
  setProgress(0, '骨格検出モデルを読み込んでいます…');
  newLessonRotation();               // 解析ごとに参考動画を選び直す

  try {
    const pose = await getPose();
    const hand = selected('hand');
    const view = selected('view');
    const club = selected('club');

    const { frames, keys, range } = mode === 'photo'
      ? await analyzePhotos(pose, hand)
      : await analyzeVideo(pose, hand);

    // 角度を正しく出すために、映像の縦横比を渡す（x と y の単位をそろえるため）
    const aspect = frameAspect(mode, frames, keys);
    const metrics = measure(frames, keys, hand, view, aspect);
    if (Object.keys(metrics).length === 0) {
      throw new Error('アドレスの骨格を検出できなかったため、診断できませんでした。全身が写っている写真・動画でお試しください。');
    }
    const result = diagnose(metrics, view, club);

    setProgress(1, '完了しました');
    await renderResult(result, frames, keys, { hand, view, club, mode, range, aspect });

    els.progress.hidden = true;
    els.setup.hidden = true;
    els.result.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (err) {
    els.progress.hidden = true;
    updateAnalyzeButton();
    showError(err.message || '解析中に問題が発生しました。');
  }
}

/** 動画を1コマずつ解析して、キーフレームを自動検出する */
async function analyzeVideo(pose, hand) {
  pose.setOptions({ smoothLandmarks: true });

  // 範囲が手で指定されていればそれを使い、なければ動画全体を粗く見て絞り込む
  let range = manualRange;
  if (!range) {
    setProgress(0.02, 'スイングの位置を探しています…');
    // 粗いスキャンはコマが飛んでいるので、前後のコマをつなぐ平滑化は切る
    pose.setOptions({ smoothLandmarks: false });
    range = await findSwingWindow(els.video, pose, p => {
      setProgress(0.02 + p * 0.33, `スイングの位置を探しています… ${Math.round(p * 100)}%`);
    });
    pose.setOptions({ smoothLandmarks: true });
  }

  setProgress(0.35, '骨格を1コマずつ検出しています…');
  const { frames } = await extractPoseSequence(els.video, pose, p => {
    setProgress(0.35 + p * 0.60, `骨格を1コマずつ検出しています… ${Math.round(p * 100)}%`);
  }, range);

  const detected = frames.filter(f => f.lms).length;
  if (detected < frames.length * 0.5) {
    throw new Error('人物の骨格をうまく検出できませんでした。全身が画面に収まっていて、明るく、背景がすっきりした動画でお試しください。');
  }

  setProgress(0.97, 'スイングの節目を判定しています…');
  const keys = detectKeyFrames(frames, hand);
  if (!keys) {
    throw new Error('スイングの動きを判定できませんでした。アドレスからフィニッシュまでが1回だけ入った動画でお試しください。');
  }
  return { frames, keys, range };
}

/** ポジションごとの写真を解析する（キーフレーム検出は不要） */
async function analyzePhotos(pose) {
  // 連続したフレームではないので、前の写真の結果を引きずらないよう平滑化を切る
  pose.setOptions({ smoothLandmarks: false });

  const ordered = {};
  for (const phase of PHASE_ORDER) if (photos[phase]) ordered[phase] = photos[phase];

  setProgress(0.05, '写真を解析しています…');
  const { frames, keys } = await extractPoseFromImages(ordered, pose, p => {
    setProgress(0.05 + p * 0.9, `写真を解析しています… ${Math.round(p * 100)}%`);
  });

  const failed = Object.keys(keys).filter(ph => !frames[keys[ph]].lms);
  if (failed.length) {
    throw new Error(
      `${failed.map(p => PHASE_LABELS[p]).join('・')} の写真から骨格を検出できませんでした。` +
      '全身が写っていて、明るく、背景がすっきりした写真でお試しください。');
  }
  return { frames, keys };
}

/** MediaPipe Pose は初回だけ生成して使い回す */
async function getPose() {
  if (poseInstance) return poseInstance;
  if (typeof Pose === 'undefined') {
    throw new Error('骨格検出ライブラリを読み込めませんでした。インターネットに接続した状態で開いてください。');
  }
  const pose = new Pose({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${f}`
  });
  // スマホでいちばん重いモデルを使うと解析が何分もかかります。
  // 1 段軽いモデルでも、この道具が見ている体の位置や角度は十分に取れます。
  pose.setOptions({
    modelComplexity: hasCamera ? 1 : 2,
    smoothLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  await pose.initialize();
  poseInstance = pose;
  return pose;
}

/* ------------------------------- 結果表示 -------------------------------- */

async function renderResult(result, frames, keys, opt) {
  current = { frames, keys, opt, lastResult: result };
  setDirty(false);

  // 切り出し範囲は全ポジションで共通。アドレス基準表の画像でも使うので先に決める
  if (opt.mode !== 'photo') {
    const used = PHASE_ORDER.map(p => keys[p]).filter(i => i !== undefined);
    current.crop = swingCrop(frames, used, els.video.videoWidth, els.video.videoHeight, FRAME_ASPECT);
  }

  renderScore(result);
  renderModeNote(opt, keys, result);
  renderPriorities(result);
  renderLesson(result);
  renderContacts();
  await renderReference(opt.club, result, opt, keys, frames);
  showSwingVideo(opt);
  await renderPhases(result, keys, opt);
}

/** レッスンの案内。中身は criteria.js の CONTACT_LINKS で差し替えられます */
function renderContacts() {
  if (els.contactLinks.children.length) return;      // 一度だけ作ればよい

  // 顔写真。ファイル名は index.html の #contactPhotoImg で指定しています。
  // 読み込めなかったときは枠ごと出しません（写真を差し替え中でも画面が崩れないように）
  const img = els.contactPhotoImg;
  const show = () => { els.contactPhoto.hidden = false; };
  const hide = () => { els.contactPhoto.hidden = true; };
  if (img.complete) { img.naturalWidth ? show() : hide(); }
  img.addEventListener('load', show);
  img.addEventListener('error', hide);

  for (const c of CONTACT_LINKS) {
    const a = document.createElement('a');
    a.className = 'contact-link';
    a.href = c.url;
    a.target = '_blank';
    a.rel = 'noopener';
    const lead = text('span', c.lead);
    lead.className = 'contact-lead';
    // 押せる場所だと一目で分かるように、ボタン風の行を必ず付けます
    const cta = text('span', 'ページを開く');
    cta.className = 'contact-cta';
    a.append(text('strong', c.title), lead, cta);
    els.contactLinks.appendChild(a);
  }
}

/** キーフレームを動かしたあと、診断し直せることを知らせる */
function setDirty(on) {
  els.rediagnoseBox.hidden = !on;
}

/**
 * 映像の縦横比（幅 ÷ 高さ）。
 * ランドマークの x と y は幅・高さをそれぞれ 1 とした値なので、
 * これを渡さないと角度が縦横比のぶんだけ歪みます。
 */
function frameAspect(mode, frames, keys) {
  if (mode === 'photo') {
    const f = frames[keys.address];
    return (f && f.img && f.img.naturalHeight) ? f.img.naturalWidth / f.img.naturalHeight : 1;
  }
  return els.video.videoHeight ? els.video.videoWidth / els.video.videoHeight : 1;
}

/** 解析後も動画を見られるように、結果側へ動画プレーヤーを移す */
function showSwingVideo(opt) {
  if (opt.mode === 'photo') { els.videoCard.hidden = true; return; }
  els.videoHolder.appendChild(els.video);
  els.videoCard.hidden = false;
  buildVideoNav();
}

/* ------------------- 動画をポジションで止めて注意点を出す ------------------- */

/*
 * 動画の下にポジションのボタンを並べ、押すとその位置で止めて注意点を出します。
 * 手で一時停止・シークしたときも、いちばん近いポジションに切り替えます。
 * NEAR_ENOUGH より離れているときは、どのポジションでもないので選択を外します。
 */
const NEAR_ENOUGH = 0.5;                              // 秒

function buildVideoNav() {
  els.videoNav.innerHTML = '';
  els.videoNotes.innerHTML = '';
  const { keys, frames, opt } = current;
  if (!keys || opt.mode === 'photo') return;

  for (const phase of PHASE_ORDER) {
    if (keys[phase] === undefined) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'video-nav-btn';
    b.dataset.phase = phase;
    b.textContent = shortPhaseLabel(phase);
    b.addEventListener('click', () => jumpToPhase(phase));
    els.videoNav.appendChild(b);
  }
  if (els.videoNav.children.length) showPhaseNotes(PHASE_ORDER.find(p => keys[p] !== undefined));
}

/** ボタンに入れる短い名前（PHASE_LABELS の括弧書きは長いので落とす） */
function shortPhaseLabel(phase) {
  return (PHASE_LABELS[phase] || phase).replace(/（.*）$/, '');
}

/** その位置まで動画を進めて止め、注意点を出す */
function jumpToPhase(phase) {
  const { keys, frames } = current;
  if (!keys || keys[phase] === undefined) return;
  els.video.pause();
  els.video.currentTime = frames[keys[phase]].t;
  showPhaseNotes(phase);
}

/** 今の再生位置にいちばん近いポジションへ切り替える */
function syncPhaseToVideo() {
  const { keys, frames } = current;
  if (!keys || !frames) return;
  const t = els.video.currentTime;
  let best = null, bestGap = Infinity;
  for (const phase of PHASE_ORDER) {
    if (keys[phase] === undefined) continue;
    const gap = Math.abs(frames[keys[phase]].t - t);
    if (gap < bestGap) { best = phase; bestGap = gap; }
  }
  if (best && bestGap <= NEAR_ENOUGH) showPhaseNotes(best);
  else for (const b of els.videoNav.children) b.classList.remove('active');
}

els.video.addEventListener('pause', syncPhaseToVideo);
els.video.addEventListener('seeked', syncPhaseToVideo);

/** 動画の下に、そのポジションの注意点を出す */
function showPhaseNotes(phase) {
  const result = current.lastResult;
  if (!result) return;

  for (const b of els.videoNav.children) b.classList.toggle('active', b.dataset.phase === phase);

  const box = els.videoNotes;
  box.innerHTML = '';
  box.appendChild(text('h3', PHASE_LABELS[phase] || phase));

  const items = result.items.filter(i => i.phase === phase);
  const checks = VISUAL_CHECKS.filter(
    c => c.phase === phase && (c.view === 'both' || c.view === current.opt.view));

  if (!items.length && !checks.length) {
    box.appendChild(text('p', 'この撮影角度では、このポジションの注意点はありません。'));
    return;
  }

  // 基準を外れたものを先に。同じ状態のなかでは点数の低い順
  for (const item of [...items].sort((a, b) => a.score - b.score)) {
    const row = document.createElement('div');
    row.className = 'note-row ' + (item.score >= 90 ? 's-good' : item.score >= 60 ? 's-warn' : 's-bad');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = item.score >= 90 ? '良好' : item.score >= 60 ? '要注意' : '要改善';
    const value = text('span',
      `${fmt(item.value, item.unit, item.signLabels)}（目安 ${fmtRange(item.ideal, item.unit, item.signLabels)}）`);
    value.className = 'note-value';
    row.append(badge, text('b', item.label), value, text('p', item.comment));
    box.appendChild(row);
  }

  for (const c of checks) {
    const row = document.createElement('div');
    row.className = 'note-row s-check';
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = '目視';
    row.append(badge, text('p', c.text));
    box.appendChild(row);
  }
}

function renderScore(result) {
  els.scoreRing.style.setProperty('--pct', result.overall);
  els.scoreNum.textContent = result.overall;
  els.summaryTitle.textContent = result.summary.title;
  els.summaryBody.textContent = result.summary.body;

  // スイング全体の項目（テンポなど）は、総合スコアと同じこの場所にまとめます。
  // ポジションごとのカードにも「スイング全体」を作ると二重になるためです。
  els.wholeItems.innerHTML = '';
  for (const item of result.items.filter(i => i.phase === 'whole')) {
    els.wholeItems.appendChild(buildItem(item));
  }
}

/** 写真モードの未入力、または動画のどの区間を解析したかを知らせる */
function renderModeNote(opt, keys, result) {
  if (opt.mode !== 'photo') {
    const r = opt.range;
    if (r && (r.scanned || r.manual)) {
      els.modeNote.innerHTML = '';
      els.modeNote.append(text('strong',
        `動画の ${r.from.toFixed(1)} 〜 ${r.to.toFixed(1)} 秒を解析しました`));
      els.modeNote.append(text('span', r.manual
        ? '手で指定された範囲です。'
        : `最も大きく動いた ${r.peak.toFixed(1)} 秒付近をインパクトとみなし、その前後を切り出しています。`));
      els.modeNote.append(text('span',
        'ここがスイングでない場合は、前の画面に戻って「現在位置を開始に / 終了に」で範囲を指定し直してください。' +
        'キーフレームが少しずれているだけなら、下の各画像の ◀ ▶ で位置を直したあと、'
        + '「修正した位置で診断し直す」を押してください。'));
      els.modeNote.hidden = false;
    } else {
      els.modeNote.hidden = true;
    }
    return;
  }

  const missing = PHASE_ORDER.filter(p => keys[p] === undefined).map(p => PHASE_LABELS[p]);
  const skipped = CRITERIA
    .filter(c => (c.view === 'both' || c.view === opt.view) && !result.items.some(i => i.id === c.id))
    .map(c => c.label);

  els.modeNote.innerHTML = '';
  els.modeNote.append(text('strong', `写真 ${Object.keys(keys).length} 枚から診断しました（${result.items.length} 項目）`));
  if (missing.length) {
    els.modeNote.append(text('span', `未入力のポジション: ${missing.join(' / ')}`));
  }
  if (skipped.length) {
    els.modeNote.append(text('span', `写真が足りず診断できなかった項目: ${skipped.join(' / ')}`));
  }
  els.modeNote.hidden = false;
}

function renderPriorities(result) {
  els.priorities.innerHTML = '';
  if (result.priorities.length === 0) {
    const li = document.createElement('li');
    li.innerHTML = '<strong class="all-good">全項目が基準内です</strong>';
    li.append(text('span', '今の形を崩さないことが最優先です。この動画を保存して、次回と見比べてください。'));
    els.priorities.appendChild(li);
    return;
  }
  for (const p of result.priorities) {
    const li = document.createElement('li');
    li.append(text('strong', p.label), text('span', p.comment));
    els.priorities.appendChild(li);
  }
}

/**
 * 参考レッスン動画。優先課題の上位に対する動画を、独立したカードで大きく出します。
 * 項目ごとに小さく並べると本数が多くなり、どれを見ればいいのか分からなくなるためです。
 */
function renderLesson(result) {
  els.lessonHolder.innerHTML = '';
  const picked = [];
  for (const p of result.priorities) {
    if (picked.length >= MAX_LESSONS) break;
    const v = pickLesson(p.id, p.status);
    if (v) picked.push({ v, item: p });
  }
  if (!picked.length) { els.lessonCard.hidden = true; return; }

  els.lessonFor.textContent =
    `「${picked.map(x => x.item.label).join('」「')}」を直すための動画です。`;
  for (const { v } of picked) els.lessonHolder.appendChild(buildLesson(v));
  els.lessonCard.hidden = false;
}

/* アドレス基準表の各行と、それを裏づける計測項目の対応 */
/* view はその項目を確かめられるカメラの位置。撮った角度に合う行だけを出します。
 * ボールの位置は帯を正面のアドレス画像にだけ描いているので front です */
const REF_ROWS = [
  { label: 'ボールの位置', field: 'ball', view: 'front', ids: [] },
  { label: 'スタンスの幅', field: 'stance', view: 'front', ids: ['stanceWidth'] },
  { label: '左右の重心', field: 'balance', view: 'front', ids: ['addressBalance'] },
  { label: '前傾角', field: 'spine', view: 'side', ids: ['spineAddress'] },
  { label: '手元の位置', field: 'hands', view: 'side', ids: ['handPosSide', 'handDistance'] }
];

/* 角度を変えて撮ると出る項目の案内文（表から消えた行の行き先を示すため） */
const REF_NOTE = {
  front: '正面から確かめられる項目だけを出しています。前傾角と手元の位置は、後方から撮ると出ます。',
  side: '後方から確かめられる項目だけを出しています。ボールの位置・スタンスの幅・左右の重心は、正面から撮ると出ます。'
};

/**
 * 番手ごとのアドレス基準を、実際の計測結果と並べて表示する。
 * 目安を書くだけでなく、その場で判定まで出します。
 */
async function renderReference(club, result, opt, keys, frames) {
  const c = CLUBS[club];
  els.clubName.textContent = c.label;

  // 目安と見比べられるよう、アドレスのコマをこの表の横にも出す
  els.refFrame.innerHTML = '';
  if (keys.address !== undefined) {
    const crop = opt.mode === 'photo'
      ? swingCrop(frames, [keys.address], frames[keys.address].img.naturalWidth,
        frames[keys.address].img.naturalHeight, FRAME_ASPECT)
      : current.crop;
    els.refFrame.appendChild(await captureFrame(frames[keys.address], 'address', opt, crop));
    els.refFrame.appendChild(text('figcaption', opt.mode === 'photo'
      ? 'あなたのアドレス'
      : `あなたのアドレス（${frames[keys.address].t.toFixed(2)} 秒）`));
    // ここでもアドレスの位置を直せるようにする
    if (opt.mode !== 'photo') els.refFrame.appendChild(buildFrameNav('address'));
    els.refFrame.hidden = false;
  } else {
    els.refFrame.hidden = true;
  }

  els.refTable.innerHTML = '';

  const head = document.createElement('tr');
  head.append(text('th', ''), text('th', '目安'), text('th', 'あなたのアドレス'));
  els.refTable.appendChild(head);

  els.refNote.textContent =
    `このクラブで構えるときの目安と、実際のアドレスを並べています。${REF_NOTE[opt.view] || ''}`;

  for (const row of REF_ROWS.filter(r => r.view === opt.view)) {
    const tr = document.createElement('tr');
    tr.append(text('th', row.label), text('td', c[row.field]));

    const td = document.createElement('td');
    const found = row.ids.map(id => result.items.find(i => i.id === id)).filter(Boolean);

    if (found.length) {
      for (const item of found) {
        const line = document.createElement('div');
        line.className = 'ref-measure ' + (item.score >= 90 ? 's-good' : item.score >= 60 ? 's-warn' : 's-bad');
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = item.score >= 90 ? '良好' : item.score >= 60 ? '要注意' : '要改善';
        line.append(badge, document.createTextNode(
          `${fmt(item.value, item.unit, item.signLabels)}`
          + `（目安 ${fmtRange(item.ideal, item.unit, item.signLabels)}）`));
        td.appendChild(line);
      }
    } else if (row.ids.length) {
      // 角度は合っているのに値が出なかった（骨格が取れなかった等）
      td.appendChild(text('span', 'この映像からは判定できませんでした'));
      td.className = 'ref-na';
    } else {
      td.appendChild(text('span', 'アドレス画像の緑の帯でご確認ください（ボールは検出できません）'));
      td.className = 'ref-na';
    }

    tr.appendChild(td);
    els.refTable.appendChild(tr);
  }
}

/**
 * ポジションごとに 1 枚のカードを作る。
 * 「そのコマの画像」と「そのポジションの診断・目視チェック」を必ず同じ場所に並べ、
 * どの説明がどの姿勢の話なのかを一目で分かるようにしています。
 */
async function renderPhases(result, keys, opt) {
  els.phases.innerHTML = '';

  // 'whole'（スイング全体）はここには出しません。総合スコアの欄にまとめています
  for (const phase of PHASE_ORDER) {
    const items = result.items.filter(i => i.phase === phase);
    const checks = VISUAL_CHECKS.filter(c => c.phase === phase && (c.view === 'both' || c.view === opt.view));
    const hasFrame = keys[phase] !== undefined;
    if (!items.length && !checks.length && !hasFrame) continue;

    const card = document.createElement('section');
    card.className = 'card phase-card';
    card.dataset.phase = phase;

    card.appendChild(text('h2', PHASE_LABELS[phase] || phase));

    const body = document.createElement('div');
    body.className = 'phase-body';

    if (hasFrame) {
      const fig = document.createElement('figure');
      fig.className = 'frame';
      fig.dataset.phase = phase;
      body.appendChild(fig);
    }

    const col = document.createElement('div');
    col.className = 'phase-items';
    for (const item of items) col.appendChild(buildItem(item));

    // この撮影角度では測れる項目がないポジション（例: 正面から見たバックスイング）
    if (!items.length && !checks.length) {
      const other = opt.view === 'front' ? '後方（飛球線の後ろ）' : '正面';
      const note = text('p', `この角度では、このポジションの自動計測項目はありません。${other}から撮った動画で診断できます。`);
      note.className = 'phase-empty';
      col.appendChild(note);
    }

    if (checks.length) col.appendChild(buildChecklist(checks));
    body.appendChild(col);

    card.appendChild(body);
    els.phases.appendChild(card);

    if (hasFrame) await refreshFrame(phase);
  }
}

function buildChecklist(checks) {
  const box = document.createElement('div');
  box.className = 'checkbox-group';
  box.appendChild(text('h4', '目で確かめる（骨格検出ではクラブを認識できません）'));

  const ul = document.createElement('ul');
  ul.className = 'checklist';
  for (const c of checks) {
    const li = document.createElement('li');
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    label.append(input, document.createTextNode(c.text));
    li.appendChild(label);

    ul.appendChild(li);
  }
  box.appendChild(ul);
  return box;
}

/** 1つのキーフレームの画像とキャプションを描き直す */
async function refreshFrame(phase) {
  const { frames, keys, opt } = current;
  const fig = els.phases.querySelector(`figure[data-phase="${phase}"]`);
  if (!fig) return;

  const idx = keys[phase];
  // 写真モードは 1 枚ずつ撮影条件が違うので、その写真だけで切り出し範囲を決める
  const crop = opt.mode === 'photo'
    ? swingCrop(frames, [idx], frames[idx].img.naturalWidth, frames[idx].img.naturalHeight, FRAME_ASPECT)
    : current.crop;
  const canvas = await captureFrame(frames[idx], phase, opt, crop);

  fig.innerHTML = '';

  // 画像をクリックすると、動画をそのコマで止めて、そこの注意点を出す
  if (opt.mode !== 'photo') {
    canvas.title = 'クリックすると動画がこの位置で止まり、注意点が出ます';
    canvas.classList.add('seekable');
    canvas.addEventListener('click', () => {
      jumpToPhase(phase);
      els.videoCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  fig.appendChild(canvas);

  // 写真モードは時刻を持たないので、ポジション名だけを出す
  fig.appendChild(text('figcaption', opt.mode === 'photo'
    ? PHASE_LABELS[phase]
    : `${frames[idx].t.toFixed(2)} 秒`));

  // 動画モードのときだけ、コマ送りで位置を直せるようにする
  if (opt.mode !== 'photo') fig.appendChild(buildFrameNav(phase));
}

/** コマ送りのボタン列。アドレス基準表の画像でも同じものを使います */
function buildFrameNav(phase) {
  const { frames, keys } = current;
  const idx = keys[phase];
  const nav = document.createElement('div');
  nav.className = 'frame-nav';
  for (const [label, delta] of [['◀◀', -5], ['◀', -1], ['▶', 1], ['▶▶', 5]]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.disabled = idx + delta < 0 || idx + delta >= frames.length;
    b.addEventListener('click', () => nudgeFrame(phase, delta));
    nav.appendChild(b);
  }
  return nav;
}

/**
 * キーフレームを delta コマ動かす。
 * 画像だけを差し替えて、診断のやり直しは「診断し直す」ボタンに任せます。
 * 1コマ動かすたびに全部を作り直すと、複数のポジションを直しているあいだ
 * 画面が落ち着かないためです。
 */
async function nudgeFrame(phase, delta) {
  const { frames, keys } = current;
  const next = keys[phase] + delta;
  if (next < 0 || next >= frames.length || !frames[next].lms) return;

  keys[phase] = next;
  await refreshFrame(phase);

  // アドレスはアドレス基準表にも出しているので、そちらも差し替える
  if (phase === 'address' && !els.refFrame.hidden) {
    const { opt } = current;
    await renderReference(opt.club, current.lastResult, opt, keys, frames);
  }
  setDirty(true);
}

/** 直したキーフレームの位置で、診断をやり直す */
async function rediagnose() {
  if (!current) return;
  const { frames, keys, opt } = current;
  els.rediagnoseBtn.disabled = true;
  try {
    newLessonRotation();                 // 参考動画も選び直す
    const result = diagnose(measure(frames, keys, opt.hand, opt.view, opt.aspect), opt.view, opt.club);
    await renderResult(result, frames, keys, opt);
    els.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } finally {
    els.rediagnoseBtn.disabled = false;
  }
}
els.rediagnoseBtn.addEventListener('click', rediagnose);

function buildItem(item) {
  const div = document.createElement('div');
  div.className = 'item ' + (item.score >= 90 ? 's-good' : item.score >= 60 ? 's-warn' : 's-bad');

  const head = document.createElement('div');
  head.className = 'item-head';

  const label = document.createElement('div');
  label.className = 'item-label';
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = item.score >= 90 ? '良好' : item.score >= 60 ? '要注意' : '要改善';
  label.append(badge, document.createTextNode(item.label));

  const value = document.createElement('div');
  value.className = 'item-value';
  value.innerHTML = `<b>${fmt(item.value, item.unit, item.signLabels)}</b>`
    + `　目安 ${fmtRange(item.ideal, item.unit, item.signLabels)}　/　${item.score}点`;

  head.append(label, value);
  div.append(head);

  const gauge = document.createElement('div');
  gauge.className = 'gauge';
  const fill = document.createElement('div');
  fill.style.width = item.score + '%';
  gauge.appendChild(fill);
  div.append(gauge);

  if (item.detail) {
    const d = text('p', item.detail);
    d.className = 'item-dir';
    div.append(d);
  }

  if (item.dir) {
    const dir = text('p', item.dir);
    dir.className = 'item-dir';
    div.append(dir);
  }

  const comment = text('p', item.comment);
  comment.className = 'item-comment';
  div.append(comment);

  if (item.drill) {
    const drill = document.createElement('p');
    drill.className = 'drill';
    drill.innerHTML = '<b>練習ドリル</b>　';
    drill.append(document.createTextNode(item.drill));
    div.appendChild(drill);
  }

  return div;
}

/**
 * 参考レッスン動画のブロック。
 * はじめはサムネイルだけを出し、押されたときに再生用の iframe に差し替えます
 * （項目ごとに埋め込むと重いので、必要になってから読み込みます）。
 */
function buildLesson(v) {
  const box = document.createElement('div');
  box.className = 'lesson';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lesson-open';

  const shot = document.createElement('span');
  shot.className = 'lesson-shot';

  const thumb = document.createElement('img');
  // 大きく出すので高解像度のサムネイルを使う。ない動画もあるので保険を用意する
  thumb.src = `https://img.youtube.com/vi/${v.id}/maxresdefault.jpg`;
  thumb.onerror = () => {
    thumb.onerror = null;
    thumb.src = `https://img.youtube.com/vi/${v.id}/mqdefault.jpg`;
  };
  thumb.alt = '';
  thumb.loading = 'lazy';
  shot.append(thumb, text('span', '▶'));

  const meta = document.createElement('span');
  meta.className = 'lesson-meta';
  // チャンネルを症状のキーワードで検索した結果。解析ごとに候補を順に出していく
  meta.append(text('span', v.title));
  btn.append(shot, meta);

  btn.addEventListener('click', () => {
    const frame = document.createElement('iframe');
    frame.src = `https://www.youtube.com/embed/${v.id}?autoplay=1&rel=0`;
    frame.allow = 'accelerometer; autoplay; encrypted-media; picture-in-picture';
    frame.allowFullscreen = true;
    frame.title = v.title;
    box.replaceChild(frame, btn);
  });

  const link = document.createElement('a');
  link.href = `https://www.youtube.com/watch?v=${v.id}`;
  link.target = '_blank';
  link.rel = 'noopener';
  link.className = 'lesson-link';
  link.textContent = 'YouTube で開く';

  box.append(btn, link);
  return box;
}

/* ------------------------------ 値の書式 --------------------------------- */

/*
 * プラス・マイナスのままでは、どちらが右でどちらが左なのか読み取れません。
 * criteria.js の signLabels があるときは「右足寄り 0.08」のように言葉で出します。
 */
function fmt(v, unit, labels) {
  if (unit === '度') {
    return labels ? `${labels[v >= 0 ? 0 : 1]} ${Math.abs(v).toFixed(1)}°` : `${v.toFixed(1)}°`;
  }
  if (unit === ': 1') return `${v.toFixed(1)} : 1`;
  if (unit === '倍') return `${v.toFixed(2)} 倍`;
  if (unit === '拳') return `拳 ${v.toFixed(1)} 個分`;
  if (labels) return `${labels[v >= 0 ? 0 : 1]} ${Math.abs(v).toFixed(2)}`;
  return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);
}

function fmtRange([lo, hi], unit, labels) {
  if (unit === '度' && lo === 0) return `${hi.toFixed(0)}° 以下`;
  if (unit === '度') return labels ? labelledRange(lo, hi, labels, 0, '°') : `${lo.toFixed(0)}〜${hi.toFixed(0)}°`;
  if (unit === ': 1') return `${lo.toFixed(1)}〜${hi.toFixed(1)} : 1`;
  if (unit === '倍') return `${lo.toFixed(2)}〜${hi.toFixed(2)} 倍`;
  if (unit === '拳') return `拳 ${lo.toFixed(1)}〜${hi.toFixed(1)} 個分`;
  if (labels) return labelledRange(lo, hi, labels, 2, '');
  return `${(lo >= 0 ? '+' : '−') + Math.abs(lo).toFixed(2)} 〜 ${(hi >= 0 ? '+' : '−') + Math.abs(hi).toFixed(2)}`;
}

/** 目安の範囲を「右足寄り 0.03〜0.20」「左足寄り 0.06 〜 右足寄り 0.07」の形にする */
function labelledRange(lo, hi, labels, digits, suffix) {
  const f = v => Math.abs(v).toFixed(digits) + suffix;
  if (lo >= 0) return `${labels[0]} ${f(lo)}〜${f(hi)}`;
  if (hi <= 0) return `${labels[1]} ${f(hi)}〜${f(lo)}`;
  return `${labels[1]} ${f(lo)} 〜 ${labels[0]} ${f(hi)}`;
}

/* ------------------------------ 画像の描画 -------------------------------- */

/** 切り出し画像の縦横比（幅 ÷ 高さ）。人が縦長なので縦向きにしています */
const FRAME_ASPECT = 3 / 4;
const FRAME_PIXELS = 600;                            // 表示幅は CSS 側。ここは解像度

/** 指定フレームから、人物を切り出して骨格とガイド線を重ねた canvas を作る */
async function captureFrame(frame, phase, opt, crop) {
  const canvas = document.createElement('canvas');
  const w = FRAME_PIXELS, h = Math.round(w / FRAME_ASPECT);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  const srcW = frame.img ? frame.img.naturalWidth : els.video.videoWidth;
  const srcH = frame.img ? frame.img.naturalHeight : els.video.videoHeight;
  const c = crop || { sx: 0, sy: 0, sw: srcW, sh: srcH };

  if (!frame.img) await seekTo(els.video, frame.t);
  ctx.drawImage(frame.img || els.video, c.sx, c.sy, c.sw, c.sh, 0, 0, w, h);

  // 元映像の正規化座標を、切り出した canvas 上の座標に直す
  const map = p => ({
    x: (p.x * srcW - c.sx) / c.sw * w,
    y: (p.y * srcH - c.sy) / c.sh * h
  });

  if (frame.lms) {
    drawSkeleton(ctx, frame.lms, map);
    if (phase === 'address' && opt.view === 'side') {
      drawNeckLine(ctx, frame.lms, map, opt.hand);
    }
    if (phase === 'address' && opt.view === 'front') {
      drawBallZone(ctx, frame.lms, map, opt.hand, opt.club, h);
    }
  }
  return canvas;
}

/** アドレス画像に、その番手の正しいボール位置の目安を帯で描く */
function drawBallZone(ctx, lms, map, hand, club, canvasH) {
  const g = ballGuide(lms, hand, club);
  if (!g) return;

  const a = map({ x: g.from, y: g.y });
  const b = map({ x: g.to, y: g.y });
  const center = map({ x: g.center, y: g.y });
  const pad = canvasH * 0.055;
  const top = a.y - pad, bottom = a.y + pad;
  const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);

  ctx.save();
  ctx.fillStyle = 'rgba(79, 191, 139, .35)';
  ctx.fillRect(x1, top, x2 - x1, bottom - top);

  ctx.strokeStyle = 'rgba(79, 191, 139, .95)';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(x1, top, x2 - x1, bottom - top);

  // 両足の中央（点線）— ボール位置を読むときの基準
  ctx.setLineDash([5, 5]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, .85)';
  ctx.beginPath();
  ctx.moveTo(center.x, top - pad);
  ctx.lineTo(center.x, bottom);
  ctx.stroke();
  ctx.restore();
}

const BONES = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [0, 11], [0, 12]
];

function drawSkeleton(ctx, lms, map) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(79, 191, 139, .95)';
  for (const [a, b] of BONES) {
    if (!lms[a] || !lms[b]) continue;
    const p = map(lms[a]), q = map(lms[b]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    if (!lms[i]) continue;
    const p = map(lms[i]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 首の付け根とボールを結んだラインの目安（スイングプレーンの上側の境界） */
function drawNeckLine(ctx, lms, map, hand) {
  const line = neckLine(lms, hand);
  if (!line) return;
  const a = map(line.from), b = map(line.to);
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(255, 200, 60, .95)';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------ ユーティリティ ---------------------------- */

function text(tag, str) {
  const el = document.createElement(tag);
  el.textContent = str;
  return el;
}

function setProgress(p, str) {
  els.barFill.style.width = Math.round(p * 100) + '%';
  els.progressText.textContent = str;
}
function showError(msg) { els.error.textContent = msg; els.error.hidden = false; }
function hideError() { els.error.hidden = true; }

els.resetBtn.addEventListener('click', () => {
  els.videoSlot.appendChild(els.video);              // 動画プレーヤーを設定画面に戻す
  els.videoCard.hidden = true;
  els.result.hidden = true;
  els.setup.hidden = false;
  updateAnalyzeButton();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
