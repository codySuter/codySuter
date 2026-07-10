import SwiftUI
import AppKit

@main
struct AceSignStudioApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var state = AppState.shared

    init() {
        Prefs.registerDefaults()
    }

    var body: some Scene {
        WindowGroup("Ace Sign Studio") {
            ContentView()
                .environmentObject(state)
                .frame(minWidth: 960, minHeight: 620)
        }
        .commands {
            CommandGroup(replacing: .printItem) {
                Button("Print…") { AppState.shared.requestPrint() }
                    .keyboardShortcut("p", modifiers: .command)
                Button("Export PDF…") { AppState.shared.requestExportPDF() }
                    .keyboardShortcut("e", modifiers: .command)
            }
            CommandGroup(after: .newItem) {
                Button("Look Up SKU") { AppState.shared.focusSKURequested = true }
                    .keyboardShortcut("l", modifiers: .command)
            }
        }

        Settings {
            SettingsView()
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Ensures the window comes forward even when launched via `swift run`.
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
