//! Keep-warm policy helpers.
//!
//! Ollama lets callers control how long a loaded model stays resident via the
//! `keep_alive` field on `/api/generate`. Passing `-1` keeps the model warm
//! indefinitely; passing `0` evicts it immediately. We model this with a
//! small enum and a function that decides which models to warm or evict.

/// Sentinel used by Ollama to keep a model warm forever.
pub(crate) const KEEP_ALIVE_FOREVER: i64 = -1;
/// Sentinel used by Ollama to evict a model immediately.
pub(crate) const KEEP_ALIVE_EVICT: i64 = 0;

/// One action to apply to a single model.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WarmAction {
    pub model: String,
    pub keep_alive: i64,
}

/// Compute the set of warm/evict actions for a given active model and warm
/// list. The active model (if any) gets `keep_alive = -1`. Every model in
/// `warm` that isn't the active one also gets `keep_alive = -1`. No eviction
/// is issued by this function — it is purely a "set of models we want loaded"
/// computation. Eviction policy is handled at a higher layer when callers
/// switch agents.
pub(crate) fn plan_warm_actions(active: Option<&str>, warm: &[String]) -> Vec<WarmAction> {
    let mut actions: Vec<WarmAction> = Vec::with_capacity(warm.len() + 1);
    let mut seen: Vec<&str> = Vec::new();

    if let Some(active_model) = active.filter(|s| !s.is_empty()) {
        actions.push(WarmAction {
            model: active_model.to_string(),
            keep_alive: KEEP_ALIVE_FOREVER,
        });
        seen.push(active_model);
    }

    for model in warm.iter().filter(|m| !m.is_empty()) {
        if seen.contains(&model.as_str()) {
            continue;
        }
        seen.push(model.as_str());
        actions.push(WarmAction {
            model: model.clone(),
            keep_alive: KEEP_ALIVE_FOREVER,
        });
    }

    actions
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_with_active_only() {
        let actions = plan_warm_actions(Some("llama3.2:latest"), &[]);
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].model, "llama3.2:latest");
        assert_eq!(actions[0].keep_alive, KEEP_ALIVE_FOREVER);
    }

    #[test]
    fn plan_with_warm_only() {
        let warm = vec!["a".to_string(), "b".to_string()];
        let actions = plan_warm_actions(None, &warm);
        assert_eq!(actions.len(), 2);
        assert!(actions.iter().all(|a| a.keep_alive == KEEP_ALIVE_FOREVER));
    }

    #[test]
    fn plan_dedupes_active_in_warm_list() {
        let warm = vec!["a".to_string(), "b".to_string()];
        let actions = plan_warm_actions(Some("a"), &warm);
        let names: Vec<&str> = actions.iter().map(|a| a.model.as_str()).collect();
        assert_eq!(names, vec!["a", "b"]);
    }

    #[test]
    fn plan_skips_empty_strings() {
        let warm = vec!["".to_string(), "a".to_string()];
        let actions = plan_warm_actions(Some(""), &warm);
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].model, "a");
    }

    #[test]
    fn plan_with_no_inputs_is_empty() {
        let actions = plan_warm_actions(None, &[]);
        assert!(actions.is_empty());
    }
}
