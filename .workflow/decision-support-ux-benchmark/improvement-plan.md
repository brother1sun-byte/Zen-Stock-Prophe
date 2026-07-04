# Decision-support UX improvement plan

| 改善項目 | 優先度 | 期待効果 | リスク | 実装対象ファイル | テスト方法 |
| --- | --- | --- | --- | --- | --- |
| 生活導線パネル上部の判断支援ブリーフ | S | 数秒で目的、結論、判断範囲、材料、不足情報を確認できる | 情報量が増えすぎる | `src/components/LifestyleDaytradePanel.jsx`, `src/utils/lifestyleDaytradeModes.js`, `src/index.css` | UI testでブリーフ表示を確認 |
| 材料、需給、テクニカル、リスクの分離表示 | S | 判断材料の混在を避け、過信を防ぐ | 既存カードとの重複 | `src/utils/lifestyleDaytradeModes.js` | unit testで4カテゴリを確認 |
| 手動判断前チェックリスト | S | 一次情報、現在価格、注文上限、撤退ライン、見送り条件を確認しやすくする | 強い行動誘導に見える可能性 | `src/components/LifestyleDaytradePanel.jsx` | UI testでチェックリストを確認 |
| データ注意の上部表示 | S | 推定、未取得、材料なし、手入力が必要な価格を隠さない | 注意文が長くなる | `src/components/LifestyleDaytradePanel.jsx`, `src/index.css` | UI testでデータ注意を確認 |
| READMEと運用手順への最小追記 | A | 初回利用者と運用者が改善意図を理解できる | 既存文書の肥大化 | `README.md`, `.workflow/.../release-notes.md`, `.workflow/.../operation-checklist.md` | 目視確認とテスト |
| TDnet実取得、長時間ライブ確認、レビューインポート | B | 将来の精度と運用性向上 | 今回範囲を超える | 設計のみ | 残課題として記録 |

## 実装方針

- 既存の4モード、保存ロジック、バックエンドAPIには触れない。
- 新しい外部通信、外部送信、実注文、自動取引は追加しない。
- UIは上部ブリーフとチェックリストの追加に限定し、詳細カードの既存挙動を維持する。
- 追加テストは既存Playwright構成に合わせる。
