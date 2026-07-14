using OptiAudit.Core;
using OptiAudit.Core.Csv;

namespace OptiAudit.App;

public partial class MainForm
{
    private TextBox _exportPathBox = null!;
    private ComboBox _skuCombo = null!;
    private ComboBox _descCombo = null!;
    private ComboBox _storeCombo = null!;
    private readonly ComboBox[] _locCombos = new ComboBox[6];
    private ListBox _validationList = null!;
    private Label _loadStatus = null!;
    private Button _applyMappingBtn = null!;
    private bool _suppressMappingEvents;

    private const string NotMapped = "(not mapped)";

    private TabPage BuildLoadTab()
    {
        var page = new TabPage("1 · Load Export");

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4, Padding = new Padding(10) };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        var intro = new Label
        {
            AutoSize = true,
            MaximumSize = new Size(1050, 0),
            Text = "Export all SKUs with their location fields from Compass (CSV format), then load that file here.\n" +
                   "The export must include the SKU/Item column and ALL of Location 1, 2, 4, 5, 6 " +
                   "(Location 3 is optional — it is protected and never touched).",
        };

        var filePanel = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = new Padding(0, 8, 0, 8) };
        _exportPathBox = new TextBox { Width = 640, ReadOnly = true };
        var browseBtn = new Button { Text = "Browse…", AutoSize = true };
        var reloadBtn = new Button { Text = "Reload file", AutoSize = true };
        browseBtn.Click += (_, _) => BrowseExport();
        reloadBtn.Click += (_, _) => { if (_exportPath.Length > 0) LoadExport(_exportPath); };
        filePanel.Controls.AddRange(new Control[] { _exportPathBox, browseBtn, reloadBtn });

        var mapGroup = new GroupBox { Text = "Column mapping (auto-detected — verify before searching)", AutoSize = true, Dock = DockStyle.Top };
        var mapLayout = new TableLayoutPanel { AutoSize = true, ColumnCount = 6, Padding = new Padding(6) };

        _skuCombo = MakeMappingCombo();
        _descCombo = MakeMappingCombo();
        _storeCombo = MakeMappingCombo();
        AddMappingRow(mapLayout, 0, "SKU / Item (required):", _skuCombo, "Description:", _descCombo, "Store:", _storeCombo);

        for (int i = 0; i < 6; i++) _locCombos[i] = MakeMappingCombo();
        AddMappingRow(mapLayout, 1, "Location 1:", _locCombos[0], "Location 2:", _locCombos[1], "Location 3 (protected):", _locCombos[2]);
        AddMappingRow(mapLayout, 2, "Location 4:", _locCombos[3], "Location 5:", _locCombos[4], "Location 6:", _locCombos[5]);

        _applyMappingBtn = new Button { Text = "Apply mapping && validate", AutoSize = true, Enabled = false, Margin = new Padding(6) };
        _applyMappingBtn.Click += (_, _) => ApplyMapping();
        foreach (var combo in AllMappingCombos())
            combo.SelectedIndexChanged += (_, _) => OnMappingComboEdited();
        mapLayout.Controls.Add(_applyMappingBtn, 0, 3);
        mapLayout.SetColumnSpan(_applyMappingBtn, 2);
        mapGroup.Controls.Add(mapLayout);

        var resultPanel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2 };
        resultPanel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        resultPanel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        _loadStatus = new Label { AutoSize = true, Font = new Font(Font, FontStyle.Bold), Text = "No export loaded." };
        _validationList = new ListBox { Dock = DockStyle.Fill, IntegralHeight = false };
        resultPanel.Controls.Add(_loadStatus, 0, 0);
        resultPanel.Controls.Add(_validationList, 0, 1);

        layout.Controls.Add(intro, 0, 0);
        layout.Controls.Add(filePanel, 0, 1);
        layout.Controls.Add(mapGroup, 0, 2);
        layout.Controls.Add(resultPanel, 0, 3);
        page.Controls.Add(layout);
        return page;
    }

    private static ComboBox MakeMappingCombo() => new()
    {
        DropDownStyle = ComboBoxStyle.DropDownList,
        Width = 190,
        Margin = new Padding(3),
    };

    private static void AddMappingRow(TableLayoutPanel table, int row, params object[] labelComboPairs)
    {
        for (int i = 0; i < labelComboPairs.Length; i += 2)
        {
            table.Controls.Add(new Label { Text = (string)labelComboPairs[i], AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(3, 8, 3, 3) }, i, row);
            table.Controls.Add((Control)labelComboPairs[i + 1], i + 1, row);
        }
    }

    private void BrowseExport()
    {
        using var dialog = new OpenFileDialog
        {
            Title = "Open Compass export",
            Filter = "CSV files (*.csv)|*.csv|All files (*.*)|*.*",
            InitialDirectory = Directory.Exists(_config.LastExportFolder) ? _config.LastExportFolder : "",
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        _config.LastExportFolder = Path.GetDirectoryName(dialog.FileName) ?? "";
        LoadExport(dialog.FileName);
    }

    private void LoadExport(string path)
    {
        try
        {
            Cursor = Cursors.WaitCursor;
            var records = CsvFile.ParseFile(path);
            if (records.Count < 2)
            {
                Error("The file has no data rows (a header row plus at least one item row is required).");
                return;
            }

            _exportPath = path;
            _exportSha256 = AuditReport.Sha256OfFile(path);
            _headers = records[0];
            _dataRows = records.Skip(1).ToList();
            _exportPathBox.Text = path;

            PopulateMappingCombos();
            var auto = ColumnMapper.AutoDetect(_headers);
            SetCombosFromMapping(auto);
            _applyMappingBtn.Enabled = true;

            Log($"Loaded {Path.GetFileName(path)}: {_dataRows.Count} data rows, {_headers.Length} columns. SHA-256 {_exportSha256[..12]}…");
            ApplyMapping();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or FormatException)
        {
            Error($"Could not read the file:\n{ex.Message}");
        }
        finally
        {
            Cursor = Cursors.Default;
        }
    }

    /// <summary>An edited (but not yet applied) mapping makes every derived result untrustworthy.</summary>
    private void OnMappingComboEdited()
    {
        if (_suppressMappingEvents || _headers.Length == 0 || _mapping == null) return;
        _mapping = null;
        _items = null;
        _loadStatus.Text = "Mapping edited — click \"Apply mapping & validate\" before searching.";
        InvalidateSearch("the column mapping was edited but not yet applied.");
    }

    private void PopulateMappingCombos()
    {
        var choices = new List<string> { NotMapped };
        for (int i = 0; i < _headers.Length; i++)
            choices.Add($"{i + 1}: {_headers[i]}");

        _suppressMappingEvents = true;
        try
        {
            foreach (var combo in AllMappingCombos())
            {
                combo.Items.Clear();
                combo.Items.AddRange(choices.Cast<object>().ToArray());
                combo.SelectedIndex = 0;
            }
        }
        finally
        {
            _suppressMappingEvents = false;
        }
    }

    private IEnumerable<ComboBox> AllMappingCombos()
    {
        yield return _skuCombo;
        yield return _descCombo;
        yield return _storeCombo;
        foreach (var c in _locCombos) yield return c;
    }

    private void SetCombosFromMapping(ColumnMapping mapping)
    {
        _suppressMappingEvents = true;
        try
        {
            _skuCombo.SelectedIndex = mapping.SkuColumn + 1;
            _descCombo.SelectedIndex = mapping.DescriptionColumn + 1;
            _storeCombo.SelectedIndex = mapping.StoreColumn + 1;
            for (int i = 0; i < 6; i++)
                _locCombos[i].SelectedIndex = mapping.LocationColumns[i] + 1;
        }
        finally
        {
            _suppressMappingEvents = false;
        }
    }

    private ColumnMapping MappingFromCombos()
    {
        var mapping = new ColumnMapping
        {
            SkuColumn = _skuCombo.SelectedIndex - 1,
            DescriptionColumn = _descCombo.SelectedIndex - 1,
            StoreColumn = _storeCombo.SelectedIndex - 1,
        };
        for (int i = 0; i < 6; i++)
            mapping.LocationColumns[i] = _locCombos[i].SelectedIndex - 1;
        return mapping;
    }

    private void ApplyMapping()
    {
        if (_headers.Length == 0) return;

        var mapping = MappingFromCombos();
        var validation = ExportValidator.Validate(_dataRows, mapping, CurrentMatchOptions);

        _validationList.Items.Clear();
        foreach (var error in validation.Errors) _validationList.Items.Add("ERROR: " + error);
        foreach (var warning in validation.Warnings) _validationList.Items.Add("Warning: " + warning);
        if (_validationList.Items.Count == 0) _validationList.Items.Add("No problems found.");

        if (!validation.IsUsable)
        {
            _mapping = null;
            _items = null;
            _loadStatus.Text = "Export NOT usable — fix the mapping errors above.";
            InvalidateSearch("the column mapping changed.");
            return;
        }

        _mapping = mapping;
        _items = ColumnMapper.BuildItems(_dataRows, mapping);
        _loadStatus.Text = $"Export ready: {_items.Count} rows. Go to tab 2 to search for an OPTI.";
        Log($"Mapping applied. {_items.Count} item rows ready to search.");
        InvalidateSearch("a new export/mapping was applied.");
        _lastClearCodes = new List<string>();
        _lastClearMatches = new Dictionary<string, SkuMatch>(StringComparer.OrdinalIgnoreCase);
    }
}
