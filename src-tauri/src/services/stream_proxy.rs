use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

#[derive(Clone)]
struct UpstreamEntry {
    url: String,
    user_agent: Option<String>,
}

struct ProxyServer {
    port: u16,
    entries: Arc<Mutex<HashMap<String, UpstreamEntry>>>,
}

static PROXY: OnceLock<ProxyServer> = OnceLock::new();

fn ensure_started() -> Result<&'static ProxyServer, String> {
    if let Some(server) = PROXY.get() {
        return Ok(server);
    }

    let std_listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind local stream proxy: {e}"))?;
    std_listener
        .set_nonblocking(true)
        .map_err(|e| format!("Failed to configure proxy socket: {e}"))?;
    let port = std_listener
        .local_addr()
        .map_err(|e| format!("Failed to read proxy port: {e}"))?
        .port();

    let entries: Arc<Mutex<HashMap<String, UpstreamEntry>>> = Arc::new(Mutex::new(HashMap::new()));
    let entries_bg = Arc::clone(&entries);

    tauri::async_runtime::spawn(async move {
        let Ok(listener) = TcpListener::from_std(std_listener) else {
            return;
        };
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .unwrap_or_default();

        loop {
            let Ok((socket, _)) = listener.accept().await else {
                continue;
            };
            let entries_req = Arc::clone(&entries_bg);
            let client = http.clone();
            tauri::async_runtime::spawn(async move {
                let _ = handle_connection(socket, entries_req, client).await;
            });
        }
    });

    let _ = PROXY.set(ProxyServer { port, entries });
    PROXY
        .get()
        .ok_or_else(|| "Proxy server failed to initialize".to_string())
}

/// Register an upstream media URL and return a `http://127.0.0.1:<port>/s/<id>` URL
/// that WKWebView `<video>` / `<audio>` can stream and scrub with proper headers.
#[allow(dead_code)]
pub fn register(url: String, user_agent: Option<String>) -> Result<String, String> {
    let server = ensure_started()?;
    let id = uuid::Uuid::new_v4().simple().to_string();
    {
        let mut map = server.entries.lock().unwrap_or_else(|e| e.into_inner());
        // Keep map bounded so old video sessions don't accumulate indefinitely.
        if map.len() > 32 {
            map.clear();
        }
        map.insert(id.clone(), UpstreamEntry { url, user_agent });
    }
    Ok(format!("http://127.0.0.1:{}/s/{}", server.port, id))
}

async fn handle_connection(
    mut socket: TcpStream,
    entries: Arc<Mutex<HashMap<String, UpstreamEntry>>>,
    client: reqwest::Client,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (read_half, mut write_half) = socket.split();
    let mut reader = BufReader::new(read_half);

    let mut request_line = String::new();
    if reader.read_line(&mut request_line).await? == 0 {
        return Ok(());
    }

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("GET");
    let raw_path = parts.next().unwrap_or("/");

    let mut range_header: Option<String> = None;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).await?;
        if n == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("range") {
                range_header = Some(v.trim().to_string());
            }
        }
    }

    if method == "OPTIONS" {
        let resp = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Range\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nConnection: close\r\n\r\n";
        write_half.write_all(resp.as_bytes()).await?;
        return Ok(());
    }

    let id = raw_path
        .strip_prefix("/s/")
        .and_then(|s| s.split('?').next())
        .unwrap_or("");

    let entry = {
        let map = entries.lock().unwrap_or_else(|e| e.into_inner());
        map.get(id).cloned()
    };

    let Some(entry) = entry else {
        write_half
            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await?;
        return Ok(());
    };

    let mut req = if method == "HEAD" {
        client.head(&entry.url)
    } else {
        client.get(&entry.url)
    };

    if let Some(ua) = &entry.user_agent {
        req = req.header("User-Agent", ua);
    }
    if let Some(range) = &range_header {
        req = req.header("Range", range);
    }

    let mut upstream = match req.send().await {
        Ok(r) => r,
        Err(_) => {
            write_half
                .write_all(
                    b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await?;
            return Ok(());
        }
    };

    let status = upstream.status();
    let status_line = format!(
        "HTTP/1.1 {} {}\r\n",
        status.as_u16(),
        status.canonical_reason().unwrap_or("OK")
    );
    let mut head = String::from(status_line);
    head.push_str("Access-Control-Allow-Origin: *\r\n");
    head.push_str("Accept-Ranges: bytes\r\n");
    head.push_str("Connection: close\r\n");

    for header_name in ["content-type", "content-length", "content-range"] {
        if let Some(val) = upstream.headers().get(header_name) {
            if let Ok(s) = val.to_str() {
                head.push_str(header_name);
                head.push_str(": ");
                head.push_str(s);
                head.push_str("\r\n");
            }
        }
    }
    head.push_str("\r\n");
    write_half.write_all(head.as_bytes()).await?;

    if method != "HEAD" {
        while let Some(chunk) = upstream.chunk().await? {
            if write_half.write_all(&chunk).await.is_err() {
                break;
            }
        }
    }

    let _ = write_half.shutdown().await;
    Ok(())
}
