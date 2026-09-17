/**
 * Household / invite Supabase access — allowlisted alongside stateRemote.js.
 */
import { supabase } from './supabase.js';

export async function fetchMemberHouseholdRows(userId) {
  return supabase
    .from('household_members')
    .select(`
      role,
      display_name,
      households (
        id,
        snapshot_id,
        name,
        owner_user_id
      )
    `)
    .eq('user_id', userId);
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
