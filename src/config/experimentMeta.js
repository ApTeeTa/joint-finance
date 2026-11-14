const EXPERIMENT_META_KEY = 'joint-finance-experiment-meta';

export function getExperimentMeta() {
  try {
    const raw = localStorage.getItem(EXPERIMENT_META_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function setExperimentMeta(patch) {
  try {
    const next = { ...getExperimentMeta(), ...patch };
    localStorage.setItem(EXPERIMENT_META_KEY, JSON.stringify(next));
    return next;
  } catch {
    return getExperimentMeta();
  }
}

export function markExperimentUserClearedData() {
  setExperimentMeta({ skipAutoSeed: true });
}

export function clearExperimentSkipAutoSeed() {
  const meta = getExperimentMeta();
  delete meta.skipAutoSeed;
  localStorage.setItem(EXPERIMENT_META_KEY, JSON.stringify(meta));
}