import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  ShieldCheck,
  Target,
  XCircle,
} from 'lucide-react';
import CandidateSummary from './CandidateSummary';
import { DataSourceBadge, DataSourceWarning } from './DataSourceBadge';

const copy = {
  heading: 'デイトレ候補レビュー',
  title: '本日の最有力候補',
  noCandidateTitle: '本日の判定保留',
  analysis: '分析結果:',
  expectedPnl: '期待損益',
  decision: '判断',
  entry: '注文目安',
  target: '利確',
  stop: '損切',
  shares: '株数',
  quantityZero: '0株',
  risk: 'リスク',
  whyCandidate: 'なぜ候補か',
  skipConditions: 'なぜ今は見送るか',
  memo: '判断メモ',
  detail: '詳細分析へ',
  openingPlan: '寄り付き後の方針',
  selectedDecision: '選択中銘柄の判断',
  decisionSource: '判断ソース',
  sourceEvidence: '価格とランキングのソース',
  crossEngine: 'クロスチェック状況',
  summaryPnl: 'シミュレーション期待損益',
  fallbackNotice: '参考候補です。実データと条件の再確認を前提に扱ってください。',
  liveNotice: '分析条件に沿った候補です。寄り付き直後の気配と板の確認を前提にしてください。',
  entryHelp: '寄り付き後は見送り判定も含みます',
  targetHelp: '想定利益',
  stopHelp: '最大損失',
  budgetUsed: '使用額',
  material: '材料確認',
  takeProfit: '利確',
  below: '以下',
  freshStrip: '鮮度と出所',
  trustGate: '信頼ゲート',
  noTradeBody: '今日は強く推せる候補がありません。判定保留は失敗ではなく、誤った行動を止めた結果として扱います。',
};

function buildVerdict({ daytradeTopPick, decisionGate, crossEngineCheck, isFallbackTopPick }) {
  if (!daytradeTopPick) {
    return {
      tone: 'block',
      label: '見送り',
      title: '今日は行動候補なし',
      summary: copy.noTradeBody,
      icon: XCircle,
    };
  }

  const crossStatus = crossEngineCheck?.status || daytradeTopPick?.advancedCrossEngineCheck?.status;
  if (decisionGate?.ready && crossStatus === 'aligned' && !isFallbackTopPick && daytradeTopPick.tradeReadiness === 'ready') {
    return {
      tone: 'pass',
      label: '条件通過',
      title: '候補は監査を通過',
      summary: 'ただし寄り付き後の板・出来高・気配確認は必須です。',
      icon: CheckCircle2,
    };
  }

  if (daytradeTopPick.tradeReadiness === 'avoid' || crossStatus === 'blocked') {
    return {
      tone: 'block',
      label: '見送り',
      title: '現時点では見送り優先',
      summary: crossEngineCheck?.detail || '主要な安全条件が揃っていません。',
      icon: XCircle,
    };
  }

  return {
    tone: 'review',
    label: '要確認',
    title: '候補はあるが再確認が必要',
    summary: crossEngineCheck?.detail || '候補は見えていますが、板・鮮度・整合性の再確認が必要です。',
    icon: AlertTriangle,
  };
}

export default function TopCandidateCard({
  ready,
  topPickTickerLabel,
  topPickReason,
  daytradeTopPick,
  simpleTopPickAction,
  isFallbackTopPick,
  scoreTone,
  marketStatusTopLabel,
  marketFreshnessLabel,
  marketFreshness,
  topPickSource,
  topCandidateMetrics = [],
  selectedRankingLabel,
  selectedRankingMetric,
  topPickMaterial,
  focusTopPick,
  openingScenarioPlan = [],
  briefScore,
  StatusPill,
  yen,
  simpleOpportunityText,
  riskLevelLabel,
  crossEngineCheck = {},
  crossEngineGatePreview = [],
  crossEngineGateLabel,
  crossEngineTone,
  decisionScoreLabel,
  selectedDecisionSourceLabel,
  selectedRankContext,
  selectedSourceEvidence = [],
  tradeStrategyTitle,
  tradeStrategyReason,
  jobsCandidate,
  selectedAdvancedReport,
  decisionGate,
  jobsVerdictHeadline,
  selectedDetail,
  valueDisciplineLens,
  chatGptPrompt,
  chatGptPromptCopied,
  onCopyChatGptPrompt,
}) {
  const StatusPillComponent = StatusPill;
  const metrics = topCandidateMetrics;
  const verdict = buildVerdict({
    daytradeTopPick,
    decisionGate,
    crossEngineCheck,
    isFallbackTopPick,
  });
  const VerdictIcon = verdict.icon;
  const crossStatus = crossEngineCheck?.status || daytradeTopPick?.advancedCrossEngineCheck?.status || 'pending';
  const blockerItems = [
    daytradeTopPick?.primaryWarning,
    ...(daytradeTopPick?.invalidConditions || []),
    ...(daytradeTopPick?.whyNotBuy || []),
  ].filter(Boolean);
  const cautionReasons = [
    marketFreshness?.isSynthetic ? '補完データを含むため参考表示です。' : null,
    marketFreshness?.isCached ? 'キャッシュが混じるため最新板の再確認が必要です。' : null,
    marketFreshness?.isUnknown ? '鮮度が未確認のため慎重に扱ってください。' : null,
    crossStatus === 'review' ? (crossEngineCheck?.detail || 'クロスチェックが確認待ちです。') : null,
    crossStatus === 'blocked' ? (crossEngineCheck?.detail || 'クロスチェックで主要条件が揃っていません。') : null,
    selectedDetail?.freshness?.newsOk === false ? '直近材料が古いため、ニュース確認を優先してください。' : null,
  ].filter(Boolean);
  const trustProfile = [
    {
      id: 'freshness',
      label: '鮮度',
      score: marketFreshness?.isSynthetic ? 20 : marketFreshness?.isCached ? 42 : marketFreshness?.isUnknown ? 48 : selectedDetail?.freshness?.priceOk ? 86 : 58,
      note: marketFreshnessLabel,
    },
    {
      id: 'alignment',
      label: '整合',
      score: crossStatus === 'aligned' ? 90 : crossStatus === 'review' ? 55 : crossStatus === 'blocked' ? 18 : 40,
      note: crossEngineCheck?.label || '判定待ち',
    },
    {
      id: 'liquidity',
      label: '流動性',
      score: Math.max(0, Math.min(100, Math.round(Number(daytradeTopPick?.candidateQuality?.qualityScore ?? daytradeTopPick?.dataQuality?.score ?? 50)))),
      note: daytradeTopPick?.volumeRatio ? `出来高 ${Number(daytradeTopPick.volumeRatio).toFixed(2)}x` : '候補品質ベース',
    },
    {
      id: 'technical',
      label: 'テクニカル',
      score: Math.max(0, Math.min(100, Math.round(Number(daytradeTopPick?.score ?? 0)))),
      note: daytradeTopPick?.tradeReadiness === 'ready' ? '寄り付き後レビュー前提' : '再確認優先',
    },
    {
      id: 'event',
      label: '材料',
      score: selectedDetail?.freshness?.newsOk ? 80 : selectedDetail?.freshness?.newsOk === false ? 32 : 52,
      note: topPickMaterial,
    },
  ];
  const showCautionMode = verdict.tone !== 'pass' || cautionReasons.length > 0;

  return (
    <CandidateSummary ready={ready}>
      <div>
        <div className="section-title">
          <ShieldCheck size={18} />
          <span>{copy.heading}</span>
        </div>
        <h2>{daytradeTopPick ? copy.title : copy.noCandidateTitle} {topPickTickerLabel}</h2>
        <p>
          <strong>{copy.analysis}</strong> {topPickReason}
        </p>

        <div className={`candidate-verdict-card ${verdict.tone}`} data-testid="candidate-verdict-card">
          <div className="candidate-verdict-head">
            <div className="candidate-verdict-mark">
              <VerdictIcon size={18} />
              <strong>{verdict.label}</strong>
            </div>
            {decisionGate?.label ? (
              <small>{decisionGate.passed}/{decisionGate.total} {copy.trustGate}</small>
            ) : null}
          </div>
          <strong className="candidate-verdict-title">{verdict.title}</strong>
          <p>{jobsVerdictHeadline || verdict.summary}</p>
          <small>{verdict.summary}</small>
          {decisionGate?.items?.length ? (
            <div className="candidate-audit-gates" aria-label={copy.trustGate}>
              {decisionGate.items.slice(0, 4).map((gate) => (
                <small key={gate.label} className={gate.ok ? 'pass' : 'block'} title={gate.detail}>
                  {gate.ok ? 'OK' : 'NG'} {gate.label}
                </small>
              ))}
            </div>
          ) : null}
        </div>

        <div className="decision-pill-row">
          {daytradeTopPick ? (
            <StatusPillComponent
              label={simpleTopPickAction}
              tone={isFallbackTopPick ? 'warn' : scoreTone(daytradeTopPick.score)}
            />
          ) : null}
          {daytradeTopPick ? (
            <StatusPillComponent
              label={`短期スコア ${daytradeTopPick.score?.toFixed?.(1) ?? '-'} / 100`}
              tone={scoreTone(daytradeTopPick.score)}
            />
          ) : null}
          <StatusPillComponent
            label={`${copy.expectedPnl} ${daytradeTopPick ? yen(daytradeTopPick.probabilityAdjustedProfit) : '-'}`}
            tone="info"
          />
          <StatusPillComponent label={marketStatusTopLabel} tone={daytradeTopPick?.tradeReadiness === 'ready' ? 'good' : 'warn'} />
          <StatusPillComponent
            label={marketFreshnessLabel}
            tone={marketFreshness?.isSynthetic || marketFreshness?.isCached || marketFreshness?.isUnknown ? 'warn' : 'info'}
          />
          <DataSourceBadge source={topPickSource} />
        </div>

        {(selectedSourceEvidence.length > 0 || topPickSource) ? (
          <div className="candidate-freshness-strip" aria-label={copy.freshStrip}>
            <span>{copy.freshStrip}</span>
            {selectedSourceEvidence.map((item) => (
              <small key={item}>{item}</small>
            ))}
          </div>
        ) : null}

        <DataSourceWarning source={topPickSource} />

        {showCautionMode ? (
          <div className={`candidate-caution-strip ${verdict.tone}`} data-testid="candidate-caution-strip">
            <strong>慎重モード</strong>
            {(cautionReasons.length ? cautionReasons : [verdict.summary]).slice(0, 2).map((item) => (
              <small key={item}>{item}</small>
            ))}
          </div>
        ) : null}

        {daytradeTopPick ? (
          <div className="stock-metric-strip summary-metric-strip" data-testid="summary-metric-strip">
            {selectedRankingMetric ? (
              <div className="active-ranking-meter" data-testid="active-ranking-meter">
                <span>表示中のランキング軸</span>
                <strong>{selectedRankingLabel || selectedRankingMetric.label}: {selectedRankingMetric.value}</strong>
                <small>同じ銘柄が複数軸で先頭になる場合も、ここで押したボタンの評価値を確認できます。</small>
              </div>
            ) : null}
            {metrics.map((metric) => (
              <span
                key={metric.id}
                className={`stock-metric ${metric.tone}${metric.active ? ' active' : ''}`}
                data-testid={`summary-metric-${metric.id}`}
              >
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </span>
            ))}
          </div>
        ) : null}

        <div className="trust-profile-grid" data-testid="trust-profile-grid">
          {trustProfile.map((item) => (
            <div key={item.id} className="trust-profile-card" data-testid={`trust-profile-${item.id}`}>
              <span>{item.label}</span>
              <strong>{item.score}/100</strong>
              <div className="trust-profile-bar" aria-hidden="true">
                <i style={{ width: `${item.score}%` }} />
              </div>
              <small>{item.note}</small>
            </div>
          ))}
        </div>

        {valueDisciplineLens ? (
          <div className={`value-discipline-lens ${valueDisciplineLens.tone}`} data-testid="value-discipline-lens">
            <div className="value-discipline-head">
              <div>
                <span>{valueDisciplineLens.label}</span>
                <strong>{valueDisciplineLens.verdict} / {valueDisciplineLens.score} / 100</strong>
              </div>
              <small>堀・安全余裕・割安度・忍耐を確認。シミュレーション専用です。</small>
            </div>
            <p>{valueDisciplineLens.summary}</p>
            <div className="value-discipline-metrics">
              {valueDisciplineLens.metrics.map((metric) => (
                <span key={metric.label} className={metric.tone}>
                  {metric.label}
                  <strong>{metric.value}</strong>
                </span>
              ))}
            </div>
            <div className="value-discipline-checks">
              {valueDisciplineLens.checks.map((check) => (
                <small key={check.label} className={check.ok ? 'pass' : 'block'} title={check.detail}>
                  {check.ok ? 'OK' : '待機'} {check.label}: {check.value}
                </small>
              ))}
            </div>
          </div>
        ) : null}

        {daytradeTopPick ? (
          <div className="simple-daytrade-board">
            <div className="simple-decision-card main">
              <span>{copy.decision}</span>
              <strong>{simpleTopPickAction}</strong>
              <small>{isFallbackTopPick ? copy.fallbackNotice : copy.liveNotice}</small>
            </div>
            <div className="simple-decision-card">
              <span>{copy.entry}</span>
              <strong>{yen(daytradeTopPick.entry)}{copy.below}</strong>
              <small>{copy.entryHelp}</small>
              <DataSourceBadge source={topPickSource} compact />
            </div>
            <div className="simple-decision-card">
              <span>{copy.target}</span>
              <strong>{yen(daytradeTopPick.target)}</strong>
              <small>{copy.targetHelp} {yen(daytradeTopPick.expectedProfit)}</small>
            </div>
            <div className="simple-decision-card danger">
              <span>{copy.stop}</span>
              <strong>{yen(daytradeTopPick.stop)}</strong>
              <small>{copy.stopHelp} {yen(daytradeTopPick.maxLoss)}</small>
            </div>
            <div className="simple-decision-card">
              <span>{copy.shares}</span>
              <strong>{daytradeTopPick.affordable ? `${daytradeTopPick.shares}株` : copy.quantityZero}</strong>
              <small>{copy.budgetUsed} {yen(daytradeTopPick.budgetUsed)}</small>
            </div>
          </div>
        ) : null}

        {daytradeTopPick ? (
          <div className="simple-reason-grid">
            <div>
              <span>{copy.whyCandidate}</span>
              <strong>{copy.expectedPnl} {yen(daytradeTopPick.probabilityAdjustedProfit)} / 損益比率 {daytradeTopPick.rr}</strong>
              {(daytradeTopPick.whyBuy?.length ? daytradeTopPick.whyBuy : [daytradeTopPick.candidateReason])
                .slice(0, 2)
                .map((item, index) => (
                  <small key={`simple-buy-${index}-${item}`}>{simpleOpportunityText(item)}</small>
                ))}
            </div>
            <div>
              <span>{copy.skipConditions}</span>
              {(blockerItems.length ? blockerItems : ['現時点で大きな阻害条件は見えていません。寄り付き後の再確認を優先してください。'])
                .slice(0, 3)
                .map((item, index) => (
                  <small key={`simple-stop-${index}-${item}`}>{simpleOpportunityText(item)}</small>
                ))}
            </div>
            <div>
              <span>{copy.memo}</span>
              <small>短期スコア {daytradeTopPick.score?.toFixed?.(1) ?? '-'} / 100, {copy.risk} {riskLevelLabel(daytradeTopPick.expertRiskLevel)}</small>
              <small>{copy.material}: {topPickMaterial}</small>
              <button className="inline-action" type="button" onClick={focusTopPick} data-testid="top-candidate-detail-button">
                <Target size={14} />
                {copy.detail}
              </button>
            </div>
          </div>
        ) : null}

        {openingScenarioPlan.length > 0 ? (
          <div className="opening-scenario-grid" data-testid="opening-scenario-plan">
            <span>{copy.openingPlan}</span>
            <div>
              {openingScenarioPlan.map((scenario) => (
                <article key={scenario.name}>
                  <b>{scenario.name}</b>
                  <strong>{scenario.action}</strong>
                  <small>{scenario.detail}</small>
                </article>
              ))}
            </div>
          </div>
        ) : null}

        {chatGptPrompt ? (
          <div className="chatgpt-consult-panel" data-testid="chatgpt-consult-panel">
            <div>
              <span>ChatGPT相談用メモ</span>
              <strong>銘柄分析サマリーを自動整形</strong>
              <small>投資助言ではなく、短期売買で確認すべき材料をChatGPTへ渡すためのコピーです。</small>
            </div>
            <button className="inline-action" type="button" onClick={onCopyChatGptPrompt} data-testid="chatgpt-copy-button">
              <ClipboardCopy size={14} />
              {chatGptPromptCopied ? 'コピー済み' : 'ChatGPT相談用にコピー'}
            </button>
            <details>
              <summary>コピー内容を確認</summary>
              <textarea data-testid="chatgpt-prompt-preview" readOnly value={chatGptPrompt} />
            </details>
          </div>
        ) : null}

        <div className="selected-simulation-summary">
          <div>
            <span>{copy.selectedDecision}</span>
            <strong>{tradeStrategyTitle}</strong>
            <small>{tradeStrategyReason}</small>
            <small>
              {copy.decisionSource}: {selectedDecisionSourceLabel}
              {selectedRankContext ? ` / ${selectedRankContext}` : ''}
            </small>
            {selectedSourceEvidence.length > 0 ? (
              <div className="source-evidence-strip" aria-label={copy.sourceEvidence}>
                {selectedSourceEvidence.map((item) => (
                  <small key={item}>{item}</small>
                ))}
              </div>
            ) : null}
            <small>{crossEngineCheck.detail}</small>
            {crossEngineGatePreview.length > 0 ? (
              <div className="cross-engine-gates" aria-label={copy.crossEngine}>
                {crossEngineGatePreview.map((gate) => (
                  <small key={gate.id} className={gate.ok ? 'pass' : 'block'} title={gate.detail}>
                    {gate.ok ? 'OK' : 'NG'} {crossEngineGateLabel(gate)}
                  </small>
                ))}
              </div>
            ) : null}
          </div>
          <div>
            <StatusPillComponent label={crossEngineCheck.label} tone={crossEngineTone(crossEngineCheck.status)} />
            <StatusPillComponent
              label={`${decisionScoreLabel} ${jobsCandidate?.score?.toFixed?.(1) ?? selectedAdvancedReport?.compositeScore ?? '-'} / 100`}
              tone={scoreTone(jobsCandidate?.score ?? selectedAdvancedReport?.compositeScore)}
            />
          </div>
        </div>
      </div>

      <div className="brief-score">
        <strong>{briefScore}</strong>
        <span>{copy.summaryPnl}</span>
        {daytradeTopPick ? <small>{copy.takeProfit} {yen(daytradeTopPick.expectedProfit)}</small> : null}
      </div>
    </CandidateSummary>
  );
}
