/** Fixed profile labels for two-person family mode (no household members table). */

export const DEFAULT_PROFILE_LABELS = Object.freeze({
  husband: 'Муж',
  wife: 'Жена'
});

export function getProfileLabels() {
  return { ...DEFAULT_PROFILE_LABELS };
}

export function getProfileLabel(profileKey) {
  return DEFAULT_PROFILE_LABELS[profileKey] ?? profileKey;
}

export async function refreshHouseholdProfileLabels() {
  return getProfileLabels();
}

export function resolveProfileKeyForMember() {
  return null;
}

export function findMemberByUserId() {
  return null;
}

export function getHouseholdMembersCache() {
  return [];
}

export function getCurrentMemberDisplayName() {
  return '';
}
