use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Claims {
    pub sub: String,
    pub sid: Option<String>,
    pub aud: Option<String>,
    pub iss: Option<String>,
    pub exp: usize,
    pub scope: Option<String>,
    #[serde(default)]
    pub roles: Vec<String>,
    pub aal: Option<String>,
    pub email: Option<String>,
}

impl Claims {
    pub fn has_scope(&self, scope: &str) -> bool {
        self.scope
            .as_deref()
            .unwrap_or_default()
            .split_whitespace()
            .any(|candidate| candidate == scope)
    }

    pub fn has_role(&self, role: &str) -> bool {
        self.roles.iter().any(|candidate| candidate == role)
    }
}
