
/**
 * Translate API field names to Japanese for UI display
 */
export const translateMissingField = (field: string): string => {
    const dict: Record<string, string> = {
        'fundamentals': '財務データ',
        'events': 'イベント情報',
        'sector': 'セクター分類',
        'playbook': 'プレイブック',
        'correlation': '相関データ',
        'technical': 'テクニカル指標',
        'forecasts': '予測データ',
        'nikkei': '日経平均',
        'topix': 'TOPIX',
        'usdjpy': 'ドル円',
        'us10y': '米10年金利',
        'vix': 'VIX恐怖指数',
        'risk_sentiment': '投資家心理',
        'entries': '日誌データ',
        'diary_entries': '集計データ'
    };
    return dict[field] || field;
};
