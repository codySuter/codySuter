using System.Text.Json;
using System.Text.Json.Serialization;

namespace OptiAudit.Core;

/// <summary>Persisted user settings (stored as JSON under %APPDATA%\OptiAudit).</summary>
public sealed class AppConfig
{
    public bool CaseInsensitive { get; set; } = true;

    /// <summary>Location fields that are never searched or cleared. Default: 3 (shelf capacity).</summary>
    public List<int> ProtectedFields { get; set; } = new() { 3 };

    public bool IncludeHeaderRow { get; set; } = true;

    public bool IncludeStoreColumn { get; set; }

    /// <summary>
    /// Optional command line used by the "Run FIL step" button, with {file}
    /// replaced by the generated CSV path. Typically points at a macro or
    /// script recorded on the Eagle workstation. Empty = manual FIL run.
    /// </summary>
    public string FilLaunchCommand { get; set; } = string.Empty;

    public string LastExportFolder { get; set; } = string.Empty;

    public string LastOutputFolder { get; set; } = string.Empty;

    [JsonIgnore]
    public MatchOptions MatchOptions => new()
    {
        CaseInsensitive = CaseInsensitive,
        ProtectedFields = new HashSet<int>(ProtectedFields),
    };

    [JsonIgnore]
    public FilFileOptions FilFileOptions => new()
    {
        IncludeHeader = IncludeHeaderRow,
        IncludeStoreColumn = IncludeStoreColumn,
    };

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        AllowTrailingCommas = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
    };

    public static AppConfig Load(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                var config = JsonSerializer.Deserialize<AppConfig>(File.ReadAllText(path), JsonOptions);
                if (config != null)
                {
                    config.Sanitize();
                    return config;
                }
            }
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            // Corrupt/unreadable config falls back to defaults; never blocks startup.
        }
        return new AppConfig();
    }

    public void Save(string path)
    {
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        File.WriteAllText(path, JsonSerializer.Serialize(this, JsonOptions));
    }

    /// <summary>Keeps loaded settings inside safe bounds no matter what the JSON contained.</summary>
    public void Sanitize()
    {
        int rawCount = ProtectedFields?.Count ?? 0;
        ProtectedFields = (ProtectedFields ?? new List<int>())
            .Where(f => f >= 1 && f <= Model.ItemRecord.LocationFieldCount)
            .Distinct()
            .OrderBy(f => f)
            .ToList();
        // A corrupt list must fail SAFE: invalid entries that would silently
        // unprotect everything, or protecting all six fields (a no-op tool),
        // both reset to the default. An explicit empty list from the UI stays
        // empty — the app warns loudly about that state instead.
        if ((rawCount > 0 && ProtectedFields.Count == 0) ||
            ProtectedFields.Count >= Model.ItemRecord.LocationFieldCount)
        {
            ProtectedFields = new List<int> { 3 };
        }
        FilLaunchCommand ??= string.Empty;
        LastExportFolder ??= string.Empty;
        LastOutputFolder ??= string.Empty;
    }
}
