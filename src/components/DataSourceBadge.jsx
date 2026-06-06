import { dataSourceBadgeInfo } from '../utils/dataSource';

export function DataSourceBadge({ source, compact = false }) {
  const info = dataSourceBadgeInfo(source);
  return (
    <span className={`data-source-badge ${info.tone}`} title={info.warning || `データ出所: ${info.label}`} data-testid="data-source-badge">
      {compact ? info.label.replace('データ', '') : `データ出所: ${info.label}`}
    </span>
  );
}

export function DataSourceWarning({ source }) {
  const info = dataSourceBadgeInfo(source);
  if (!info.warning) return null;
  return (
    <p className={`data-source-warning ${info.tone}`} data-testid={`data-source-warning-${info.key}`}>
      {info.warning}
    </p>
  );
}
