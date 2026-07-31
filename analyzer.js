/* ============================================================================
 * analyzer.js — 姿勢推定と計測のエンジン
 * ----------------------------------------------------------------------------
 * MediaPipe Pose で動画の各フレームから 33 点の骨格を取り出し、
 * スイングのキーフレームを自動検出して、criteria.js の各項目に対応する数値を
 * 計算します。診断のしきい値やコメントはここには書きません（criteria.js 側）。
 *
 * 【重要な制約】
 *   骨格検出はクラブを認識しません。シャフトの向き、フェースの向き、
 *   グリップエンドの方向、クラブヘッドの軌道は自動計測できないため、
 *   criteria.js の VISUAL_CHECKS（目視チェックリスト）に回しています。
 * ==========================================================================*/

/* MediaPipe Pose のランドマーク番号 */
const LM = {
  nose: 0,
  lEar: 7, rEar: 8,
  lShoulder: 11, rShoulder: 12,
  lElbow: 13, rElbow: 14,
  lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24,
  lKnee: 25, rKnee: 26,
  lAnkle: 27, rAnkle: 28,
  lHeel: 29, rHeel: 30,
  lFoot: 31, rFoot: 32
};

/** 右打ち／左打ちに応じた「リード側（前）」「トレール側（後ろ）」の対応表 */
function sides(handedness) {
  const L = {
    shoulder: LM.lShoulder, elbow: LM.lElbow, wrist: LM.lWrist, hip: LM.lHip,
    knee: LM.lKnee, ankle: LM.lAnkle, heel: LM.lHeel, foot: LM.lFoot
  };
  const R = {
    shoulder: LM.rShoulder, elbow: LM.rElbow, wrist: LM.rWrist, hip: LM.rHip,
    knee: LM.rKnee, ankle: LM.rAnkle, heel: LM.rHeel, foot: LM.rFoot
  };
  return handedness === 'left' ? { lead: R, trail: L } : { lead: L, trail: R };
}

/* --------------------------- 解析範囲の決め方 -----------------------------
 * 長い動画では、スイングの前に構え直しやワッグル、素振り、歩いて入ってくる場面が
 * 入ります。先頭から一定秒数を切り出すとスイングそのものを取り逃がすため、まず
 * 動画全体を粗くスキャンして「手元が最も速く動いた瞬間＝インパクト付近」を見つけ、
 * その前後だけを本番の骨格検出にかけます。
 *
 * 粗いスキャンにも骨格検出を使います。画素の差分で代用すると、被写体が小さく
 * 背景が木立や観客のように動く映像で、風で揺れる背景のほうが大きな変化として
 * 検出されてしまい、まったく違う時刻を指してしまうためです。
 * ------------------------------------------------------------------------*/
const SAMPLE_FPS = 30;            // 本番の骨格検出のフレームレート
const SCAN_FPS_MAX = 10;          // 粗いスキャンの上限フレームレート
const SCAN_FRAME_BUDGET = 250;    // 粗いスキャンで処理する最大コマ数
const SCAN_MAX_SECONDS = 90;      // これより長い動画は先頭 90 秒だけを対象にする
const SHORT_VIDEO = 8;            // これ以下の動画はスキャンせず全体を解析する
const WINDOW_BEFORE = 2.5;        // インパクトの何秒前から解析するか
const WINDOW_AFTER = 2.0;         // 何秒後まで解析するか

/* --------------------------------- 幾何 ---------------------------------- */

const deg = r => r * 180 / Math.PI;
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** b を頂点とする a-b-c のなす角（度） */
function jointAngle(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const m1 = Math.hypot(v1.x, v1.y), m2 = Math.hypot(v2.x, v2.y);
  if (!m1 || !m2) return NaN;
  return deg(Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (m1 * m2)))));
}

/** 下の点から上の点へ向かうベクトルが、垂直線から何度傾いているか（signDir 方向を正とする） */
function tiltFromVertical(lower, upper, signDir = 1) {
  const dx = (upper.x - lower.x) * signDir;
  const dy = lower.y - upper.y;              // 画像座標は下が正なので反転
  return deg(Math.atan2(dx, dy));
}

/**
 * 肘の角度を、前後数コマの中央値で求める。
 *
 * 手首と肘の検出は、速く動くコマでは大きく揺れます。実測では、ずっと伸びている
 * 腕なのに 145〜170° の範囲で 1 コマごとに散りました。1 コマだけを見ると、
 * たまたま低い値のコマに当たって「曲がっている」と誤判定します。
 */
function medianElbow(frames, index, side, conv) {
  const center = frames[index];
  if (!center || !center.lms) return NaN;

  const angleAt = p => jointAngle(conv(p[side.shoulder]), conv(p[side.elbow]), conv(p[side.wrist]));
  const vals = [angleAt(center.lms)].filter(v => !isNaN(v));

  // 前後のコマを混ぜてよいのは、時間的に隣り合っている場合だけ。写真モードでは
  // 隣が「別のポジションの写真」なので、時刻が動かないことで見分けて除きます。
  for (let i = index - 2; i <= index + 2; i++) {
    if (i === index) continue;
    const f = frames[i];
    if (!f || !f.lms) continue;
    const dt = Math.abs(f.t - center.t);
    if (dt <= 0 || dt > 0.2) continue;
    const a = angleAt(f.lms);
    if (!isNaN(a)) vals.push(a);
  }
  if (!vals.length) return NaN;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)];
}

/** 直線 a→b から点 p までの距離 */
function distanceToLine(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return dist(p, a);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/** 腕（肩→手首）が水平からどれだけ傾いているか（度・絶対値） */
function armFromHorizontal(lms, side) {
  const s = lms[side.shoulder], w = lms[side.wrist];
  const dx = Math.abs(w.x - s.x);
  if (dx < 1e-6) return 90;
  return Math.abs(deg(Math.atan2(w.y - s.y, dx)));
}

/* ---------------------- 動画からフレーム単位で骨格を取る ------------------- */

function seekTo(video, t) {
  return new Promise(resolve => {
    const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = t;
  });
}

/**
 * 動画全体を粗くスキャンして、スイングが写っている範囲を割り出す。
 *
 * 全体を低いフレームレートで骨格検出にかけ、手元（両手首の中点）が最も速く動いた
 * 瞬間をインパクト付近とみなして、その前後を解析範囲として返します。
 * 短い動画はスキャンせず全体を対象にします。
 */
async function findSwingWindow(video, pose, onProgress) {
  const duration = Math.min(video.duration, SCAN_MAX_SECONDS);
  if (duration <= SHORT_VIDEO) {
    return { from: 0, to: duration, scanned: false };
  }

  // 長い動画ほど間隔を広げて、処理するコマ数が増えすぎないようにする
  const fps = Math.max(2, Math.min(SCAN_FPS_MAX, SCAN_FRAME_BUDGET / duration));
  const step = 1 / fps;

  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 480 / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext('2d');

  let latest = null;
  pose.onResults(r => { latest = r; });

  const samples = [];
  for (let t = 0; t < duration; t += step) {
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    latest = null;
    await pose.send({ image: canvas });
    const lms = latest && latest.poseLandmarks;
    samples.push({ t, hand: lms ? mid(lms[LM.lWrist], lms[LM.rWrist]) : null });
    if (onProgress) onProgress(t / duration);
  }

  const raw = samples.map((s, i) => (i === 0 || !s.hand || !samples[i - 1].hand) ? 0
    : Math.hypot(s.hand.x - samples[i - 1].hand.x, s.hand.y - samples[i - 1].hand.y));

  // スイングは数コマにわたって速いが、検出の乱れは1コマだけ。中央値で後者を落とす
  let peakT = duration / 2, peakV = -1;
  for (let i = 0; i < raw.length; i++) {
    const lo = Math.max(0, i - 2), hi = Math.min(raw.length - 1, i + 2);
    const w = raw.slice(lo, hi + 1).sort((a, b) => a - b);
    const v = w[Math.floor(w.length / 2)];
    if (v > peakV) { peakV = v; peakT = samples[i].t; }
  }

  return {
    from: Math.max(0, peakT - WINDOW_BEFORE),
    to: Math.min(duration, peakT + WINDOW_AFTER),
    scanned: true,
    peak: peakT
  };
}

/**
 * 指定した範囲を 1 コマずつ走査して、フレームごとのランドマーク配列を返す。
 * range を省略すると先頭から SHORT_VIDEO 秒までを対象にします。
 * onProgress(0..1) で進捗を通知します。
 */
async function extractPoseSequence(video, pose, onProgress, range) {
  const from = range ? range.from : 0;
  const to = range ? range.to : Math.min(video.duration, SHORT_VIDEO);
  const span = Math.max(to - from, 1e-6);
  const step = 1 / SAMPLE_FPS;

  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 640 / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext('2d');

  const frames = [];
  let latest = null;
  pose.onResults(res => { latest = res; });

  for (let t = from; t < to; t += step) {
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    latest = null;
    await pose.send({ image: canvas });

    // 時刻は「要求した t」ではなく、シーク後に実際に止まった位置を記録します。
    // 動画のシークは要求どおりの位置に止まるとは限らず、近くのコマにずれます。
    // 要求値のまま記録すると、コマ間隔が実際とずれてテンポの計算が狂います。
    const actual = isFinite(video.currentTime) ? video.currentTime : t;
    frames.push({ t: actual, lms: latest && latest.poseLandmarks ? latest.poseLandmarks : null });
    if (onProgress) onProgress((t - from) / span);
  }
  return { frames };
}

/**
 * ポジションごとの写真から骨格を取り出す。
 *
 * images は { address: <img>, top: <img>, ... } の形。用意された写真だけを処理し、
 * 動画のときと同じ { frames, keys } を返します。時刻はすべて 0 なので、
 * テンポのように時間差から求める項目は自動的に対象外になります。
 *
 * 呼び出す前に pose.setOptions({ smoothLandmarks: false }) にしてください。
 * 連続したフレームではないので、前の写真の結果を引きずらせないためです。
 */
async function extractPoseFromImages(images, pose, onProgress) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const frames = [], keys = {};
  const entries = Object.entries(images);

  let latest = null;
  pose.onResults(res => { latest = res; });

  let done = 0;
  for (const [phase, img] of entries) {
    const scale = Math.min(1, 640 / img.naturalWidth);
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    latest = null;
    await pose.send({ image: canvas });

    keys[phase] = frames.length;
    frames.push({ t: 0, img, lms: latest && latest.poseLandmarks ? latest.poseLandmarks : null });
    if (onProgress) onProgress(++done / entries.length);
  }
  return { frames, keys };
}

/* --------------------------- キーフレームの検出 --------------------------- */

/**
 * 手元（両手首の中点）の動きからスイングの節目を割り出す。
 *
 *  address   … 手元が動き出す直前
 *  backswing … アドレス〜トップで、リード腕が最も水平に近いフレーム
 *  top       … アドレス〜最高速点で、手元が最も高く上がったフレーム
 *  downswing … トップ〜インパクトで、リード腕が最も水平に近いフレーム
 *  impact    … トップ以降で、手元の高さがアドレスまで戻ってきた最初のフレーム
 *  follow    … インパクト〜フィニッシュで、トレール腕が最も水平に近いフレーム
 *  finish    … 手元の動きが止まるフレーム
 *
 * 「速度が最小の点をトップとみなす」方式は、インパクト直後の減速やフィニッシュ
 * 手前の緩みを拾ってしまうため採用していません。ダウンスイングの最高速点
 * （＝インパクト付近）を先に確定させ、そこから前を遡って探します。
 */
function detectKeyFrames(frames, handedness) {
  const S = sides(handedness);

  // visibility は使いません。実際のスイング動画で確認したところ、手が速く動く
  // バックスイングからフィニッシュにかけて visibility は 0.01〜0.46 まで下がり、
  // 「はっきり写っていないコマを除く」と、肝心のスイングごと落ちてしまいます。
  const hand = frames.map(f => f.lms ? mid(f.lms[LM.lWrist], f.lms[LM.rWrist]) : null);
  if (hand.filter(Boolean).length < 10) return null;

  /*
   * 手元の「高さ」だけを使って節目を決めます。
   *
   * 速度の最大点をインパクトとみなす方式は使えません。被写体が画面内で小さいと手首の
   * 検出が数ピクセル揺れ、その見かけの速度が実際のインパクトと同じか、それ以上に
   * なります（実測: インパクト 0.056 に対し、フィニッシュで手が頭に重なるあたりの
   * 揺れが 0.081）。骨格検出は実行のたびに結果が微妙に変わるため、どちらが勝つかも
   * 安定しません。
   *
   * 一方、手元の高さはアドレスからトップまで画面の 3 割ほども動くので、
   * 数ピクセルの揺れには埋もれません。
   */
  const smooth = pick => {
    const raw = hand.map(h => h ? pick(h) : null);
    return raw.map((_, i) => {
      const w = [];
      for (let k = Math.max(0, i - 2); k <= Math.min(raw.length - 1, i + 2); k++) {
        if (raw[k] !== null) w.push(raw[k]);
      }
      if (!w.length) return null;
      w.sort((a, b) => a - b);
      return w[Math.floor(w.length / 2)];             // 1コマだけの飛びを消す
    });
  };
  const Y = smooth(h => h.y);
  const X = smooth(h => h.x);

  const dt = frames.length > 1
    ? (frames[frames.length - 1].t - frames[0].t) / (frames.length - 1) : 1 / SAMPLE_FPS;
  const fps = dt > 0 ? 1 / dt : SAMPLE_FPS;
  const need = Math.max(3, Math.round(0.20 * fps));   // 静止と認めるのに要る連続フレーム数

  /* 1. トップ = 手元が高く上がっている「最初のかたまり」の中で最も高いフレーム
   *
   *    全体の最小値をそのまま採ると、フィニッシュで手がトップと同じ高さまで
   *    上がる人ではフィニッシュをトップと取り違えます。トップのあとには必ず
   *    手元がアドレスの高さまで下りてくる（インパクト）ので、先に現れるほうを採ります。 */
  let ymin = Infinity, ymax = -Infinity;
  for (const v of Y) if (v !== null) { if (v < ymin) ymin = v; if (v > ymax) ymax = v; }
  if (!isFinite(ymin) || ymax <= ymin) return null;

  const HIGH = ymin + (ymax - ymin) * 0.20;           // 「手元が高い」とみなす高さ
  const gap = Math.max(2, Math.round(0.10 * fps));    // 一瞬これを外れても同じ山とみなす

  let gs = -1, ge = -1, out = 0;
  for (let i = 0; i < Y.length; i++) {
    if (Y[i] !== null && Y[i] <= HIGH) { if (gs < 0) gs = i; ge = i; out = 0; }
    else if (gs >= 0 && ++out > gap) break;
  }
  if (gs < 0) return null;

  // 中央値で均すと頂点が平らになるので、同じ高さが並ぶ区間の「真ん中」を採る。
  // 単純に最小値の先頭を採ると、なだらかな山では手前にずれます。
  const EPS = (ymax - ymin) * 0.005;
  const highest = (lo, hi, pick) => {
    let best = Infinity;
    for (let i = lo; i <= hi; i++) if (Y[i] !== null && Y[i] < best) best = Y[i];
    const flat = [];
    for (let i = lo; i <= hi; i++) if (Y[i] !== null && Y[i] <= best + EPS) flat.push(i);
    if (!flat.length) return lo;
    // トップはなだらかな山なので真ん中。フィニッシュは形を作って静止するので、
    // その姿勢になった最初のコマを採る（長く止まっていても位置がずれない）。
    return pick === 'first' ? flat[0] : flat[Math.floor((flat.length - 1) / 2)];
  };

  const top = highest(gs, ge);
  if (top <= 0) return null;

  /* 2. アドレス = トップから遡って見つかる「手元が上下しなくなる区間」の終わり
   *    動画の先頭から探すとワッグルや素振りを拾うため、必ずトップから遡ります。 */
  const rise = Math.max(ymax - ymin, 1e-6);           // バックスイングで手元が上がる量
  const STILL = rise * 0.008;                         // 1コマの移動がこの程度なら静止

  /* 静止しているかは「上下」だけでなく「上下左右」で見ます。
   * テイクバックの序盤は手元がほぼ真横に動くので、上下だけで判定すると
   * まだ止まっていると誤認し、アドレスが実際より遅い位置になります。
   * するとバックスイングが短く測られ、テンポが実際より速く出てしまいます。 */
  const move = i => (i <= 0 || X[i] === null || X[i - 1] === null || Y[i] === null || Y[i - 1] === null)
    ? 0 : Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]);

  let address = -1, run = 0;
  for (let i = top - 1; i >= 0; i--) {
    if (move(i) < STILL) {
      run++;
      if (run >= need) { address = i + run - 1; break; }   // 静止区間の末尾＝構え終わり
    } else run = 0;
  }
  if (address < 0) {
    // 構えてすぐ振り始めている場合は、テイクバックで最も動いた点から遡る
    let fastest = 0, fmax = -1;
    for (let i = 1; i <= top; i++) if (move(i) > fmax) { fmax = move(i); fastest = i; }
    let i = fastest;
    while (i > 0 && move(i) >= STILL) i--;
    address = i;
  }
  if (Y[address] === null || address >= top) return null;

  /* 3. インパクト = トップ以降で手元がいちばん低くなるコマ
   *
   *    「アドレスの高さまで戻ったところ」で決めると、アドレスが 1 コマずれただけで
   *    インパクトまで動いてしまいます。手元の軌道そのものから決めるほうが安定します。
   *    振り終わったあとにクラブを下ろす動きを拾わないよう、トップから 1.5 秒で打ち切ります。 */
  const lowest = (lo, hi) => {
    let best = -Infinity;
    for (let i = lo; i <= hi; i++) if (Y[i] !== null && Y[i] > best) best = Y[i];
    const flat = [];
    for (let i = lo; i <= hi; i++) if (Y[i] !== null && Y[i] >= best - EPS) flat.push(i);
    return flat.length ? flat[Math.floor((flat.length - 1) / 2)] : lo;
  };
  const searchTo = Math.min(Y.length - 1, top + Math.round(1.5 * fps));
  const impact = top + 1 <= searchTo ? lowest(top + 1, searchTo) : -1;
  if (impact < 0) return null;

  /* 4. フィニッシュ = インパクト以降で手元が最も高く上がったフレーム
   *    「動きが止まったところ」で探すと、検出の揺れが静止と認められず最後まで
   *    行ってしまいます。振り抜いた先で手が一番高くなる位置がフィニッシュです。 */
  let finish = impact + 1 <= Y.length - 1 ? highest(impact + 1, Y.length - 1, 'first') : impact;
  if (finish <= impact) finish = Math.min(Y.length - 1, impact + 1);
  if (!(address < top && top < impact && impact <= finish)) return null;

  /**
   * 区間 [lo, hi] で、腕が水平になる「最初の」フレームを返す。
   *
   * 区間内で最も水平に近いコマを選ぶ方式は使えません。フィニッシュで腕をたたんだ
   * 姿勢は、肘が深く曲がっていても肩と手首の高さがそろうため、そこを「腕が水平」と
   * 誤って拾い、肘が曲がっていると判定してしまいます。
   * 手首が肩の高さを最初に越える瞬間を取ります。
   */
  const armHorizontal = (lo, hi, side) => {
    let prev = null, best = lo, bestAbs = Infinity;
    for (let i = lo; i <= hi; i++) {
      const p = frames[i] && frames[i].lms;
      if (!p) continue;
      const d = p[side.wrist].y - p[side.shoulder].y;   // プラス = 手首が肩より下
      if (Math.abs(d) < bestAbs) { bestAbs = Math.abs(d); best = i; }
      if (prev !== null && d !== 0 && prev !== 0 && Math.sign(d) !== Math.sign(prev)) {
        const before = i - 1;
        return (frames[before] && frames[before].lms && Math.abs(prev) < Math.abs(d)) ? before : i;
      }
      prev = d;
    }
    return best;                                       // 越えない場合は最も水平に近いコマ
  };

  const backswing = armHorizontal(address, top, S.lead);

  /* テークバック（シャフトが地面と水平）
   *
   * クラブは検出できないので、手元の高さで代用します。シャフトが水平になるのは
   * 手元が腰の高さあたり、つまりアドレスから「左腕が水平」までの上がり幅の
   * 3 割ほど上がったところです。目視チェック用のコマなので、この近似で十分です。 */
  let takeaway = address;
  if (Y[address] !== null && Y[backswing] !== null) {
    const target = Y[address] + (Y[backswing] - Y[address]) * 0.30;
    for (let i = address + 1; i <= backswing; i++) {
      if (Y[i] !== null && Y[i] <= target) { takeaway = i; break; }
    }
  }

  return {
    address,
    takeaway,
    backswing,
    top,
    downswing: armHorizontal(top, impact, S.lead),
    impact,
    follow: armHorizontal(impact, finish, S.trail),
    finish
  };
}

/* ------------------------------- 計測 ------------------------------------ */

/**
 * キーフレームの骨格から criteria.js の各 id に対応する値を作る。
 *
 * handedness: 'right' | 'left'   view: 'front' | 'side'
 *
 * 左右の向きは骨格そのものから決めています（撮影が左右反転していても正しく動きます）。
 *   targetSign … 画面上でどちらが目標方向かの符号。リード肩とトレール肩の位置関係から決定
 *   frontSign  … 後方撮影で、どちらがボール側かの符号。足首とつま先の位置関係から決定
 *
 * 値が取れない項目は入れないので、診断側で自動的にスキップされます。
 */
function measure(frames, keys, handedness, view, aspect) {
  const S = sides(handedness);
  const at = i => frames[i] && frames[i].lms;

  /*
   * ランドマークの x と y は、それぞれ画面の幅・高さを 1 とした値です。単位が
   * 違うので、そのまま角度を出すと画面の縦横比のぶんだけ歪みます。16:9 の映像
   * では実際の 30° が 18° に見えてしまいます（実測で確認）。
   * 角度を求めるときだけ、x を高さ基準にそろえてから計算します。
   */
  const ratio = aspect || 1;
  const ac = p => ({ x: p.x * ratio, y: p.y });
  const A = at(keys.address), B = at(keys.backswing), T = at(keys.top),
    D = at(keys.downswing), I = at(keys.impact), W = at(keys.follow), F = at(keys.finish);

  // アドレスは正規化の基準（体格・頭幅・左右の向き）を決めるので必須。
  // それ以外のポジションは、欠けていればその項目だけ計測を飛ばします
  // （写真モードでは一部のポジションしか用意されないため）。
  if (!A) return {};

  const m = {};

  const shoulderC = p => mid(p[S.lead.shoulder], p[S.trail.shoulder]);
  const hipC = p => mid(p[S.lead.hip], p[S.trail.hip]);
  const handC = p => mid(p[LM.lWrist], p[LM.rWrist]);

  /* 正規化に使う基準の長さ（すべてアドレス時の値で固定） */
  const torso = dist(shoulderC(A), hipC(A)) || 1;
  const shoulderW = dist(A[S.lead.shoulder], A[S.trail.shoulder]) || 1;
  const earGap = dist(A[LM.lEar], A[LM.rEar]);
  const headW = earGap > torso * 0.1 ? earGap : torso * 0.35;   // 耳が取れない場合の保険

  /* 画面上の向き */
  const targetSign = Math.sign(A[S.lead.shoulder].x - A[S.trail.shoulder].x) || 1;
  const trailSign = -targetSign;
  const ankleMid = mid(A[S.lead.ankle], A[S.trail.ankle]);
  const footMid = mid(A[S.lead.foot], A[S.trail.foot]);
  const frontSign = Math.sign(footMid.x - ankleMid.x) || 1;

  /* ------------------------------ 全体 ------------------------------ */
  // テンポは時間差から求めるため、写真モード（すべて t=0）では自動的に求まりません。
  // アドレスは「静止区間の最後＝動き出す直前」なので、構えている時間は含まれません
  if (T && I) {
    const back = frames[keys.top].t - frames[keys.address].t;
    const down = frames[keys.impact].t - frames[keys.top].t;
    if (down > 0 && back > 0) m.tempo = back / down;
  }

  /* --------------------------- 正面からの計測 --------------------------- */
  if (view === 'front') {
    m.stanceWidth = dist(A[S.lead.ankle], A[S.trail.ankle]) / shoulderW;
    m.addressBalance = (A[LM.nose].x - ankleMid.x) * trailSign / torso;
    const bodyCenter = mid(shoulderC(A), hipC(A));
    m.handPosFront = (handC(A).x - bodyCenter.x) * targetSign / torso;

    // 右手（トレール手）が体のセンターに来ているか。0 に近いほど中央
    m.trailHandCenter = (A[S.trail.wrist].x - bodyCenter.x) * targetSign / torso;

    // 肩の傾き（トレール肩が下がっていればプラス）
    m.shoulderTilt = deg(Math.atan2(
      A[S.trail.shoulder].y - A[S.lead.shoulder].y,
      Math.abs(ac(A[S.lead.shoulder]).x - ac(A[S.trail.shoulder]).x)
    ));

    // 左腕が水平になったところ（バックスイングの途中）でのチェック
    if (B) {
      m.hipAtBackswing = (hipC(B).x - hipC(A).x) * trailSign / torso;
      m.headAtBackswing = (B[LM.nose].x - A[LM.nose].x) * trailSign / headW;
      m.leadElbowBackswing = medianElbow(frames, keys.backswing, S.lead, ac);
    }

    if (T) {
      // 肩の回転量：正面から見た肩幅の縮み具合から逆算する
      const projected = Math.abs(T[S.lead.shoulder].x - T[S.trail.shoulder].x);
      m.shoulderTurn = deg(Math.acos(Math.max(0, Math.min(1, projected / shoulderW))));

      m.hipAtTop = (hipC(T).x - hipC(A).x) * trailSign / torso;
      m.headAtTop = (T[LM.nose].x - A[LM.nose].x) * trailSign / headW;

      // トップで左腕が体を横切って右側まで来ているか。
      // 後方からは左右が奥行き方向になって読み取れないので、正面から測ります
      m.leadArmAcross =
        (T[S.lead.wrist].x - mid(shoulderC(T), hipC(T)).x) * trailSign / torso;

      if (D) m.hipDownswing = (hipC(D).x - hipC(T).x) * targetSign / torso;
    }

    if (I) {
      m.headAtImpact = (I[LM.nose].x - A[LM.nose].x) * trailSign / headW;
      m.hipAtImpact = (hipC(I).x - hipC(A).x) * targetSign / torso;

      // インパクトのリード脚：膝が目標方向に出ているとプラス
      m.leadLegImpact = tiltFromVertical(ac(I[S.lead.ankle]), ac(I[S.lead.knee]), targetSign);
    }

    if (W) m.hipAtFollow = (hipC(W).x - hipC(A).x) * targetSign / torso;

    if (F) {
      // フィニッシュ：リード足首とトレール肩を結んだラインの垂直からの傾き
      m.finishStack = Math.abs(tiltFromVertical(ac(F[S.lead.ankle]), ac(F[S.trail.shoulder])));

      // その線の上にトレール腰も乗っているか（左足・右腰・右肩が一直線か）
      m.finishHipLine = distanceToLine(F[S.trail.hip], F[S.lead.ankle], F[S.trail.shoulder]) / torso;
    }
  }

  /* --------------------------- 後方からの計測 --------------------------- */
  if (view === 'side') {
    const spine = p => tiltFromVertical(ac(hipC(p)), ac(shoulderC(p)), frontSign);
    const spineA = spine(A);
    m.spineAddress = Math.abs(spineA);
    if (T) m.spineAtTop = Math.abs(spine(T) - spineA);
    if (I) m.spineAtImpact = Math.abs(spine(I) - spineA);

    m.handPosSide = (handC(A).x - shoulderC(A).x) * frontSign / torso;

    // フィニッシュ：左肘が両肩を結んだライン上にあるか。
    // 肩がこちらを向いて重なってしまうと線の向きが定まらないので、その場合は測りません
    if (F) {
      const sep = dist(F[S.lead.shoulder], F[S.trail.shoulder]);
      if (sep > torso * 0.15) {
        m.leadElbowFinish =
          distanceToLine(F[S.lead.elbow], F[S.lead.shoulder], F[S.trail.shoulder]) / torso;
      }
    }

    // 手と体の距離。体の前面の代わりに膝の位置を基準にしています。
    // 拳 1 個は頭幅のおよそ 0.55 倍（拳の幅 約8.5cm / 頭幅 約15cm）。
    const fist = headW * 0.55;
    m.handDistance = (handC(A).x - mid(A[S.lead.knee], A[S.trail.knee]).x) * frontSign / fist;

    // 前後の重心。腰の中心が、かかと（足首）とつま先の中間からどちら側にあるか
    const toeMid = mid(A[S.lead.foot], A[S.trail.foot]);
    const footCenter = mid(ankleMid, toeMid);
    m.weightFrontBack = (hipC(A).x - footCenter.x) * frontSign / torso;

    // 左腕が水平のとき、手元が右肩の真下あたりに来ているか。
    // 上下ではなく、右肩から前後（ボール側／体側）にどれだけずれているかを見ます
    if (B) m.handAtBackswing = (handC(B).x - B[S.trail.shoulder].x) * frontSign / torso;
  }

  /* ------------------------ どちらの撮影でも取れる ---------------------- */
  if (W) m.trailElbowFollow = medianElbow(frames, keys.follow, S.trail, ac);

  // フィニッシュの右足は「かかとからつま先が地面と垂直」かを見ます。
  // すね（膝→足首）ではありません。フルフィニッシュでは足を後ろに残したまま
  // つま先立ちになるため、すねは大きく傾いていても足自体は垂直になります。
  if (F) {
    m.trailFootFinish = Math.abs(tiltFromVertical(ac(F[S.trail.foot]), ac(F[S.trail.heel])));
  }

  return m;
}

/**
 * 後方撮影のアドレス画像に重ねる「スイングプレーンの目安線」。
 * 首の付け根（肩の中心）から手元を通り、地面（足首の高さ）まで伸ばした線を返します。
 * アドレス時のシャフトのラインはクラブが検出できないため引けません。
 * 画像に写っているクラブと見比べてご判断ください。
 */
function neckLine(lms, handedness) {
  const S = sides(handedness);
  const neck = mid(lms[S.lead.shoulder], lms[S.trail.shoulder]);
  const hands = mid(lms[LM.lWrist], lms[LM.rWrist]);
  const groundY = Math.max(lms[S.lead.ankle].y, lms[S.trail.ankle].y);
  const dy = hands.y - neck.y;
  if (Math.abs(dy) < 1e-6) return null;
  const k = (groundY - neck.y) / dy;
  return { from: neck, to: { x: neck.x + (hands.x - neck.x) * k, y: groundY } };
}

/* 切り出しの範囲を決めるときに見るランドマーク（顔の細かい点は含めない） */
const CROP_POINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

/**
 * スイングしている人だけを切り出す範囲を、骨格の位置から求める。
 *
 * indices に複数のキーフレームを渡すと、その全部が入る範囲を返します。
 * ポジションごとに切り出し方を変えると人の大きさも位置も変わってしまい、
 * 姿勢の移り変わりが読み取れなくなるため、動画では全ポジション共通の範囲を使います。
 *
 * クラブは検出できないので、体の大きさに応じた余白を上下左右に足しています。
 * 返り値は元映像のピクセル座標 { sx, sy, sw, sh }。
 */
function swingCrop(frames, indices, frameW, frameH, aspect) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const i of indices) {
    const p = frames[i] && frames[i].lms;
    if (!p) continue;
    for (const k of CROP_POINTS) {
      const q = p[k];
      if (!q) continue;
      const x = q.x * frameW, y = q.y * frameH;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!isFinite(minX)) return { sx: 0, sy: 0, sw: frameW, sh: frameH };

  const body = Math.max(maxY - minY, 1);
  minY -= body * 0.34;                 // トップやフィニッシュでクラブが頭上に出る分
  maxY += body * 0.08;
  minX -= body * 0.26;                 // アドレスやフォローでクラブが横に出る分
  maxX += body * 0.26;

  let sw = maxX - minX, sh = maxY - minY;
  if (sw / sh < aspect) { const n = sh * aspect; minX -= (n - sw) / 2; sw = n; }
  else { const n = sw / aspect; minY -= (n - sh) / 2; sh = n; }

  // 画面からはみ出す場合は、まず収まる大きさに縮めてから位置を戻す
  const fit = Math.min(1, frameW / sw, frameH / sh);
  if (fit < 1) {
    const cx = minX + sw / 2, cy = minY + sh / 2;
    sw *= fit; sh *= fit;
    minX = cx - sw / 2; minY = cy - sh / 2;
  }
  return {
    sx: Math.max(0, Math.min(frameW - sw, minX)),
    sy: Math.max(0, Math.min(frameH - sh, minY)),
    sw, sh
  };
}

/**
 * 正面から見たアドレス画像に重ねる「ボール位置の目安」を返す。
 *
 * 両足の中央を 0、リード側のかかとを 1.0 とした割合（criteria.js の ballZone）を、
 * 画面上の x 座標（0〜1）に直します。ボールそのものは検出していません。
 */
function ballGuide(lms, handedness, club) {
  const zone = CLUBS[club] && CLUBS[club].ballZone;
  if (!zone) return null;
  const S = sides(handedness);
  const lead = lms[S.lead.ankle], trail = lms[S.trail.ankle];
  const center = (lead.x + trail.x) / 2;
  const half = (lead.x - trail.x) / 2;              // 中央からリードかかとまで（符号つき）
  if (Math.abs(half) < 1e-6) return null;
  return {
    center,
    lead: lead.x,
    from: center + half * zone[0],
    to: center + half * zone[1],
    y: Math.max(lead.y, trail.y)
  };
}

/* ------------------------------- 採点 ------------------------------------ */

/** 1項目のスコア（0-100）。ideal 内は 100、hard の外は 0、その間は線形。 */
function scoreOne(value, c) {
  const [ilo, ihi] = c.ideal, [hlo, hhi] = c.hard;
  if (value >= ilo && value <= ihi) return 100;
  if (value > ihi) return value >= hhi ? 0 : Math.round(100 * (1 - (value - ihi) / (hhi - ihi)));
  return value <= hlo ? 0 : Math.round(100 * (1 - (ilo - value) / (ilo - hlo)));
}

/** 計測値と criteria.js から診断結果を組み立てる */
function diagnose(metrics, view, club) {
  const items = [];
  for (const raw of CRITERIA) {
    if (raw.view !== 'both' && raw.view !== view) continue;
    const c = resolveCriterion(raw, club);
    const value = metrics[c.id];
    if (value === undefined || value === null || isNaN(value)) continue;

    const score = scoreOne(value, c);
    const status = score === 100 ? 'good' : (value > c.ideal[1] ? 'high' : 'low');
    const comment = status === 'good' ? c.good : (c[status] || c.high || c.low);

    items.push({
      id: c.id, label: c.label, phase: c.phase, unit: c.unit, dir: c.dir,
      signLabels: c.signLabels, weight: c.weight, ideal: c.ideal,
      value, score, status, comment,
      drill: status === 'good' ? null : c.drill
    });
  }

  const totalW = items.reduce((s, i) => s + i.weight, 0);
  const overall = totalW ? Math.round(items.reduce((s, i) => s + i.score * i.weight, 0) / totalW) : 0;
  const summary = OVERALL_COMMENTS.find(o => overall >= o.min) || OVERALL_COMMENTS[OVERALL_COMMENTS.length - 1];

  // 優先課題 = 重み付きの失点が大きい順
  const priorities = items
    .filter(i => i.score < 100)
    .sort((a, b) => (100 - b.score) * b.weight - (100 - a.score) * a.weight)
    .slice(0, 3);

  return { items, overall, summary, priorities };
}
