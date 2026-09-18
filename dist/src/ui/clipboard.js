/**
 * 文字列をクリップボードへ渡す。
 *
 * 画面は canvas 1 枚で、選択もコピーもできない。だから外へ文字を出す口が要る。
 *
 * navigator.clipboard は HTTPS（GitHub Pages はそう）とユーザー操作が要る。
 * どちらかが欠けていても遊びが止まらないように、window.prompt に落とす。
 * prompt は第 2 引数の文字列が選択された状態で開くので、そのままコピーできる。
 */
import { buildPlayLog } from '../game/playlog.js';
export async function copyText(text) {
    const nav = globalThis.navigator;
    if (nav?.clipboard?.writeText) {
        try {
            await nav.clipboard.writeText(text);
            return 'clipboard';
        }
        catch {
            // 権限が無い・安全な文脈ではない。下の逃げ道へ
        }
    }
    try {
        // 戻り値は見ない。開いた時点で選択されているので、閉じ方は本人に任せる
        globalThis.prompt?.('コピーしてください（Ctrl+A → Ctrl+C）', text);
        return 'prompt';
    }
    catch {
        return 'failed';
    }
}
// ---------------------------------------------------------------------------
// プレイログ
// ---------------------------------------------------------------------------
/**
 * プレイログを 1 枚にして、クリップボードへ渡す。
 *
 * 出せる場所が 3 つ（ダンジョン・結果画面・村）あるので、
 * 組み立てと知らせ方はここに 1 つだけ置く。散らすと文面がずれる。
 *
 * 戻り値は画面に出す 1 行。
 */
export async function copyPlayLog(replay, head) {
    if (!replay)
        return 'まだ 記録が ありません。';
    const text = await buildPlayLog(replay, head);
    const size = Math.round(text.length / 1024);
    switch (await copyText(text)) {
        case 'clipboard':
            return `プレイログを コピーしました（${replay.actions.length} 手・約 ${size}KB）。`;
        case 'prompt':
            return 'プレイログを 出しました。選んで コピーしてください。';
        default:
            return 'コピーできませんでした。';
    }
}
//# sourceMappingURL=clipboard.js.map