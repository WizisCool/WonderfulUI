//! Library-facing models. The first implementation reuses the parser IPC
//! shapes so the existing GUI can keep rendering while SQLite becomes the
//! backing store.

use crate::parser::model::LoadResult;

pub type LibraryLoadResult = LoadResult;
