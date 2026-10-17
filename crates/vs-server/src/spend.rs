//! The daily limit on what agents spend: a job an agent starts through MCP is refused when its price,
//! added to what agents spent today, would pass the limit the person set.

use vs_providers::{price, ModelForm};

use crate::jobs::CreateRequest;

static SPENT: std::sync::OnceLock<std::sync::Arc<crate::jobs::Jobs>> = std::sync::OnceLock::new();

pub fn init(jobs: std::sync::Arc<crate::jobs::Jobs>) {
    let _ = SPENT.set(jobs);
}

/// Held from the limit check until the job is recorded, so agents calling at once cannot all pass on the same
/// spending.
pub static CHECK_AND_RECORD: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Why the job may not start, if the limit stops it.
pub fn agent_limit_left(request: &CreateRequest, form: &ModelForm) -> Option<String> {
    if request.origin.as_deref() != Some("agent") {
        return None;
    }
    let budget = crate::settings::get().agent_daily_budget_usd?;
    let spent = SPENT.get().map(|jobs| jobs.agent_spent_today()).unwrap_or(0.0);
    let values = crate::jobs::with_defaults(form, request.values.clone());
    let cost = price::estimate(form, &values).map(|estimate| estimate.usd * f64::from(request.repeat.max(1)));
    match cost {
        Some(cost) if spent + cost > budget => Some(t!("spend-agent-limit", spent = format!("{spent:.2}"), cost = format!("{cost:.2}"), budget = format!("{budget:.2}"))),
        Some(_) => None,
        // a run priced only afterwards cannot be held to the limit, so an agent may not start it while one is set
        None => Some(t!("spend-agent-limit-unknown-price", budget = format!("{budget:.2}"))),
    }
}

/// Why the chat may not take another paid step, if the limit stops it: what agents spent today with what this
/// conversation has cost so far, which is recorded only when it ends.
pub fn chat_limit_left(so_far: f64) -> Option<String> {
    let budget = crate::settings::get().agent_daily_budget_usd?;
    let spent = SPENT.get().map(|jobs| jobs.agent_spent_today()).unwrap_or(0.0) + so_far;
    (spent >= budget).then(|| t!("spend-agent-limit-chat", spent = format!("{spent:.2}"), budget = format!("{budget:.2}")))
}
