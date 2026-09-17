import { getEmptySharedSnapshot } from '../modules/storage.js';
import { buildHouseholdSnapshotId, loadPersistedHousehold, setActiveHousehold } from './householdContext.js';
import {
  fetchMemberHouseholdRows,
  insertHouseholdRow,
  insertHouseholdMemberRow,
  upsertHouseholdMemberRow,
  insertHouseholdSnapshotRow,
  fetchInviteByCode,
  fetchHouseholdById,
  insertHouseholdInviteRow
} from './householdRemote.js';

const INVITE_TTL_DAYS = 14;

function inviteExpiryIso() {
  const date = new Date();
  date.setDate(date.getDate() + INVITE_TTL_DAYS);
  return date.toISOString();
}

function normalizeHouseholdRow(row, role, displayName) {
  if (!row) return null;
  return {
    id: row.id,
    snapshot_id: row.snapshot_id,
    name: row.name,
    owner_user_id: row.owner_user_id,
    role,
    display_name: displayName ?? ''
  };
}

export async function fetchUserHouseholds(userId) {
  const { data, error } = await fetchMemberHouseholdRows(userId);

  if (error) {
    return { ok: false, error: error.message };
  }

  const households = (data ?? [])
    .map((row) => normalizeHouseholdRow(row.households, row.role, row.display_name))
    .filter(Boolean);

  return { ok: true, households };
}

export async function createHousehold(userId, { name, displayName, seedPayload = null }) {
  const householdId = crypto.randomUUID();
  const snapshotId = buildHouseholdSnapshotId(householdId);
  const householdName = (name ?? '').trim() || 'My household';
  const memberName = (displayName ?? '').trim() || 'Member';

  const { error: householdError } = await insertHouseholdRow({
    id: householdId,
    owner_user_id: userId,
    snapshot_id: snapshotId,
    name: householdName
  });

  if (householdError) {
    return { ok: false, error: householdError.message };
  }

  const { error: memberError } = await insertHouseholdMemberRow({
    household_id: householdId,
    user_id: userId,
    display_name: memberName,
    role: 'owner'
  });

  if (memberError) {
    return { ok: false, error: memberError.message };
  }

  const payload = seedPayload ?? getEmptySharedSnapshot();
  const { error: snapshotError } = await insertHouseholdSnapshotRow({
    id: snapshotId,
    payload,
    updated_at: new Date().toISOString()
  });

  if (snapshotError) {
    return { ok: false, error: snapshotError.message };
  }

  const household = {
    id: householdId,
    snapshot_id: snapshotId,
    name: householdName,
    owner_user_id: userId,
    role: 'owner',
    display_name: memberName
  };

  setActiveHousehold(household);
  return { ok: true, household };
}

export async function joinHouseholdByInviteCode(userId, code, displayName) {
  const normalizedCode = (code ?? '').trim().toUpperCase();
  if (!normalizedCode) {
    return { ok: false, error: 'Enter invite code' };
  }

  const { data: invite, error: inviteError } = await fetchInviteByCode(normalizedCode);

  if (inviteError) {
    return { ok: false, error: inviteError.message };
  }
  if (!invite) {
    return { ok: false, error: 'Invite code not found' };
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'Invite code expired' };
  }

  const memberName = (displayName ?? '').trim() || 'Member';

  const { error: memberError } = await upsertHouseholdMemberRow({
    household_id: invite.household_id,
    user_id: userId,
    display_name: memberName,
    role: 'member'
  });

  if (memberError) {
    return { ok: false, error: memberError.message };
  }

  const { data: household, error: householdError } = await fetchHouseholdById(invite.household_id);

  if (householdError) {
    return { ok: false, error: householdError.message };
  }

  const context = normalizeHouseholdRow(household, 'member', memberName);
  setActiveHousehold(context);
  return { ok: true, household: context, inviterUserId: invite.inviter_user_id };
}

export async function createInviteCode(householdId, inviterUserId) {
  const code = generateClientInviteCode();
  const { data, error } = await insertHouseholdInviteRow({
    household_id: householdId,
    code,
    inviter_user_id: inviterUserId,
    expires_at: inviteExpiryIso()
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, code: data.code, expiresAt: data.expires_at };
}

export async function resolveActiveHouseholdForUser(userId) {
  const result = await fetchUserHouseholds(userId);
  if (!result.ok) {
    return result;
  }

  const persisted = loadPersistedHousehold();
  if (persisted) {
    const match = result.households.find((h) => h.id === persisted.id);
    if (match) {
      setActiveHousehold(match);
      return { ok: true, household: match };
    }
  }

  if (result.households.length >= 1) {
    setActiveHousehold(result.households[0]);
    return {
      ok: true,
      household: result.households[0],
      multiple: result.households.length > 1
    };
  }

  return { ok: true, household: null };
}

function generateClientInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
