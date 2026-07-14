using OptiAudit.Core.Model;

namespace OptiAudit.App;

public partial class MainForm
{
    private CheckBox _caseInsensitiveCheck = null!;
    private CheckBox _headerRowCheck = null!;
    private CheckBox _storeColumnCheck = null!;
    private readonly CheckBox[] _protectedChecks = new CheckBox[6];
    private TextBox _filCommandBox = null!;
    private Label _protectedWarning = null!;

    private TabPage BuildSettingsTab()
    {
        var page = new TabPage("Settings");

        var matchGroup = new GroupBox { Text = "Matching", AutoSize = true, Padding = new Padding(10) };
        var matchLayout = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, Dock = DockStyle.Fill, WrapContents = false };
        _caseInsensitiveCheck = new CheckBox
        {
            Text = "Case-insensitive comparison (recommended — Eagle locations are usually uppercase)",
            AutoSize = true,
            Checked = true,
        };
        matchLayout.Controls.Add(_caseInsensitiveCheck);
        matchLayout.Controls.Add(new Label
        {
            Text = "Matching is always whole-field and whitespace-trimmed. \"54\" never matches \"540\", \"154\" or \"54A\".",
            AutoSize = true,
            ForeColor = SystemColors.GrayText,
        });
        matchGroup.Controls.Add(matchLayout);

        var protectedGroup = new GroupBox { Text = "Protected location fields (never searched, never cleared, never written)", AutoSize = true, Padding = new Padding(10) };
        var protectedLayout = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, WrapContents = false, FlowDirection = FlowDirection.TopDown };
        var checksRow = new FlowLayoutPanel { AutoSize = true, WrapContents = false };
        for (int f = 1; f <= ItemRecord.LocationFieldCount; f++)
        {
            _protectedChecks[f - 1] = new CheckBox { Text = "Location " + f, AutoSize = true, Margin = new Padding(0, 0, 14, 0) };
            checksRow.Controls.Add(_protectedChecks[f - 1]);
        }
        _protectedWarning = new Label { AutoSize = true, ForeColor = Color.Firebrick, Text = "" };
        protectedLayout.Controls.Add(checksRow);
        protectedLayout.Controls.Add(new Label
        {
            Text = "Default: Location 3 (shelf capacity). Changing this affects searching, clearing and re-adding.",
            AutoSize = true,
            ForeColor = SystemColors.GrayText,
        });
        protectedLayout.Controls.Add(_protectedWarning);
        protectedGroup.Controls.Add(protectedLayout);

        var fileGroup = new GroupBox { Text = "FIL file format", AutoSize = true, Padding = new Padding(10) };
        var fileLayout = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, Dock = DockStyle.Fill, WrapContents = false };
        _headerRowCheck = new CheckBox { Text = "Include a header row (SKU, Location 1 … Location 6) in generated files", AutoSize = true, Checked = true };
        _storeColumnCheck = new CheckBox { Text = "Include a Store column (only if your export has one and FIL needs it)", AutoSize = true };
        fileLayout.Controls.Add(_headerRowCheck);
        fileLayout.Controls.Add(_storeColumnCheck);
        fileGroup.Controls.Add(fileLayout);

        var runGroup = new GroupBox { Text = "Run FIL step (optional automation)", AutoSize = true, Padding = new Padding(10) };
        var runLayout = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, Dock = DockStyle.Fill, WrapContents = false };
        runLayout.Controls.Add(new Label
        {
            AutoSize = true,
            MaximumSize = new Size(1000, 0),
            Text = "Command to run after a FIL file is generated. {file} is replaced with the CSV path.\n" +
                   "Point it at a macro/script recorded on this Eagle workstation (see README for options).\n" +
                   "Leave empty to run FIL manually in Eagle — the app then shows you the file path to load.",
        });
        _filCommandBox = new TextBox { Width = 700 };
        runLayout.Controls.Add(_filCommandBox);
        runGroup.Controls.Add(runLayout);

        var saveBtn = new Button { Text = "Save settings", AutoSize = true, Font = new Font(Font, FontStyle.Bold), Margin = new Padding(0, 12, 0, 0) };
        saveBtn.Click += (_, _) => SaveSettingsFromUi();

        var stack = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, Dock = DockStyle.Fill, AutoScroll = true, WrapContents = false, Padding = new Padding(10) };
        stack.Controls.AddRange(new Control[] { matchGroup, protectedGroup, fileGroup, runGroup, saveBtn });
        page.Controls.Add(stack);
        return page;
    }

    private void RefreshSettingsUi()
    {
        _caseInsensitiveCheck.Checked = _config.CaseInsensitive;
        _headerRowCheck.Checked = _config.IncludeHeaderRow;
        _storeColumnCheck.Checked = _config.IncludeStoreColumn;
        _filCommandBox.Text = _config.FilLaunchCommand;
        for (int f = 1; f <= ItemRecord.LocationFieldCount; f++)
            _protectedChecks[f - 1].Checked = _config.ProtectedFields.Contains(f);
        UpdateProtectedWarning();
        RefreshTargetFieldCombo();
    }

    private void UpdateProtectedWarning()
    {
        int count = _protectedChecks.Count(c => c.Checked);
        _protectedWarning.Text = count == 0
            ? "WARNING: no protected fields — every location field can be searched and cleared."
            : "";
    }

    private void SaveSettingsFromUi()
    {
        var newProtected = new List<int>();
        for (int f = 1; f <= ItemRecord.LocationFieldCount; f++)
            if (_protectedChecks[f - 1].Checked)
                newProtected.Add(f);

        if (newProtected.Count >= ItemRecord.LocationFieldCount)
        {
            Error("You cannot protect ALL six location fields — the tool would have nothing to search.");
            return;
        }

        bool matchingChanged =
            _config.CaseInsensitive != _caseInsensitiveCheck.Checked ||
            !_config.ProtectedFields.SequenceEqual(newProtected);

        _config.CaseInsensitive = _caseInsensitiveCheck.Checked;
        _config.ProtectedFields = newProtected;
        _config.IncludeHeaderRow = _headerRowCheck.Checked;
        _config.IncludeStoreColumn = _storeColumnCheck.Checked;
        _config.FilLaunchCommand = _filCommandBox.Text.Trim();
        _config.Sanitize();
        TrySaveConfig();

        UpdateProtectedWarning();
        RefreshTargetFieldCombo();
        Log("Settings saved." + (newProtected.Count == 0 ? " WARNING: no location fields are protected." : $" Protected: Location {string.Join(", Location ", newProtected)}."));

        if (matchingChanged)
        {
            InvalidateSearch("matching settings changed.");
            if (_headers.Length > 0) ApplyMapping();
        }
    }
}
