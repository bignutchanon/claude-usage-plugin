// ClaudeUsageLogin — tiny macOS app that:
//   1. opens a window with a WKWebView loading https://claude.ai/login
//   2. polls the web view's cookie store for the `sessionKey` cookie
//   3. once found, fetches /api/organizations to learn the user's org id
//   4. POSTs {sessionKey, orgId} to http://127.0.0.1:4000/api/setup/save
//   5. shows success, then quits
//
// Designed to be launched by the dashboard's setup wizard via `open`.
//
// No code signing identity required; ad-hoc signed via build-login.sh.
// Not sandboxed; freely makes outbound HTTPS + localhost connections.

import Cocoa
import WebKit

// ─── CONFIGURATION ───────────────────────────────────────────────────────────
let LOGIN_URL = URL(string: "https://claude.ai/login")!
let SERVER_BASE = ProcessInfo.processInfo.environment["CLAUDE_MONITOR_BASE"]
    ?? "http://127.0.0.1:4000"
let COOKIE_POLL_INTERVAL: TimeInterval = 1.0

// ─── APP DELEGATE ────────────────────────────────────────────────────────────
final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var statusLabel: NSTextField!
    var pollTimer: Timer?
    var captured = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        setupWindow()
        startCookiePoll()
        NSApp.activate(ignoringOtherApps: true)
    }

    // ── window + chrome ──────────────────────────────────────────────────────
    func setupWindow() {
        let frame = NSRect(x: 0, y: 0, width: 920, height: 720)
        window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "claude-usage-plugin — Sign in"
        window.center()
        window.isReleasedWhenClosed = false

        // Status bar at the top with brief instructions.
        statusLabel = NSTextField(labelWithString:
            "Sign in to claude.ai below. We'll grab the session cookie automatically — no copy-paste required."
        )
        statusLabel.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        statusLabel.textColor = NSColor(red: 0.5, green: 0.7, blue: 0.5, alpha: 1)
        statusLabel.backgroundColor = .black
        statusLabel.drawsBackground = true
        statusLabel.alignment = .center
        statusLabel.translatesAutoresizingMaskIntoConstraints = false

        // Web view configured with a NON-PERSISTENT data store so each launch
        // starts with a fresh session — prevents stale cookies from a prior
        // run.  ALSO means we can read cookies directly from this store
        // without interfering with the user's Safari/Chrome.
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.allowsBackForwardNavigationGestures = false

        let container = NSView(frame: frame)
        container.addSubview(statusLabel)
        container.addSubview(webView)

        NSLayoutConstraint.activate([
            statusLabel.topAnchor.constraint(equalTo: container.topAnchor),
            statusLabel.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            statusLabel.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            statusLabel.heightAnchor.constraint(equalToConstant: 32),

            webView.topAnchor.constraint(equalTo: statusLabel.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])

        window.contentView = container
        window.makeKeyAndOrderFront(nil)
        webView.load(URLRequest(url: LOGIN_URL))
    }

    func setStatus(_ text: String, error: Bool = false, success: Bool = false) {
        DispatchQueue.main.async {
            self.statusLabel.stringValue = text
            if success {
                self.statusLabel.textColor = NSColor(red: 0, green: 1, blue: 0.25, alpha: 1)
            } else if error {
                self.statusLabel.textColor = NSColor(red: 1, green: 0.2, blue: 0.3, alpha: 1)
            } else {
                self.statusLabel.textColor = NSColor(red: 0.5, green: 0.7, blue: 0.5, alpha: 1)
            }
        }
    }

    // ── cookie polling ───────────────────────────────────────────────────────
    func startCookiePoll() {
        pollTimer = Timer.scheduledTimer(withTimeInterval: COOKIE_POLL_INTERVAL, repeats: true) { [weak self] _ in
            self?.tryCaptureCookie()
        }
    }

    func tryCaptureCookie() {
        guard !captured else { return }
        let store = webView.configuration.websiteDataStore.httpCookieStore
        store.getAllCookies { [weak self] cookies in
            guard let self = self else { return }
            for c in cookies where c.name == "sessionKey" {
                self.captured = true
                self.pollTimer?.invalidate()
                self.setStatus("Got sessionKey — looking up your org…")
                self.finishLogin(sessionKey: c.value)
                return
            }
        }
    }

    // ── after-login flow: orgId lookup, POST to local server, exit ───────────
    func finishLogin(sessionKey: String) {
        Task {
            do {
                let orgId = try await self.lookupFirstOrgId(sessionKey: sessionKey)
                try await self.postToLocalServer(sessionKey: sessionKey, orgId: orgId)
                self.setStatus("[+] Connected. You can close this window.", success: true)
                // Tiny pause so the user sees the success message, then quit.
                try? await Task.sleep(nanoseconds: 1_400_000_000)
                await MainActor.run { NSApp.terminate(nil) }
            } catch {
                self.setStatus("[!] \(error.localizedDescription)", error: true)
                // Allow the user to try again — re-enable the poll.
                self.captured = false
                self.startCookiePoll()
            }
        }
    }

    func lookupFirstOrgId(sessionKey: String) async throws -> String {
        var req = URLRequest(url: URL(string: "https://claude.ai/api/organizations")!)
        req.setValue("sessionKey=\(sessionKey)", forHTTPHeaderField: "Cookie")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("web_claude_ai", forHTTPHeaderField: "anthropic-client-platform")
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else {
            throw NSError(domain: "ClaudeUsageLogin", code: 0,
                          userInfo: [NSLocalizedDescriptionKey: "no HTTP response"])
        }
        guard (200..<300).contains(http.statusCode) else {
            throw NSError(domain: "ClaudeUsageLogin", code: http.statusCode,
                          userInfo: [NSLocalizedDescriptionKey: "claude.ai returned HTTP \(http.statusCode) on /api/organizations"])
        }
        guard
            let arr = try JSONSerialization.jsonObject(with: data) as? [[String: Any]],
            let first = arr.first,
            let uuid = first["uuid"] as? String
        else {
            throw NSError(domain: "ClaudeUsageLogin", code: 0,
                          userInfo: [NSLocalizedDescriptionKey: "couldn't parse org list from claude.ai"])
        }
        return uuid
    }

    func postToLocalServer(sessionKey: String, orgId: String) async throws {
        var req = URLRequest(url: URL(string: "\(SERVER_BASE)/api/setup/save")!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "sessionKey": sessionKey,
            "orgId": orgId
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else {
            throw NSError(domain: "ClaudeUsageLogin", code: 0,
                          userInfo: [NSLocalizedDescriptionKey: "local server didn't respond — is it running on \(SERVER_BASE)?"])
        }
        guard (200..<300).contains(http.statusCode) else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
                ?? "HTTP \(http.statusCode)"
            throw NSError(domain: "ClaudeUsageLogin", code: http.statusCode,
                          userInfo: [NSLocalizedDescriptionKey: "local server: \(msg)"])
        }
    }

    // ── lifecycle ────────────────────────────────────────────────────────────
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
