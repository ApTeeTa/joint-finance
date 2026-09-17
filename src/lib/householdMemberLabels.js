import { isLocalOnlyTestMode } from '../config/environmentConfig.js';
import { getActiveHousehold } from './householdContext.js';
import { fetchHouseholdMembers } from './householdRemote.js';

export const DEFAULT_PROFILE_LABELS = Object.freeze({
  husband: 'Муж',
  wife: 'Жена'
});

let cachedProfileLabels = { ...DEFAULT_PROFILE_LABELS };
let cachedMembers = [];

export function getProfileLabels() {
  return cachedProfileLabels;
}

export function getProfileLabel(profileKey) {
  return cachedProfileLabels[profileKey] ?? DEFAULT_PROFILE_LABELS[profileKey] ?? profileKey;
}

export function getHouseholdMembersCache() {
  return cachedMembers;
}

/** owner → husband slot, member → wife slot (internal profile keys unchanged). */
function mapMembersToLabels(members) {
  const labels = { ...DEFAULT_PROFILE_LABELS };
  for (const member of members) {
    const name = (member.display_name ?? '').trim();
    if (!name) continue;
    if (member.role === 'owner') {
      labels.husband = name;
    } else {
      labels.wife = name;
    }
  }
  return labels;
}

export async function refreshHouseholdProfileLabels() {
  if (isLocalOnlyTestMode()) {
    cachedProfileLabels = { ...DEFAULT_PROFILE_LABELS };
    cachedMembers = [];
    return cachedProfileLabels;
  }

  const household = getActiveHousehold();
  if (!household?.id) {
    cachedProfileLabels = { ...DEFAULT_PROFILE_LABELS };
    cachedMembers = [];
    return cachedProfileLabels;
  }

  const { data, error } = await fetchHouseholdMembers(household.id);
  if (error || !data?.length) {
    cachedProfileLabels = { ...DEFAULT_PROFILE_LABELS };
    cachedMembers = [];
    return cachedProfileLabels;
  }

  cachedMembers = data;
  cachedProfileLabels = mapMembersToLabels(data);
  return cachedProfileLabels;
}

/** Pick husband/wife profile key for the signed-in household member. */
export function resolveProfileKeyForMember(member) {
  if (!member) return null;
  return member.role === 'owner' ? 'husband' : 'wife';
}

export function findMemberByUserId(userId) {
  return cachedMembers.find((member) => member.user_id === userId) ?? null;
}

export function getCurrentMemberDisplayName(userId) {
  const member = findMemberByUserId(userId);
  if (member?.display_name?.trim()) {
    return member.display_name.trim();
  }
  const household = getActiveHousehold();
  if (household?.display_name?.trim()) {
    return household.display_name.trim();
  }
  return '';
}
