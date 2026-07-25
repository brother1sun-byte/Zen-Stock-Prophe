export function isVerifiedCandidateForDisplay({
  opportunity,
  decisionGate,
  crossEngineCheck,
  isFallbackCandidate = false,
}) {
  if (!opportunity?.ticker || isFallbackCandidate) return false;

  const auditVerdict = String(opportunity.decisionAudit?.verdict || '').toUpperCase();
  const opportunityCrossCheck = opportunity.advancedCrossEngineCheck;
  const hasActionableSize = Number(opportunity.shares || 0) > 0
    && opportunity.positionSizingVerdict !== 'skip';
  const opportunityCrossAligned = !opportunityCrossCheck
    || String(opportunityCrossCheck.status || '').toLowerCase() === 'aligned';
  const displayCrossAligned = !crossEngineCheck
    || String(crossEngineCheck.status || '').toLowerCase() === 'aligned';

  return opportunity.tradeReadiness === 'ready'
    && auditVerdict === 'PASS'
    && hasActionableSize
    && opportunityCrossAligned
    && displayCrossAligned
    && decisionGate?.ready === true;
}

export function buildCandidateEvidencePresentation(input) {
  const verified = isVerifiedCandidateForDisplay(input);

  return {
    verified,
    title: verified ? '検証済みの手動判断候補' : '調査対象（未検証）',
    decisionLabel: verified ? '手動判断候補' : '調査のみ',
    scoreLabel: verified ? '検証済み短期スコア' : '短期動向（未検証）',
    pnlLabel: verified ? '検証条件下の参考損益' : '損益計算は検証前のため非表示',
  };
}
