//! NDJSON streaming helpers for `/api/generate` and `/api/pull`.
//!
//! Ollama returns one JSON object per line when `stream: true`. The byte
//! stream may split objects across chunks, so we maintain a buffer and only
//! parse complete (newline-terminated) lines.

use bytes::Bytes;
use futures::Stream;
use futures_util::StreamExt;

use super::types::{GenerateChunk, OllamaPullEvent, PullChunk};

/// Convert a stream of byte chunks into a stream of complete NDJSON lines.
pub(crate) fn ndjson_lines<S>(byte_stream: S) -> impl Stream<Item = Result<String, String>>
where
    S: Stream<Item = reqwest::Result<Bytes>> + Unpin,
{
    let state = NdjsonState::new(byte_stream);
    futures::stream::unfold(state, |mut state| async move {
        loop {
            if let Some(line) = state.take_line() {
                return Some((Ok(line), state));
            }
            match state.byte_stream.next().await {
                Some(Ok(chunk)) => state.push_chunk(&chunk),
                Some(Err(err)) => return Some((Err(format!("HTTP read error: {err}")), state)),
                None => return state.flush_remainder(),
            }
        }
    })
}

struct NdjsonState<S> {
    byte_stream: S,
    buffer: Vec<u8>,
}

impl<S> NdjsonState<S> {
    fn new(byte_stream: S) -> Self {
        Self {
            byte_stream,
            buffer: Vec::new(),
        }
    }

    fn push_chunk(&mut self, chunk: &[u8]) {
        self.buffer.extend_from_slice(chunk);
    }

    fn take_line(&mut self) -> Option<String> {
        let newline_idx = self.buffer.iter().position(|&b| b == b'\n')?;
        let line_bytes: Vec<u8> = self.buffer.drain(..=newline_idx).collect();
        let trimmed = trim_newline(&line_bytes);
        Some(String::from_utf8_lossy(trimmed).into_owned())
    }

    fn flush_remainder(self) -> Option<(Result<String, String>, Self)> {
        if self.buffer.is_empty() {
            return None;
        }
        let line = String::from_utf8_lossy(&self.buffer).into_owned();
        let mut next = self;
        next.buffer.clear();
        Some((Ok(line), next))
    }
}

fn trim_newline(bytes: &[u8]) -> &[u8] {
    let without_lf = bytes.strip_suffix(b"\n").unwrap_or(bytes);
    without_lf.strip_suffix(b"\r").unwrap_or(without_lf)
}

/// Parse one NDJSON line of `/api/generate`, returning `Some(text)` for
/// response chunks or `None` when the stream is done.
pub(crate) fn parse_generate_line(line: &str) -> Result<GenerateLineOutcome, String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(GenerateLineOutcome::Skip);
    }
    let chunk: GenerateChunk = serde_json::from_str(trimmed)
        .map_err(|e| format!("Failed to parse generate chunk: {e}"))?;
    if chunk.done {
        return Ok(GenerateLineOutcome::Done);
    }
    if chunk.response.is_empty() {
        return Ok(GenerateLineOutcome::Skip);
    }
    Ok(GenerateLineOutcome::Delta(chunk.response))
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum GenerateLineOutcome {
    Delta(String),
    Skip,
    Done,
}

/// Parse one NDJSON line of `/api/pull` into a typed pull event.
pub(crate) fn parse_pull_line(line: &str) -> Result<Option<OllamaPullEvent>, String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let chunk: PullChunk =
        serde_json::from_str(trimmed).map_err(|e| format!("Failed to parse pull chunk: {e}"))?;
    Ok(Some(chunk.into_event()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::Bytes;
    use futures::stream;
    use futures_util::StreamExt;

    fn byte_stream(chunks: Vec<&'static [u8]>) -> impl Stream<Item = reqwest::Result<Bytes>> {
        stream::iter(chunks.into_iter().map(|c| Ok(Bytes::from_static(c))))
    }

    #[tokio::test]
    async fn ndjson_lines_splits_on_newline() {
        let stream = byte_stream(vec![b"a\nb\nc\n"]);
        let mut s = Box::pin(ndjson_lines(stream));
        let mut lines = vec![];
        while let Some(line) = s.next().await {
            lines.push(line.unwrap());
        }
        assert_eq!(lines, vec!["a", "b", "c"]);
    }

    #[tokio::test]
    async fn ndjson_lines_handles_split_chunks() {
        let stream = byte_stream(vec![b"hel", b"lo\nwor", b"ld\n"]);
        let mut s = Box::pin(ndjson_lines(stream));
        let lines: Vec<String> = std::iter::from_fn(|| {
            futures::executor::block_on(s.next()).map(|r| r.unwrap())
        })
        .collect();
        assert_eq!(lines, vec!["hello", "world"]);
    }

    #[tokio::test]
    async fn ndjson_lines_flushes_unterminated_remainder() {
        let stream = byte_stream(vec![b"a\nb"]);
        let mut s = Box::pin(ndjson_lines(stream));
        let mut lines = vec![];
        while let Some(line) = s.next().await {
            lines.push(line.unwrap());
        }
        assert_eq!(lines, vec!["a", "b"]);
    }

    #[tokio::test]
    async fn ndjson_lines_strips_carriage_return() {
        let stream = byte_stream(vec![b"a\r\nb\r\n"]);
        let mut s = Box::pin(ndjson_lines(stream));
        let mut lines = vec![];
        while let Some(line) = s.next().await {
            lines.push(line.unwrap());
        }
        assert_eq!(lines, vec!["a", "b"]);
    }

    #[test]
    fn parse_generate_line_yields_delta() {
        let outcome = parse_generate_line(r#"{"response":"Hello","done":false}"#).unwrap();
        assert_eq!(outcome, GenerateLineOutcome::Delta("Hello".into()));
    }

    #[test]
    fn parse_generate_line_done_when_done_flag() {
        let outcome = parse_generate_line(r#"{"response":"","done":true}"#).unwrap();
        assert_eq!(outcome, GenerateLineOutcome::Done);
    }

    #[test]
    fn parse_generate_line_skips_empty_response() {
        let outcome = parse_generate_line(r#"{"response":"","done":false}"#).unwrap();
        assert_eq!(outcome, GenerateLineOutcome::Skip);
    }

    #[test]
    fn parse_generate_line_skips_blank_line() {
        assert_eq!(parse_generate_line("   ").unwrap(), GenerateLineOutcome::Skip);
    }

    #[test]
    fn parse_generate_line_errors_on_bad_json() {
        assert!(parse_generate_line("{not json").is_err());
    }

    #[test]
    fn parse_pull_line_progress_event() {
        let evt = parse_pull_line(
            r#"{"status":"downloading","completed":10,"total":100}"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            evt,
            OllamaPullEvent::Progress {
                completed: 10,
                total: 100,
                status: "downloading".into()
            }
        );
    }

    #[test]
    fn parse_pull_line_success_event() {
        let evt = parse_pull_line(r#"{"status":"success"}"#).unwrap().unwrap();
        assert_eq!(evt, OllamaPullEvent::Done {});
    }

    #[test]
    fn parse_pull_line_blank_returns_none() {
        assert!(parse_pull_line("").unwrap().is_none());
    }
}
