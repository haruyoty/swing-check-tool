/* ============================================================================
 * update-videos.js — 動画目録（videos.js）の作り直し
 * ----------------------------------------------------------------------------
 * チャンネルに動画を追加したら、これを使って videos.js を最新にしてください。
 *
 * 【使い方】
 *   1. Chrome で https://www.youtube.com/@up7267/videos を開く
 *   2. F12 で開発者ツールを開き、「Console」タブを選ぶ
 *   3. このファイルの中身を全部コピーして貼り付け、Enter
 *   4. 数十秒待つと videos.js がダウンロードされる
 *   5. ダウンロードした videos.js を、このフォルダの videos.js に上書き
 *
 * スクロールは不要です。YouTube 内部のデータを直接読むので、
 * 何百本あっても数十秒で終わります。
 * ==========================================================================*/

(async () => {
  const html = document.documentElement.innerHTML;
  const key = (html.match(/"INNERTUBE_API_KEY":"(.*?)"/) || [])[1];
  const ver = (html.match(/"INNERTUBE_CLIENT_VERSION":"(.*?)"/) || [])[1];
  let token = (html.match(/"continuationCommand":\{"token":"(.*?)"/) || [])[1];
  if (!key) { console.error('YouTube のチャンネル動画一覧ページで実行してください'); return; }

  const found = new Map();

  /* 画面表示用のデータ（lockupViewModel）から、動画IDとタイトルを拾う */
  const collect = obj => {
    const walk = o => {
      if (!o || typeof o !== 'object') return;
      const lv = o.lockupViewModel;
      if (lv && lv.contentId) {
        const m = lv.metadata && lv.metadata.lockupMetadataViewModel;
        const t = m && m.title && m.title.content;
        if (t) found.set(lv.contentId, t);
      }
      for (const k in o) walk(o[k]);
    };
    walk(obj);
  };

  const init = html.match(/ytInitialData = (\{.+?\});<\/script>/s);
  if (init) { try { collect(JSON.parse(init[1])); } catch (e) { /* 最初の30本は諦める */ } }

  while (token) {
    const res = await fetch(`/youtubei/v1/browse?key=${key}&prettyPrint=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: ver, hl: 'ja', gl: 'JP' } },
        continuation: token
      })
    });
    const json = await res.json();
    collect(json);
    const next = JSON.stringify(json).match(/"continuationCommand":\{"token":"(.*?)"/);
    token = next ? next[1] : null;
    console.log('取得中… ' + found.size + ' 本');
  }

  const rows = [...found.entries()];
  const today = new Date().toISOString().slice(0, 10);
  const url = location.origin + location.pathname.replace(/\/videos$/, '');

  const text = [
    '/* ============================================================================',
    ' * videos.js — YouTube チャンネル「ゴルフ力UPレッスン」の動画目録',
    ' * ----------------------------------------------------------------------------',
    ' * lessons.js が、この一覧を症状のキーワードで検索して参考動画を選びます。',
    ' *',
    ' * 【自動生成ファイルです。手で編集しないでください】',
    ' * 新しい動画を足したら、update-videos.js の手順で作り直してください。',
    ' *',
    ' *   チャンネル : ' + url,
    ' *   本数       : ' + rows.length,
    ' *   取得日     : ' + today,
    ' * ==========================================================================*/',
    '',
    "const CHANNEL_URL = '" + url + "';",
    "const CATALOG_UPDATED = '" + today + "';",
    '',
    '/* [動画ID, タイトル] */',
    'const CHANNEL_VIDEOS = ['
  ].join('\n') + '\n'
    + rows.map(([id, t]) => '  ' + JSON.stringify([id, t]) + ',').join('\n')
    + '\n];\n';

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  a.download = 'videos.js';
  document.body.appendChild(a);
  a.click();
  a.remove();

  console.log(`完了: ${rows.length} 本を videos.js に書き出しました`);
})();
