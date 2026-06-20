use thiserror::Error;

#[derive(Debug, Error)]
pub enum ParseError {
    #[error("hex decode error at position {pos}: {msg}")]
    Hex { msg: String, pos: usize },

    #[error("crypto error: {0}")]
    Crypto(String),

    #[error("utf-8 error: {0}")]
    Utf8(#[from] std::string::FromUtf8Error),

    #[error("decrypted plaintext is not valid JSON: {0}")]
    InvalidJson(#[from] serde_json::Error),

    #[error("decrypted JSON: expected top-level object")]
    NotAnObject,

    #[error("no match list found (expected key \"{0}\")")]
    NoMatchList(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}
