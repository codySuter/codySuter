import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: - Settings

struct SettingsView: View {
    @AppStorage(Prefs.storeCode) private var storeCode = "12180"
    @AppStorage(Prefs.storeName) private var storeName = "Snyder's Ace Hardware • Media, PA"
    @AppStorage(Prefs.showFooter) private var showFooter = true
    @AppStorage(Prefs.logoPath) private var logoPath = ""

    var body: some View {
        Form {
            Section("Store") {
                TextField("Ace store number", text: $storeCode)
                    .help("Used to load your store's context on acehardware.com (store-details/\(storeCode))")
                TextField("Store line printed on signs", text: $storeName)
                Toggle("Show SKU + store line at the bottom of signs", isOn: $showFooter)
            }
            Section("Branding") {
                HStack(spacing: 12) {
                    if !logoPath.isEmpty, let logo = NSImage(contentsOfFile: logoPath) {
                        Image(nsImage: logo)
                            .resizable()
                            .scaledToFit()
                            .frame(height: 40)
                    } else {
                        Text("Using the official Ace Hardware logo (built in)")
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                    Button("Choose Logo…") { chooseLogo() }
                    if !logoPath.isEmpty {
                        Button("Use Built-in") { logoPath = "" }
                    }
                }
                Text("The official two-line Ace Hardware logo is built in. Choose a file only to override it (for example a seasonal or co-branded version); the brand kit's vector originals live in the project's BrandAssets folder.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .formStyle(.grouped)
        .frame(width: 520, height: 320)
    }

    private func chooseLogo() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        panel.message = "Choose a logo image for the corner of your signs"
        if panel.runModal() == .OK, let url = panel.url {
            logoPath = url.path
        }
    }
}

// MARK: - Diagnostics

/// Step-by-step log of the last lookup. When acehardware.com changes something
/// and a field stops filling in, this log is what makes it fixable — copy it
/// and share it.
struct DiagnosticsView: View {
    @EnvironmentObject var state: AppState
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Lookup Diagnostics")
                .font(.title3.bold())
            Text("Everything the last lookup did. If a price or photo didn't come through, Copy All and share this log so the lookup can be updated.")
                .font(.callout)
                .foregroundColor(.secondary)

            List(state.diagnostics) { entry in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: entry.ok ? "checkmark.circle.fill" : "xmark.octagon.fill")
                        .foregroundColor(entry.ok ? .green : .red)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry.title)
                            .fontWeight(.medium)
                        Text(entry.detail)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .textSelection(.enabled)
                    }
                }
                .padding(.vertical, 2)
            }

            HStack {
                Button("Copy All") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(state.diagnosticsText, forType: .string)
                }
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 620, height: 460)
    }
}
