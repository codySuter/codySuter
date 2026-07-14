using OptiAudit.Core;
using OptiAudit.Core.Model;

namespace OptiAudit.App;

public partial class MainForm
{
    private TextBox _reAddCodeBox = null!;
    private TextBox _scanBox = null!;
    private ComboBox _targetFieldCombo = null!;
    private DataGridView _reAddGrid = null!;
    private TextBox _exceptionsBox = null!;
    private Button _planBtn = null!;
    private Button _generateReAddBtn = null!;
    private Button _runReAddFilBtn = null!;
    private ReAddPlan? _plan;

    /// <summary>The code the current plan was built with. Generation uses THIS, never the live code box.</summary>
    private string _planCode = string.Empty;
    private string _lastReAddFile = string.Empty;

    private TabPage BuildReAddTab()
    {
        var page = new TabPage("3 · Re-Add After Scan");

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 3, Padding = new Padding(10) };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 300));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        var intro = new Label
        {
            AutoSize = true,
            MaximumSize = new Size(1050, 0),
            Text = "After the FIL clear has posted in Eagle, physically scan every SKU in the OPTI container into the box below " +
                   "(one SKU per line — a barcode scanner that sends Enter works directly). " +
                   "This builds the FIL file that puts the OPTI code back on the items actually in the container.",
        };
        layout.Controls.Add(intro, 0, 0);
        layout.SetColumnSpan(intro, 2);

        var leftPanel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4 };
        leftPanel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        leftPanel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        leftPanel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        leftPanel.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        var codePanel = new FlowLayoutPanel { AutoSize = true, WrapContents = false };
        codePanel.Controls.Add(new Label { Text = "OPTI code:", AutoSize = true, Margin = new Padding(0, 8, 4, 0) });
        _reAddCodeBox = new TextBox { Width = 100 };
        codePanel.Controls.Add(_reAddCodeBox);

        var targetPanel = new FlowLayoutPanel { AutoSize = true, WrapContents = false };
        targetPanel.Controls.Add(new Label { Text = "Target field:", AutoSize = true, Margin = new Padding(0, 8, 4, 0) });
        _targetFieldCombo = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 170 };
        targetPanel.Controls.Add(_targetFieldCombo);

        _scanBox = new TextBox
        {
            Dock = DockStyle.Fill,
            Multiline = true,
            ScrollBars = ScrollBars.Vertical,
            AcceptsReturn = true,
            Font = new Font(FontFamily.GenericMonospace, 10f),
        };

        _planBtn = new Button { Text = "Plan re-add", AutoSize = true };
        _planBtn.Click += (_, _) => PlanReAdd();

        leftPanel.Controls.Add(codePanel, 0, 0);
        leftPanel.Controls.Add(targetPanel, 0, 1);
        leftPanel.Controls.Add(_scanBox, 0, 2);
        leftPanel.Controls.Add(_planBtn, 0, 3);

        var rightPanel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2 };
        rightPanel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        rightPanel.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        _reAddGrid = new DataGridView
        {
            Dock = DockStyle.Fill,
            AllowUserToAddRows = false,
            AllowUserToDeleteRows = false,
            RowHeadersVisible = false,
            SelectionMode = DataGridViewSelectionMode.FullRowSelect,
            AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.None,
        };
        _reAddGrid.Columns.Add(new DataGridViewCheckBoxColumn { HeaderText = "Write", Name = "colWrite", Width = 46 });
        _reAddGrid.Columns.Add(MakeTextColumn("SKU", 110));
        _reAddGrid.Columns.Add(MakeTextColumn("Description", 230));
        _reAddGrid.Columns.Add(MakeTextColumn("Target", 90));
        _reAddGrid.Columns.Add(MakeTextColumn("Current value", 110));
        _reAddGrid.Columns.Add(MakeTextColumn("Status", 260));

        _exceptionsBox = new TextBox
        {
            Dock = DockStyle.Top,
            Multiline = true,
            ReadOnly = true,
            Height = 60,
            ScrollBars = ScrollBars.Vertical,
            ForeColor = Color.Firebrick,
        };

        rightPanel.Controls.Add(_reAddGrid, 0, 0);
        rightPanel.Controls.Add(_exceptionsBox, 0, 1);

        layout.Controls.Add(leftPanel, 0, 1);
        layout.Controls.Add(rightPanel, 1, 1);

        var generatePanel = new FlowLayoutPanel { AutoSize = true, WrapContents = false };
        _generateReAddBtn = new Button { Text = "Generate FIL re-add file…", AutoSize = true, Enabled = false, Font = new Font(Font, FontStyle.Bold) };
        _generateReAddBtn.Click += (_, _) => GenerateReAddFile();
        _runReAddFilBtn = new Button { Text = "Run FIL step", AutoSize = true, Enabled = false };
        _runReAddFilBtn.Click += (_, _) => RunFilCommand(_lastReAddFile);
        generatePanel.Controls.AddRange(new Control[] { _generateReAddBtn, _runReAddFilBtn });
        layout.Controls.Add(generatePanel, 0, 2);
        layout.SetColumnSpan(generatePanel, 2);

        // A plan is only valid for the exact inputs it was computed from: any
        // edit to the code, the scan list, or the target field forces a re-plan.
        _reAddCodeBox.TextChanged += (_, _) => InvalidateReAddPlan();
        _scanBox.TextChanged += (_, _) => InvalidateReAddPlan();
        _targetFieldCombo.SelectedIndexChanged += (_, _) => InvalidateReAddPlan();

        page.Controls.Add(layout);
        return page;
    }

    /// <summary>Drops the current re-add plan; the Generate button stays disabled until a fresh plan is made.</summary>
    private void InvalidateReAddPlan()
    {
        if (_generateReAddBtn == null) return; // during construction
        _generateReAddBtn.Enabled = false;
        if (_plan == null && _reAddGrid.Rows.Count == 0) return;
        _plan = null;
        _planCode = string.Empty;
        _reAddGrid.Rows.Clear();
        _exceptionsBox.Text = string.Empty;
    }

    /// <summary>Rebuilds the target-field choices from the configured protected fields.</summary>
    private void RefreshTargetFieldCombo()
    {
        var options = CurrentMatchOptions;
        _targetFieldCombo.Items.Clear();
        _targetFieldCombo.Items.Add("Auto (recommended)");
        foreach (var field in options.SearchableFields())
            _targetFieldCombo.Items.Add($"Location {field}");
        _targetFieldCombo.SelectedIndex = 0;
    }

    private int SelectedTargetField()
    {
        if (_targetFieldCombo.SelectedIndex <= 0) return ReAddPlanner.AutoTargetField;
        var text = (string)_targetFieldCombo.SelectedItem!;
        return int.Parse(text.Replace("Location ", ""));
    }

    private void PlanReAdd()
    {
        if (_items == null)
        {
            Error("Load and validate a Compass export first (tab 1). The export is needed to pick safe target fields.");
            return;
        }
        var code = _reAddCodeBox.Text.Trim();
        var codeError = LocationMatcher.ValidateCode(code);
        if (codeError != null)
        {
            Error(codeError);
            return;
        }

        var scans = _scanBox.Lines.ToList();
        if (scans.All(string.IsNullOrWhiteSpace))
        {
            Error("Scan or type at least one SKU.");
            return;
        }

        var options = CurrentMatchOptions;
        var cleared = _lastClearCodes.Contains(code, StringComparer.OrdinalIgnoreCase)
            ? _lastClearMatches
            : new Dictionary<string, SkuMatch>(StringComparer.OrdinalIgnoreCase);

        _plan = ReAddPlanner.Plan(scans, _items, cleared, code, SelectedTargetField(), options);
        _planCode = code;

        _reAddGrid.SuspendLayout();
        _reAddGrid.Rows.Clear();
        foreach (var entry in _plan.Ready)
        {
            int i = _reAddGrid.Rows.Add(true, entry.Item.Sku, entry.Item.Description,
                "Loc " + entry.TargetField,
                entry.ExistingValue.Length == 0 ? "(empty)" : entry.ExistingValue,
                "Ready");
            _reAddGrid.Rows[i].Tag = entry;
        }
        foreach (var entry in _plan.Conflicts)
        {
            int i = _reAddGrid.Rows.Add(false, entry.Item.Sku, entry.Item.Description,
                "Loc " + entry.TargetField,
                entry.ExistingValue,
                $"CONFLICT — would overwrite \"{entry.ExistingValue}\"");
            var row = _reAddGrid.Rows[i];
            row.Tag = entry;
            row.DefaultCellStyle.ForeColor = Color.Firebrick;
        }
        _reAddGrid.ResumeLayout();

        _exceptionsBox.Text = _plan.Exceptions.Count == 0
            ? string.Empty
            : "Needs manual attention (NOT in the FIL file): " +
              string.Join("   ", _plan.Exceptions.Select(e => $"{e.ScannedSku}: {e.Reason}"));

        _generateReAddBtn.Enabled = _plan.Ready.Count + _plan.Conflicts.Count > 0;
        Log($"Re-add plan for OPTI {code}: {_plan.Ready.Count} ready, {_plan.Conflicts.Count} conflict(s), {_plan.Exceptions.Count} exception(s).");
    }

    private void GenerateReAddFile()
    {
        if (_plan == null || _planCode.Length == 0) return;
        _reAddGrid.EndEdit();

        // The plan snapshot is authoritative. The live code box cannot differ
        // (editing it drops the plan), but this gate must not rest on UI wiring.
        var code = _planCode;
        if (!string.Equals(_reAddCodeBox.Text.Trim(), code, StringComparison.OrdinalIgnoreCase))
        {
            Error("The OPTI code was changed after planning. Click \"Plan re-add\" again.");
            InvalidateReAddPlan();
            return;
        }

        if (_config.IncludeStoreColumn && (_mapping?.StoreColumn ?? -1) < 0 &&
            MessageBox.Show(this,
                "Settings include a Store column in FIL files, but no Store column is mapped — Store cells will be blank.\n\nContinue anyway?",
                "Store column not mapped", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes)
        {
            return;
        }

        var selected = new List<ReAddEntry>();
        int forcedOverwrites = 0;
        foreach (DataGridViewRow row in _reAddGrid.Rows)
        {
            if (row.Tag is ReAddEntry entry && Convert.ToBoolean(row.Cells["colWrite"].Value ?? false))
            {
                selected.Add(entry);
                if (entry.OverwritesExistingValue) forcedOverwrites++;
            }
        }
        if (selected.Count == 0)
        {
            Error("No rows are checked — nothing to write.");
            return;
        }

        if (forcedOverwrites > 0)
        {
            bool confirmed = ConfirmDialog.Show(this,
                "Confirm overwrites",
                $"{forcedOverwrites} checked row(s) will OVERWRITE an existing location value with {code}.\n\n" +
                $"Type the OPTI code ({code}) to confirm:",
                code);
            if (!confirmed) return;
        }
        else
        {
            var answer = MessageBox.Show(this,
                $"Create a FIL file that writes {code} onto {selected.Count} SKU(s)?",
                "Confirm FIL re-add file", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (answer != DialogResult.Yes) return;
        }

        using var dialog = new SaveFileDialog
        {
            Title = "Save FIL re-add file",
            Filter = "CSV files (*.csv)|*.csv",
            FileName = $"FIL_READD_OPTI_{SafeFileToken(code)}_{DateTime.Now:yyyyMMdd_HHmmss}.csv",
            InitialDirectory = Directory.Exists(_config.LastOutputFolder) ? _config.LastOutputFolder : "",
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        _config.LastOutputFolder = Path.GetDirectoryName(dialog.FileName) ?? "";

        try
        {
            var options = CurrentMatchOptions;
            var rows = FilExportBuilder.BuildReAddRows(selected, code, options, _config.FilFileOptions);
            File.WriteAllText(dialog.FileName, FilExportBuilder.ToCsvText(rows));

            var auditPath = Path.ChangeExtension(dialog.FileName, null) + "_audit.txt";
            File.WriteAllText(auditPath, AuditReport.BuildReAddAudit(
                DateTime.Now, code, selected, _plan.Exceptions, dialog.FileName));

            _lastReAddFile = dialog.FileName;
            _runReAddFilBtn.Enabled = true;
            _runReAddFilBtn.Text = $"Run FIL step ({Path.GetFileName(dialog.FileName)})";

            Log($"FIL re-add file written: {dialog.FileName} ({selected.Count} SKUs). Audit saved alongside.");
            MessageBox.Show(this,
                $"FIL re-add file created:\n{dialog.FileName}\n\nLoad it with FIL in Eagle and verify the preview before posting." +
                (_plan.Exceptions.Count > 0 ? $"\n\nREMINDER: {_plan.Exceptions.Count} scanned SKU(s) need manual attention — see the audit file." : ""),
                "File created", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException or ArgumentException)
        {
            Error($"Could not create the file:\n{ex.Message}");
        }
    }
}
