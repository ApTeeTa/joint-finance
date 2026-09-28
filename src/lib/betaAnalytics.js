/**
 * Beta product analytics — usage events only.
 *
 * View stats (Supabase SQL Editor):
 *   SELECT event_name, count(*) FROM beta_product_events GROUP BY 1 ORDER BY 2 DESC;
 *   SELECT date_trunc('day', created_at) d, event_name, count(*)
 *     FROM beta_product_events GROUP BY 1, 2 ORDER BY 1 DESC, 2;
 */

import { supabase } from './supabase.js';
import { isLocalOnlyTestMode } from '../config/environmentConfig.js';
import { getActiveHousehold } from './householdContext.js';
import { getCurrentUser } from './authSession.js';

export const BETA_ANALYTICS_EVENTS = Object.freeze({
  SIGNUP: 'signup',
  SIGNIN: 'signin',
  HOUSEHOLD_CREATED: 'household_created',
  HOUSEHOLD_JOINED: 'household_joined',
  PURCHASE_PLANNER_OPENED: 'purchase_planner_opened',
  PURCHASE_SIMULATION_COMPLETED: 'purchase_simulation_completed',
  PURCHASE_SIMULATION_CANCELLED: 'purchase_simulation_cancelled',
  PURCHASE_RESERVE_AFFECTED: 'purchase_reserve_affected',
  SAVINGS_GOAL_CREATED: 'savings_goal_created',
  REDISTRIBUTION_PERFORMED: 'redistribution_performed',
  FEEDBACK_SUBMITTED: 'feedback_submitted'
});

const ALLOWED_CONTEXT_KEYS = new Set([
  'auth_method',
  'simulation_outcome',
  'reserve_affected',
  'redistribution_kind',
  'feedback_category',
  'planner_source'
]);

/** Exported for privacy tests — strips any key outside the allowlist. */
export function sanitizeBetaEventContext(rawContext = {}) {
  if (!rawContext || typeof rawContext !== 'object' || Array.isArray(rawContext)) {
    return {};
  }

  const context = {};
  for (const [key, value] of Object.entries(rawContext)) {
    if (!ALLOWED_CONTEXT_KEYS.has(key)) {
      console.warn('[analytics] dropped disallowed context key', key);
      continue;
    }
    if (typeof value === 'boolean' || typeof value === 'string') {
      context[key] = value;
    }
  }
  return context;
}

function logLocalDebug(eventName, context) {
  const entry = {
    event_name: eventName,
    context,
    at: new Date().toISOString()
  };
  console.info('[analytics]', entry);
  try {
    const key = 'beta_analytics_debug';
    const prev = JSON.parse(localStorage.getItem(key) ?? '[]');
    prev.push(entry);
    localStorage.setItem(key, JSON.stringify(prev.slice(-200)));
  } catch {
    // ignore storage errors
  }
}

/**
 * Track a beta usage event. Never pass financial content in context.
 */
export async function trackBetaEvent(eventName, context = {}) {
  if (!Object.values(BETA_ANALYTICS_EVENTS).includes(eventName)) {
    console.warn('[analytics] unknown event', eventName);
    return { ok: false, skipped: true, reason: 'unknown_event' };
  }

  const safeContext = sanitizeBetaEventContext(context);

  if (isLocalOnlyTestMode()) {
    logLocalDebug(eventName, safeContext);
    return { ok: true, local: true };
  }

  const user = await getCurrentUser();
  if (!user?.id) {
    return { ok: false, skipped: true, reason: 'not_authenticated' };
  }

  const household = getActiveHousehold();
  const row = {
    event_name: eventName,
    household_id: household?.id ?? null,
    context: safeContext
  };

  const { error } = await supabase.from('beta_product_events').insert(row);

  if (error) {
    console.warn('[analytics] insert failed', eventName, error.message);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export function trackBetaEventFireAndForget(eventName, context = {}) {
  trackBetaEvent(eventName, context).catch((error) => {
    console.warn('[analytics] track failed', eventName, error?.message ?? error);
  });
}

/** Call from feedback form when implemented. */
export function trackFeedbackSubmitted(feedbackCategory) {
  const allowed = new Set(['bug', 'suggestion', 'question']);
  const category = allowed.has(feedbackCategory) ? feedbackCategory : 'question';
  trackBetaEventFireAndForget(BETA_ANALYTICS_EVENTS.FEEDBACK_SUBMITTED, {
    feedback_category: category
  });
}
