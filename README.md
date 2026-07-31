# X Scheduler Quick Menu

X (formerly Twitter) の投稿画面に、予約投稿のショートカットメニューを追加する拡張機能です。

## 特徴

- 投稿ボタンの近くにショートカットボタンを追加
- 固定時刻の予約投稿をワンタップで実行
- 自分で追加した日時プリセットを保存・削除可能
- メニューは画面内に収まるように配置し、必要に応じてスクロール可能

## 対応環境

- Google Chrome / Chromium 系ブラウザ
- Firefox
- Manifest V3
- 対象サイト: `x.com`, `twitter.com`

## インストール方法

1. このリポジトリをローカルに配置します。
2. Chrome で `chrome://extensions` を開きます。
3. 右上の「デベロッパー モード」を有効にします。
4. 「パッケージ化されていない拡張機能を読み込む」を選びます。
5. `X-Scheduler-Quick-Menu` フォルダを指定します。

### Firefox での読み込み

1. Firefox で `about:debugging#/runtime/this-firefox` を開きます。
2. 「一時的なアドオンを読み込む」を選びます。
3. このリポジトリ内の `manifest.json` を指定します。

## 配布方法

GitHub Release を作成すると、GitHub Actions が ZIP を自動生成して添付します。
生成物はソース一式をまとめた配布用 ZIP です。

## 使い方

1. X の投稿画面を開きます。
2. 「ポストする」ボタンの近くに表示される ▼ ボタンを押します。
3. 予約メニューから固定時刻または保存済みプリセットを選びます。
4. 「日時を追加」から新しいプリセットを追加できます。

## 保存されるデータ

この拡張機能は `chrome.storage.local` に日時プリセットを保存します。
外部サーバーへ送信する処理はありません。

## 開発メモ

- 実装の中心は [content.js](content.js) です。
- 見た目は [style.css](style.css) で調整しています。
- Manifest は [manifest.json](manifest.json) にあります。

## 注意事項

- X の UI 変更によって、セレクタや予約モーダルの構造が変わると動作が変わる場合があります。
- 予約投稿の自動化は、X 側の仕様変更や制限の影響を受けることがあります。
- Firefox では、X 側の UI や拡張機能 API の差分により挙動が Chrome と完全一致しない場合があります。
