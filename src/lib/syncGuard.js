import { hasSharedStateData } from './stateAuthority.js';

/**
 * Decide whether remote snapshot may replace in-memory/local state.
 * @param {object} localState
 * @param {{ hasData?: boolean, rowExists?: boolean }} remoteMeta
 */
export function shouldApplyRemoteSnapshot(localState, remoteMeta = {}) {
  const remoteHasData = remoteMeta.hasData === true;
  const localHasData = hasSharedStateData(localState);

  if (remoteHasData) {
    return { apply: true, reason: 'remote_has_data' };
  }

  if (localHasData) {
    return { apply: false, reason: 'remote_empty_local_has_data' };
  }

  return { apply: true, reason: 'both_empty' };
}

/**
 * Block pushing an empty snapshot over a previously non-empty remote.
 * @param {object} localState
 * @param {object|null} lastRemoteSnapshot
 */
export function shouldAllowRemotePush(localState, lastRemoteSnapshot) {
  const localHasData = hasSharedStateData(localState);
  const remoteHasData = hasSharedStateData(lastRemoteSnapshot);

  if (!localHasData && remoteHasData) {
    return { allow: false, reason: 'push_blocked_empty_over_nonempty' };
  }

  return { allow: true, reason: 'push_allowed' };
}

export function getSyncStatusMessage(reason) {
  const messages = {
    remote_has_data: null,
    both_empty: null,
    remote_empty_local_has_data:
      'Облачный snapshot пуст, локальный кэш сохранён. Изменения будут отправлены при сохранении.',
    fetch_failed: 'Не удалось загрузить данные из облака. Показан локальный кэш.',
    snapshot_row_missing: 'Snapshot семьи не найден в базе. Попробуйте обновить страницу.',
    no_active_household: 'Не выбрана активная семья для синхронизации.',
    offline: 'Нет сети — используется локальный кэш.',
    push_blocked_empty_over_nonempty:
      'Сохранение в облако заблокировано: попытка записать пустое состояние поверх данных.'
  };
  return messages[reason] ?? 'Ошибка синхронизации.';
}
