import SwiftUI

struct ContentView: View {
    @EnvironmentObject var state: AppState
    @FocusState private var skuFocused: Bool

    var body: some View {
        HSplitView {
            controls
                .frame(minWidth: 330, idealWidth: 375, maxWidth: 450)
            SignPreview()
                .frame(minWidth: 430, maxWidth: .infinity, maxHeight: .infinity)
        }
        .toolbar { toolbarItems }
        .sheet(isPresented: $state.showDiagnostics) {
            DiagnosticsView().environmentObject(state)
        }
        .onChange(of: state.focusSKURequested) { requested in
            if requested {
                skuFocused = true
                state.focusSKURequested = false
            }
        }
    }

    @ToolbarContentBuilder
    private var toolbarItems: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            Button {
                state.showDiagnostics = true
            } label: {
                Label("Diagnostics", systemImage: "waveform.path.ecg")
            }
            .help("Show what the last lookup did, step by step")
            .disabled(state.diagnostics.isEmpty)

            Button {
                state.requestExportPDF()
            } label: {
                Label("Export PDF", systemImage: "square.and.arrow.down")
            }
            .help("Save the sign as a PDF (⌘E)")

            Button {
                state.requestPrint()
            } label: {
                Label("Print", systemImage: "printer")
            }
            .help("Print the sign (⌘P)")
        }
    }

    private var controls: some View {
        Form {
            Section("Look Up Product") {
                HStack(spacing: 8) {
                    TextField("SKU, item #, name, or product URL", text: $state.sku)
                        .textFieldStyle(.roundedBorder)
                        .focused($skuFocused)
                        .onSubmit { state.runLookup() }
                    Button {
                        state.runLookup()
                    } label: {
                        if state.isLookingUp {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Look Up")
                        }
                    }
                    .disabled(state.isLookingUp
                        || state.sku.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                if let error = state.lookupError {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.callout)
                        .foregroundColor(.orange)
                }
                if state.productPageURL != nil || !state.diagnostics.isEmpty {
                    HStack {
                        if state.productPageURL != nil {
                            Button("Open Product Page") { state.openProductPage() }
                                .buttonStyle(LinkButtonStyle())
                                .help("Double-check the price on acehardware.com")
                        }
                        Spacer()
                        if !state.diagnostics.isEmpty {
                            Button("Diagnostics…") { state.showDiagnostics = true }
                                .buttonStyle(LinkButtonStyle())
                        }
                    }
                    .font(.callout)
                }
            }

            Section("Sign Text") {
                TextField("Product name", text: $state.productName, axis: .vertical)
                    .lineLimit(1...3)
                TextField("Detail line (brand, size, model)", text: $state.detailLine)
                TextField("Price", text: $state.priceText)
                if !state.priceCandidates.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Prices found on the page — click to use:")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                ForEach(state.priceCandidates) { candidate in
                                    Button {
                                        state.applyCandidate(candidate)
                                    } label: {
                                        VStack(spacing: 1) {
                                            Text("$" + candidate.value)
                                                .fontWeight(.semibold)
                                            Text(candidate.source)
                                                .font(.system(size: 9))
                                                .foregroundColor(.secondary)
                                        }
                                    }
                                    .buttonStyle(.bordered)
                                    .controlSize(.small)
                                }
                            }
                        }
                    }
                }
                TextField("Was price (optional — adds strikethrough)", text: $state.wasPriceText)
                TextField("Unit (optional, e.g. /each, /ft, /gal)", text: $state.unitSuffix)
            }

            Section("Photo") {
                HStack(spacing: 12) {
                    Group {
                        if let image = state.productImage {
                            Image(nsImage: image)
                                .resizable()
                                .scaledToFit()
                        } else {
                            ZStack {
                                RoundedRectangle(cornerRadius: 6)
                                    .fill(Color.secondary.opacity(0.12))
                                Image(systemName: "photo")
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                    .frame(width: 64, height: 64)

                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Button("Choose…") { state.chooseImageFile() }
                            Button("Paste") { state.pasteImage() }
                            Button("Clear") { state.clearImage() }
                                .disabled(state.productImage == nil)
                        }
                        Text("Or drag a photo onto the sign preview.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }

            Section("Sign") {
                Picker("Size", selection: $state.signSize) {
                    ForEach(SignSize.presets) { size in
                        Text(size.name).tag(size)
                    }
                }
                if state.signSize.isCustom {
                    HStack {
                        TextField("Width (in)", value: $state.customWidth, format: .number)
                        Text("×").foregroundColor(.secondary)
                        TextField("Height (in)", value: $state.customHeight, format: .number)
                    }
                } else {
                    Picker("Orientation", selection: $state.orientation) {
                        ForEach(SignOrientation.allCases) { orientation in
                            Text(orientation.label).tag(orientation)
                        }
                    }
                    .pickerStyle(.segmented)
                }
                Picker("Format", selection: $state.layout) {
                    ForEach(SignLayoutKind.allCases) { kind in
                        Text(kind.label).tag(kind)
                    }
                }
                .pickerStyle(.segmented)
            }

            Section("Print") {
                Picker("Paper", selection: $state.paper) {
                    ForEach(PaperOption.allCases) { option in
                        Text(option.label).tag(option)
                    }
                }
                Toggle("Fit as many signs as possible per sheet", isOn: $state.multiUp)
                    .disabled(state.paper == .exactSign)
                Toggle("Cut marks", isOn: $state.cutMarks)
                    .disabled(state.paper == .exactSign)
                HStack {
                    Button("Print…") { state.requestPrint() }
                        .buttonStyle(.borderedProminent)
                    Button("Export PDF…") { state.requestExportPDF() }
                    Spacer()
                    Button {
                        state.addCurrentToQueue()
                    } label: {
                        Label("Add to Queue", systemImage: "plus.rectangle.on.rectangle")
                    }
                    .help("Save this sign to the batch queue")
                }
            }

            Section {
                if state.queue.isEmpty {
                    Text("The queue is empty. Build a sign, then **Add to Queue** to batch several and print or export them all at once.")
                        .font(.callout)
                        .foregroundColor(.secondary)
                } else {
                    ForEach(state.queue) { item in
                        HStack(spacing: 8) {
                            QueueThumb(image: item.thumbnail)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(item.title).lineLimit(1)
                                if !item.subtitle.isEmpty {
                                    Text(item.subtitle)
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                            Spacer()
                            Button {
                                state.removeFromQueue(item.id)
                            } label: {
                                Image(systemName: "trash")
                            }
                            .buttonStyle(.borderless)
                            .help("Remove from queue")
                        }
                    }
                    Text(state.queuePlanDescription)
                        .font(.caption)
                        .foregroundColor(.secondary)
                    HStack {
                        Button {
                            state.printQueue()
                        } label: {
                            Label("Print Queue (\(state.queue.count))", systemImage: "printer")
                        }
                        .buttonStyle(.borderedProminent)
                        Button {
                            state.exportQueuePDF()
                        } label: {
                            Label("Export PDF", systemImage: "square.and.arrow.down")
                        }
                        Spacer()
                        Button("Clear") { state.clearQueue() }
                    }
                }
            } header: {
                HStack {
                    Text("Batch Queue")
                    if !state.queue.isEmpty {
                        Text("\(state.queue.count)")
                            .font(.caption)
                            .padding(.horizontal, 6).padding(.vertical, 1)
                            .background(Capsule().fill(Color.secondary.opacity(0.2)))
                    }
                }
            }
        }
        .formStyle(.grouped)
    }
}

/// Small thumbnail for a queued sign's photo (or a placeholder).
struct QueueThumb: View {
    let image: NSImage?

    var body: some View {
        Group {
            if let image {
                Image(nsImage: image).resizable().scaledToFit()
            } else {
                Image(systemName: "tag")
                    .foregroundColor(.secondary)
            }
        }
        .frame(width: 34, height: 34)
        .background(RoundedRectangle(cornerRadius: 4).fill(Color.secondary.opacity(0.1)))
    }
}
