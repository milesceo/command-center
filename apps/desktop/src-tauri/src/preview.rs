//! Serves untrusted preview documents from their own `preview:` URL scheme.
//!
//! Why a custom scheme instead of an iframe `srcdoc`: a `srcdoc` document inherits
//! the app's Content-Security-Policy, which (rightly) forbids inline scripts, so
//! previews could not run. A separate scheme is a separate origin, gets its own
//! CSP from the response header below, and, together with the iframe's
//! `sandbox="allow-scripts"` (no `allow-same-origin`), cannot reach the app, its
//! storage, the Tauri IPC or the bridge. The page may load https resources but
//! `connect-src 'none'` stops it from making network requests of its own.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Manager, Runtime, State, UriSchemeContext};

/// Keep in sync with PREVIEW_CSP in src/lib/preview-doc.ts (a test enforces it).
const PREVIEW_CSP: &str = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; media-src data: blob: https:; connect-src 'none'; form-action 'none'; base-uri 'none'";

/// Documents kept at once; older ones are evicted so memory stays bounded.
const MAX_DOCS: usize = 32;
const MAX_ID_LEN: usize = 96;
/// A preview larger than this is refused rather than held in memory.
const MAX_DOC_BYTES: usize = 8 * 1024 * 1024;

#[derive(Default)]
struct Docs {
    by_id: HashMap<String, String>,
    order: VecDeque<String>,
}

#[derive(Default)]
pub struct PreviewStore(Mutex<Docs>);

impl PreviewStore {
    fn set(&self, id: String, html: String) {
        let mut docs = self.0.lock().expect("preview store poisoned");
        if docs.by_id.insert(id.clone(), html).is_none() {
            docs.order.push_back(id);
        }
        while docs.order.len() > MAX_DOCS {
            if let Some(oldest) = docs.order.pop_front() {
                docs.by_id.remove(&oldest);
            }
        }
    }

    fn get(&self, id: &str) -> Option<String> {
        self.0
            .lock()
            .expect("preview store poisoned")
            .by_id
            .get(id)
            .cloned()
    }
}

/// Ids come from the frontend and end up in a URL path: allow only a safe alphabet.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID_LEN
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Registers a document so the `preview:` scheme can serve it at `/<id>`.
#[tauri::command]
pub fn preview_set(store: State<'_, PreviewStore>, id: String, html: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("invalid preview id".into());
    }
    if html.len() > MAX_DOC_BYTES {
        return Err("preview document is too large".into());
    }
    store.set(id, html);
    Ok(())
}

fn respond(status: StatusCode, body: String) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        // `sandbox` here keeps the document sandboxed even if it is ever opened outside the iframe.
        .header(
            header::CONTENT_SECURITY_POLICY,
            format!("{PREVIEW_CSP}; sandbox allow-scripts"),
        )
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::REFERRER_POLICY, "no-referrer")
        .body(body.into_bytes())
        .expect("static response headers are valid")
}

/// Handler for the `preview:` scheme (`preview://localhost/<id>`, or `http://preview.localhost/<id>` on Windows).
pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let id = request.uri().path().trim_start_matches('/');
    let store = ctx.app_handle().state::<PreviewStore>();
    match valid_id(id).then(|| store.get(id)).flatten() {
        Some(html) => respond(StatusCode::OK, html),
        None => respond(StatusCode::NOT_FOUND, "Preview not found".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_restricted_to_a_safe_alphabet() {
        assert!(valid_id("tab-1_v2"));
        assert!(!valid_id(""));
        assert!(!valid_id("../secret"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id("a b"));
        assert!(!valid_id(&"x".repeat(MAX_ID_LEN + 1)));
    }

    #[test]
    fn store_replaces_by_id_and_evicts_the_oldest() {
        let store = PreviewStore::default();
        store.set("a".into(), "one".into());
        store.set("a".into(), "two".into());
        assert_eq!(store.get("a").as_deref(), Some("two"));
        for i in 0..MAX_DOCS {
            store.set(format!("d{i}"), "x".into());
        }
        assert_eq!(store.get("a"), None, "oldest entry is evicted");
        assert!(store.get("d0").is_some());
    }

    #[test]
    fn responses_carry_the_isolation_headers() {
        let response = respond(StatusCode::OK, "<p>hi</p>".into());
        let csp = response
            .headers()
            .get(header::CONTENT_SECURITY_POLICY)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default();
        assert!(csp.contains("connect-src 'none'"));
        assert!(csp.contains("default-src 'none'"));
        assert!(csp.ends_with("sandbox allow-scripts"));
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(response.body(), b"<p>hi</p>");
    }
}
