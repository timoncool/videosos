//! The daily limit on what agents spend: a job an agent starts through MCP is refused when its price,
//! added to what agents spent today, would pass the limit the person set.

use vs_providers::{price, ModelForm};

use crate::jobs::CreateRequest;

static SPENT: std::sync::OnceLock<std::sync::Arc<crate::jobs::Jobs>> = std::sync::OnceLock::new();

pub fn init(jobs: std::sync::Arc<crate::jobs::Jobs>) {
    let _ = SPENT.set(jobs);
}

/// Why the job may not start, if the limit stops it.
pub fn agent_limit_left(request: &CreateRequest, form: &ModelForm) -> Option<String> {
    if request.origin.as_deref() != Some("agent") {
        return None;
    }
    let budget = crate::settings::get().agent_daily_budget_usd?;
    let spent = SPENT.get().map(|jobs| jobs.agent_spent_today()).unwrap_or(0.0);
    let cost = price::estimate(form, &request.values).map(|estimate| estimate.usd * f64::from(request.repeat.max(1)));
    match cost {
        Some(cost) if spent + cost > budget => Some(t!("spend-agent-limit", spent = format!("{spent:.2}"), cost = format!("{cost:.2}"), budget = format!("{budget:.2}"))),
        None if spent >= budget => Some(t!("spend-agent-limit-reached", budget = format!("{budget:.2}"))),
        _ => None,
    }
}
