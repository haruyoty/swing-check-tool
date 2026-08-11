/* ============================================================================
 * test.js — analyzer.js / criteria.js の自動テスト（合成スイングデータ）
 *   実行: node test.js
 * ==========================================================================*/

const fs = require('fs');
const path = require('path');
const dir = __dirname;
const src = ['criteria.js', 'videos.js', 'lessons.js', 'analyzer.js']
  .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
const A = new Function('document', src + `
  return {detectKeyFrames, measure, diagnose, scoreOne, neckLine, ballGuide, sides, guideLines,
          estimateBall, planeLines, detectShaft,
          lessonVideo, lessonCandidates, searchLessons, normalizeTitle, LESSON_CANDIDATES,
          swingCrop, CRITERIA, CLUBS, VISUAL_CHECKS, PHASE_LABELS, LESSON_QUERIES,
          CHANNEL_VIDEOS, CHANNEL_URL, CATALOG_UPDATED, CONTACT_LINKS, resolveCriterion};`)(null);

/* ---------------------------- テスト用ユーティリティ ---------------------- */

/** app.js の PHASE_ORDER と同じ並び（キーフレームの表示順） */
const PHASE_ORDER_TEST = ['address', 'takeaway', 'backswing', 'top', 'downswing', 'impact', 'follow', 'finish'];

/** ランドマーク配列の複製（テスト内で姿勢をいじるとき用） */
const cloneLms = lms => lms.map(p => Object.assign({}, p));

/** 計測結果を見やすく丸める（数値でないもの＝補足文はそのまま） */
const round3 = m => Object.fromEntries(
  Object.entries(m).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(3) : v]));

/** 動画のキーフレームを「ポジションごとの写真」の形に組み替える */
const asPhotos = (src, srcKeys, phases) => {
  const frames = phases.map(p => ({ t: 0, lms: src[srcKeys[p]].lms }));
  const keys = {};
  phases.forEach((p, i) => keys[p] = i);
  return { frames, keys };
};

let pass = 0, fail = 0;
function check(name, got, want, tol = 0.02) {
  const ok = typeof want === 'number' && typeof got === 'number'
    ? Math.abs(got - want) <= tol : got === want;
  const shown = typeof got === 'number' ? got.toFixed(3) : String(got);
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${name}: ${shown}${ok ? '' : `   ← 期待 ${want}`}`);
  ok ? pass++ : fail++;
  return ok;
}
function section(t) { console.log(`\n=== ${t} ===`); }

/* ------------------------- 合成スイングデータの生成 ----------------------- */
/*
 * 正面から見た右打ちのスイングを模した骨格。
 * 画面の左（x が小さい側）が目標方向、右（x が大きい側）が後ろ側。
 * つまり右打ちの「左肩(11)」が小さい x に来る。
 * トップ = frame 45（1.50秒）、インパクト = frame 60（2.00秒）
 */
function buildFront(o = {}) {
  o = Object.assign({
    headTopDX: 0.010,      // トップでの頭の右移動（画面 +x）
    headImpDX: 0.000,      // インパクトでの頭の位置（アドレス比）
    hipTopDX: 0.008,       // トップでの腰の右移動
    hipImpDX: -0.020,      // インパクトでの腰の左移動
    // トップで肩幅が縮む割合。正面から見た肩の回転量に対応する。
    // 90度回れば肩は正面からほぼ重なって見えるので、良いスイングでは 0.9 前後になる。
    shoulderNarrow: 0.90
  }, o);

  const N = 91, fps = 30, TOP = 45, IMP = 60, frames = [];
  const ease = u => (1 - Math.cos(Math.PI * u)) / 2;

  for (let i = 0; i < N; i++) {
    const t = i / fps;
    let hx, hy;                                        // 手元
    if (i <= TOP) { const u = i / TOP; hx = 0.50 + 0.15 * ease(u); hy = 0.60 - 0.35 * ease(u); }
    else if (i <= IMP) { const u = (i - TOP) / (IMP - TOP); hx = 0.65 - 0.15 * ease(u); hy = 0.25 + 0.35 * ease(u); }
    else { const u = (i - IMP) / (N - 1 - IMP); hx = 0.50 - 0.15 * ease(u); hy = 0.60 - 0.35 * ease(u); }

    const upTop = i <= TOP ? i / TOP : 1;                          // 0→1（トップまで）
    const toImp = i <= TOP ? 0 : Math.min(1, (i - TOP) / (IMP - TOP));
    const afterImp = i <= IMP ? 0 : (i - IMP) / (N - 1 - IMP);

    const headDX = o.headTopDX * upTop + (o.headImpDX - o.headTopDX) * toImp;
    const hipDX = o.hipTopDX * upTop + (o.hipImpDX - o.hipTopDX) * toImp
      + (-0.045 - o.hipImpDX) * afterImp;                          // フォロー以降さらに左へ
    const narrow = 1 - o.shoulderNarrow * upTop * (1 - afterImp);

    // フォロー以降、左足の上にまっすぐ立つフィニッシュへ滑らかに移行させる。
    // （最終フレームだけ差し替えると、実際に検出されるフィニッシュ位置とずれるため）
    const fin = afterImp;

    const p = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5 }));
    p[0] = { x: 0.500 + headDX, y: 0.200 };                        // 鼻
    p[7] = { x: 0.470 + headDX, y: 0.195 };                        // 左耳（頭幅 0.06）
    p[8] = { x: 0.530 + headDX, y: 0.195 };                        // 右耳

    const shC = 0.500 + headDX * 0.5 - 0.060 * fin;                // 肩全体が目標方向へ寄る
    p[11] = { x: shC - 0.060 * narrow, y: 0.300 };                 // 左肩（目標側）
    p[12] = { x: shC + 0.060 * narrow, y: 0.318 };                 // 右肩（少し下がる）
    p[13] = { x: shC - 0.075, y: 0.430 }; p[14] = { x: shC + 0.075, y: 0.430 };
    p[15] = { x: hx - 0.012, y: hy }; p[16] = { x: hx + 0.012, y: hy };

    p[23] = { x: 0.455 + hipDX, y: 0.550 }; p[24] = { x: 0.545 + hipDX, y: 0.550 };
    p[25] = { x: 0.440 + 0.030 * fin, y: 0.740 };                  // 左膝
    p[26] = { x: 0.560, y: 0.740 + 0.020 * fin };                  // 右膝（つま先立ちで上がる）
    p[27] = { x: 0.435 + 0.035 * fin, y: 0.930 };                  // 左足首
    p[28] = { x: 0.565 - 0.005 * fin, y: 0.930 };                  // 右足首
    p[29] = { x: 0.425, y: 0.955 };                                // 左かかと
    p[31] = { x: 0.445, y: 0.960 };                                // 左つま先
    // 右足: アドレスでは接地（かかとが後ろ）→ フィニッシュではつま先立ち（かかとが真上）
    p[30] = { x: 0.580 - 0.010 * fin, y: 0.955 - 0.045 * fin };    // 右かかと
    p[32] = { x: 0.575, y: 0.960 };                                // 右つま先

    frames.push({ t, lms: p });
  }
  return frames;
}

/** 後方（飛球線後方）から見た骨格。前傾 spineDeg 度、つま先は画面右（ボール側）。 */
function buildSide(spineDeg = 30, handAhead = 0.03) {
  const N = 91, fps = 30, TOP = 45, IMP = 60, frames = [];
  const ease = u => (1 - Math.cos(Math.PI * u)) / 2;
  const rad = spineDeg * Math.PI / 180;
  const torso = 0.25;
  const hipC = { x: 0.440, y: 0.550 };
  // 前傾：腰から肩へのベクトルが垂直から spineDeg 傾く（つま先＝画面右 が正）
  const shC = { x: hipC.x + torso * Math.sin(rad), y: hipC.y - torso * Math.cos(rad) };
  const hx0 = shC.x + handAhead;                      // アドレスの手元（肩の真下 + handAhead）

  for (let i = 0; i < N; i++) {
    const t = i / fps;
    let hx, hy;
    if (i <= TOP) { const u = i / TOP; hx = hx0 + 0.10 * ease(u); hy = 0.60 - 0.35 * ease(u); }
    else if (i <= IMP) { const u = (i - TOP) / (IMP - TOP); hx = hx0 + 0.10 - 0.10 * ease(u); hy = 0.25 + 0.35 * ease(u); }
    else { const u = (i - IMP) / (N - 1 - IMP); hx = hx0 - 0.10 * ease(u); hy = 0.60 - 0.35 * ease(u); }

    const p = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5 }));

    p[0] = { x: shC.x + 0.020, y: shC.y - 0.090 };
    p[7] = { x: shC.x + 0.005, y: shC.y - 0.085 };
    p[8] = { x: shC.x + 0.035, y: shC.y - 0.085 };
    // 後方から見ると、アドレスでは両肩がほぼ重なり、フィニッシュでは体が目標を
    // 向くぶん左右に離れて見える
    const turn = i <= IMP ? 0 : (i - IMP) / (N - 1 - IMP);
    const sep = 0.012 + 0.048 * turn;
    p[11] = { x: shC.x - sep, y: shC.y }; p[12] = { x: shC.x + sep, y: shC.y };
    // 左肘はフィニッシュで両肩のライン上（＝肩と同じ高さ）に来る
    p[13] = { x: shC.x - 0.010, y: shC.y + 0.10 * (1 - turn) };
    p[14] = { x: shC.x + 0.010, y: shC.y + 0.10 };
    p[23] = { x: hipC.x - 0.012, y: hipC.y }; p[24] = { x: hipC.x + 0.012, y: hipC.y };
    p[25] = { x: 0.445, y: 0.740 }; p[26] = { x: 0.455, y: 0.740 };
    p[27] = { x: 0.430, y: 0.930 }; p[28] = { x: 0.440, y: 0.930 };
    p[31] = { x: 0.480, y: 0.960 }; p[32] = { x: 0.490, y: 0.960 };  // つま先は画面右＝ボール側

    p[15] = { x: hx - 0.008, y: hy }; p[16] = { x: hx + 0.008, y: hy };
    frames.push({ t, lms: p });
  }
  return frames;
}

/* ================================ テスト ================================= */

section('1. キーフレーム検出（7 点）');
const fF = buildFront();
const kF = A.detectKeyFrames(fF, 'right');
console.log('  ', JSON.stringify(kF));
check('アドレス < バックスイング', kF.address < kF.backswing, true);
check('バックスイング < トップ', kF.backswing < kF.top, true);
check('トップのフレーム', kF.top, 45, 2);
check('トップ < ダウンスイング', kF.top < kF.downswing, true);
check('ダウンスイング <= インパクト', kF.downswing <= kF.impact, true);
check('インパクトのフレーム', kF.impact, 60, 2);
check('インパクト <= フォロー <= フィニッシュ',
  kF.impact <= kF.follow && kF.follow <= kF.finish, true);

// テークバック（シャフトが水平）はアドレスと「左腕が水平」の間
check('アドレス < テークバック', kF.address < kF.takeaway, true);
check('テークバック < バックスイング', kF.takeaway < kF.backswing, true);
{
  const hy = i => (fF[i].lms[15].y + fF[i].lms[16].y) / 2;
  const 進み = (hy(kF.address) - hy(kF.takeaway)) / (hy(kF.address) - hy(kF.backswing));
  check('手元が3割ほど上がったところ', 進み, 0.30, 0.12);
}

section('2. 正面の計測値（良いスイング）');
const mF = A.measure(fF, kF, 'right', 'front');
console.log('  ', JSON.stringify(round3(mF)));
check('肩の傾き（右肩が下がる＝正）', mF.shoulderTilt > 0, true);
check('トップの頭は右（正）へ', mF.headAtTop > 0, true);
check('トップの腰は右（正）へ', mF.hipAtTop > 0, true);
check('ダウンで腰が目標方向（正）へ', mF.hipDownswing > 0, true);
check('インパクトで腰が目標方向（正）へ', mF.hipAtImpact > 0, true);
check('フォローで腰がさらに目標方向へ', mF.hipAtFollow > mF.hipAtImpact, true);
check('肩の回転量が 0 より大きい', mF.shoulderTurn > 0, true);
check('フィニッシュがほぼ垂直', mF.finishStack < 8, true);
// 右足は「かかとがつま先の真上」に近いほど 0°。すねの傾きとは別物であることも確かめる
check('右足（かかと〜つま先）がほぼ垂直', mF.trailFootFinish < 20, true);
check('テンポが基準内', A.diagnose(mF, 'front', 'driver').items.find(i => i.id === 'tempo').score, 100, 0);

// テンポは「動き出してからトップまで」を測る。アドレスで静止している時間の
// 長さでテンポの値が変わってしまわないことを確かめる
{
  const still = Array.from({ length: 40 }, () => ({ lms: fF[0].lms }));
  const padded = [...still, ...fF.map(f => ({ lms: f.lms }))].map((f, i) => ({ t: i / 30, lms: f.lms }));
  const kP = A.detectKeyFrames(padded, 'right');
  const mP = A.measure(padded, kP, 'right', 'front');
  check('構えて静止する時間が長くてもテンポが変わらない', mP.tempo, mF.tempo, 0.25);
}

section('3. 左打ち（左右反転）で同じ数値になるか');
const mirror = frames => frames.map(f => {
  const L = f.lms.map(p => ({ x: 1 - p.x, y: p.y }));
  [[7, 8], [11, 12], [13, 14], [15, 16], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]]
    .forEach(([a, b]) => { const t = L[a]; L[a] = L[b]; L[b] = t; });
  return { t: f.t, lms: L };
});
const fL = mirror(buildFront());
const kL = A.detectKeyFrames(fL, 'left');
const mL = A.measure(fL, kL, 'left', 'front');
check('キーフレームが一致', JSON.stringify(kL), JSON.stringify(kF));
for (const k of Object.keys(mF)) check(`${k} が左右で一致`, mL[k], mF[k], 0.01);

section('4. 後方の計測値');
const fS = buildSide(30, 0.03);
const kS = A.detectKeyFrames(fS, 'right');
const mS = A.measure(fS, kS, 'right', 'side');
console.log('  ', JSON.stringify(kS));
console.log('  ', JSON.stringify(round3(mS)));
check('後方でもトップのフレームが正しい', kS.top, 45, 2);
check('後方でもインパクトのフレームが正しい', kS.impact, 60, 2);
check('後方でもテンポが 2.4〜3.6', mS.tempo >= 2.4 && mS.tempo <= 3.6, true);
check('左腕が水平のとき手は右肩の少し下', mS.handAtBackswing > 0 && mS.handAtBackswing < 0.4, true);
check('アドレスの前傾角 ≒ 30°', mS.spineAddress, 30, 1.5);
check('前傾は一定なのでトップの変化 ≒ 0', mS.spineAtTop, 0, 0.5);
check('インパクトの変化 ≒ 0', mS.spineAtImpact, 0, 0.5);
check('手元が肩の真下より前（正）', mS.handPosSide > 0, true);
// 手と体の距離は「拳いくつ分」という換算値なので、絶対値は撮影条件で変わる。
// ここでは向きが正しいこと（体から離すほど大きくなること）を確かめる。
{
  const dist = (ahead, spine = 30) => {
    const f = buildSide(spine, ahead);
    return A.measure(f, A.detectKeyFrames(f, 'right'), 'right', 'side').handDistance;
  };
  const near = dist(0.01), far = dist(0.06);
  check('手と体の距離が有限の値になる', isFinite(near) && near > 0, true);
  check('手を体から離すほど大きくなる', far > near, true);

  /*
   * 基準は「腰の中心から、お腹の厚みの半分だけ前が体の前面」という換算。
   * 前傾 38°・手元が肩の真下なら 2.0 拳ぶん、という導出どおりになるかを見る。
   * 以前は膝を基準にしていて、実際は離れているのに 1 拳未満と出ていた。
   */
  check('前傾38°・手は肩の真下 → 拳 2.0 個分', dist(0, 38), 2.0, 0.05);
  check('前傾30°・手は肩の真下 → 拳 1.4 個分', dist(0, 30), 1.40, 0.05);
  check('前傾が深いほど手は体から離れる', dist(0, 45) > dist(0, 30), true);

  const band = A.resolveCriterion(A.CRITERIA.find(c => c.id === 'handDistance'), 'iron').ideal;
  check('前傾38°の値が目安の中に入る', dist(0, 38) >= band[0] && dist(0, 38) <= band[1], true);
  check('手を体に付けたら「近すぎ」と出る',
    A.diagnose({ handDistance: dist(-0.10, 38) }, 'side', 'iron')
      .items.find(i => i.id === 'handDistance').status, 'low');
}
check('前後の重心が有限の値になる', isFinite(mS.weightFrontBack), true);
const s45 = buildSide(45);
check('45度で作れば前傾角も 45°',
  A.measure(s45, A.detectKeyFrames(s45, 'right'), 'right', 'side').spineAddress, 45, 1.5);

section('4-2. 後方：ダウンスイングとフォローの起き上がりを拾えるか');
/*
 * 合成データは胴体を固定しているので、そのままでは前傾の変化がすべて 0 になる。
 * ここでは特定のコマだけ「起き上がった」「お尻が前に出た」形に差し替えて、
 * 数値が正しい向き・大きさで反応するかを確かめる。
 */
{
  /** idx のコマの肩まわりを動かして、前傾角を newDeg にする */
  const tiltSpineAt = (frames, idx, newDeg) => {
    const l = cloneLms(frames[idx].lms);
    const hip = { x: (l[23].x + l[24].x) / 2, y: (l[23].y + l[24].y) / 2 };
    const sh = { x: (l[11].x + l[12].x) / 2, y: (l[11].y + l[12].y) / 2 };
    const len = Math.hypot(sh.x - hip.x, sh.y - hip.y);
    const rad = newDeg * Math.PI / 180;
    const dx = hip.x + len * Math.sin(rad) - sh.x;
    const dy = hip.y - len * Math.cos(rad) - sh.y;
    for (const i of [0, 7, 8, 11, 12, 13, 14]) l[i] = { x: l[i].x + dx, y: l[i].y + dy };
    return { t: frames[idx].t, lms: l };
  };
  /** idx のコマの腰だけを dx ずらす（プラス＝ボール側） */
  const pushHipsAt = (frames, idx, dx) => {
    const l = cloneLms(frames[idx].lms);
    for (const i of [23, 24]) l[i] = { x: l[i].x + dx, y: l[i].y };
    return { t: frames[idx].t, lms: l };
  };

  // 目安（criteria.js 側を緩めたときに気づけるよう、ここで固定しておく）
  const bandOfSide = id => A.resolveCriterion(A.CRITERIA.find(x => x.id === id), 'iron').ideal;
  for (const id of ['spineAtTop', 'spineAtDownswing', 'spineAtImpact']) {
    check(`${id} の目安は 8° 以内`, JSON.stringify(bandOfSide(id)), '[0,8]');
  }
  check('spineAtFollow の目安は他より緩い',
    bandOfSide('spineAtFollow')[1] > bandOfSide('spineAtImpact')[1], true);

  // 起き上がり：ダウンで 30°→16°（14°）、フォローで 30°→6°（24°）
  const up = fS.slice();
  up[kS.downswing] = tiltSpineAt(fS, kS.downswing, 16);
  up[kS.follow] = tiltSpineAt(fS, kS.follow, 6);
  const mUp = A.measure(up, kS, 'right', 'side');
  check('ダウンの前傾変化を拾える', mUp.spineAtDownswing, 14, 0.5);
  check('フォローの前傾変化を拾える', mUp.spineAtFollow, 24, 0.5);
  check('起き上がると頭も上がる（マイナス）', mUp.headHeightAtDownswing < 0, true);
  check('トップとインパクトは巻き込まれない',
    Math.abs(mUp.spineAtTop) < 0.5 && Math.abs(mUp.spineAtImpact) < 0.5, true);

  const dUp = A.diagnose(mUp, 'side', 'iron');
  const at = id => dUp.items.find(i => i.id === id);
  check('ダウンの前傾が減点される', at('spineAtDownswing').score < 100, true);
  check('ダウンの前傾は「起き上がり」判定', at('spineAtDownswing').status, 'high');
  check('フォローの前傾が減点される', at('spineAtFollow').score < 100, true);
  check('フォロー 24° は目安 16° 超え', at('spineAtFollow').status, 'high');

  // 同じ 14° のずれでも、フォローは目安が緩いので満点のまま
  const keep = fS.slice();
  keep[kS.downswing] = tiltSpineAt(fS, kS.downswing, 24);   // 6° のずれ
  keep[kS.follow] = tiltSpineAt(fS, kS.follow, 16);         // 14° のずれ
  const dKeep = A.diagnose(A.measure(keep, kS, 'right', 'side'), 'side', 'iron');
  check('ダウンの 6° は目安内',
    dKeep.items.find(i => i.id === 'spineAtDownswing').score, 100, 0);
  check('フォローの 14° は目安内',
    dKeep.items.find(i => i.id === 'spineAtFollow').score, 100, 0);

  // お尻がボール側へ（つま先は画面右なので +x がボール側）
  const hips = fS.slice();
  hips[kS.downswing] = pushHipsAt(fS, kS.downswing, 0.03);
  const mHip = A.measure(hips, kS, 'right', 'side');
  check('ダウンでお尻が前に出ると正の値', mHip.hipToBallAtDownswing > 0.1, true);
  check('お尻が前に出ると減点される',
    A.diagnose(mHip, 'side', 'iron').items.find(i => i.id === 'hipToBallAtDownswing').status, 'high');

  // 良いスイング（胴体が固定）ではどれも満点
  const dGood = A.diagnose(mS, 'side', 'iron');
  for (const id of ['spineAtDownswing', 'spineAtFollow', 'hipToBallAtDownswing', 'headHeightAtDownswing']) {
    check(`前傾が保てていれば ${id} は満点`, dGood.items.find(i => i.id === id).score, 100, 0);
  }
}

section('4-3. 後方：背骨と左前腕が平行か');
/*
 * 合成データの腕はざっくりした形なので、そのままの値には意味がない。
 * テークバック前後のコマの前腕だけを「背骨と厳密に平行」「20°ずらす」と置き換えて、
 * 計算が意図どおりの角度を返すかを確かめる。
 * （中央値を取る都合で、前後 2 コマぶんまとめて置き換える必要がある）
 */
{
  const SPINE = 30;                                     // buildSide(30) の前傾
  /** 左前腕（13=肘 / 15=手首）を、垂直から deg 度傾いた線に置き換える */
  const setForearm = (frames, idx, deg, len = 0.20) => {
    const out = frames.slice();
    for (let i = idx - 2; i <= idx + 2; i++) {
      if (!out[i]) continue;
      const l = cloneLms(out[i].lms);
      const wrist = { x: 0.50, y: 0.60 };
      l[15] = wrist;
      l[13] = { x: wrist.x + Math.tan(deg * Math.PI / 180) * len, y: wrist.y - len };
      out[i] = { t: out[i].t, lms: l };
    }
    return out;
  };
  const valueOf = frames => A.measure(frames, kS, 'right', 'side').armSpineParallel;

  check('背骨と同じ傾きなら 0°', valueOf(setForearm(fS, kS.takeaway, SPINE)), 0, 0.5);
  check('20° ずらせば 20°', valueOf(setForearm(fS, kS.takeaway, SPINE + 20)), 20, 0.5);
  check('反対に 20° ずらしても 20°', valueOf(setForearm(fS, kS.takeaway, SPINE - 20)), 20, 0.5);

  // 奥行きに潰れて前腕が短く写るコマは、角度が定まらないので測らない
  check('前腕が短すぎるコマは測らない',
    valueOf(setForearm(fS, kS.takeaway, SPINE, 0.02)), undefined);

  // 1 コマだけ乱れても中央値で吸収する
  {
    const f = setForearm(fS, kS.takeaway, SPINE);
    const l = cloneLms(f[kS.takeaway].lms);
    l[13] = { x: l[13].x + 0.15, y: l[13].y };           // 中心のコマだけ大きく外す
    f[kS.takeaway] = { t: f[kS.takeaway].t, lms: l };
    check('1 コマの乱れに引っ張られない', valueOf(f), 0, 0.5);
  }

  // 採点：平行なら満点、大きくずれれば減点
  const scoreAt = deg => A.diagnose(A.measure(setForearm(fS, kS.takeaway, deg), kS, 'right', 'side'),
    'side', 'iron').items.find(i => i.id === 'armSpineParallel');
  check('平行なら満点', scoreAt(SPINE).score, 100, 0);
  check('10° のずれは目安内', scoreAt(SPINE + 10).score, 100, 0);
  check('25° のずれは減点', scoreAt(SPINE + 25).score < 100, true);
  check('25° のずれは「ずれている」判定', scoreAt(SPINE + 25).status, 'high');
}

section('4-4. 縦で撮っても横で撮っても同じ数値になるか');
/*
 * 骨格の x は「幅の何割」、y は「高さの何割」。同じ人・同じ姿勢でも、縦長で撮るか
 * 横長で撮るかで x の刻みが変わるので、正規化された座標そのものが変わる。
 * measure() に縦横比を渡して単位をそろえているので、結果は一致しなければならない。
 *
 * 以前は角度だけをそろえていて、「横方向の距離 ÷ 体格」の項目が縦横比で変わっていた。
 * 実測で、同じ姿勢の手と体の距離が 16:9 で 0.91 拳・9:16 で 3.05 拳・1:1 で 2.03 拳。
 */
{
  /* 縦横比 r の映像で撮ったときの見え方（x が 1/r に詰まって写る） */
  const shot = (frames, r) => frames.map(f => ({
    t: f.t, lms: f.lms.map(p => ({ x: 0.5 + (p.x - 0.5) / r, y: p.y }))
  }));
  const aspects = [['横長 16:9', 16 / 9], ['縦長 9:16', 9 / 16], ['4:3', 4 / 3]];

  for (const [viewName, base] of [['front', fF], ['side', fS]]) {
    const ref = A.measure(base, A.detectKeyFrames(base, 'right'), 'right', viewName, 1);
    for (const [name, r] of aspects) {
      const f = shot(base, r);
      const m = A.measure(f, A.detectKeyFrames(f, 'right'), 'right', viewName, r);
      const off = Object.keys(ref).filter(k =>
        typeof ref[k] === 'number' && Math.abs(m[k] - ref[k]) > 0.01);
      check(`${viewName} / ${name}: 全項目が 1:1 と一致${off.length ? '（ずれ: ' + off.join(', ') + '）' : ''}`,
        off.length, 0, 0);
    }
  }

  // 縦横比を渡し忘れたときに気づけるよう、渡さない場合はずれることも確かめておく
  const f = shot(fS, 16 / 9);
  const noAspect = A.measure(f, A.detectKeyFrames(f, 'right'), 'right', 'side');
  const withAspect = A.measure(f, A.detectKeyFrames(f, 'right'), 'right', 'side', 16 / 9);
  check('縦横比を渡さないと手と体の距離がずれる',
    Math.abs(noAspect.handDistance - withAspect.handDistance) > 0.5, true);
}

section('5. 悪いスイングを減点できるか');
const good = A.diagnose(mF, 'front', 'driver');
const cases = [
  ['頭が右に動きすぎ', { headTopDX: 0.09, headImpDX: 0.09 }, 'headAtTop'],
  ['腰が右にスウェー', { hipTopDX: 0.075 }, 'hipAtTop'],
  ['肩が回っていない', { shoulderNarrow: 0.30 }, 'shoulderTurn'],
  ['右足に体重が残る', { hipImpDX: 0.02 }, 'hipAtImpact']
];
for (const [name, opt, id] of cases) {
  const f = buildFront(opt);
  const k = A.detectKeyFrames(f, 'right');
  const d = A.diagnose(A.measure(f, k, 'right', 'front'), 'front', 'driver');
  const item = d.items.find(i => i.id === id);
  check(`${name} → ${id} が減点`, item.score < 100, true);
  check(`${name} → 総合点が下がる（${good.overall} → ${d.overall}）`, d.overall < good.overall, true);
}

section('6. 番手ごとの基準の切り替え');
const bandOf = (id, club) =>
  A.resolveCriterion(A.CRITERIA.find(x => x.id === id), club).ideal;
// 目安は「クラブごとの理論値 ± 6°」。中心がずれていないかを見る
const centerOf = (id, club) => { const b = bandOf(id, club); return (b[0] + b[1]) / 2; };
check('前傾角: 1W の中心は 30°', centerOf('spineAddress', 'driver'), 30, 0.01);
check('前傾角: FW・UT の中心は 33°', centerOf('spineAddress', 'fwut'), 33, 0.01);
check('前傾角: ウエッジの中心は 45°', centerOf('spineAddress', 'wedge'), 45, 0.01);
check('前傾角: 1W は 26〜34', JSON.stringify(bandOf('spineAddress', 'driver')), '[26,34]');
check('前傾角: ウエッジは 41〜49', JSON.stringify(bandOf('spineAddress', 'wedge')), '[41,49]');
check('前傾角: クラブが短いほど深い',
  centerOf('spineAddress', 'driver') < centerOf('spineAddress', 'fwut')
  && centerOf('spineAddress', 'fwut') < centerOf('spineAddress', 'iron')
  && centerOf('spineAddress', 'iron') < centerOf('spineAddress', 'wedge'), true);
check('重心: ドライバーは右寄りが正解', bandOf('addressBalance', 'driver')[0] > 0, true);
check('重心: SW は左寄りが正解', bandOf('addressBalance', 'wedge')[1] < 0, true);
check('前傾角: アイアンは 5番〜PW をまとめた 33〜45',
  JSON.stringify(bandOf('spineAddress', 'iron')), '[33,45]');
check('前傾角: アイアンの幅が他のクラブより広い',
  bandOf('spineAddress', 'iron')[1] - bandOf('spineAddress', 'iron')[0]
  > bandOf('spineAddress', 'driver')[1] - bandOf('spineAddress', 'driver')[0], true);
check('重心: アイアンは均等', Math.abs(bandOf('addressBalance', 'iron')[0]) < 0.1, true);
check('インパクトの頭: ドライバーは右に残す', bandOf('headAtImpact', 'driver')[0] > 0, true);
check('インパクトの頭: アイアンは戻す', bandOf('headAtImpact', 'iron')[0] < 0, true);
check('スタンス幅: ドライバーの方が広い',
  bandOf('stanceWidth', 'driver')[1] > bandOf('stanceWidth', 'iron')[1], true);

section('6-2. クラブによって出す・出さないが変わる項目');
{
  const has = (club, id) => A.diagnose(mS, 'side', club).items.some(i => i.id === id);
  check('背骨と左前腕の平行: アイアンでは出る', has('iron', 'armSpineParallel'), true);
  check('背骨と左前腕の平行: 1W では出さない', has('driver', 'armSpineParallel'), false);
  check('1W で消えるのはこの項目だけ',
    A.diagnose(mS, 'side', 'iron').items.length - A.diagnose(mS, 'side', 'driver').items.length, 1, 0);
  check('出さない項目は総合スコアにも入らない',
    A.diagnose(mS, 'side', 'driver').items.every(i => i.id !== 'armSpineParallel'), true);

  // テークバックの前傾は後方だけ・どのクラブでも出る
  check('テークバックの前傾: 後方で出る',
    A.diagnose(mS, 'side', 'driver').items.some(i => i.id === 'spineAtTakeaway'), true);
  check('テークバックの前傾: 正面では出ない',
    A.diagnose(mF, 'front', 'driver').items.some(i => i.id === 'spineAtTakeaway'), false);

  // 手と体の距離の目安
  const band = club => A.resolveCriterion(A.CRITERIA.find(c => c.id === 'handDistance'), club).ideal;
  check('手と体の距離: アイアンは 1.2〜2.3', JSON.stringify(band('iron')), '[1.2,2.3]');
  check('手と体の距離: FW・UT も 1.2〜2.3', JSON.stringify(band('fwut')), '[1.2,2.3]');
  check('手と体の距離: ウエッジも 1.2〜2.3', JSON.stringify(band('wedge')), '[1.2,2.3]');
  check('手と体の距離: 1W だけ広い', JSON.stringify(band('driver')), '[1.8,3.4]');
}

section('7. 同じスイングでも番手で評価が変わる');
// 頭がアドレス位置に戻るスイング → アイアンでは満点、ドライバーでは減点
const headIron = A.diagnose(mF, 'front', 'iron').items.find(i => i.id === 'headAtImpact');
const headDrv = A.diagnose(mF, 'front', 'driver').items.find(i => i.id === 'headAtImpact');
check('頭が戻る → アイアンでは満点', headIron.score, 100, 0);
check('頭が戻る → ドライバーでは減点', headDrv.score < 100, true);
check('ドライバーのコメントが「突っ込み」を指摘', /突っ込/.test(headDrv.comment), true);

section('8. 採点関数の境界');
const band = { ideal: [2.4, 3.6], hard: [1.2, 5.5] };
check('理想の中央', A.scoreOne(3.0, band), 100, 0);
check('理想の上端', A.scoreOne(3.6, band), 100, 0);
check('理想の下端', A.scoreOne(2.4, band), 100, 0);
check('hard の外（上）', A.scoreOne(6.0, band), 0, 0);
check('hard の外（下）', A.scoreOne(0.5, band), 0, 0);
check('中間は 0〜100', A.scoreOne(4.5, band) > 0 && A.scoreOne(4.5, band) < 100, true);

section('9. criteria.js の整合性');
const ids = A.CRITERIA.map(c => c.id);
check('id の重複なし', new Set(ids).size, ids.length, 0);
for (const c of A.CRITERIA) {
  for (const club of Object.keys(A.CLUBS)) {
    const r = A.resolveCriterion(c, club);
    check(`${c.id}/${club}: hard ⊇ ideal`,
      r.hard[0] <= r.ideal[0] && r.ideal[0] <= r.ideal[1] && r.ideal[1] <= r.hard[1], true);
  }
  check(`${c.id}: view が正しい`, ['both', 'front', 'side'].includes(c.view), true);
  check(`${c.id}: phase が定義済み`, !!A.PHASE_LABELS[c.phase], true);
}
for (const v of A.VISUAL_CHECKS) {
  check(`目視チェック「${v.text.slice(0, 12)}…」の phase`, !!A.PHASE_LABELS[v.phase], true);
}
for (const club of Object.keys(A.CLUBS)) {
  const c = A.CLUBS[club];
  check(`CLUBS.${club} の項目がそろっている`,
    !!(c.label && c.ball && c.stance && c.spine && c.balance && c.hands), true);
}

section('8-2. 画面の縦横比で角度が歪まないか');
/*
 * ランドマークの x と y は画面の幅・高さをそれぞれ 1 とした値なので、
 * そのまま角度を出すと縦横比のぶんだけ歪む。実測では 16:9 の映像で
 * 実際の 30° が 18° に化けていた。measure に縦横比を渡して補正する。
 */
{
  // 横に潰した（＝ x が 1/2 に圧縮された）データを作る。16:9 の映像で
  // 正規化座標を読むのと同じ状況になる
  const squash = (fr, k) => fr.map(f => ({
    t: f.t, lms: f.lms.map(p => ({ x: 0.5 + (p.x - 0.5) / k, y: p.y }))
  }));

  const base = A.measure(fS, kS, 'right', 'side', 1);
  const sq = squash(fS, 2);
  const kSq = A.detectKeyFrames(sq, 'right');

  const 補正なし = A.measure(sq, kSq, 'right', 'side', 1).spineAddress;
  const 補正あり = A.measure(sq, kSq, 'right', 'side', 2).spineAddress;
  console.log(`   前傾角: 元 ${base.spineAddress.toFixed(1)}° / 横1/2に潰す → 補正なし ${補正なし.toFixed(1)}° 補正あり ${補正あり.toFixed(1)}°`);

  check('補正しないと角度が小さく出る', 補正なし < base.spineAddress - 5, true);
  check('縦横比を渡せば元の角度に戻る', 補正あり, base.spineAddress, 0.5);

  // 正面側の角度も同じ
  const fq = squash(fF, 2);
  const kFq = A.detectKeyFrames(fq, 'right');
  const tiltBase = A.measure(fF, kF, 'right', 'front', 1).shoulderTilt;
  const tiltFix = A.measure(fq, kFq, 'right', 'front', 2).shoulderTilt;
  check('肩の傾きも縦横比を補正すれば一致', tiltFix, tiltBase, 0.5);
  check('肩の傾きの符号が変わらない', Math.sign(tiltFix), Math.sign(tiltBase), 0);
  check('縦横比を省略しても落ちない', isFinite(A.measure(fF, kF, 'right', 'front').shoulderTilt), true);
}

section('8-3. 肘の角度が1コマの揺れに振り回されないか');
/*
 * 実際の動画では、伸びたままの右腕でも 145〜170° の範囲で 1 コマごとに散る。
 * 前後のコマの中央値を取って、たまたま低い値のコマで「チキンウィング」と
 * 誤判定しないようにしている。
 */
{
  /* そのコマだけを見たときの肘の角度（中央値を取らない素の値） */
  const singleAt = (fr, i) => {
    const p = fr[i].lms, deg = r => r * 180 / Math.PI;
    const v1 = { x: p[12].x - p[14].x, y: p[12].y - p[14].y };
    const v2 = { x: p[16].x - p[14].x, y: p[16].y - p[14].y };
    return deg(Math.acos((v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y))));
  };

  const noisy = fF.map((f, i) => {
    const l = cloneLms(f.lms);
    if (i === kF.follow) l[14] = { x: 0.70, y: 0.30 };   // 1 コマだけ肘が飛ぶ
    return { t: f.t, lms: l };
  });

  const clean = A.measure(fF, kF, 'right', 'front').trailElbowFollow;
  const spiked1コマ = singleAt(noisy, kF.follow);
  const withSpike = A.measure(noisy, kF, 'right', 'front').trailElbowFollow;
  console.log(`   肘: 正常 ${clean.toFixed(0)}° / 乱れたコマ単体 ${spiked1コマ.toFixed(0)}° / 中央値 ${withSpike.toFixed(0)}°`);

  check('乱れたコマの値に引っ張られない', Math.abs(withSpike - spiked1コマ) > 20, true);
  check('本来の値からほとんど動かない', Math.abs(withSpike - clean) < 5, true);

  // 写真モードでは隣が別ポジションなので、混ぜずにその 1 枚だけで測る
  const { frames, keys } = asPhotos(fF, kF, PHASE_ORDER_TEST);
  const photo = A.measure(frames, keys, 'right', 'front').trailElbowFollow;
  check('写真モードは隣の写真を混ぜず、その1枚で測る', photo, singleAt(fF, kF.follow), 0.001);
}

section('9-1. 符号の意味が言葉で分かるか');
{
  // ＋−の数字だけでは、どちらが右でどちらが左か読み取れない。
  // 符号に意味がある項目には signLabels を必ず付けておく。
  // 0 以上しか取らない「ずれの大きさ」は向きを持たないので対象外
  const signed = A.CRITERIA.filter(c =>
    ['体格比', '頭幅比'].includes(c.unit) && !(c.ideal[0] === 0 && c.hard[0] === 0));
  for (const c of signed) {
    check(`${c.id}: プラス・マイナスの意味がある`, Array.isArray(c.signLabels) && c.signLabels.length === 2, true);
    if (c.signLabels) {
      check(`${c.id}: 2つの意味が別物`, c.signLabels[0] !== c.signLabels[1], true);
      check(`${c.id}: 空文字でない`, c.signLabels.every(s => s && s.length > 0), true);
    }
  }
  // 符号つきの「度」の項目にも付いていること
  for (const id of ['shoulderTilt', 'leadLegImpact']) {
    const c = A.CRITERIA.find(x => x.id === id);
    check(`${id}: プラス・マイナスの意味がある`, Array.isArray(c.signLabels), true);
  }
  const bal = A.CRITERIA.find(c => c.id === 'addressBalance');
  check('左右バランス: プラスは右足寄り', /右/.test(bal.signLabels[0]), true);
  check('左右バランス: マイナスは左足寄り', /左/.test(bal.signLabels[1]), true);
}

section('9-1b. レッスンの案内リンク');
{
  check('案内が 1 つ以上ある', A.CONTACT_LINKS.length > 0, true);
  for (const c of A.CONTACT_LINKS) {
    check(`${c.title}: https で始まる`, /^https:\/\//.test(c.url), true);
    check(`${c.title}: 説明文がある`, c.lead.length > 5, true);
  }
  check('ラウンドレッスンの案内がある',
    A.CONTACT_LINKS.some(c => c.url.includes('noyamagolf.com/?p=47')), true);
  check('ホームページの案内がある',
    A.CONTACT_LINKS.some(c => c.url === 'https://noyamagolf.com/'), true);
}

section('9-2. チャンネル目録と検索');
{
  console.log(`   目録 ${A.CHANNEL_VIDEOS.length} 本 / 取得日 ${A.CATALOG_UPDATED} / ${A.CHANNEL_URL}`);
  check('目録が十分な本数ある', A.CHANNEL_VIDEOS.length > 100, true);
  check('動画IDがすべて11文字', A.CHANNEL_VIDEOS.every(v => /^[\w-]{11}$/.test(v[0])), true);
  check('タイトルがすべて入っている', A.CHANNEL_VIDEOS.every(v => typeof v[1] === 'string' && v[1].length > 0), true);
  check('動画IDに重複がない', new Set(A.CHANNEL_VIDEOS.map(v => v[0])).size, A.CHANNEL_VIDEOS.length, 0);

  // 表記ゆれの吸収
  check('全角英数字を半角にそろえる', A.normalizeTitle('ＦさんＡＢＣ'), 'fさんabc');
  check('長音記号をそろえる', A.normalizeTitle('テークバック') === A.normalizeTitle('テ―クバック'), true);
  check('空白を無視する', A.normalizeTitle('前傾 角度'), '前傾角度');

  // 検索そのもの
  const hits = A.searchLessons([['スウェー', 5], ['軸ブレ', 4]], 10);
  check('スウェーで検索して当たる', hits.length > 0, true);
  check('当たったものは語を含む',
    hits.every(h => /スウェー|スエー|軸ブレ/.test(h.title)), true);
  check('点数の高い順に並ぶ', hits.every((h, i) => i === 0 || hits[i - 1].score >= h.score), true);
  check('件数の上限が効く', A.searchLessons([['ゴルフ', 1]], 3).length <= 3, true);
  check('当たらない語では空', A.searchLessons([['存在しない語句zzz', 1]], 5).length, 0, 0);
  check('語を渡さなければ空', A.searchLessons([], 5).length, 0, 0);
}

section('9-3. 症状ごとに動画が見つかるか');
{
  const ids = new Set(A.CRITERIA.map(c => c.id));
  const checkKeys = new Set(A.VISUAL_CHECKS.filter(v => v.video).map(v => v.video));
  let total = 0, thin = [];

  for (const [key, q] of Object.entries(A.LESSON_QUERIES)) {
    check(`${key}: 対応する項目がある`, ids.has(key) || checkKeys.has(key), true);
    check(`${key}: high/low を使うなら両方ある`, !!q.any || (!!q.high && !!q.low), true);

    for (const status of Object.keys(q)) {
      const list = A.lessonCandidates(key, status);
      check(`${key}/${status}: 動画が見つかる`, list.length > 0, true);
      check(`${key}/${status}: 候補が重複しない`, new Set(list.map(v => v.id)).size, list.length, 0);
      if (list.length < 2) thin.push(`${key}/${status}(${list.length})`);
      total += list.length;
    }
  }
  console.log(`   ${Object.keys(A.LESSON_QUERIES).length} 症状 / のべ候補 ${total} 本`);
  // 候補が 1 本しかない症状があってもよい。ぴったり合う動画が 1 本だけなら、
  // 無理に別の動画を混ぜるより、その 1 本を出し続けるほうが役に立つため
  if (thin.length) console.log(`   候補が 1 本だけの症状: ${thin.join(', ')}`);

  // 減点された項目には必ず動画が付く
  const bad = A.diagnose({ tempo: 9, headAtTop: 2.0, hipAtTop: 0.9, shoulderTurn: 20 }, 'front', 'driver');
  for (const item of bad.items) {
    check(`減点項目「${item.id}」に動画がある`, !!A.lessonVideo(item.id, item.status, 0), true);
  }

  // 症状の向きで違う動画が出る
  check('テンポ: 遅すぎと速すぎで別の動画',
    A.lessonVideo('tempo', 'high', 0).id !== A.lessonVideo('tempo', 'low', 0).id, true);
  check('腰のスウェーと腰の引けで別の動画',
    A.lessonVideo('hipAtTop', 'high', 0).id !== A.lessonVideo('hipAtTop', 'low', 0).id, true);
  check('キーワード未定義の id は null', A.lessonVideo('nosuch', 'any', 0), null);

  // 毎回違う動画が出る
  for (const [key, q] of Object.entries(A.LESSON_QUERIES)) {
    for (const status of Object.keys(q)) {
      const n = A.lessonCandidates(key, status).length;
      if (n < 2) continue;
      const seq = [];
      for (let i = 0; i < n; i++) seq.push(A.lessonVideo(key, status, i).id);
      check(`${key}/${status}: ${n} 回で全部の候補が出る`, new Set(seq).size, n, 0);
      check(`${key}/${status}: 連続で同じにならない`, seq.every((v, i) => i === 0 || v !== seq[i - 1]), true);
      check(`${key}/${status}: ${n} 回で一周する`, A.lessonVideo(key, status, n).id, seq[0]);
    }
  }
  check('負の回数でも落ちない', !!A.lessonVideo('tempo', 'high', -3), true);
  check('回数を渡さなくても引ける', !!A.lessonVideo('tempo', 'high'), true);

  // 検索結果が症状に合っているか（代表例を目で見て確かめられるように出す）
  console.log('\n   症状ごとの検索結果（上位3本）:');
  for (const [key, status] of [['spineAddress','any'], ['shoulderTurn','any'], ['hipAtTop','high'],
                               ['hipAtTop','low'], ['trailElbowFollow','any'], ['trailFootFinish','any'],
                               ['tempo','high'], ['tempo','low']]) {
    const list = A.lessonCandidates(key, status).slice(0, 3);
    console.log(`   [${key}/${status}] ` + list.map(v => v.title.slice(0, 26)).join(' / '));
  }
}

section('10. 計測漏れの検出（全項目が値を返すか）');
for (const viewName of ['front', 'side']) {
  const frames = viewName === 'front' ? fF : fS;
  const keys = viewName === 'front' ? kF : kS;
  const met = A.measure(frames, keys, 'right', viewName);
  for (const c of A.CRITERIA.filter(c => c.view === 'both' || c.view === viewName)) {
    check(`${viewName}: ${c.id} が計測されている`,
      met[c.id] !== undefined && !isNaN(met[c.id]), true);
  }
}

section('11-2. ボール位置の目安ゾーン（アドレス画像に描く帯）');
{
  // 正面の合成データ: 左足首 x=0.435（目標側）、右足首 x=0.565、中央 0.500
  const A0 = fF[kF.address].lms;
  for (const club of ['driver', 'iron', 'wedge']) {
    const g = A.ballGuide(A0, 'right', club);
    const mid = (g.from + g.to) / 2;
    check(`${club}: ゾーンが両足の間に収まる`, g.from > 0.3 && g.to < 0.7, true);
  }
  {
    const g = A.ballGuide(A0, 'right', 'driver');
    const mid = (g.from + g.to) / 2;
    check('driver: ゾーンが左足かかと寄り', Math.abs(mid - A0[27].x) < 0.02, true);
    check('driver: 中央より目標側', mid < g.center, true);
  }
  {
    const g = A.ballGuide(A0, 'right', 'wedge');
    check('wedge: ゾーンがほぼ中央', Math.abs((g.from + g.to) / 2 - g.center), 0, 0.012);
  }
  {
    // アイアンは 5番〜PW をまとめているので、中央から目標側までの幅を持つ
    const g = A.ballGuide(A0, 'right', 'iron');
    const wedge = A.ballGuide(A0, 'right', 'wedge');
    const driver = A.ballGuide(A0, 'right', 'driver');
    check('iron: ウエッジより帯が広い',
      Math.abs(g.to - g.from) > Math.abs(wedge.to - wedge.from), true);
    check('iron: 中央側の端がウエッジと同じ', Math.abs(g.from - wedge.from) < 0.001, true);
    check('iron: ドライバーより手前で終わる', Math.abs(g.to - g.center) < Math.abs(driver.to - driver.center), true);
  }
  // 左打ちでは左右が反転する
  const gR = A.ballGuide(A0, 'right', 'driver');
  const gL = A.ballGuide(A0, 'left', 'driver');
  check('左打ちではゾーンが反対側に出る', (gR.from - gR.center) * (gL.from - gL.center) < 0, true);
  check('ballZone が未定義なら null', A.ballGuide(A0, 'right', 'nosuch'), null);
}

section('11-5. 動画・画像に重ねる赤いガイド線');
{
  const byId = (lines, id) => lines.find(l => l.id === id);

  /* --- 正面：鼻を通る垂直線 --- */
  {
    const A0 = fF[kF.address].lms;
    const g = A.guideLines(A0, 'right', 'front', 'iron', 1);
    check('正面は 1 本だけ', g.length, 1, 0);
    const nose = byId(g, 'nose');
    check('鼻の位置を通る', nose.from.x, A0[0].x, 0.001);
    check('垂直である', Math.abs(nose.to.x - nose.from.x), 0, 1e-9);
    check('頭より上から始まる', nose.from.y < A0[0].y, true);
    // 地面はかかとまで含めた足元のいちばん下
    check('地面（足元）まで伸びる', nose.to.y,
      Math.max(A0[27].y, A0[28].y, A0[29].y, A0[30].y), 0.001);
  }

  /* --- 後方：シャフト・首の付け根・お尻の後ろ --- */
  {
    const A0 = fS[kS.address].lms;
    const g = A.guideLines(A0, 'right', 'side', 'iron', 1);
    check('後方は 3 本', g.length, 3, 0);
    const shaft = byId(g, 'shaft'), neck = byId(g, 'neck'), back = byId(g, 'back');
    check('シャフトの線がある', !!shaft, true);
    check('首の付け根の線がある', !!neck, true);
    check('お尻の後ろの線がある', !!back, true);

    // 2 本はボールで交わる（同じ点から始まる）
    check('2 本が同じ点（ボール）から出ている',
      Math.hypot(shaft.from.x - neck.from.x, shaft.from.y - neck.from.y), 0, 1e-9);
    const ground = Math.max(A0[27].y, A0[28].y, A0[29].y, A0[30].y);
    check('ボールは地面の高さ', shaft.from.y, ground, 0.001);

    // つま先は画面右（ボール側）。ボールは手元より右
    const hands = (A0[15].x + A0[16].x) / 2;
    check('ボールは手元よりボール側', shaft.from.x > hands, true);

    // 上端は頭より上で、2 本は上へ向かって離れていく
    check('シャフトの線は頭より上まで伸びる', shaft.to.y < A0[0].y, true);
    check('2 本は別の線', Math.abs(shaft.to.x - neck.to.x) > 0.005, true);

    // 背中の後ろの線は、背骨と平行で、体の後ろ側（ボールと反対）にずれている
    const hipX = (A0[23].x + A0[24].x) / 2, hipY = (A0[23].y + A0[24].y) / 2;
    const shX = (A0[11].x + A0[12].x) / 2, shY = (A0[11].y + A0[12].y) / 2;
    const cross = (shX - hipX) * (back.to.y - back.from.y)
      - (shY - hipY) * (back.to.x - back.from.x);
    check('背中の線は背骨と平行', Math.abs(cross) < 1e-6, true);

    const t = (hipY - back.from.y) / (back.to.y - back.from.y);
    const xAtHip = back.from.x + (back.to.x - back.from.x) * t;
    check('背中の線は腰の高さで腰より後ろ', xAtHip < hipX, true);
    // 背骨からの「垂直距離」がお腹の厚みの半分。真横に測ると前傾のぶん長くなる
    const ux = back.to.x - back.from.x, uy = back.to.y - back.from.y;
    const len = Math.hypot(ux, uy);
    const perp = Math.abs((hipX - back.from.x) * uy - (hipY - back.from.y) * ux) / len;
    check('背骨からの距離はお腹の厚みの半分', perp, 0.25 * 0.23, 0.002);
    // 背中の線は頭の上から「お尻の少し下」まで。地面まで伸ばすと脚に重なる
    check('背中の線は頭の上から始まる', back.from.y < A0[0].y, true);
    check('下端はお尻の少し下', back.to.y, hipY + 0.25 * 0.30, 0.01);
    check('下端は地面まで届かない', back.to.y < ground - 0.05, true);
  }

  /* --- 縦横比を変えても同じ場所を指すか --- */
  {
    const squeeze = p => ({ x: 0.5 + (p.x - 0.5) / (16 / 9), y: p.y });
    const A0 = fS[kS.address].lms;
    const g1 = A.guideLines(A0, 'right', 'side', 'iron', 1);
    const g2 = A.guideLines(A0.map(squeeze), 'right', 'side', 'iron', 16 / 9);
    // 横に潰して撮った映像では、線も同じだけ潰れた位置に出るはず
    const off = g1.map((l, i) => Math.abs(squeeze(l.from).x - g2[i].from.x)
      + Math.abs(squeeze(l.to).x - g2[i].to.x));
    check('16:9 で撮っても同じ場所を指す', Math.max(...off) < 0.004, true);
  }

  /* --- クラブによってシャフトの角度（ライ角）が変わる --- */
  {
    const A0 = fS[kS.address].lms;
    const ballX = club => A.guideLines(A0, 'right', 'side', club, 1).find(l => l.id === 'shaft').from.x;
    check('ライ角が立つウエッジのほうがボールが手前', ballX('wedge') < ballX('driver'), true);
  }

  /* --- ボールの位置を決めれば、2 本は必ずシャフトと首の付け根の上に乗る --- */
  {
    const A0 = fS[kS.address].lms;
    const hands = { x: (A0[15].x + A0[16].x) / 2, y: (A0[15].y + A0[16].y) / 2 };
    const neck = { x: (A0[11].x + A0[12].x) / 2, y: (A0[11].y + A0[12].y) / 2 };
    /* 点 p から線 l までの距離。0 なら線がその点を通っている */
    const gap = (l, p) => {
      const ux = l.to.x - l.from.x, uy = l.to.y - l.from.y;
      return Math.abs((p.x - l.from.x) * uy - (p.y - l.from.y) * ux) / Math.hypot(ux, uy);
    };
    // ボールがどこにあっても、2 本は必ず手元と首の付け根を通ること
    for (const ball of [A.estimateBall(A0, 'right', 'iron', 1), { x: 0.58, y: 0.90 }]) {
      const [neckLine2, shaftLine] = A.planeLines(A0, 'right', ball, 1);
      const tag = ball.y === 0.90 ? 'ボールが別の位置' : '推定したボール';
      check(`${tag}: シャフトの線が手元を通る`, gap(shaftLine, hands), 0, 1e-9);
      check(`${tag}: 首の線が首の付け根を通る`, gap(neckLine2, neck), 0, 1e-9);
      check(`${tag}: 2 本ともボールから出ている`,
        shaftLine.from.x === ball.x && shaftLine.from.y === ball.y
        && neckLine2.from.x === ball.x && neckLine2.from.y === ball.y, true);
      check(`${tag}: 上端は頭より上`, shaftLine.to.y < A0[0].y && neckLine2.to.y < A0[0].y, true);
    }
    check('ボールが無ければ 2 本とも引かない', A.planeLines(A0, 'right', null, 1).length, 0, 0);
  }

  /* --- 骨格が取れていないコマでは何も返さない --- */
  check('骨格がなければ空', A.guideLines(null, 'right', 'front', 'iron', 1).length, 0, 0);
  check('骨格がなければボールも出さない', A.estimateBall(null, 'right', 'iron', 1), null);
}

section('11-6. 画像からシャフトを探す');
/*
 * 手元から伸びる細い線を画像に描いて、その向きと先端を当てられるかを見る。
 * 実写での結果は analyzer.js の detectShaft のコメントに残してある。
 */
{
  const W = 400, H = 400;
  /** 手元から deg 方向に、長さ len の線を引いた画像を作る（bright: 明るい線か） */
  const draw = (deg, len, bright, noise = 0) => {
    const data = new Uint8Array(W * H);
    let seed = 12345;                                 // 毎回同じ「ざらつき」にする
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = 120 + (noise ? Math.round((seed / 0x7fffffff - 0.5) * 2 * noise) : 0);
    }
    const rad = deg * Math.PI / 180;
    const ux = Math.sin(rad), uy = Math.cos(rad);
    for (let d = 0; d <= len; d += 0.4) {
      for (let t = -1; t <= 1; t++) {                 // 太さ 3px ほど
        const x = Math.round(50 + ux * d + (-uy) * t);
        const y = Math.round(40 + uy * d + ux * t);
        if (x >= 0 && y >= 0 && x < W && y < H) data[y * W + x] = bright ? 230 : 20;
      }
    }
    return { data, width: W, height: H };
  };
  const hand = { x: 50, y: 40 };

  for (const bright of [true, false]) {
    const tag = bright ? '明るい線' : '暗い線';
    const r = A.detectShaft(draw(40, 300, bright), hand, 1, 320);
    check(`${tag}: 見つかる`, !!r, true);
    if (r) {
      check(`${tag}: 角度が合う`, r.deg, 40, 1.5);
      check(`${tag}: 明暗を正しく判定`, r.polarity, bright ? 1 : -1, 0);
      check(`${tag}: 先端が線の端に近い`,
        Math.hypot(r.head.x - (50 + Math.sin(40 * Math.PI / 180) * 300),
          r.head.y - (40 + Math.cos(40 * Math.PI / 180) * 300)), 0, 25);
    }
  }

  // 角度を変えても追える
  for (const deg of [15, 30, 55, 70]) {
    const r = A.detectShaft(draw(deg, 300, true), hand, 1, 320);
    check(`${deg}° の線を当てられる`, r ? r.deg : null, deg, 1.5);
  }

  // ざらつきがあっても大丈夫
  {
    const r = A.detectShaft(draw(40, 300, true, 25), hand, 1, 320);
    check('ざらついた画像でも当てられる', r ? r.deg : null, 40, 2);
  }

  // 線が無ければ「自信なし」を返す（呼び出し側は推定に戻る）
  {
    const flat = { data: new Uint8Array(W * H).fill(120), width: W, height: H };
    check('線が無ければ null', A.detectShaft(flat, hand, 1, 320), null);
  }
  // 手元から始まっていない線（芝に落ちたクラブの影など）は拾わない
  {
    const g = draw(40, 300, false);
    const shifted = { data: new Uint8Array(W * H).fill(120), width: W, height: H };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const s = g.data[y * W + x];
        if (s !== 120 && x + 60 < W) shifted.data[y * W + x + 60] = s;   // 右に 60px ずらす
      }
    }
    const r = A.detectShaft(shifted, hand, 1, 320);
    check('手元から離れた線は拾わない', !r || Math.abs(r.deg - 40) > 3, true);
  }
  check('画像が無ければ null', A.detectShaft(null, hand, 1, 320), null);
}

section('11-4. 人物の切り出し範囲');
{
  const W = 1920, H = 1080, ASPECT = 3 / 4;
  const used = PHASE_ORDER_TEST.map(p => kF[p]);
  const c = A.swingCrop(fF, used, W, H, ASPECT);
  console.log(`   切り出し: ${Math.round(c.sw)}x${Math.round(c.sh)} @ (${Math.round(c.sx)}, ${Math.round(c.sy)}) / 元 ${W}x${H}`);

  check('指定した縦横比になる', c.sw / c.sh, ASPECT, 0.01);
  check('元映像の中に収まる（左）', c.sx >= -0.01, true);
  check('元映像の中に収まる（上）', c.sy >= -0.01, true);
  check('元映像の中に収まる（右）', c.sx + c.sw <= W + 0.01, true);
  check('元映像の中に収まる（下）', c.sy + c.sh <= H + 0.01, true);
  // 縦は人物の背丈でいっぱいになることもあるので、面積と横幅で拡大を確かめる
  check('全画面より狭く切り出される', c.sw < W && c.sw * c.sh < W * H, true);
  check('横方向に 2 倍以上拡大される', W / c.sw > 2, true);

  // すべてのキーフレームの体が範囲に入る（クラブぶんの余白があるので余裕をみる）
  let inside = true;
  for (const i of used) {
    for (const k of [0, 15, 16, 27, 28]) {
      const p = fF[i].lms[k];
      const x = p.x * W, y = p.y * H;
      if (x < c.sx || x > c.sx + c.sw || y < c.sy || y > c.sy + c.sh) inside = false;
    }
  }
  check('全ポジションの体が範囲に収まる', inside, true);

  // 頭上にはクラブぶんの余白がある
  const headY = Math.min(...used.map(i => fF[i].lms[0].y)) * H;
  check('頭の上に余白がある', headY - c.sy > 0, true);

  // 人物が小さく写っている映像ほど強く拡大される
  const shrink = fF.map(f => ({
    t: f.t,
    lms: f.lms.map(p => ({ x: 0.45 + (p.x - 0.5) * 0.25, y: 0.30 + (p.y - 0.5) * 0.25 }))
  }));
  const c2 = A.swingCrop(shrink, used, W, H, ASPECT);
  check('小さく写っているほど切り出しも小さい', c2.sw < c.sw, true);
  check('拡大率が上がる', (W / c2.sw) > (W / c.sw), true);

  // 骨格が取れないときは全画面のまま
  const none = fF.map(f => ({ t: f.t, lms: null }));
  const c3 = A.swingCrop(none, used, W, H, ASPECT);
  check('骨格がなければ全画面', c3.sw === W && c3.sh === H, true);
}

section('11. スイングプレーンの目安線');
const nl = A.neckLine(fS[kS.address].lms, 'right');
check('目安線が引ける', !!nl, true);
check('肩の中心から始まる', Math.abs(nl.from.y - 0.334) < 0.05, true);
check('地面（足首の高さ）で終わる', nl.to.y, 0.930, 0.001);

section('11-3. 実機で見つかった 2 つの誤判定');
/*
 * (a) 腕をたたんだフィニッシュを「腕が水平」と誤認しないこと。
 *     区間内で最も水平に近いコマを選ぶ方式だと、肘が深く曲がっていても
 *     肩と手首の高さがそろうフィニッシュを拾い、「チキンウィング」と誤判定していた。
 */
{
  const fr = buildFront().map((f, i) => ({ t: i / 30, lms: cloneLms(f.lms) }));
  const k0 = A.detectKeyFrames(fr, 'right');
  const m0 = A.measure(fr, k0, 'right', 'front');

  // フィニッシュ側の数コマを「肘を深く曲げて、手首を肩と同じ高さにたたんだ」姿勢にする
  const folded = fr.map((f, i) => ({ t: f.t, lms: cloneLms(f.lms) }));
  for (let i = folded.length - 6; i < folded.length; i++) {
    const p = folded[i].lms;
    p[12] = { x: 0.500, y: 0.300 };                 // 右肩
    p[14] = { x: 0.560, y: 0.250 };                 // 右肘（跳ね上がる）
    p[16] = { x: 0.470, y: 0.300 };                 // 右手首（肩と同じ高さ = 見かけ上「腕が水平」）
  }
  const k1 = A.detectKeyFrames(folded, 'right');
  const m1 = A.measure(folded, k1, 'right', 'front');

  check('フォローの位置がたたんだコマに移らない', k1.follow < folded.length - 6, true);
  check('フォローの位置が元のまま', k1.follow, k0.follow, 0);
  check('肘の角度がたたんだ姿勢の値にならない', m1.trailElbowFollow, m0.trailElbowFollow, 0.001);
}

/*
 * (b) フィニッシュの右足は「かかと〜つま先」で測る。すね（膝→足首）ではない。
 *     フルフィニッシュでは足を後ろに残したままつま先立ちになるため、
 *     すねは大きく傾いていても足自体は地面と垂直になる。
 */
{
  const fr = buildFront().map((f, i) => ({ t: i / 30, lms: cloneLms(f.lms) }));
  const k = A.detectKeyFrames(fr, 'right');
  const p = fr[k.finish].lms;

  // すねは大きく傾け、足はつま先立ちで垂直にする
  p[26] = { x: 0.640, y: 0.760 };                   // 右膝（後方に大きく残る）
  p[28] = { x: 0.575, y: 0.930 };                   // 右足首
  p[30] = { x: 0.578, y: 0.905 };                   // 右かかと（つま先のほぼ真上）
  p[32] = { x: 0.575, y: 0.960 };                   // 右つま先

  const m = A.measure(fr, k, 'right', 'front');
  const shin = Math.abs(Math.atan2(p[26].x - p[28].x, p[28].y - p[26].y) * 180 / Math.PI);
  check(`すねは傾いている（${shin.toFixed(0)}°）`, shin > 20, true);
  check('それでも足は垂直と判定される', m.trailFootFinish < 10, true);

  const item = A.diagnose(m, 'front', 'driver').items.find(i => i.id === 'trailFootFinish');
  check('つま先立ちのフィニッシュが満点', item.score, 100, 0);

  // 逆に、足の裏が地面についたままなら減点される
  p[30] = { x: 0.545, y: 0.958 };                   // かかとが後ろ・地面の高さ
  const m2 = A.measure(fr, k, 'right', 'front');
  const item2 = A.diagnose(m2, 'front', 'driver').items.find(i => i.id === 'trailFootFinish');
  check('べた足のフィニッシュは減点', item2.score < 100, true);
}

section('12. 写真モード（ポジションが一部だけでも動くか）');
// 写真モードは「必要な写真だけを並べた frames」と「phase → 添字」の keys を渡す。
// 時刻はすべて 0 なので、テンポのような時間差の項目は自動的に落ちる。

// (a) アドレス＋トップだけ
{
  const { frames, keys } = asPhotos(fF, kF, ['address', 'top']);
  const met = A.measure(frames, keys, 'right', 'front');
  const d = A.diagnose(met, 'front', 'driver');
  check('アドレスの項目が出る', met.stanceWidth !== undefined, true);
  check('トップの項目が出る', met.shoulderTurn !== undefined && met.headAtTop !== undefined, true);
  check('インパクトの項目は出ない', met.headAtImpact, undefined);
  check('フィニッシュの項目は出ない', met.finishStack, undefined);
  check('テンポは出ない（時刻がすべて 0）', met.tempo, undefined);
  check('ダウンの項目は出ない（写真なし）', met.hipDownswing, undefined);
  check('診断は成立し、項目数が動画より少ない', d.items.length > 0 && d.items.length < good.items.length, true);
  check('総合スコアが 0〜100', d.overall >= 0 && d.overall <= 100, true);
}

// (b) アドレスだけ
{
  const { frames, keys } = asPhotos(fF, kF, ['address']);
  const met = A.measure(frames, keys, 'right', 'front');
  check('アドレスだけでも計測できる', met.handPosFront !== undefined, true);
  check('トップの項目は出ない', met.hipAtTop, undefined);
  check('診断が例外を投げない', A.diagnose(met, 'front', 'driver').items.length > 0, true);
}

// (c) アドレスがない場合は診断不能
{
  const { frames, keys } = asPhotos(fF, kF, ['top', 'impact']);
  const met = A.measure(frames, keys, 'right', 'front');
  check('アドレスがなければ空を返す', Object.keys(met).length, 0, 0);
}

// (d) 後方撮影の写真モード
{
  const { frames, keys } = asPhotos(fS, kS, ['address', 'impact']);
  const met = A.measure(frames, keys, 'right', 'side');
  check('後方: 前傾角が出る', met.spineAddress, 30, 1.5);
  check('後方: インパクトの前傾変化が出る', met.spineAtImpact !== undefined, true);
  check('後方: トップの前傾変化は出ない', met.spineAtTop, undefined);
  check('後方: バックスイングの項目は出ない', met.handAtBackswing, undefined);
}

// (e) 全ポジションの写真をそろえれば、テンポ以外は動画と同じ値になる
{
  const all = PHASE_ORDER_TEST;
  const { frames, keys } = asPhotos(fF, kF, all);
  const met = A.measure(frames, keys, 'right', 'front');
  for (const k of Object.keys(mF)) {
    if (k === 'tempo' || k === 'tempoDetail') continue;   // テンポは写真では出ない
    check(`写真7枚: ${k} が動画と一致`, met[k], mF[k], 0.001);
  }
  check('写真7枚でもテンポだけは出ない', met.tempo, undefined);
}

section('12-2. 画面まわり（app.js と index.html の突き合わせ）');
/*
 * app.js は id で要素を引くので、index.html 側の id を書き忘れると
 * その場では気づかず、結果表示のときに初めて落ちる。ここで先に検出する。
 */
{
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
  const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));

  const start = app.indexOf('const els = {');
  const block = app.slice(start, app.indexOf('};', start));
  const els = [...block.matchAll(/(\w+):\s*\$\('([^']+)'\)/g)].map(m => ({ key: m[1], id: m[2] }));
  check('els が読み取れる', els.length > 20, true);

  const missing = els.filter(e => !htmlIds.has(e.id)).map(e => `${e.key}→#${e.id}`);
  check(`els の id がすべて index.html にある${missing.length ? '（欠け: ' + missing.join(', ') + '）' : ''}`,
    missing.length, 0, 0);

  const keys = new Set(els.map(e => e.key));
  const undef = [...new Set([...app.matchAll(/els\.(\w+)/g)].map(m => m[1]))].filter(k => !keys.has(k));
  check(`els.○○ の参照がすべて定義済み${undef.length ? '（未定義: ' + undef.join(', ') + '）' : ''}`,
    undef.length, 0, 0);

  // アドレス基準表は撮影角度で出し分ける
  const rows = [...app.matchAll(/\{ label: '([^']+)', field: '\w+', view: '(front|side)'/g)]
    .map(m => [m[1], m[2]]);
  check('アドレス基準表の行数', rows.length, 5, 0);
  check('正面で出る行', rows.filter(r => r[1] === 'front').length, 3, 0);
  check('後方で出る行', rows.filter(r => r[1] === 'side').length, 2, 0);
  check('前傾角は後方', (rows.find(r => r[0] === '前傾角') || [])[1], 'side');
  check('ボールの位置は正面', (rows.find(r => r[0] === 'ボールの位置') || [])[1], 'front');
  check('撮影角度で絞り込んでいる',
    /REF_ROWS\.filter\(r => r\.view === opt\.view\)/.test(app), true);

  // 「優先して直したい項目」がスコアのすぐ下にあること
  const iPri = html.indexOf('id="priorities"');
  const iVideo = html.indexOf('id="videoCard"');
  const iScore = html.indexOf('id="scoreNum"');
  check('優先して直したい項目がある', iPri > 0, true);
  check('優先項目はスコアより下', iPri > iScore, true);
  check('優先項目は動画カードより上', iPri < iVideo, true);
}

section('13. スイング前に余計な動きがある動画');
/*
 * 実際の動画は「構える → ワッグル → 素振り → 構え直す → 本番のスイング」のように
 * スイング前に動きが入る。動画の先頭から動き出しを探すと素振りやワッグルを
 * アドレスと誤認するので、本番のスイングだけを拾えるかを確認する。
 */
/** アドレス姿勢のまま、手元だけ (dx, dy) ずらしたフレームを作る */
function poseAt(addrLms, dx, dy) {
  const l = cloneLms(addrLms);
  l[15] = { x: l[15].x + dx, y: l[15].y + dy };
  l[16] = { x: l[16].x + dx, y: l[16].y + dy };
  return l;
}

/**
 * 本番より小さい素振りを作る。振り終わったあとは、構えの位置までゆっくり戻す
 * （瞬間移動させると、そこが本番より速い最速点になってしまう）。
 */
function practiceSwing(swing, ampl) {
  const a = swing[0].lms;
  const out = [];
  for (const f of swing) {
    const l = cloneLms(f.lms);
    for (const w of [15, 16]) {
      l[w] = { x: a[w].x + (f.lms[w].x - a[w].x) * ampl, y: a[w].y + (f.lms[w].y - a[w].y) * ampl };
    }
    out.push(l);
  }
  const last = out[out.length - 1];
  const RET = 24;                                     // クラブを下ろして構え直すまで
  for (let i = 1; i <= RET; i++) {
    const u = i / RET;
    const l = cloneLms(a);
    for (const w of [15, 16]) {
      l[w] = { x: last[w].x + (a[w].x - last[w].x) * u, y: last[w].y + (a[w].y - last[w].y) * u };
    }
    out.push(l);
  }
  return out;
}

const real = buildFront();
const addr = real[0].lms;

const preroll = [];
for (let i = 0; i < 20; i++) preroll.push(poseAt(addr, 0, 0));                  // 構える
for (let i = 0; i < 30; i++) {                                                  // ワッグル
  const taper = Math.sin(Math.PI * i / 29);                                     // 端をなめらかに
  preroll.push(poseAt(addr, Math.sin(i / 2.2) * 0.022 * taper, 0));
}
for (let i = 0; i < 12; i++) preroll.push(poseAt(addr, 0, 0));                  // 一度止まる
preroll.push(...practiceSwing(real, 0.6));                                      // 素振り
for (let i = 0; i < 15; i++) preroll.push(poseAt(addr, 0, 0));                  // 構え直す

const OFFSET = preroll.length;
const composite = [...preroll.map(l => ({ lms: l })), ...real.map(f => ({ lms: f.lms }))]
  .map((f, i) => ({ t: i / 30, lms: f.lms }));

console.log(`   本番のスイングは ${OFFSET} フレーム目から（全 ${composite.length} フレーム）`);
const kC = A.detectKeyFrames(composite, 'right');
console.log('  ', JSON.stringify(kC), '→ 本番基準:',
  JSON.stringify(Object.fromEntries(Object.entries(kC).map(([k, v]) => [k, v - OFFSET]))));

check('アドレスが素振り・ワッグルより後', kC.address > OFFSET - 20, true);
check('アドレスが本番の構えの位置', kC.address >= OFFSET - 8 && kC.address <= OFFSET + 8, true);
check('トップが本番のトップ', kC.top - OFFSET, 45, 3);
check('インパクトが本番のインパクト', kC.impact - OFFSET, 60, 3);
check('バックスイングがアドレスとトップの間', kC.backswing > kC.address && kC.backswing < kC.top, true);
check('バックスイングがワッグルを拾っていない', kC.backswing > OFFSET, true);
check('フォローがインパクトより後', kC.follow >= kC.impact, true);

// 計測値も、余計な動きがない場合とほぼ一致するはず
const mC = A.measure(composite, kC, 'right', 'front');
for (const k of ['headAtTop', 'hipAtTop', 'shoulderTurn', 'headAtImpact', 'hipAtImpact']) {
  check(`${k} が素振りなしの場合と一致`, mC[k], mF[k], 0.03);
}
check('テンポが 2.4〜3.6 に収まる', mC.tempo >= 2.4 && mC.tempo <= 3.6, true);

// 振り終わったあともフィニッシュを保持して撮影が続くケース
{
  const finishPose = real[real.length - 1].lms;
  const tail = [];
  for (let i = 0; i < 20; i++) tail.push(cloneLms(finishPose));
  const withTail = [...composite.map(f => ({ lms: f.lms })), ...tail.map(l => ({ lms: l }))]
    .map((f, i) => ({ t: i / 30, lms: f.lms }));
  const kT = A.detectKeyFrames(withTail, 'right');
  check('後ろに動きが続いてもトップは変わらない', kT.top, kC.top, 1);
  check('フィニッシュが振り終わりで止まる', kT.finish - OFFSET <= 92, true);
}

section('14. 骨格検出が乱れたフレームに引っ張られないか');
/*
 * 実際の動画では、手首の位置が1コマだけ大きく飛ぶことがある（背景と紛れる、
 * 体の前で手が重なる、など）。その1コマの見かけの速度はスイングより大きくなるため、
 * そこをインパクトと誤判定しないことを確かめる。
 */
{
  const glitched = composite.map(f => ({ t: f.t, lms: cloneLms(f.lms) }));
  const G = 80;                                     // スイングのはるか前（ワッグル中）
  glitched[G].lms[15] = { x: 0.05, y: 0.05 };       // 手首が画面の隅へ飛ぶ
  glitched[G].lms[16] = { x: 0.08, y: 0.05 };

  const kG = A.detectKeyFrames(glitched, 'right');
  check('乱れたコマがあってもトップは変わらない', kG.top, kC.top, 0);
  check('乱れたコマがあってもインパクトは変わらない', kG.impact, kC.impact, 0);
  check('乱れたコマがあってもアドレスは変わらない', kG.address, kC.address, 0);
}

/*
 * visibility でコマを捨ててはいけない。実際のスイング動画で計測したところ、
 * 手が速く動くバックスイング〜フィニッシュでは visibility が 0.01〜0.46 まで
 * 下がる（手ブレや自己遮蔽のため）。「はっきり写っていないコマを除く」と、
 * 肝心のスイングが丸ごと落ちて検出できなくなる。
 */
{
  const lowVis = composite.map(f => ({ t: f.t, lms: cloneLms(f.lms) }));
  for (let i = OFFSET; i < lowVis.length; i++) {
    lowVis[i].lms[15].visibility = 0.05;
    lowVis[i].lms[16].visibility = 0.08;
  }
  const kV = A.detectKeyFrames(lowVis, 'right');
  check('visibility が低くてもアドレスを検出できる', kV.address, kC.address, 0);
  check('visibility が低くてもトップを検出できる', kV.top, kC.top, 0);
  check('visibility が低くてもインパクトを検出できる', kV.impact, kC.impact, 0);
}

/*
 * 手首の検出が毎コマ揺れるケース（被写体が画面内で小さいと実際に起きる）。
 *
 * 揺れが乗ると見かけの最高速が本来より低く見積もられ、「最速点から遡って
 * 速度が閾値を下回る点を切り返しとする」方式では、バックスイング全体が閾値を
 * 超えたままになって遡りすぎ、アドレス付近をトップと誤判定する。
 * トップは速度の谷ではなく手元の高さで決めているので、揺れても動じないこと。
 */
{
  const jitter = (fr, amp) => fr.map((f, i) => {
    const l = cloneLms(f.lms);
    const h = k => { const s = Math.sin(i * k) * 43758.5453; return (s - Math.floor(s) - 0.5) * amp; };
    const jx = h(12.9898), jy = h(78.233);
    l[15] = { x: l[15].x + jx, y: l[15].y + jy };
    l[16] = { x: l[16].x + jx, y: l[16].y + jy };
    return { t: f.t, lms: l };
  });

  for (const amp of [0.010, 0.020]) {
    const noisy = jitter(composite, amp);
    const kN = A.detectKeyFrames(noisy, 'right');
    check(`揺れ±${amp}: トップが本番のトップ`, kN.top - OFFSET, 45, 3);
    check(`揺れ±${amp}: インパクトが本番のインパクト`, kN.impact - OFFSET, 60, 3);
    check(`揺れ±${amp}: アドレスがトップより前`, kN.address < kN.top, true);
    check(`揺れ±${amp}: トップがアドレス付近に落ちていない（間隔 ${kN.top - kN.address} コマ）`,
      kN.top - kN.address > 20, true);
  }
}

/* 中央値フィルタが本番のインパクト検出を鈍らせていないこと */
{
  const kPlain = A.detectKeyFrames(real.map((f, i) => ({ t: i / 30, lms: f.lms })), 'right');
  check('素のスイングでもトップは 45 付近', kPlain.top, 45, 2);
  check('素のスイングでもインパクトは 60 付近', kPlain.impact, 60, 2);
}

console.log(`\n────────────────\n成功 ${pass} / 失敗 ${fail}\n`);
process.exit(fail ? 1 : 0);

