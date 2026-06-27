import { dataSourceBadgeInfo } from './dataSource';

function scoreTone(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return 'warn';
  if (value >= 70) return 'good';
  if (value >= 45) return 'warn';
  return 'danger';
}

function statusItem({ id, label, status, tone = 'neutral', detail, source = '無料データ', action }) {
  return {
    id,
    label,
    status,
    tone,
    detail,
    source,
    action,
  };
}

export function buildResearchCoverage({
  selectedDetail,
  selectedAdvancedReport,
  selectedSourceContext,
  jquantsView,
  marketRankings,
}) {
  const sourceInfo = dataSourceBadgeInfo(selectedSourceContext || selectedDetail || {});
  const hasUsablePrice = sourceInfo.key !== 'synthetic' && sourceInfo.key !== 'unknown';
  const hasTechnical = Boolean(selectedAdvancedReport?.factors);
  const hasWalkForward = Number(selectedAdvancedReport?.walkForward?.sampleCount || 0) > 0;
  const mlPrediction = selectedAdvancedReport?.mlPrediction;
  const hasDisclosure = Boolean(
    selectedDetail?.news?.count
    || selectedDetail?.news?.items?.length
    || selectedDetail?.material?.summary
  );
  const jquantsConnected = Boolean(jquantsView?.configured && jquantsView?.matchesSelection);
  const hasRanking = Boolean(marketRankings?.items?.length);

  return [
    statusItem({
      id: 'price',
      label: '株価データ',
      status: hasUsablePrice ? '取得済み' : '要注意',
      tone: sourceInfo.tone === 'normal' ? 'good' : sourceInfo.tone,
      source: sourceInfo.label,
      detail: sourceInfo.warning || '主要価格にデータ出所を表示しています。',
      action: hasUsablePrice ? 'チャート・注文練習の参考値として利用' : '実データ確認後に判断',
    }),
    statusItem({
      id: 'ranking',
      label: '市場スクリーニング',
      status: hasRanking ? '取得済み' : '確認待ち',
      tone: hasRanking ? 'good' : 'warn',
      source: marketRankings?.provider || marketRankings?.source || 'JPX/yfinance系',
      detail: hasRanking
        ? `${marketRankings.items.length}件のランキング候補を保持しています。`
        : 'ランキング取得前、または取得に失敗しています。',
      action: hasRanking ? '候補比較に利用' : '再取得または銘柄指定で確認',
    }),
    statusItem({
      id: 'technical',
      label: 'テクニカル分析',
      status: hasTechnical ? '計算済み' : '確認待ち',
      tone: hasTechnical ? scoreTone(selectedAdvancedReport?.compositeScore) : 'warn',
      source: 'ローカル計算',
      detail: hasTechnical
        ? 'トレンド、勢い、流動性、ATRリスクを同じ銘柄に連動して表示します。'
        : '高度分析APIの取得待ちです。',
      action: '売買推奨ではなく、確認材料として使用',
    }),
    statusItem({
      id: 'walk_forward',
      label: 'ウォークフォワード検証',
      status: hasWalkForward ? '検証あり' : '標本不足',
      tone: hasWalkForward ? scoreTone(selectedAdvancedReport?.walkForward?.score) : 'warn',
      source: '過去データ検証',
      detail: hasWalkForward
        ? `標本数 ${selectedAdvancedReport.walkForward.sampleCount}件 / エッジ ${Number(selectedAdvancedReport.walkForward.edgePct || 0).toFixed(1)}pt`
        : '過去標本が不足しているため、強い判断材料にはしません。',
      action: hasWalkForward ? '過去検証の強弱を確認' : '参考表示に留める',
    }),
    statusItem({
      id: 'ai',
      label: 'AI検証補助',
      status: mlPrediction ? '表示中' : '確認待ち',
      tone: mlPrediction ? (mlPrediction.status === 'supportive' ? 'good' : mlPrediction.status === 'contradiction' ? 'danger' : 'warn') : 'warn',
      source: 'ローカルML',
      detail: mlPrediction
        ? `${mlPrediction.horizonDays || 5}営業日確率 ${Number(mlPrediction.probabilityUpPct || 0).toFixed(1)}%。投資助言ではありません。`
        : 'AI検証補助はまだ取得されていません。',
      action: '候補を疑うための補助材料',
    }),
    statusItem({
      id: 'disclosure',
      label: '開示・材料確認',
      status: hasDisclosure ? '材料あり' : '未確認',
      tone: hasDisclosure ? 'good' : 'warn',
      source: selectedDetail?.material?.source || 'TDnet/EDINET/J-Quants候補',
      detail: hasDisclosure
        ? (selectedDetail?.news?.summary || selectedDetail?.material?.summary || '材料情報を取得済みです。')
        : '決算・適時開示・重要ニュースの確認が不足しています。',
      action: hasDisclosure ? '材料の鮮度と内容を確認' : '取引前に公式開示を確認',
    }),
    statusItem({
      id: 'fundamental',
      label: '財務・業績',
      status: jquantsConnected ? '接続済み' : '未接続',
      tone: jquantsConnected ? 'good' : 'warn',
      source: jquantsConnected ? 'J-Quants遅延データ' : 'J-Quants未接続',
      detail: jquantsConnected
        ? 'EPS/BPSなどの公的履歴を確認できます。リアルタイムではありません。'
        : '無料枠やトークン設定がない場合は、財務確認を別途行ってください。',
      action: jquantsConnected ? '割安性と決算影響を確認' : '次の拡張候補',
    }),
  ];
}
