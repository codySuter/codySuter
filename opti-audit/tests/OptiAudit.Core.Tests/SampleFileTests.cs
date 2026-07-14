using OptiAudit.Core;
using OptiAudit.Core.Csv;

namespace OptiAudit.Core.Tests;

/// <summary>
/// Runs the shipped sample export through the real pipeline, so the file the
/// README tells users to dry-run with is guaranteed to behave as documented.
/// </summary>
public class SampleFileTests
{
    private static string FindSampleFile()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (int i = 0; i < 8 && dir != null; i++, dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "samples", "compass_export_sample.csv");
            if (File.Exists(candidate)) return candidate;
        }
        throw new FileNotFoundException("samples/compass_export_sample.csv not found above " + AppContext.BaseDirectory);
    }

    [Fact]
    public void Sample_export_behaves_exactly_as_the_readme_describes()
    {
        var records = CsvFile.ParseFile(FindSampleFile());
        var mapping = ColumnMapper.AutoDetect(records[0]);
        var dataRows = records.Skip(1).ToList();
        var options = new MatchOptions();

        var validation = ExportValidator.Validate(dataRows, mapping, options);
        Assert.True(validation.IsUsable, string.Join("; ", validation.Errors));

        var items = ColumnMapper.BuildItems(dataRows, mapping);
        var report = LocationMatcher.FindMatches(items, new[] { "54" }, options);

        Assert.Equal(new[] { "100200", "100201", "100204", "100206" },
            report.Matches.Select(m => m.Item.Sku).ToArray());
        Assert.Equal(new[] { "100203" },
            report.ProtectedOnlyMatches.Select(m => m.Item.Sku).ToArray());
        Assert.DoesNotContain(report.Matches, m => m.Item.Sku == "100202"); // "540" must not match "54"
    }
}
