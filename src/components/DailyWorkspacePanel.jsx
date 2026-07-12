import React, { useMemo, useState } from 'react';
import { CACHE_KEY, clearCache, getCacheMetadata } from '../api/apiClient';
import {
  buildPersonalWorkspaceBackup,
  filterAndSortWatchlist,
  loadPersonalWorkspace,
  mergeWorkspaceWatchlist,
  parseManualDataText,
  savePersonalWorkspace,
} from '../utils/personalWorkspace';

export default function DailyWorkspacePanel({ stocks = [], settingsSummary, onWorkspaceChange, onRetry }) {
  const [workspace, setWorkspace] = useState(() => loadPersonalWorkspace());
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState('score-desc');
  const [manualType, setManualType] = useState('earnings');
  const [manualText, setManualText] = useState('[]');
  const [message, setMessage] = useState('');
  const [cacheMetadata, setCacheMetadata] = useState(() => getCacheMetadata());

  const mergedItems = useMemo(() => mergeWorkspaceWatchlist(workspace.watchlistItems, stocks), [stocks, workspace.watchlistItems]);
  const tags = useMemo(() => [...new Set(mergedItems.flatMap((item) => item.tags || []))].sort(), [mergedItems]);
  const visibleItems = useMemo(() => filterAndSortWatchlist(mergedItems, { query, tag, sort }).slice(0, 8), [mergedItems, query, sort, tag]);

  const persist = (next) => {
    setWorkspace(next);
    savePersonalWorkspace(next);
    onWorkspaceChange?.(next);
  };

  const toggleToday = (ticker) => {
    const selected = workspace.todayTickers.includes(ticker);
    persist({ ...workspace, watchlistItems: mergedItems, todayTickers: selected ? workspace.todayTickers.filter((item) => item !== ticker) : [...workspace.todayTickers, ticker] });
  };

  const updateTags = (ticker, value) => {
    persist({
      ...workspace,
      watchlistItems: mergedItems.map((item) => item.ticker === ticker ? { ...item, tags: value.split(',').map((entry) => entry.trim()).filter(Boolean) } : item),
    });
  };

  const saveManualData = () => {
    const parsed = parseManualDataText(manualText);
    setMessage(parsed.message);
    if (!parsed.ok) return;
    persist({ ...workspace, watchlistItems: mergedItems, manualData: { ...workspace.manualData, [manualType]: parsed.items } });
  };

  const removeCache = () => {
    clearCache();
    setCacheMetadata(getCacheMetadata());
    setMessage('市場データの一時キャッシュを削除しました。個人設定とレビューは保持しています。');
  };

  const exportWorkspace = () => {
    const backup = buildPersonalWorkspaceBackup(workspace);
    const url = URL.createObjectURL(new Blob([backup.text], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = backup.filename;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage('個人設定と手動データをJSONで保存しました。外部送信はありません。');
  };

  return (
    <section className="daily-workspace-panel" data-testid="daily-workspace-panel">
      <div className="daily-workspace-head">
        <div><span>日常利用</span><strong>今日確認する銘柄とデータ状態</strong></div>
        <small>端末内に保存。外部送信なし。</small>
      </div>
      <div className="daily-status-strip">
        {(settingsSummary?.apiItems || []).map((item) => <div key={item.name}><span>{item.name}</span><strong>{item.status}</strong></div>)}
        <div><span>最終更新</span><strong>{cacheMetadata.updatedAt || '未取得'}</strong></div>
      </div>
      <div className="daily-recovery-actions">
        <button type="button" className="secondary-button" onClick={onRetry}>APIデータを再取得</button>
        <button type="button" className="secondary-button" onClick={exportWorkspace}>設定と手動データを保存</button>
      </div>
      <div className="daily-controls">
        <input aria-label="ウォッチリスト検索" placeholder="銘柄コード・名称" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="タグ絞り込み" value={tag} onChange={(event) => setTag(event.target.value)}><option value="">すべてのタグ</option>{tags.map((item) => <option key={item}>{item}</option>)}</select>
        <select aria-label="並び順" value={sort} onChange={(event) => setSort(event.target.value)}><option value="score-desc">確認スコア順</option><option value="ticker">コード順</option><option value="name">名称順</option></select>
      </div>
      <div className="daily-watchlist">
        {visibleItems.map((item) => (
          <div key={item.ticker}>
            <label><input type="checkbox" checked={workspace.todayTickers.includes(item.ticker)} onChange={() => toggleToday(item.ticker)} /><span>今日</span></label>
            <strong>{item.ticker} {item.name || item.companyName || ''}</strong>
            <input aria-label={`${item.ticker} タグ`} defaultValue={(item.tags || []).join(', ')} placeholder="タグをカンマ区切り" onBlur={(event) => updateTags(item.ticker, event.target.value)} />
          </div>
        ))}
      </div>
      <details className="daily-data-tools">
        <summary>手動データとキャッシュを管理</summary>
        <div className="daily-tool-grid">
          <div>
            <strong>手動データ</strong>
            <select value={manualType} onChange={(event) => setManualType(event.target.value)}><option value="earnings">決算予定</option><option value="tdnet">TDnet相当</option></select>
            <textarea value={manualText} onChange={(event) => setManualText(event.target.value)} aria-label="手動データJSON" />
            <button type="button" className="secondary-button" onClick={saveManualData}>端末内へ保存</button>
          </div>
          <div>
            <strong>キャッシュ</strong>
            <span>{cacheMetadata.exists ? `${CACHE_KEY} / ${cacheMetadata.ageLabel}` : '一時キャッシュなし'}</span>
            <button type="button" className="secondary-button" onClick={removeCache}>一時キャッシュを削除</button>
          </div>
        </div>
      </details>
      {message ? <p>{message}</p> : null}
    </section>
  );
}
