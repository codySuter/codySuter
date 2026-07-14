using OptiAudit.Core;

namespace OptiAudit.Core.Tests;

public class ValidatorAndConfigTests
{
    private static ColumnMapping FullMapping()
    {
        var m = new ColumnMapping { SkuColumn = 0 };
        for (int i = 0; i < 6; i++) m.LocationColumns[i] = i + 1;
        return m;
    }

    [Fact]
    public void Valid_export_passes()
    {
        var v = ExportValidator.Validate(new[] { new[] { "1001", "54", "", "", "", "", "" } }, FullMapping(), new MatchOptions());
        Assert.True(v.IsUsable);
        Assert.Empty(v.Warnings);
    }

    [Fact]
    public void Missing_searchable_location_column_is_an_error()
    {
        var m = FullMapping();
        m.LocationColumns[4] = -1; // Location 5 missing
        var v = ExportValidator.Validate(new[] { new[] { "1001" } }, m, new MatchOptions());
        Assert.False(v.IsUsable);
        Assert.Contains(v.Errors, e => e.Contains("Location 5"));
    }

    [Fact]
    public void Missing_protected_location_column_is_only_a_warning()
    {
        var m = FullMapping();
        m.LocationColumns[2] = -1; // Location 3 missing
        var v = ExportValidator.Validate(new[] { new[] { "1001", "54", "", "", "", "", "" } }, m, new MatchOptions());
        Assert.True(v.IsUsable);
        Assert.Contains(v.Warnings, w => w.Contains("Location 3"));
    }

    [Fact]
    public void Missing_sku_column_is_an_error()
    {
        var m = FullMapping();
        m.SkuColumn = -1;
        var v = ExportValidator.Validate(new[] { new[] { "x" } }, m, new MatchOptions());
        Assert.False(v.IsUsable);
    }

    [Fact]
    public void Duplicate_column_mapping_is_an_error()
    {
        var m = FullMapping();
        m.DescriptionColumn = 1; // same as Location 1
        var v = ExportValidator.Validate(new[] { new[] { "1001" } }, m, new MatchOptions());
        Assert.False(v.IsUsable);
    }

    [Fact]
    public void Duplicate_skus_and_empty_skus_produce_warnings()
    {
        var rows = new[]
        {
            new[] { "1001", "", "", "", "", "", "" },
            new[] { "1001", "", "", "", "", "", "" },
            new[] { "  ", "", "", "", "", "", "" },
        };
        var v = ExportValidator.Validate(rows, FullMapping(), new MatchOptions());
        Assert.True(v.IsUsable);
        Assert.Contains(v.Warnings, w => w.Contains("more than once"));
        Assert.Contains(v.Warnings, w => w.Contains("empty SKU"));
    }

    [Fact]
    public void Short_rows_produce_a_warning()
    {
        var v = ExportValidator.Validate(new[] { new[] { "1001", "54" } }, FullMapping(), new MatchOptions());
        Assert.True(v.IsUsable);
        Assert.Contains(v.Warnings, w => w.Contains("fewer columns"));
    }

    [Fact]
    public void Empty_export_is_an_error()
    {
        var v = ExportValidator.Validate(Array.Empty<string[]>(), FullMapping(), new MatchOptions());
        Assert.False(v.IsUsable);
    }

    [Fact]
    public void Config_round_trips_through_json()
    {
        var path = Path.Combine(Path.GetTempPath(), $"optiaudit-test-{Guid.NewGuid():N}.json");
        try
        {
            var config = new AppConfig
            {
                CaseInsensitive = false,
                ProtectedFields = new List<int> { 3, 5 },
                IncludeHeaderRow = false,
                IncludeStoreColumn = true,
                FilLaunchCommand = "C:\\eagle\\runfil.cmd {file}",
            };
            config.Save(path);
            var loaded = AppConfig.Load(path);
            Assert.False(loaded.CaseInsensitive);
            Assert.Equal(new List<int> { 3, 5 }, loaded.ProtectedFields);
            Assert.False(loaded.IncludeHeaderRow);
            Assert.True(loaded.IncludeStoreColumn);
            Assert.Equal("C:\\eagle\\runfil.cmd {file}", loaded.FilLaunchCommand);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void Missing_or_corrupt_config_falls_back_to_defaults()
    {
        var missing = AppConfig.Load(Path.Combine(Path.GetTempPath(), $"nope-{Guid.NewGuid():N}.json"));
        Assert.True(missing.CaseInsensitive);
        Assert.Equal(new List<int> { 3 }, missing.ProtectedFields);

        var path = Path.Combine(Path.GetTempPath(), $"optiaudit-corrupt-{Guid.NewGuid():N}.json");
        try
        {
            File.WriteAllText(path, "{not json!!!");
            var corrupt = AppConfig.Load(path);
            Assert.Equal(new List<int> { 3 }, corrupt.ProtectedFields);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void Sanitize_rejects_absurd_protected_field_sets()
    {
        var config = new AppConfig { ProtectedFields = new List<int> { 0, 1, 2, 3, 4, 5, 6, 7, 99 } };
        config.Sanitize();
        Assert.Equal(new List<int> { 3 }, config.ProtectedFields);

        // A list that only contained garbage must fail SAFE (back to Location 3),
        // never silently unprotect everything.
        var config2 = new AppConfig { ProtectedFields = new List<int> { 9, -1 } };
        config2.Sanitize();
        Assert.Equal(new List<int> { 3 }, config2.ProtectedFields);

        // An explicit, deliberate empty choice from the UI is kept (the app warns loudly).
        var config3 = new AppConfig { ProtectedFields = new List<int>() };
        config3.Sanitize();
        Assert.Empty(config3.ProtectedFields);
    }
}
