using System.Diagnostics;
using OptiAudit.Core;
using OptiAudit.Core.Model;

namespace OptiAudit.App;

public partial class MainForm
{
    private TextBox _codeBox = null!;
    private Button _searchBtn = null!;
    private DataGridView _matchGrid = null!;
    private Label _searchSummary = null!;
    private TextBox _protectedWarnBox = null!;
    private Button _generateClearBtn = null!;
    private Button _saveChecklistBtn = null!;
    private Button _runFilBtn = null!;

    private static readonly Color MatchHighlight = Color.FromArgb(255, 245, 170);
    private static readonly Color ProtectedShade = Color.FromArgb(235, 235, 235);

    private TabPage BuildClearTab()
    {
        var page = new TabPage("2 · Find && Clear");

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4, Padding = new Padding(10) };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        var searchPanel = new FlowLayoutPanel { AutoSize = true, WrapContents = false };
        searchPanel.Controls.Add(new Label
        {
            Text = "OPTI / location code:",
            AutoSize = true,
            Anchor = AnchorStyles.Left,
            Margin = new Padding(0, 8, 4, 0),
        });
        _codeBox = new TextBox { Width = 160, Font = new Font(Font.FontFamily, 11f) };
        _searchBtn = new Button { Text = "Search locations 1, 2, 4, 5, 6", AutoSize = true };
        _searchBtn.Click += (_, _) => DoSearch();
        _codeBox.KeyDown += (_, e) => { if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; DoSearch(); } };
        searchPanel.Controls.Add(_codeBox);
        searchPanel.Controls.Add(_searchBtn);
        searchPanel.Controls.Add(new Label
        {
            Text = "Exact whole-field match only (54 never matches 540). Multiple codes: separate with commas (e.g. 54,054).",
            AutoSize = true,
            ForeColor = SystemColors.GrayText,
            Margin = new Padding(10, 10, 0, 0),
        });

        _matchGrid = new DataGridView
        {
            Dock = DockStyle.Fill,
            AllowUserToAddRows = false,
            AllowUserToDeleteRows = false,
            RowHeadersVisible = false,
            SelectionMode = DataGridViewSelectionMode.FullRowSelect,
            AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.None,
        };
        _matchGrid.Columns.Add(new DataGridViewCheckBoxColumn { HeaderText = "Clear", Name = "colClear", Width = 44 });
        _matchGrid.Columns.Add(MakeTextColumn("SKU", 110));
        _matchGrid.Columns.Add(MakeTextColumn("Description", 250));
        _matchGrid.Columns.Add(MakeTextColumn("Will clear", 110));
        for (int f = 1; f <= ItemRecord.LocationFieldCount; f++)
            _matchGrid.Columns.Add(MakeTextColumn($"Loc {f}", 85));

        _searchSummary = new Label { AutoSize = true, Font = new Font(Font, FontStyle.Bold), Text = "No search yet.", Margin = new Padding(0, 6, 0, 0) };

        _protectedWarnBox = new TextBox
        {
            Dock = DockStyle.Top,
            Multiline = true,
            ReadOnly = true,
            Height = 54,
            ScrollBars = ScrollBars.Vertical,
            ForeColor = Color.Firebrick,
        };

        var buttonPanel = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = new Padding(0, 6, 0, 0) };
        _generateClearBtn = new Button { Text = "Generate FIL clear file…", AutoSize = true, Enabled = false, Font = new Font(Font, FontStyle.Bold) };
        _generateClearBtn.Click += (_, _) => GenerateClearFile();
        _saveChecklistBtn = new Button { Text = "Save scan checklist…", AutoSize = true, Enabled = false };
        _saveChecklistBtn.Click += (_, _) => SaveChecklist();
        _runFilBtn = new Button { Text = "Run FIL step", AutoSize = true, Enabled = false };
        _runFilBtn.Click += (_, _) => RunFilCommand(_lastClearFile);
        buttonPanel.Controls.AddRange(new Control[] { _generateClearBtn, _saveChecklistBtn, _runFilBtn });

        var bottom = new TableLayoutPanel { AutoSize = true, ColumnCount = 1, Dock = DockStyle.Top };
        bottom.Controls.Add(_searchSummary);
        bottom.Controls.Add(_protectedWarnBox);
        bottom.Controls.Add(buttonPanel);

        layout.Controls.Add(searchPanel, 0, 0);
        layout.Controls.Add(_matchGrid, 0, 1);
        layout.Controls.Add(bottom, 0, 2);
        page.Controls.Add(layout);
        return page;
    }

    private static DataGridViewTextBoxColumn MakeTextColumn(string header, int width) => new()
    {
        HeaderText = header,
        Width = width,
        ReadOnly = true,
        SortMode = DataGridViewColumnSortMode.NotSortable,
    };

    private List<string> ParseCodesFromBox(TextBox box, out string? error)
    {
        error = null;
        var codes = box.Text.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
        if (codes.Count == 0)
        {
            error = "Enter the OPTI / location code to search for.";
            return codes;
        }
        foreach (var code in codes)
        {
            var codeError = LocationMatcher.ValidateCode(code);
            if (codeError != null)
            {
                error = codeError;
                break;
            }
        }
        return codes;
    }

    private void DoSearch()
    {
        if (_items == null || _mapping == null)
        {
            Error("Load and validate a Compass export first (tab 1).");
            return;
        }
        var codes = ParseCodesFromBox(_codeBox, out var error);
        if (error != null)
        {
            Error(error);
            return;
        }

        Cursor = Cursors.WaitCursor;
        try
        {
            // The run button belongs to the previous container's file.
            _runFilBtn.Enabled = false;
            _runFilBtn.Text = "Run FIL step";

            var options = CurrentMatchOptions;
            _report = LocationMatcher.FindMatches(_items, codes, options);
            PopulateMatchGrid(options);

            _searchSummary.Text =
                $"OPTI {string.Join(", ", _report.SearchedCodes)}: {_report.Matches.Count} SKU(s) matched, " +
                $"{_report.TotalFieldsToClear} location field(s) would be cleared.";

            _protectedWarnBox.Text = _report.ProtectedOnlyMatches.Count == 0
                ? string.Empty
                : "Code found in PROTECTED Location 3 only (will NOT be cleared — review manually): " +
                  string.Join(", ", _report.ProtectedOnlyMatches.Select(m => m.Item.Sku));

            _generateClearBtn.Enabled = _report.Matches.Count > 0;
            _saveChecklistBtn.Enabled = _report.Matches.Count > 0;
            Log($"Search for {string.Join(", ", _report.SearchedCodes)}: {_report.Matches.Count} SKUs, {_report.TotalFieldsToClear} fields. " +
                $"{_report.ProtectedOnlyMatches.Count} protected-only hit(s).");

            // Prefill tab 3 with this container's code (also drops any stale plan).
            _reAddCodeBox.Text = _report.SearchedCodes[0];
        }
        finally
        {
            Cursor = Cursors.Default;
        }
    }

    private void PopulateMatchGrid(MatchOptions options)
    {
        _matchGrid.SuspendLayout();
        _matchGrid.Rows.Clear();
        if (_report == null) return;

        foreach (var match in _report.Matches)
        {
            int rowIndex = _matchGrid.Rows.Add(
                true,
                match.Item.Sku,
                match.Item.Description,
                string.Join(", ", match.MatchedFields.Select(f => "Loc " + f)),
                match.Item.LocationValue(1).Trim(),
                match.Item.LocationValue(2).Trim(),
                match.Item.LocationValue(3).Trim(),
                match.Item.LocationValue(4).Trim(),
                match.Item.LocationValue(5).Trim(),
                match.Item.LocationValue(6).Trim());

            var row = _matchGrid.Rows[rowIndex];
            row.Tag = match;

            foreach (var field in match.MatchedFields)
                row.Cells[3 + field].Style.BackColor = MatchHighlight;
            foreach (var field in options.ProtectedFields)
                if (field >= 1 && field <= ItemRecord.LocationFieldCount)
                    row.Cells[3 + field].Style.BackColor = ProtectedShade;
        }
        _matchGrid.ResumeLayout();
    }

    private List<SkuMatch> SelectedMatches()
    {
        var selected = new List<SkuMatch>();
        foreach (DataGridViewRow row in _matchGrid.Rows)
        {
            if (row.Tag is SkuMatch match && Convert.ToBoolean(row.Cells["colClear"].Value ?? false))
                selected.Add(match);
        }
        return selected;
    }

    private void GenerateClearFile()
    {
        if (_report == null) return;
        _matchGrid.EndEdit();

        var selected = SelectedMatches();
        if (selected.Count == 0)
        {
            Error("No SKUs are checked — nothing to clear.");
            return;
        }

        var options = CurrentMatchOptions;
        int fieldCount = selected.Sum(m => m.MatchedFields.Count);
        string codeText = string.Join(",", _report.SearchedCodes);

        if (_config.IncludeStoreColumn && (_mapping?.StoreColumn ?? -1) < 0 &&
            MessageBox.Show(this,
                "Settings include a Store column in FIL files, but no Store column is mapped — Store cells will be blank.\n\nContinue anyway?",
                "Store column not mapped", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes)
        {
            return;
        }

        bool confirmed = ConfirmDialog.Show(this,
            "Confirm FIL clear file",
            $"This creates a FIL load file that CLEARS {fieldCount} location field(s) on {selected.Count} SKU(s) " +
            $"for OPTI {codeText}.\n\nLocation 3 is protected and is never cleared.\n\n" +
            $"Type the OPTI code ({codeText}) to confirm:",
            codeText);
        if (!confirmed) return;

        using var dialog = new SaveFileDialog
        {
            Title = "Save FIL clear file",
            Filter = "CSV files (*.csv)|*.csv",
            FileName = $"FIL_CLEAR_OPTI_{SafeFileToken(codeText)}_{DateTime.Now:yyyyMMdd_HHmmss}.csv",
            InitialDirectory = Directory.Exists(_config.LastOutputFolder) ? _config.LastOutputFolder : "",
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        _config.LastOutputFolder = Path.GetDirectoryName(dialog.FileName) ?? "";

        try
        {
            var rows = FilExportBuilder.BuildClearRows(selected, options, _config.FilFileOptions);
            File.WriteAllText(dialog.FileName, FilExportBuilder.ToCsvText(rows));

            var auditPath = Path.ChangeExtension(dialog.FileName, null) + "_audit.txt";
            File.WriteAllText(auditPath, AuditReport.BuildClearAudit(
                DateTime.Now, _exportPath, _exportSha256, _dataRows.Count,
                _report, selected, options, dialog.FileName));

            var checklistPath = Path.ChangeExtension(dialog.FileName, null) + "_checklist.csv";
            File.WriteAllText(checklistPath, AuditReport.BuildScanChecklistCsv(selected));

            _lastClearCodes = _report.SearchedCodes.ToList();
            // Duplicate SKUs (multi-store exports) must not crash here — merge
            // their cleared fields so re-add auto-targeting sees the union.
            _lastClearMatches = new Dictionary<string, SkuMatch>(StringComparer.OrdinalIgnoreCase);
            foreach (var m in selected)
            {
                if (_lastClearMatches.TryGetValue(m.Item.Sku, out var existing))
                {
                    _lastClearMatches[m.Item.Sku] = new SkuMatch
                    {
                        Item = existing.Item,
                        MatchedFields = existing.MatchedFields.Concat(m.MatchedFields).Distinct().OrderBy(f => f).ToList(),
                        ProtectedFieldHits = existing.ProtectedFieldHits.Concat(m.ProtectedFieldHits).Distinct().OrderBy(f => f).ToList(),
                    };
                }
                else
                {
                    _lastClearMatches[m.Item.Sku] = m;
                }
            }
            _lastClearFile = dialog.FileName;
            _runFilBtn.Enabled = true;
            _runFilBtn.Text = $"Run FIL step ({Path.GetFileName(dialog.FileName)})";

            Log($"FIL clear file written: {dialog.FileName} ({selected.Count} SKUs, {fieldCount} fields). Audit + checklist saved alongside.");
            MessageBox.Show(this,
                $"FIL clear file created:\n{dialog.FileName}\n\nAlso saved:\n• {Path.GetFileName(auditPath)} (audit trail)\n" +
                $"• {Path.GetFileName(checklistPath)} (scan checklist)\n\n" +
                "Next: load this file with FIL in Eagle (or use \"Run FIL step\" if configured), " +
                "verify the FIL preview matches the counts above, then scan the container and use tab 3.",
                "File created", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException or ArgumentException)
        {
            Error($"Could not create the file:\n{ex.Message}");
        }
    }

    private void SaveChecklist()
    {
        if (_report == null) return;
        _matchGrid.EndEdit();
        var selected = SelectedMatches();
        if (selected.Count == 0)
        {
            Error("No SKUs are checked.");
            return;
        }
        using var dialog = new SaveFileDialog
        {
            Title = "Save scan checklist",
            Filter = "CSV files (*.csv)|*.csv",
            FileName = $"OPTI_{SafeFileToken(string.Join(",", _report.SearchedCodes))}_checklist_{DateTime.Now:yyyyMMdd_HHmmss}.csv",
            InitialDirectory = Directory.Exists(_config.LastOutputFolder) ? _config.LastOutputFolder : "",
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        try
        {
            File.WriteAllText(dialog.FileName, AuditReport.BuildScanChecklistCsv(selected));
            Log($"Scan checklist written: {dialog.FileName}");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Error($"Could not save the checklist:\n{ex.Message}");
        }
    }

    private void RunFilCommand(string filPath)
    {
        if (filPath.Length == 0) return;
        var command = _config.FilLaunchCommand.Trim();
        if (command.Length == 0)
        {
            MessageBox.Show(this,
                "No FIL launch command is configured (Settings tab).\n\n" +
                "Run FIL manually in Eagle and load:\n" + filPath,
                "Manual FIL run", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        var resolved = command.Replace("{file}", "\"" + filPath + "\"");
        var answer = MessageBox.Show(this,
            $"Run this command now?\n\n{resolved}\n\n" +
            "It should open/run your recorded FIL macro. Always verify the FIL preview in Eagle before posting.",
            "Run FIL step", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
        if (answer != DialogResult.Yes) return;

        try
        {
            // /S + outer quotes makes cmd treat the whole command literally,
            // so a quoted executable path plus quoted arguments both survive.
            Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/S /C \"" + resolved + "\"",
                UseShellExecute = true,
            });
            Log($"FIL command launched: {resolved}");
        }
        catch (Exception ex)
        {
            Error($"Could not run the command:\n{ex.Message}");
        }
    }

    private static string SafeFileToken(string text)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var cleaned = new string(text.Select(c => invalid.Contains(c) || c == ',' ? '-' : c).ToArray());
        return cleaned.Length == 0 ? "code" : cleaned;
    }
}
