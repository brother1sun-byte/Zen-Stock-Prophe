This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

---

## Development Workflow (Automation)

このプロジェクトは開発効率化のために以下のスクリプトを用意しています。
コマンドはすべてプロジェクトルートで実行してください。

### 1. 開発環境の起動 (Frontend & Backend)
フロントエンド(localhost:3000)とバックエンド(localhost:8000)を同時に起動します。

```bash
npm run start-dev
```

### 2. API動作確認
APIエンドポイント(/predict)の疎通確認を行います。

```bash
npm run check-api
```

### 3. テスト実行
フロントエンドとバックエンドのテストを一括実行します。

```bash
npm run test-all
```

### 4. Lint & 型チェック
コード品質チェックを実行します。コミット前に推奨。

```bash
npm run lint-check
```

---

## Phase 2 Key Features (Backend)
- **Reproducible Analysis**: `asof` パラメータによる、過去の特定時点を基準とした再現可能な分析機能。
- **Playbook Persistence**: 投資の教訓をディスク上に安全に保存し、再起動後も永続化。
- **Two-Layer Cache**: L1(メモリ) & L2(ディスク) の二層キャッシュにより、APIレスポンスの高速化と外部API負荷を軽減。
- **Refined Risk Logic**: 決算発表直前の自動リスク回避（ロット削減）およびセクターバイアスの検知ロジック。
- **Robust Error Handling**: データ欠損時の部分的レスポンス（Partial Response）対応。

### トラブルシューティング
- **サーバーが起動しない**: `scripts/start-dev.bat` を直接実行してエラー出力を確認してください。
- **APIがつながらない**: `npm run check-api` で詳細なエラーを見てください。
- **ログ**: `backend/logs/` ディレクトリにログが出力されます。
