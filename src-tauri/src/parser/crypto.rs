//! Crypto layer for ACLOS WonderfulDb.
//!
//! File format (verified against ACLOS 2.15.3.449, @tencent/icreate-wonderful@3.5.2):
//!   - file body is hex-encoded ASCII (0-9, a-f)
//!   - decoded bytes = AES-256-CBC ciphertext (PKCS7 padding, stripped by cbc crate)
//!   - key = sha256(openid).hex.substring(0, 32) as UTF-8 bytes  (32 bytes)
//!   - iv  = sha256(openid).hex.substring(0, 16) as UTF-8 bytes  (16 bytes)
//!   - plaintext = JSON object: { "key_wonderful_list_<openid>": Match[] }

use crate::parser::error::ParseError;
use aes::Aes256;
use cbc::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use sha2::{Digest, Sha256};

type Aes256CbcDec = cbc::Decryptor<Aes256>;

/// Derive the AES-256 key (32 bytes) and CBC IV (16 bytes) from the openid.
/// Both are the first 32 / 16 hex chars of sha256(openid), interpreted as
/// UTF-8 bytes — i.e. literal ASCII hex chars, not the decoded bytes.
pub fn derive_key_iv(openid: &str) -> (Vec<u8>, Vec<u8>) {
    let mut hasher = Sha256::new();
    hasher.update(openid.as_bytes());
    let sha_hex = hex::encode(hasher.finalize());
    let key = sha_hex.as_bytes()[..32].to_vec();
    let iv = sha_hex.as_bytes()[..16].to_vec();
    (key, iv)
}

/// Decrypt AES-256-CBC ciphertext with PKCS7 padding. Returns the plaintext.
pub fn aes_decrypt(cipher: &[u8], key: &[u8], iv: &[u8]) -> Result<Vec<u8>, ParseError> {
    let decryptor = Aes256CbcDec::new_from_slices(key, iv)
        .map_err(|e| ParseError::Crypto(format!("invalid key/iv: {}", e)))?;
    let mut buf = cipher.to_vec();
    let pt = decryptor
        .decrypt_padded_mut::<Pkcs7>(&mut buf)
        .map_err(|e| ParseError::Crypto(format!("decrypt failed: {}", e)))?;
    Ok(pt.to_vec())
}
