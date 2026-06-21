import { useCallback, useMemo, useState } from 'react';
import { dataSourceBadgeInfo } from '../utils/dataSource';

export const PRACTICE_ORDER_STATUS = {
  DRAFT: 'DRAFT',
  PENDING: 'PENDING',
  FILLED: 'FILLED',
  CANCELLED: 'CANCELLED',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
  REFERENCE_ONLY: 'REFERENCE_ONLY',
};

const STATUS_LABELS = {
  [PRACTICE_ORDER_STATUS.DRAFT]: '入力中',
  [PRACTICE_ORDER_STATUS.PENDING]: '未約定',
  [PRACTICE_ORDER_STATUS.FILLED]: '約定済み',
  [PRACTICE_ORDER_STATUS.CANCELLED]: '取消済み',
  [PRACTICE_ORDER_STATUS.INSUFFICIENT_DATA]: 'データ不足',
  [PRACTICE_ORDER_STATUS.REFERENCE_ONLY]: '参考表示',
};

const SIDE_LABELS = {
  BUY: '買い練習',
  SELL: '売り練習',
};

function toPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function cleanTicker(value) {
  return String(value || '').trim().toUpperCase();
}

function sourceWarnings(source) {
  const info = dataSourceBadgeInfo(source);
  const warnings = [];
  if (info.warning) warnings.push(info.warning);
  if (info.key === 'synthetic') {
    warnings.push('補完データのため、練習用の参考値としてのみ扱ってください。');
  }
  if (info.key === 'cache') {
    warnings.push('一時保存データのため、最新価格と異なる可能性があります。');
  }
  if (info.key === 'jquants_delayed') {
    warnings.push('J-Quants遅延データのため、リアルタイム価格ではありません。');
  }
  if (info.key === 'unknown') {
    warnings.push('データ出所を確認できないため、参考値として扱ってください。');
  }
  warnings.push('これは練習注文です。証券会社への実注文は行いません。');
  return { info, warnings: [...new Set(warnings)] };
}

export function practiceOrderStatusLabel(status) {
  return STATUS_LABELS[status] || STATUS_LABELS[PRACTICE_ORDER_STATUS.DRAFT];
}

export function practiceOrderSideLabel(side) {
  return SIDE_LABELS[side] || SIDE_LABELS.BUY;
}

export function validatePracticeOrder(form, { source, referencePrice } = {}) {
  const ticker = cleanTicker(form?.ticker);
  const entryPrice = toPositiveNumber(form?.entryPrice);
  const shares = toPositiveNumber(form?.shares);
  const refPrice = toPositiveNumber(referencePrice ?? form?.referencePrice);
  const { info, warnings } = sourceWarnings(source);
  const errors = [];

  if (!ticker) errors.push('銘柄コードを入力してください。');
  if (!String(form?.name || '').trim()) warnings.unshift('銘柄名を取得できません。銘柄コードを名称代わりに記録します。');
  if (!shares) errors.push('株数は1以上で入力してください。');
  if (!entryPrice) errors.push('指値または買値は1円以上で入力してください。');
  if (!refPrice) warnings.unshift('参考価格を取得できません。手入力価格を練習用の参考値として扱います。');

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    sourceInfo: info,
    status: errors.length ? PRACTICE_ORDER_STATUS.INSUFFICIENT_DATA : PRACTICE_ORDER_STATUS.DRAFT,
  };
}

function createPracticeOrder(form, { source, referencePrice, status = PRACTICE_ORDER_STATUS.PENDING } = {}) {
  const entryPrice = toPositiveNumber(form.entryPrice);
  const shares = toPositiveNumber(form.shares);
  const ticker = cleanTicker(form.ticker);
  const validation = validatePracticeOrder(form, { source, referencePrice });
  const sourceInfo = validation.sourceInfo;
  const createdAt = new Date().toISOString();
  return {
    id: `practice-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    ticker,
    name: String(form.name || ticker).trim(),
    side: form.side || 'BUY',
    action: form.side === 'SELL' ? 'PRACTICE_SELL' : 'PRACTICE_BUY',
    price: entryPrice,
    entryPrice,
    referencePrice: toPositiveNumber(referencePrice ?? form.referencePrice),
    shares,
    total: entryPrice * shares,
    note: String(form.note || '').trim(),
    practiceStatus: status,
    status,
    statusLabel: practiceOrderStatusLabel(status),
    sideLabel: practiceOrderSideLabel(form.side),
    isPracticeOrder: true,
    sourceKey: sourceInfo.key,
    sourceLabel: sourceInfo.label,
    sourceWarning: sourceInfo.warning,
    validationWarnings: validation.warnings,
    createdAt,
  };
}

export function usePracticeOrder({ initialForm }) {
  const [positionForm, setPositionForm] = useState({
    ticker: '',
    name: '',
    entryPrice: '',
    referencePrice: '',
    shares: '100',
    side: 'BUY',
    note: '',
    ...initialForm,
  });
  const [practiceOrders, setPracticeOrders] = useState([]);

  const updatePositionForm = useCallback((field, value) => {
    setPositionForm((current) => ({ ...current, [field]: value }));
  }, []);

  const applyPracticeCandidate = useCallback((candidate = {}) => {
    setPositionForm((current) => {
      const entryPrice = Number(candidate.entryPrice ?? candidate.entry ?? candidate.price ?? current.entryPrice);
      return {
        ...current,
        ticker: candidate.ticker || current.ticker,
        name: candidate.name || current.name || candidate.ticker || '',
        entryPrice: Number.isFinite(entryPrice) && entryPrice > 0 ? String(Math.round(entryPrice)) : current.entryPrice,
        referencePrice: candidate.referencePrice ? String(candidate.referencePrice) : current.referencePrice,
        shares: candidate.shares ? String(candidate.shares) : current.shares,
        note: candidate.note || current.note,
      };
    });
  }, []);

  const getPracticeOrderValidation = useCallback((options = {}) => (
    validatePracticeOrder(positionForm, options)
  ), [positionForm]);

  const addPracticeOrder = useCallback((status, options = {}) => {
    const order = createPracticeOrder(positionForm, { ...options, status });
    setPracticeOrders((current) => [order, ...current].slice(0, 50));
    return order;
  }, [positionForm]);

  const setPracticeOrderStatus = useCallback((id, status) => {
    const changedAt = new Date().toISOString();
    setPracticeOrders((current) => current.map((order) => (
      order.id === id
        ? {
          ...order,
          practiceStatus: status,
          status,
          statusLabel: practiceOrderStatusLabel(status),
          updatedAt: changedAt,
          filledAt: status === PRACTICE_ORDER_STATUS.FILLED ? changedAt : order.filledAt,
          cancelledAt: status === PRACTICE_ORDER_STATUS.CANCELLED ? changedAt : order.cancelledAt,
        }
        : order
    )));
  }, []);

  const markPracticeOrderFilled = useCallback((id) => {
    setPracticeOrderStatus(id, PRACTICE_ORDER_STATUS.FILLED);
  }, [setPracticeOrderStatus]);

  const cancelPracticeOrder = useCallback((id) => {
    setPracticeOrderStatus(id, PRACTICE_ORDER_STATUS.CANCELLED);
  }, [setPracticeOrderStatus]);

  const cancelCurrentPracticeOrder = useCallback((options = {}) => {
    return addPracticeOrder(PRACTICE_ORDER_STATUS.CANCELLED, options);
  }, [addPracticeOrder]);

  const submitPracticeOrder = useCallback(async ({
    source,
    referencePrice,
    persistPortfolio,
    onBeforePersist,
    onSaved,
    onError,
  } = {}) => {
    const validation = validatePracticeOrder(positionForm, { source, referencePrice });
    if (!validation.ok) return { ok: false, validation };

    const order = createPracticeOrder(positionForm, {
      source,
      referencePrice,
      status: PRACTICE_ORDER_STATUS.PENDING,
    });
    setPracticeOrders((current) => [order, ...current].slice(0, 50));

    const payload = {
      ticker: order.ticker,
      name: order.name || undefined,
      entryPrice: order.entryPrice,
      shares: order.shares,
      note: order.note || undefined,
    };

    try {
      onBeforePersist?.(payload, order);
      const response = persistPortfolio ? await persistPortfolio(payload, order) : null;
      const filledOrder = {
        ...order,
        practiceStatus: PRACTICE_ORDER_STATUS.FILLED,
        status: PRACTICE_ORDER_STATUS.FILLED,
        statusLabel: practiceOrderStatusLabel(PRACTICE_ORDER_STATUS.FILLED),
        filledAt: new Date().toISOString(),
      };
      setPracticeOrders((current) => current.map((item) => (item.id === order.id ? filledOrder : item)));
      await onSaved?.(response, filledOrder);
      return { ok: true, order: filledOrder, response, validation };
    } catch (error) {
      const failedAt = new Date().toISOString();
      const failedOrder = {
        ...order,
        practiceStatus: PRACTICE_ORDER_STATUS.REFERENCE_ONLY,
        status: PRACTICE_ORDER_STATUS.REFERENCE_ONLY,
        statusLabel: practiceOrderStatusLabel(PRACTICE_ORDER_STATUS.REFERENCE_ONLY),
        saveError: error?.message || '練習台帳への保存に失敗しました。',
        updatedAt: failedAt,
      };
      setPracticeOrders((current) => current.map((item) => (item.id === order.id ? failedOrder : item)));
      onError?.(error, order);
      return { ok: false, error, order: failedOrder, validation };
    }
  }, [positionForm]);

  const latestValidation = useMemo(() => validatePracticeOrder(positionForm), [positionForm]);

  return {
    positionForm,
    setPositionForm,
    updatePositionForm,
    applyPracticeCandidate,
    practiceOrders,
    getPracticeOrderValidation,
    latestValidation,
    addPracticeOrder,
    submitPracticeOrder,
    markPracticeOrderFilled,
    cancelPracticeOrder,
    cancelCurrentPracticeOrder,
  };
}
