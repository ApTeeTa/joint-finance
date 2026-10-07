/**
 * Household / invite Supabase access — allowlisted alongside stateRemote.js.
 */
import { supabase } from './supabase.js';

export async function fetchMemberHouseholdRows(userId) {
  const { data: members, error: membersError } = await supabase
    .from('household_members')
    .select('household_id, role, display_name')
    .eq('user_id', userId);

  if (membersError) {
    return { data: null, error: membersError };
  }

  if (!members?.length) {
    return { data: [], error: null };
  }

  const householdIds = [...new Set(members.map((row) => row.household_id).filter(Boolean))];
  const { data: households, error: householdsError } = await supabase
    .from('households')
    .select('id, snapshot_id, name, owner_user_id')
    .in('id', householdIds);

  if (householdsError) {
    return { data: null, error: householdsError };
  }

  const householdById = new Map((households ?? []).map((household) => [household.id, household]));

  const rows = members
    .map((member) => {
      const household = householdById.get(member.household_id) ?? null;
      if (!household) {
        console.warn('[HOUSEHOLD] Member row without readable household', member.household_id);
        return null;
      }
      return {
        role: member.role,
        display_name: member.display_name,
        households: household
      };
    })
    .filter(Boolean);

  return { data: rows, error: null };
}

export async function insertHouseholdRow(row) {
  return supabase.from('households').insert(row);
}

export async function insertHouseholdMemberRow(row) {
  return supabase.from('household_members').insert(row);
}

export async function upsertHouseholdMemberRow(row) {
  return supabase.from('household_members').upsert(row, { onConflict: 'household_id,user_id' });
}

export async function updateHouseholdMemberRow(householdId, userId, patch) {
  return supabase
    .from('household_members')
    .update(patch)
    .eq('household_id', householdId)
    .eq('user_id', userId);
}

export async function insertHouseholdSnapshotRow(row) {
  return supabase.from('household_snapshots').insert(row);
}

export async function fetchInviteByCode(code) {
  return supabase
    .from('household_invites')
    .select('id, household_id, expires_at, inviter_user_id')
    .eq('code', code)
    .maybeSingle();
}

export async function fetchHouseholdById(householdId) {
  return supabase
    .from('households')
    .select('id, snapshot_id, name, owner_user_id')
    .eq('id', householdId)
    .single();
}

export async function insertHouseholdInviteRow(row) {
  return supabase.from('household_invites').insert(row).select('code, expires_at').single();
}

export async function fetchActiveInviteForHousehold(householdId) {
  return supabase
    .from('household_invites')
    .select('code, expires_at')
    .eq('household_id', householdId)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function fetchHouseholdMemberCount(householdId) {
  return supabase
    .from('household_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('household_id', householdId);
}

export async function fetchHouseholdMembers(householdId) {
  return supabase
    .from('household_members')
    .select('user_id, display_name, role, joined_at')
    .eq('household_id', householdId)
    .order('joined_at', { ascending: true });
}
