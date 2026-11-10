# フェイク着信アプリ PWA版 ソース一式

## ファイル構成
- index.html : 本体HTML（css/style.css と js/app.js を読み込みます）
- css/style.css : 全スタイル
- js/app.js : 全ロジック（発信者・セリフ・タイマー・着信・通話）
- manifest.webmanifest : PWAマニフェスト（display: fullscreen / start_url は ./index.html に調整済み）
- sw.js : Service Worker（アセットのキャッシュ用）
- icons/ : アプリアイコン（apple-touch-icon / 192 / 512）
- images/miruku.jpg : ミルクの写真（発信者アバター）
- audio/ringtone.wav : 着信音
- audio/script-a1〜a4.mp3 : セリフA（脱出用・緊急呼び出し）※間(gap)は js/app.js 側で管理
- audio/script-b1〜b4.mp3 : セリフB（ミルクおしゃべり）
- audio/script-c1〜c3.mp3 : セリフC（仕事の緊急連絡）

## 置き方
このフォルダの中身をそのまま、HTTPSで配信できる場所にアップロードしてください。
index.html を開けば動きます。iPhoneでは Safari で開いて「ホーム画面に追加」すると
全画面（バーなし）で起動します。

## 注意
- 音声・画像は相対パス参照に直してあるので、フォルダ構成を変えると読み込めなくなります。
- オリジナルの単一ファイル版（全て埋め込み）は hueikuzhao-xin-apuri.html です（このZIPには含まれません）。

## 更新メモ
- 着信・通話画面の偽ステータスバー（9:41／電波／Wi-Fi／バッテリー）を削除済み。実機のステータスバーがそのまま表示されます。
