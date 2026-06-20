//! Pure Rust parser for ACLOS WonderfulDb files.
//!
//! Mirrors `packages/parser/src/` 1:1. The TS parser is kept around for the
//! CLI and the bun-based test fixtures; the GUI only talks to the Rust one.

pub mod crypto;
pub mod error;
pub mod hex;
pub mod model;
pub mod reader;

pub use reader::{parse_snapshot_db, parse_wonderful_db};
