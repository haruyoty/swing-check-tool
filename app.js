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
  captureFallback: $('captureFallback'),
  cameraHelp: $('cameraHelp'),
  recorder: $('recorder'),
  recPreview: $('recPreview'),
  recToggle: $('recToggle'),
  recTime: $('recTime'),
  recCancel: $('recCancel'),
  videoInput: $('videoInput'),
  photoInput: $('photoInput'),
  photoGrid: $('photoGrid'),
  phases: $('phases'),
  videoSlot: $('videoSlot'),
  videoCard: $('videoCard'),
  videoHolder: $('videoHolder'),
  videoOverlay: $('videoOverlay'),
  guideToggle: $('guideToggle'),
  guideEdit: $('guideEdit'),
  guideAdd: $('guideAdd'),
  guideDel: $('guideDel'),
  guideReset: $('guideReset'),
  shaftStatus: $('shaftStatus'),
  replayBtn: $('replayBtn'),
  tourBtn: $('tourBtn'),
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
      e.target.value = '';                 // 同じ写真を選び直しても change が起きるように
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
  // 同じファイルをもう一度選んでも change が起きるように、選択を空に戻す
  e.target.value = '';
});

/* --------------------------- カメラで撮って取り込む -----------------------
 * ファイル入力の capture 属性で端末のカメラアプリを開く方法は、Android では
 * 機種や入っているアプリによってカメラが開いたり、ただのファイル選択になったり
 * とばらつきます（実機で確認）。そこで、ブラウザの中で直接録画します。
 *   getUserMedia でカメラ映像をもらう → MediaRecorder で録る → その場で読み込む
 * 端末のカメラアプリを経由しないので、機種による差が出ません。
 *
 * 録れない端末（古い iOS など）のために、capture 付きの入力も逃げ道として残します。
 * ------------------------------------------------------------------------*/
const hasCamera = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches);

/** ブラウザ内で録画できるか */
const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia
  && window.MediaRecorder);

/* LINE や Instagram の中のブラウザ。カメラを使えないことが多い */
const IN_APP_BROWSER = /\bLine\/|FBAN|FBAV|Instagram|Twitter|MicroMessenger/i
  .test(navigator.userAgent);

if (hasCamera) {
  els.captureBtn.hidden = false;
  els.captureFallback.hidden = false;
}

/*
 * 逃げ道（端末のカメラアプリ）も、開かなかったときは何も起きません。
 * カメラアプリが開けばこの画面はいったん裏に回るので、「押したのに
 * すぐ戻ってきて、動画も選ばれていない」なら開かなかったと判断します。
 */
let fallbackTapped = 0;
els.captureFallback.addEventListener('click', () => { fallbackTapped = Date.now(); });
window.addEventListener('focus', () => {
  if (!fallbackTapped) return;
  const quick = Date.now() - fallbackTapped < 1500;
  fallbackTapped = 0;
  if (quick && !videoReady) {
    showCameraHelp('端末のカメラアプリを開けませんでした。下の手順でお試しください。');
  }
});

// アプリの中のブラウザでは、そもそもカメラを使えないことが多いので先に案内する
if (hasCamera && IN_APP_BROWSER) els.cameraHelp.hidden = false;

els.captureInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) { fallbackTapped = 0; els.cameraHelp.hidden = true; loadVideo(file); }
  /*
   * カメラで撮り直したときに何も起きなくなるのを防ぎます。
   * スマホのカメラが返すファイルは毎回同じ名前になることがあり、その場合
   * ブラウザは「選択が変わっていない」と判断して change を出しません。
   * 受け取ったあとに選択を空へ戻しておけば、2 回目以降も必ず読み込まれます。
   */
  e.target.value = '';
});

/* ------------------------ ブラウザの中で録画する ------------------------ */

let recStream = null, recorder = null, recChunks = [], recTimer = 0, recStart = 0;

/** その端末で使える動画形式を選ぶ（Safari は mp4、Chrome は webm） */
function recorderMime() {
  const list = ['video/mp4;codecs=avc1', 'video/mp4',
    'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const t of list) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

/*
 * カメラが使えない環境を先に見分けます。
 * ここを黙って素通りさせると「押しても何も起きない」になってしまうので、
 * 何が起きているかと、どうすれば撮れるかを必ず画面に出します。
 */
function cameraProblem() {
  if (IN_APP_BROWSER) {
    return 'LINE などアプリの中のブラウザでは、カメラを使えないことがあります。'
      + '画面の「…」から Safari や Chrome で開き直すか、下の手順でお試しください。';
  }
  if (!window.isSecureContext) {
    return 'この画面は保護された接続（https）ではないため、ブラウザがカメラの使用を'
      + '止めています。https:// で始まるアドレスから開いてください。';
  }
  if (!canRecord) {
    return 'このブラウザは画面の中での録画に対応していません。下の手順でお試しください。';
  }
  return null;
}

/** 撮れないときの手順を画面に出す */
function showCameraHelp(msg) {
  showError(msg);
  els.cameraHelp.hidden = false;
}

async function openRecorder() {
  hideError();
  const problem = cameraProblem();
  if (problem) { showCameraHelp(problem); return; }

  // まず背面カメラ・高画質で頼み、断られたら条件を外してもう一度頼む
  const tries = [
    { video: { facingMode: { ideal: 'environment' },
      width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } }, audio: false },
    { video: true, audio: false }
  ];
  let err = null;
  for (const req of tries) {
    try { recStream = await navigator.mediaDevices.getUserMedia(req); err = null; break; }
    catch (e) { err = e; }
  }
  if (!recStream) {
    const name = (err && err.name) || '不明';
    const why = {
      NotAllowedError: 'カメラの使用が許可されませんでした。ブラウザのアドレス欄の鍵マークから、カメラを「許可」にしてください。',
      NotFoundError: 'カメラが見つかりませんでした。',
      NotReadableError: '他のアプリがカメラを使っています。そのアプリを閉じてからお試しください。',
      SecurityError: 'ブラウザの設定でカメラが止められています。'
    }[name] || ('カメラを開けませんでした（' + name + '）。');
    showCameraHelp(why);
    return;
  }
  els.recPreview.srcObject = recStream;
  els.recorder.hidden = false;
  els.captureBtn.hidden = true;
  setRecording(false);
}

function closeRecorder() {
  stopTimer();
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  recorder = null;
  if (recStream) { for (const t of recStream.getTracks()) t.stop(); recStream = null; }
  els.recPreview.srcObject = null;
  els.recorder.hidden = true;
  els.captureBtn.hidden = !hasCamera;
}

function stopTimer() { if (recTimer) { clearInterval(recTimer); recTimer = 0; } }

function setRecording(on) {
  els.recToggle.textContent = on ? '■ 停止' : '● 撮影開始';
  els.recToggle.classList.toggle('recording', on);
  if (!on) { stopTimer(); els.recTime.textContent = '0.0 秒'; }
}

els.captureBtn.addEventListener('click', openRecorder);
els.recCancel.addEventListener('click', closeRecorder);

els.recToggle.addEventListener('click', () => {
  if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
  if (!recStream) return;

  const mime = recorderMime();
  recChunks = [];
  try {
    recorder = new MediaRecorder(recStream, mime ? { mimeType: mime } : undefined);
  } catch (e) {
    showError('この端末では録画できませんでした。下の「端末のカメラアプリで撮る」をお使いください。');
    closeRecorder();
    return;
  }
  recorder.ondataavailable = e => { if (e.data && e.data.size) recChunks.push(e.data); };
  recorder.onstop = () => {
    setRecording(false);
    const type = mime || 'video/webm';
    const blob = new Blob(recChunks, { type });
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    closeRecorder();
    if (blob.size) loadVideo(new File([blob], `swing.${ext}`, { type }));
  };
  recorder.start();
  setRecording(true);
  recStart = Date.now();
  recTimer = setInterval(() => {
    els.recTime.textContent = ((Date.now() - recStart) / 1000).toFixed(1) + ' 秒';
  }, 100);
});

/*
 * その場で録画した動画は、長さが書き込まれないまま渡ってくることがあり、
 * video.duration が Infinity になります。そのままだと解析範囲を決められないので、
 * いったんうんと先へシークして、ブラウザに長さを数えさせます。
 */
function fixDuration(v) {
  if (isFinite(v.duration) && v.duration > 0) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => {
      v.removeEventListener('durationchange', onChange);
      clearTimeout(timer);
      v.currentTime = 0;
      resolve();
    };
    const onChange = () => { if (isFinite(v.duration) && v.duration > 0) done(); };
    v.addEventListener('durationchange', onChange);
    const timer = setTimeout(done, 3000);       // 数えられなくても先へ進む
    v.currentTime = 1e6;
  });
}

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
  els.video.onloadedmetadata = async () => {
    await fixDuration(els.video);
    videoReady = true;
    manualRange = null;
    els.rangeBox.hidden = false;
    showRange();
    updateAnalyzeButton();
    els.dropzone.classList.add('has-file');
    els.dropzone.querySelector('.dz-main').textContent = file.name;
    els.dropzone.querySelector('.dz-sub').textContent =
      `${els.video.videoWidth}×${els.video.videoHeight}`
      + (isFinite(els.video.duration) ? ` / ${els.video.duration.toFixed(1)}秒` : '')
      + '　（クリックで選び直し）';
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

    // 赤い線を入れたまま、まず 1 回スローで流す（終わるとアドレスで止まります）
    slowReview();

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
  // 線を手で直していたら、診断し直しても引き継ぐ
  const keptGuides = current && current.guides;
  current = { frames, keys, opt, lastResult: result };
  setDirty(false);
  if (keptGuides) { current.guides = keptGuides; current.selectedGuide = null; }
  else { initGuides(); await applyShaftDetection(); }
  showShaftStatus();

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

  CONTACT_LINKS.forEach((c, i) => {
    const a = document.createElement('a');
    // 先頭（オンラインスイング診断）はいちばん見てほしいので、大きく目立たせます
    a.className = 'contact-link' + (i === 0 ? ' primary-link' : '');
    a.href = c.url;
    a.target = '_blank';
    a.rel = 'noopener';
    const lead = text('span', c.lead);
    lead.className = 'contact-lead';
    // 押せる場所だと一目で分かるように、ボタン風の行を必ず付けます
    const cta = text('span', i === 0 ? 'LINE で受け付けています' : 'ページを開く');
    cta.className = 'contact-cta';
    a.append(text('strong', c.title), lead, cta);
    els.contactLinks.appendChild(a);
  });
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
  // canvas より前に入れて、赤い線が映像の上に重なるようにする
  els.videoHolder.insertBefore(els.video, els.videoOverlay);
  els.videoCard.hidden = false;
  buildVideoNav();
  drawGuides();
}

/* ------------------------ 動画に重ねる赤いガイド線 ------------------------ */

/*
 * 線は「アドレスの骨格から 1 回だけ」引いて、そのまま固定します。
 * スイング中の骨格に追わせると線が体と一緒に動いてしまい、クラブが
 * その線をどう通ったかが読めなくなるためです。
 *
 * 骨格検出のズレで線が合わないことがあるので、手で動かせるようにしています。
 * current.guides に正規化座標（x は幅の割合、y は高さの割合）で持ちます。
 */
let guideEditing = false;
let guideDrag = null;

/*
 * アドレスのコマの画像から実際のシャフトを探し、見つかればその先端（＝ヘッド＝ボール）
 * を使って、シャフトの線と首の付け根の線を引き直します。
 * 見つからなければ何もしません（クラブのライ角からの推定のまま）。
 */
async function applyShaftDetection() {
  const { frames, keys, opt } = current;
  current.shaftFound = false;
  if (opt.mode === 'photo' || opt.view !== 'side' || keys.address === undefined) return;

  const f = frames[keys.address];
  const w = els.video.videoWidth, h = els.video.videoHeight;
  if (!f || !f.lms || !w || !h) return;

  await seekTo(els.video, f.t);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(els.video, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const gray = { data: new Uint8Array(w * h), width: w, height: h };
  for (let i = 0, j = 0; j < gray.data.length; i += 4, j++) {
    gray.data[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
  }

  const S = sides(opt.hand);
  const L = f.lms;
  const hand = { x: (L[LM.lWrist].x + L[LM.rWrist].x) / 2 * w,
    y: (L[LM.lWrist].y + L[LM.rWrist].y) / 2 * h };
  const ground = Math.max(L[S.lead.ankle].y, L[S.trail.ankle].y,
    L[S.lead.heel].y, L[S.trail.heel].y) * h;
  const toward = Math.sign((L[S.lead.foot].x + L[S.trail.foot].x)
    - (L[S.lead.ankle].x + L[S.trail.ankle].x)) || 1;

  const drop = ground - hand.y;
  if (drop <= 0) return;
  // いちばん寝たクラブ（地面と 45°）でも届く長さまで探す
  const maxLen = drop / Math.sin(45 * Math.PI / 180);

  const found = detectShaft(gray, hand, toward, maxLen);
  if (!found) return;

  current.shaftFound = true;
  const ball = { x: found.head.x / w, y: found.head.y / h };
  for (const l of planeLines(L, opt.hand, ball, opt.aspect)) {
    const i = current.guides.findIndex(g => g.id === l.id);
    if (i >= 0) current.guides[i] = l;
    else current.guides.push(l);
  }
}

/** 線がどうやって引かれたかを画面に出す */
function showShaftStatus() {
  if (!els.shaftStatus) return;
  if (!current || current.opt.view !== 'side' || current.opt.mode === 'photo') {
    els.shaftStatus.textContent = '';
    return;
  }
  els.shaftStatus.textContent = current.shaftFound
    ? '映像から実際のシャフトを見つけて線を引きました。'
    : 'シャフトを見つけられなかったので、クラブのライ角からの推定で引いています。ズレていたら手で直してください。';
}

/** アドレスのコマから線を引き直す（診断のたびに呼ぶ） */
function initGuides() {
  if (!current) return;
  const { frames, keys, opt } = current;
  const a = keys.address !== undefined && frames[keys.address] && frames[keys.address].lms;
  current.guides = a ? guideLines(a, opt.hand, opt.view, opt.club, opt.aspect) : [];
  current.selectedGuide = null;
}

function drawGuides() {
  const cv = els.videoOverlay;
  if (!current || !current.opt || current.opt.mode === 'photo' || els.videoCard.hidden) return;

  const w = els.video.clientWidth, h = els.video.clientHeight;
  if (!w || !h) return;
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (!els.guideToggle.checked) return;

  const lines = current.guides || [];
  ctx.save();
  ctx.lineCap = 'round';
  const lw = Math.max(2, Math.round(w / 220));
  lines.forEach((l, i) => {
    const selected = guideEditing && i === current.selectedGuide;
    ctx.strokeStyle = selected ? '#ffb020' : '#e5322d';
    ctx.lineWidth = selected ? lw + 2 : lw;
    ctx.beginPath();
    ctx.moveTo(l.from.x * w, l.from.y * h);
    ctx.lineTo(l.to.x * w, l.to.y * h);
    ctx.stroke();

    // 手で動かせるときは、端に丸いつまみを出す
    if (guideEditing) {
      ctx.fillStyle = selected ? '#ffb020' : '#e5322d';
      for (const p of [l.from, l.to]) {
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, lw + 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
  ctx.restore();
}

els.video.addEventListener('loadedmetadata', drawGuides);
window.addEventListener('resize', drawGuides);
els.guideToggle.addEventListener('change', drawGuides);

/** 再生速度を変えて、ボタンの見た目もそろえる */
function setSpeed(rate) {
  els.video.playbackRate = rate;
  for (const o of document.querySelectorAll('.speed-btn')) {
    o.classList.toggle('active', Number(o.dataset.rate) === rate);
  }
}
for (const b of document.querySelectorAll('.speed-btn')) {
  b.addEventListener('click', () => setSpeed(Number(b.dataset.rate)));
}

/* -------------------- 診断のあとに一度スローで見せる -------------------- */

/*
 * 結果が出たら、赤い線を入れたまま 0.5 倍速でスイングを 1 回流し、
 * 終わったらアドレスで止めます。そのあとはポジションのボタンで見ていけます。
 */
let reviewTimer = 0;
function stopSlowReview() { if (reviewTimer) { clearInterval(reviewTimer); reviewTimer = 0; } }

async function slowReview() {
  stopSlowReview();
  stopTour();
  if (!current || current.opt.mode === 'photo') return;
  const { frames, keys } = current;
  if (keys.address === undefined) return;

  setSpeed(0.5);
  /*
   * 流すのはアドレスからフィニッシュまでだけ。前後を足すと、構え直しや
   * 振り終わったあとの余計な動きまで見せることになるためです。
   */
  const last = keys.finish !== undefined ? keys.finish : keys.impact;
  const start = frames[keys.address].t;
  const end = last !== undefined ? frames[last].t : els.video.duration;
  if (!(end > start)) { jumpToPhase('address'); return; }

  await seekTo(els.video, start);
  drawGuides();
  try {
    await els.video.play();
  } catch (e) {
    jumpToPhase('address');                 // 自動再生が止められた端末ではアドレスで待つ
    return;
  }
  reviewTimer = setInterval(() => {
    if (els.video.paused) { stopSlowReview(); return; }
    if (els.video.currentTime >= end) { stopSlowReview(); jumpToPhase('address'); }
  }, 60);
}
els.replayBtn.addEventListener('click', () => { stopTour(); slowReview(); });

/* ---------------------- コメント付きスロー（自動で解説） ---------------------- */

/*
 * 0.5 倍速で流しながら、各ポジションで止まって右側にそのポジションの
 * 注意点を出します。読み終わるころに次のポジションへ進みます。
 */
const TOUR_PAUSE = 8000;                       // 各ポジションで止まる時間（ミリ秒）
let tourToken = 0;

function stopTour() {
  tourToken++;
  els.video.pause();
  els.tourBtn.classList.remove('active');
  els.tourBtn.textContent = 'コメント付きスロー';
}

/** 指定の時刻まで再生して止める。途中で中断されたら false */
function playUntil(t, token) {
  return new Promise(resolve => {
    const tick = () => {
      if (token !== tourToken) { clearInterval(id); resolve(false); return; }
      if (els.video.paused || els.video.currentTime >= t) {
        clearInterval(id);
        els.video.pause();
        resolve(token === tourToken);
      }
    };
    const id = setInterval(tick, 50);
    els.video.play().catch(() => { clearInterval(id); resolve(false); });
  });
}

const waitMs = (ms, token) => new Promise(r => setTimeout(() => r(token === tourToken), ms));

async function commentedTour() {
  stopSlowReview();
  stopTour();
  if (!current || current.opt.mode === 'photo') return;
  const { frames, keys } = current;
  const order = PHASE_ORDER.filter(p => keys[p] !== undefined);
  if (order.length < 2) return;

  const token = ++tourToken;
  els.tourBtn.classList.add('active');
  els.tourBtn.textContent = '止める';
  setSpeed(0.5);

  await seekTo(els.video, frames[keys[order[0]]].t);
  if (token !== tourToken) return;
  showPhaseNotes(order[0]);
  drawGuides();
  if (!await waitMs(TOUR_PAUSE, token)) return;

  for (let i = 1; i < order.length; i++) {
    if (!await playUntil(frames[keys[order[i]]].t, token)) return;
    showPhaseNotes(order[i]);
    drawGuides();
    if (!await waitMs(TOUR_PAUSE, token)) return;
  }
  stopTour();
  jumpToPhase(order[0]);
}

els.tourBtn.addEventListener('click', () => {
  if (els.tourBtn.classList.contains('active')) stopTour();
  else commentedTour();
});

/* ---------------------------- 線を手で動かす ---------------------------- */

/** 画面上の座標（0〜1）を返す */
function guidePoint(e) {
  const r = els.videoOverlay.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
    y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
  };
}

/** その位置にいちばん近い線と、つかんだ場所（端か、線そのものか）を返す */
function guideHit(p) {
  const w = els.videoOverlay.width || 1, h = els.videoOverlay.height || 1;
  const px = { x: p.x * w, y: p.y * h };
  const grab = Math.max(14, w / 22);            // 指でもつまめる大きさ
  let best = null;

  (current.guides || []).forEach((l, i) => {
    const a = { x: l.from.x * w, y: l.from.y * h };
    const b = { x: l.to.x * w, y: l.to.y * h };
    for (const [end, q] of [['from', a], ['to', b]]) {
      const d = Math.hypot(px.x - q.x, px.y - q.y);
      if (d < grab && (!best || d < best.d)) best = { index: i, end, d };
    }
    // 線そのものをつかんだら、線ごと平行移動する
    const vx = b.x - a.x, vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    if (len2 > 0) {
      const t = Math.max(0, Math.min(1, ((px.x - a.x) * vx + (px.y - a.y) * vy) / len2));
      const d = Math.hypot(px.x - (a.x + vx * t), px.y - (a.y + vy * t));
      if (d < grab && (!best || d < best.d - 1)) best = { index: i, end: null, d };
    }
  });
  return best;
}

els.videoOverlay.addEventListener('pointerdown', e => {
  if (!guideEditing || !current) return;
  const p = guidePoint(e);
  const hit = guideHit(p);
  current.selectedGuide = hit ? hit.index : null;
  if (hit) {
    guideDrag = { ...hit, last: p };
    els.videoOverlay.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  updateGuideButtons();
  drawGuides();
});

els.videoOverlay.addEventListener('pointermove', e => {
  if (!guideDrag) return;
  const p = guidePoint(e);
  const l = current.guides[guideDrag.index];
  if (guideDrag.end) {
    l[guideDrag.end] = p;                        // つまんだ端だけ動かす
  } else {
    const dx = p.x - guideDrag.last.x, dy = p.y - guideDrag.last.y;
    l.from = { x: l.from.x + dx, y: l.from.y + dy };
    l.to = { x: l.to.x + dx, y: l.to.y + dy };
  }
  guideDrag.last = p;
  setDirty(true);                                // 直した線で作り直せることを知らせる
  drawGuides();
  e.preventDefault();
});

const endGuideDrag = () => { guideDrag = null; };
els.videoOverlay.addEventListener('pointerup', endGuideDrag);
els.videoOverlay.addEventListener('pointercancel', endGuideDrag);

/** 編集中だけ canvas がタップを受ける（ふだんは再生ボタンを塞がない） */
function setGuideEditing(on) {
  if (on) { stopTour(); stopSlowReview(); }
  guideEditing = on;
  els.videoOverlay.classList.toggle('editing', on);
  els.guideEdit.classList.toggle('active', on);
  els.guideEdit.textContent = on ? '動かすのをやめる' : '線を動かす';
  if (on) els.video.pause();
  else { current.selectedGuide = null; refreshAllFrames(); }
  updateGuideButtons();
  drawGuides();
}

function updateGuideButtons() {
  const n = (current && current.guides ? current.guides.length : 0);
  els.guideAdd.disabled = !guideEditing || n >= 8;
  els.guideDel.disabled = !guideEditing || current.selectedGuide === null;
  els.guideReset.disabled = !guideEditing;
}

/** 編集をやめたら、各ポジションの画像も新しい線で描き直す */
async function refreshAllFrames() {
  if (!current) return;
  for (const phase of PHASE_ORDER) {
    if (current.keys[phase] !== undefined) await refreshFrame(phase);
  }
}

els.guideEdit.addEventListener('click', () => setGuideEditing(!guideEditing));

els.guideAdd.addEventListener('click', () => {
  if (!current) return;
  // 画面の真ん中に、まっすぐな線を 1 本足す。あとは端をつまんで合わせる
  current.guides.push({ id: 'manual', from: { x: 0.5, y: 0.1 }, to: { x: 0.5, y: 0.9 } });
  current.selectedGuide = current.guides.length - 1;
  setDirty(true);
  updateGuideButtons();
  drawGuides();
});

els.guideDel.addEventListener('click', () => {
  if (!current || current.selectedGuide === null) return;
  current.guides.splice(current.selectedGuide, 1);
  current.selectedGuide = null;
  setDirty(true);
  updateGuideButtons();
  drawGuides();
});

els.guideReset.addEventListener('click', async () => {
  initGuides();
  drawGuides();
  // 戻すときも、もう一度映像からシャフトを探す（推定に落ちたままにしない）
  await applyShaftDetection();
  showShaftStatus();
  updateGuideButtons();
  drawGuides();
});

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
  if (!current) return;
  const { keys, opt } = current;
  if (!keys || opt.mode === 'photo') return;

  for (const phase of PHASE_ORDER) {
    if (keys[phase] === undefined) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'video-nav-btn';
    b.dataset.phase = phase;
    b.textContent = shortPhaseLabel(phase);
    b.addEventListener('click', () => { stopTour(); jumpToPhase(phase); });
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
  if (!current) return;
  const { keys, frames } = current;
  if (!keys || keys[phase] === undefined) return;
  els.video.pause();
  els.video.currentTime = frames[keys[phase]].t;
  showPhaseNotes(phase);
}

/**
 * 今の再生位置にいちばん近いポジションへ切り替える。
 * 設定画面で範囲を決めているあいだや解析中も pause / seeked は飛んでくるので、
 * まだ診断結果がないときは何もしません（ここで落ちると解析中ずっと例外が出ます）。
 */
function syncPhaseToVideo() {
  if (!current || current.opt.mode === 'photo') return;
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

  // まず総評
  const summary = buildPhaseSummary(items);
  if (summary) box.appendChild(summary);

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
/*
 * 動画がスイングの途中で終わっていないかを見ます。
 *
 * インパクトのすぐあとで映像が切れていると、フォローもフィニッシュも
 * 「残っている最後の数コマ」に押し込まれ、まったく別の姿勢で判定されます。
 * 実測した動画では、インパクト 12.37 秒に対して映像が 12.55 秒で終わっており、
 * フォロー 12.43 秒・フィニッシュ 12.50 秒と 0.07 秒刻みになっていました。
 * 直しようがないので、撮り直しの目安として知らせます。
 */
function swingCutOff(keys) {
  const { frames } = current || {};
  if (!frames || keys.impact === undefined || keys.finish === undefined) return null;
  const after = frames[frames.length - 1].t - frames[keys.impact].t;
  if (after >= 0.5) return null;
  return `インパクトのあと ${after.toFixed(2)} 秒で映像が終わっています。`
    + 'フォローとフィニッシュは振り抜いた姿勢まで写っていないため、'
    + 'この 2 つの判定はあてになりません。振り終わって静止するまで（インパクトの 1 秒後くらいまで）'
    + '撮ると、正しく判定できます。';
}

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

      const cut = swingCutOff(keys);
      if (cut) {
        const warn = text('span', cut);
        warn.className = 'mode-warn';
        els.modeNote.append(warn);
      }
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

/*
 * そのポジションの総評。項目ごとの点数からその場で作ります。
 * 項目を上から順に読まなくても、そのポジションが良いのか、どこから
 * 直せばいいのかが一目で分かるように、カードの先頭に置きます。
 */
function phaseSummary(items) {
  if (!items.length) return null;
  const one = items.length === 1;                  // 1 項目のときは言い回しを変える
  const off = items.filter(i => i.score < 90);
  if (!off.length) {
    return (one ? 'このポジションは基準内です。' : `${items.length} 項目すべてが基準内です。`)
      + 'この形を崩さないようにしてください。';
  }
  const worst = items.reduce((a, b) => (b.score < a.score ? b : a));
  const kind = off.some(i => i.score < 60) ? '基準を外れています' : '基準の境目です';
  return (one ? `このポジションは${kind}。`
    : `${items.length} 項目のうち ${off.length} 項目が${kind}。`)
    + `まずは「${worst.label}」から直してください。`;
}

/** 総評の 1 行を作る（見出しの直後に置く） */
function buildPhaseSummary(items) {
  const text2 = phaseSummary(items);
  if (!text2) return null;
  const box = document.createElement('p');
  const worstScore = items.reduce((a, b) => Math.min(a, b.score), 100);
  box.className = 'phase-summary '
    + (worstScore >= 90 ? 's-good' : worstScore >= 60 ? 's-warn' : 's-bad');
  box.textContent = text2;
  return box;
}

/*
 * クラブごとのアドレスの目安（CLUBS の中身）を出す表。
 * 判定と計測値は、すぐ下に続くアドレスの診断項目がそのまま担うので、
 * ここでは「言葉での目安」だけを出します（同じ数字を 2 か所に出さないため）。
 *
 * view はその項目を確かめられるカメラの位置。撮った角度に合う行だけを出します。
 * ボールの位置は帯を正面のアドレス画像にだけ描いているので front です。
 */
const REF_ROWS = [
  { label: 'ボールの位置', field: 'ball', view: 'front' },
  { label: 'スタンスの幅', field: 'stance', view: 'front' },
  { label: '左右の重心', field: 'balance', view: 'front' },
  { label: '前傾角', field: 'spine', view: 'side' },
  { label: '手元の位置', field: 'hands', view: 'side' }
];

/* 角度を変えて撮ると出る項目の案内文（表から消えた行の行き先を示すため） */
const REF_NOTE = {
  front: '正面から確かめられる項目だけを出しています。前傾角と手元の位置は、後方から撮ると出ます。',
  side: '後方から確かめられる項目だけを出しています。ボールの位置・スタンスの幅・左右の重心は、正面から撮ると出ます。'
};

/**
 * アドレスのカードの先頭に置く「このクラブの目安」。
 * 以前は独立したカードで計測値と判定まで出していましたが、すぐ下のアドレスの
 * 診断項目とまるごと重複していたので、言葉の目安だけをここに残しました。
 */
function buildClubGuide(club, opt) {
  const c = CLUBS[club];
  const box = document.createElement('div');
  box.className = 'club-guide';
  box.appendChild(text('h4', `${c.label} で構えるときの目安`));

  const table = document.createElement('table');
  table.className = 'ref-table';
  for (const row of REF_ROWS.filter(r => r.view === opt.view)) {
    const tr = document.createElement('tr');
    tr.append(text('th', row.label), text('td', c[row.field]));
    table.appendChild(tr);
  }
  box.appendChild(table);

  const note = text('p', REF_NOTE[opt.view] || '');
  note.className = 'note';
  box.appendChild(note);
  return box;
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
    // まず総評。そのあとに個々の項目を並べる
    const summary = buildPhaseSummary(items);
    if (summary) col.appendChild(summary);
    // アドレスだけ、クラブごとの目安を続けて置く（以前は独立したカードでした）
    if (phase === 'address') col.appendChild(buildClubGuide(opt.club, opt));
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
    // 赤いガイド線は全ポジションに重ねる（動画のスロー再生と同じ線）
    drawGuideLines(ctx, map, w);
    if (phase === 'address' && opt.view === 'front') {
      drawBallZone(ctx, frame.lms, map, opt.hand, opt.club, h);
    }
  }
  return canvas;
}

/*
 * 切り出し画像にも、動画と同じ赤いガイド線を重ねる。
 * 線はアドレスで固定した current.guides をそのまま使うので、どのポジションの
 * 画像でも同じ位置に出ます（クラブがその線をどう通ったかを見るため）。
 */
function drawGuideLines(ctx, map, canvasW) {
  const lines = (current && current.guides) || [];
  if (!lines.length) return;
  ctx.save();
  ctx.strokeStyle = '#e5322d';
  ctx.lineWidth = Math.max(2, Math.round(canvasW / 220));
  ctx.lineCap = 'round';
  for (const l of lines) {
    ctx.beginPath();
    const a = map(l.from), b = map(l.to);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
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
  // 前回の結果を捨てる。残しておくと、次の動画を選んでいる最中の pause / seeked で
  // 前のスイングの注意点に切り替わってしまいます
  stopSlowReview();
  stopTour();
  current = null;
  els.videoNav.innerHTML = '';
  els.videoNotes.innerHTML = '';
  els.videoOverlay.getContext('2d').clearRect(0, 0, els.videoOverlay.width, els.videoOverlay.height);
  els.videoCard.hidden = true;
  els.result.hidden = true;
  els.setup.hidden = false;
  updateAnalyzeButton();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
