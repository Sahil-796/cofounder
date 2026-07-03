//! Cofounder Tauri shell (minimal).
//!
//! On startup: probe `GET http://127.0.0.1:9119/api/status`. If the backend is
//! unreachable, spawn `hermes serve --port 9119 --skip-build` (binary at
//! `~/.local/bin/hermes`, falling back to a PATH lookup). We track whether WE
//! spawned it and kill it on app exit only in that case. The `sidecar_status`
//! command surfaces {running, spawned_by_us, port} to the frontend.

use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{Manager, RunEvent, State};

const PORT: u16 = 9119;

/// Shared handle to the sidecar we manage. `child` is Some only when we spawned
/// it ourselves (and are therefore responsible for killing it on exit).
#[derive(Default)]
struct Sidecar {
    child: Mutex<Option<Child>>,
    spawned_by_us: Mutex<bool>,
}

#[derive(Serialize, Clone)]
struct SidecarStatus {
    running: bool,
    spawned_by_us: bool,
    port: u16,
}

/// Blocking liveness probe against the REST status endpoint. Any HTTP response
/// (even an error status) means the port is served → backend reachable.
fn backend_reachable() -> bool {
    // Minimal dependency-free TCP+HTTP GET so we don't pull in reqwest.
    use std::io::{Read, Write};
    use std::net::TcpStream;

    let addr = format!("127.0.0.1:{PORT}");
    let Ok(mut stream) = TcpStream::connect_timeout(
        &addr.parse().expect("valid loopback addr"),
        Duration::from_millis(600),
    ) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(800)));
    let req = format!(
        "GET /api/status HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 16];
    match stream.read(&mut buf) {
        Ok(n) if n > 0 => buf.starts_with(b"HTTP/"),
        _ => false,
    }
}

/// Resolve the hermes binary: prefer the known install path, else rely on PATH.
fn hermes_binary() -> String {
    if let Some(home) = dirs_home() {
        let candidate = home.join(".local/bin/hermes");
        if candidate.is_file() {
            return candidate.to_string_lossy().into_owned();
        }
    }
    // PATH fallback — Command resolves this against the process PATH.
    "hermes".to_string()
}

/// Home directory without pulling in the `dirs` crate.
fn dirs_home() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").map(std::path::PathBuf::from)
}

/// Spawn `hermes serve --port 9119 --skip-build` unless the backend is already
/// up. Records ownership so we only reap what we started.
fn ensure_sidecar(sidecar: &Sidecar) {
    if backend_reachable() {
        return;
    }
    let bin = hermes_binary();
    match Command::new(&bin)
        .args(["serve", "--port", &PORT.to_string(), "--skip-build"])
        .spawn()
    {
        Ok(child) => {
            *sidecar.child.lock().unwrap() = Some(child);
            *sidecar.spawned_by_us.lock().unwrap() = true;
            eprintln!("[cofounder] spawned hermes sidecar ({bin}) on port {PORT}");
        }
        Err(e) => {
            eprintln!("[cofounder] failed to spawn hermes ({bin}): {e}");
        }
    }
}

/// Kill the sidecar if (and only if) we spawned it.
fn teardown_sidecar(sidecar: &Sidecar) {
    if !*sidecar.spawned_by_us.lock().unwrap() {
        return;
    }
    if let Some(mut child) = sidecar.child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
        eprintln!("[cofounder] killed hermes sidecar we spawned");
    }
}

#[tauri::command]
fn sidecar_status(sidecar: State<'_, Sidecar>) -> SidecarStatus {
    // If we spawned a child, treat it as running unless it has visibly exited.
    let mut guard = sidecar.child.lock().unwrap();
    let child_alive = match guard.as_mut() {
        Some(child) => matches!(child.try_wait(), Ok(None)),
        None => false,
    };
    let spawned_by_us = *sidecar.spawned_by_us.lock().unwrap();
    // Reachability covers the attach case (backend already running, not ours).
    let running = child_alive || backend_reachable();
    SidecarStatus {
        running,
        spawned_by_us,
        port: PORT,
    }
}

/// Create a directory tree (mkdir -p). The Cofounder workspace bootstrap needs
/// this because Hermes's REST fs API can only write files into an already
/// existing parent (no /api/fs/mkdir endpoint — see core/bootstrap.md §4).
#[tauri::command]
fn mkdir_p(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .manage(Sidecar::default())
        .invoke_handler(tauri::generate_handler![sidecar_status, mkdir_p])
        .setup(|app| {
            let sidecar = app.state::<Sidecar>();
            ensure_sidecar(&sidecar);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Cofounder")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                teardown_sidecar(&app_handle.state::<Sidecar>());
            }
        });
}
