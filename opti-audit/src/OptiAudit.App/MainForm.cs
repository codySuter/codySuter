using OptiAudit.Core;
using OptiAudit.Core.Model;

namespace OptiAudit.App;

/// <summary>
/// OptiAudit main window. Workflow (left tab to right tab):
///   1. Load a Compass export of SKUs + location fields.
///   2. Search for the OPTI code in Locations 1, 2, 4, 5, 6 and generate the
///      FIL clear file ("?" in each matched field).
///   3. After physically rescanning the container, generate the FIL re-add file.
/// All data logic lives in OptiAudit.Core and is unit-tested; this class is UI wiring only.
/// </summary>
public partial class MainForm : Form
{
    private readonly AppConfig _config;

    // Loaded export
    private string _exportPath = string.Empty;
    private string _exportSha256 = string.Empty;
    private string[] _headers = Array.Empty<string>();
    private List<string[]> _dataRows = new();
    private ColumnMapping? _mapping;
    private List<ItemRecord>? _items;

    // Current search
    private MatchReport? _report;

    // Most recent generated clear file (drives re-add auto-targeting)
    private List<string> _lastClearCodes = new();
    private Dictionary<string, SkuMatch> _lastClearMatches = new(StringComparer.OrdinalIgnoreCase);
    private string _lastClearFile = string.Empty;

    private TabControl _tabs = null!;
    private TextBox _logBox = null!;

    private static string ConfigPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "OptiAudit", "config.json");

    public MainForm()
    {
        _config = AppConfig.Load(ConfigPath);

        Text = "OptiAudit — Eagle OPTI Location Auditor";
        MinimumSize = new Size(1000, 700);
        Size = new Size(1150, 780);
        StartPosition = FormStartPosition.CenterScreen;

        _tabs = new TabControl { Dock = DockStyle.Fill };
        _tabs.TabPages.Add(BuildLoadTab());
        _tabs.TabPages.Add(BuildClearTab());
        _tabs.TabPages.Add(BuildReAddTab());
        _tabs.TabPages.Add(BuildSettingsTab());

        _logBox = new TextBox
        {
            Dock = DockStyle.Fill,
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            Font = new Font(FontFamily.GenericMonospace, 8.5f),
            BackColor = SystemColors.Window,
        };
        var logGroup = new GroupBox { Text = "Session log", Dock = DockStyle.Bottom, Height = 130, Padding = new Padding(6) };
        logGroup.Controls.Add(_logBox);

        Controls.Add(_tabs);
        Controls.Add(logGroup);

        FormClosing += (_, _) => TrySaveConfig();
        Log("OptiAudit started. Load a Compass export to begin.");
        RefreshSettingsUi();
    }

    private MatchOptions CurrentMatchOptions => _config.MatchOptions;

    private void Log(string message)
    {
        var line = $"[{DateTime.Now:HH:mm:ss}] {message}";
        _logBox.AppendText(line + Environment.NewLine);
    }

    private void TrySaveConfig()
    {
        try
        {
            _config.Save(ConfigPath);
        }
        catch (Exception ex)
        {
            // Settings persistence must never block using the tool.
            Log($"Could not save settings: {ex.Message}");
        }
    }

    private static void Error(string message) =>
        MessageBox.Show(message, "OptiAudit", MessageBoxButtons.OK, MessageBoxIcon.Warning);

    /// <summary>
    /// Search results and re-add plans depend on the export + mapping + options;
    /// drop ALL derived state when any of those change.
    /// </summary>
    private void InvalidateSearch(string reason)
    {
        InvalidateReAddPlan();
        _runFilBtn.Enabled = false;
        _runFilBtn.Text = "Run FIL step";
        _runReAddFilBtn.Enabled = false;
        _runReAddFilBtn.Text = "Run FIL step";
        if (_report == null && _matchGrid.Rows.Count == 0) return;
        _report = null;
        _matchGrid.Rows.Clear();
        _searchSummary.Text = "No search yet.";
        _protectedWarnBox.Text = string.Empty;
        _generateClearBtn.Enabled = false;
        _saveChecklistBtn.Enabled = false;
        Log($"Search results cleared: {reason} Re-run the search.");
    }
}
