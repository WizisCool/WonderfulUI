use crate::parser::error::ParseError;

/// Decode a hex-encoded ASCII string to raw bytes. Strict: every char must
/// be 0-9 / a-f / A-F, and the length must be even.
pub fn decode_hex(text: &str) -> Result<Vec<u8>, ParseError> {
    let len = text.len();
    if len == 0 {
        return Ok(Vec::new());
    }
    if len % 2 != 0 {
        return Err(ParseError::Hex {
            msg: "odd number of hex characters".into(),
            pos: len,
        });
    }
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(len / 2);
    for i in (0..len).step_by(2) {
        let hi = hex_val(bytes[i], i)?;
        let lo = hex_val(bytes[i + 1], i + 1)?;
        out.push((hi << 4) | lo);
    }
    Ok(out)
}

#[inline]
fn hex_val(b: u8, pos: usize) -> Result<u8, ParseError> {
    match b {
        b'0'..=b'9' => Ok(b - b'0'),
        b'a'..=b'f' => Ok(b - b'a' + 10),
        b'A'..=b'F' => Ok(b - b'A' + 10),
        _ => Err(ParseError::Hex {
            msg: format!("non-hex character 0x{:02x}", b),
            pos,
        }),
    }
}
