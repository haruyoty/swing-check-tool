/* ============================================================================
 * lessons.js — 症状に合う参考レッスン動画を、チャンネルの目録から探す
 * ----------------------------------------------------------------------------
 * videos.js に入っているチャンネル全動画のタイトルを、criteria.js の
 * LESSON_QUERIES（症状ごとのキーワード）で検索して、点数の高い順に返します。
 *
 * ローカルの HTML から YouTube を直接検索することはできません（別ドメインへの
 * 通信がブラウザに止められるため）。そこでチャンネルの目録を videos.js に
 * 持っておき、そこを毎回検索する形にしています。
 * 目録の作り直し方は README を参照してください。
 * ==========================================================================*/

/* タイトルの表記ゆれを吸収してから照合する */
function normalizeTitle(s) {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[ー―‐−]/g, 'ー')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/* 目録は起動時に一度だけ正規化しておく（毎回の検索を軽くするため） */
const LESSON_INDEX = (typeof CHANNEL_VIDEOS === 'undefined' ? [] : CHANNEL_VIDEOS)
  .map(([id, title], order) => ({ id, title, key: normalizeTitle(title), order }));

/**
 * 症状のキーワードで動画を検索する。
 *
 * words は ['前傾', ['起き上が', 3]] のように、文字列または [語, 重み] の配列。
 * 重みを省略すると 1。タイトルに含まれていれば加点し、
 *   ・複数のキーワードが当たるほど高得点（掛け合わせで加点）
 *   ・短いタイトルほど、その語が主題である可能性が高いので少し優遇
 * として並べ替えます。
 */
function searchLessons(words, limit) {
  if (!words || !words.length) return [];
  const terms = words.map(w => Array.isArray(w) ? { w: normalizeTitle(w[0]), s: w[1] } : { w: normalizeTitle(w), s: 1 });

  const hits = [];
  for (const v of LESSON_INDEX) {
    let score = 0, matched = 0;
    for (const t of terms) {
      if (t.w && v.key.includes(t.w)) { score += t.s; matched++; }
    }
    if (!matched) continue;
    score += (matched - 1) * 1.5;                 // 複数の語が当たったものを上に
    score += Math.max(0, 30 - v.title.length) / 60;  // 題名が短い＝主題そのもの
    hits.push({ id: v.id, title: v.title, score, order: v.order });
  }

  hits.sort((a, b) => b.score - a.score || a.order - b.order);

  /*
   * 弱い当たりを落とします。キーワードのうち軽い語だけがかすった動画は、
   * その症状の話ではないことが多く、出すとかえって混乱します
   * （例：「肩の回転不足」に対して「スイングの始動は肩から？腰から？」）。
   * いちばん良く当たった動画の半分に届かないものは候補から外します。
   */
  const best = hits.length ? hits[0].score : 0;
  const strong = hits.filter(h => h.score >= best * 0.5);

  return strong.slice(0, limit || 6);
}

/**
 * 項目 id と判定（high / low）に合う動画を、点数順に返す。
 * criteria.js の LESSON_QUERIES にキーワードがなければ空配列。
 */
function lessonCandidates(id, status, limit) {
  const q = typeof LESSON_QUERIES === 'undefined' ? null : LESSON_QUERIES[id];
  if (!q) return [];
  const words = q[status] || q.any;
  return searchLessons(words, limit || LESSON_CANDIDATES);
}

/** 1 つの項目につき、候補を何本まで持っておくか（この中から順に出していく） */
const LESSON_CANDIDATES = 5;

/**
 * 参考レッスン動画を 1 本選ぶ。index を進めると候補が順に切り替わります。
 * 見つからなければ null。
 */
function lessonVideo(id, status, index) {
  const list = lessonCandidates(id, status);
  if (!list.length) return null;
  const n = list.length;
  const pick = list[(((index | 0) % n) + n) % n];
  return { id: pick.id, title: pick.title, count: n };
}
