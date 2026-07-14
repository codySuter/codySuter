namespace OptiAudit.App;

/// <summary>
/// Type-to-confirm gate used before generating any file that changes inventory
/// data. The OK button stays disabled until the user types the expected text.
/// Layout is fully auto-sized so it never clips at high DPI or long messages.
/// </summary>
public sealed class ConfirmDialog : Form
{
    private readonly TextBox _input;
    private readonly Button _okButton;
    private readonly string _expected;

    private ConfirmDialog(string title, string message, string expected)
    {
        _expected = expected;

        Text = title;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.CenterParent;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        AutoScaleMode = AutoScaleMode.Font;

        var layout = new TableLayoutPanel
        {
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            ColumnCount = 1,
            Dock = DockStyle.Fill,
            Padding = new Padding(14),
        };

        var messageLabel = new Label
        {
            Text = message,
            AutoSize = true,
            MaximumSize = new Size(520, 0),
            Margin = new Padding(0, 0, 0, 12),
        };

        _input = new TextBox
        {
            Width = 520,
            Font = new Font(FontFamily.GenericSansSerif, 11f),
            Margin = new Padding(0, 0, 0, 12),
        };
        _input.TextChanged += (_, _) => _okButton!.Enabled = Matches();

        var buttons = new FlowLayoutPanel
        {
            AutoSize = true,
            FlowDirection = FlowDirection.RightToLeft,
            Anchor = AnchorStyles.Right,
            WrapContents = false,
        };
        var cancelButton = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, AutoSize = true };
        _okButton = new Button { Text = "Create file", DialogResult = DialogResult.OK, Enabled = false, AutoSize = true };
        buttons.Controls.Add(cancelButton);
        buttons.Controls.Add(_okButton);

        layout.Controls.Add(messageLabel);
        layout.Controls.Add(_input);
        layout.Controls.Add(buttons);
        Controls.Add(layout);

        AcceptButton = _okButton;
        CancelButton = cancelButton;
    }

    private bool Matches() =>
        string.Equals(_input.Text.Trim(), _expected.Trim(), StringComparison.OrdinalIgnoreCase);

    public static bool Show(IWin32Window owner, string title, string message, string expectedText)
    {
        using var dialog = new ConfirmDialog(title, message, expectedText);
        return dialog.ShowDialog(owner) == DialogResult.OK && dialog.Matches();
    }
}
