//! skills.sh directory search.

use crate::model::SearchResult;
use anyhow::{Context, Result};
use serde::Deserialize;

#[derive(Deserialize)]
struct Resp {
    skills: Vec<Item>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Item {
    id: String,
    #[serde(default)]
    skill_id: Option<String>,
    name: String,
    #[serde(default)]
    source: String,
    #[serde(default)]
    installs: u64,
}

pub fn search(query: &str, installed: &[String]) -> Result<Vec<SearchResult>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let base = std::env::var("SKILLS_API_URL").unwrap_or_else(|_| "https://skills.sh".into());
    let resp: Resp = ureq::get(&format!("{base}/api/search"))
        .query("q", q)
        .query("limit", "40")
        .timeout(std::time::Duration::from_secs(15))
        .call()
        .context("skills.sh search failed")?
        .into_json()
        .context("unexpected response from skills.sh")?;
    let mut out: Vec<SearchResult> = resp
        .skills
        .into_iter()
        .map(|i| {
            let key = crate::skill::sanitize_name(i.skill_id.as_deref().unwrap_or(&i.name));
            SearchResult {
                installed: installed.contains(&key),
                id: i.id,
                name: i.name,
                source: i.source,
                installs: i.installs,
            }
        })
        .collect();
    out.sort_by_key(|r| std::cmp::Reverse(r.installs));
    Ok(out)
}
