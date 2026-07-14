using OptiAudit.Core;
using OptiAudit.Core.Csv;
using static OptiAudit.Core.Tests.TestData;

namespace OptiAudit.Core.Tests;

public class FilExportBuilderTests
{
    private static readonly MatchOptions Match = new();
    private static readonly FilFileOptions File = new();

    private static List<SkuMatch> MatchesFor(string code, params Model.ItemRecord[] items)
        => LocationMatcher.FindMatches(items, new[] { code }, Match).Matches.ToList();

    [Fact]
    public void Clear_rows_put_question_marks_exactly_on_matched_fields()
    {
        var matches = MatchesFor("54",
            Item("1001", l1: "54", l4: "54"),
            Item("1002", l6: "54", l2: "A1"));

        var rows = FilExportBuilder.BuildClearRows(matches, Match, File);

        Assert.Equal(3, rows.Count); // header + 2
        Assert.Equal(new[] { "SKU", "Location 1", "Location 2", "Location 3", "Location 4", "Location 5", "Location 6" }, rows[0]);
        Assert.Equal(new[] { "1001", "?", "", "", "?", "", "" }, rows[1]);
        Assert.Equal(new[] { "1002", "", "", "", "", "", "?" }, rows[2]);
    }

    [Fact]
    public void Location_3_cell_is_always_empty_in_clear_output()
    {
        var matches = MatchesFor("54", Item("2001", l1: "54", l2: "54", l3: "54", l4: "54", l5: "54", l6: "54"));
        var rows = FilExportBuilder.BuildClearRows(matches, Match, File);
        Assert.Equal(new[] { "2001", "?", "?", "", "?", "?", "?" }, rows[1]);
    }

    [Fact]
    public void Header_row_can_be_disabled()
    {
        var matches = MatchesFor("54", Item("3001", l1: "54"));
        var rows = FilExportBuilder.BuildClearRows(matches, Match, new FilFileOptions { IncludeHeader = false });
        Assert.Single(rows);
        Assert.Equal("3001", rows[0][0]);
    }

    [Fact]
    public void Store_column_is_included_when_configured()
    {
        var matches = MatchesFor("54", Item("4001", l1: "54", store: "2"));
        var rows = FilExportBuilder.BuildClearRows(matches, Match, new FilFileOptions { IncludeStoreColumn = true });
        Assert.Equal(new[] { "SKU", "Store", "Location 1", "Location 2", "Location 3", "Location 4", "Location 5", "Location 6" }, rows[0]);
        Assert.Equal(new[] { "4001", "2", "?", "", "", "", "", "" }, rows[1]);
    }

    [Fact]
    public void Tampered_match_touching_protected_field_refuses_to_generate()
    {
        var forged = new SkuMatch
        {
            Item = Item("6666", l3: "54"),
            MatchedFields = new[] { 3 },
            ProtectedFieldHits = Array.Empty<int>(),
        };
        var ex = Assert.Throws<InvalidOperationException>(() =>
            FilExportBuilder.BuildClearRows(new[] { forged }, Match, File));
        Assert.Contains("SAFETY STOP", ex.Message);
    }

    [Fact]
    public void Out_of_range_field_number_refuses_to_generate()
    {
        var forged = new SkuMatch
        {
            Item = Item("7777"),
            MatchedFields = new[] { 7 },
            ProtectedFieldHits = Array.Empty<int>(),
        };
        Assert.Throws<InvalidOperationException>(() =>
            FilExportBuilder.BuildClearRows(new[] { forged }, Match, File));
    }

    [Fact]
    public void Matches_with_no_clearable_fields_are_skipped()
    {
        var protectedOnly = new SkuMatch
        {
            Item = Item("8001", l3: "54"),
            MatchedFields = Array.Empty<int>(),
            ProtectedFieldHits = new[] { 3 },
        };
        var rows = FilExportBuilder.BuildClearRows(new[] { protectedOnly }, Match, File);
        Assert.Single(rows); // header only
    }

    [Fact]
    public void Csv_text_output_is_exact()
    {
        var matches = MatchesFor("54", Item("1001", l1: "54"));
        var text = FilExportBuilder.ToCsvText(FilExportBuilder.BuildClearRows(matches, Match, new FilFileOptions { IncludeHeader = false }));
        Assert.Equal("1001,?,,,,,\r\n", text);
    }

    [Fact]
    public void Sku_with_comma_or_quotes_is_escaped_safely()
    {
        var matches = new[]
        {
            new SkuMatch
            {
                Item = Item("AB,C\"1"),
                MatchedFields = new[] { 1 },
                ProtectedFieldHits = Array.Empty<int>(),
            },
        };
        var text = FilExportBuilder.ToCsvText(FilExportBuilder.BuildClearRows(matches, Match, new FilFileOptions { IncludeHeader = false }));
        var parsed = CsvFile.ParseText(text);
        Assert.Equal("AB,C\"1", parsed[0][0]);
        Assert.Equal("?", parsed[0][1]);
    }

    [Fact]
    public void ReAdd_rows_write_code_into_target_field_only()
    {
        var entries = new[]
        {
            new ReAddEntry { Item = Item("1001"), TargetField = 1, ExistingValue = "", ExistingValueIsSafe = true },
            new ReAddEntry { Item = Item("1002"), TargetField = 5, ExistingValue = "", ExistingValueIsSafe = true },
        };
        var rows = FilExportBuilder.BuildReAddRows(entries, "54", Match, File);
        Assert.Equal(new[] { "1001", "54", "", "", "", "", "" }, rows[1]);
        Assert.Equal(new[] { "1002", "", "", "", "54", "" , "" }.Length, rows[2].Length);
        Assert.Equal("54", rows[2][5]);
        Assert.All(new[] { 1, 2, 3, 4, 6 }, i => Assert.Equal("", rows[2][i]));
    }

    [Fact]
    public void ReAdd_to_protected_field_refuses_to_generate()
    {
        var entries = new[] { new ReAddEntry { Item = Item("1001"), TargetField = 3, ExistingValue = "", ExistingValueIsSafe = true } };
        Assert.Throws<InvalidOperationException>(() =>
            FilExportBuilder.BuildReAddRows(entries, "54", Match, File));
    }

    [Fact]
    public void ReAdd_with_invalid_code_is_rejected()
    {
        var entries = new[] { new ReAddEntry { Item = Item("1001"), TargetField = 1, ExistingValue = "", ExistingValueIsSafe = true } };
        Assert.Throws<ArgumentException>(() =>
            FilExportBuilder.BuildReAddRows(entries, "?", Match, File));
    }

    [Fact]
    public void Empty_sku_rows_refuse_to_generate_in_both_directions()
    {
        var clear = new SkuMatch { Item = Item("  "), MatchedFields = new[] { 1 }, ProtectedFieldHits = Array.Empty<int>() };
        Assert.Throws<InvalidOperationException>(() =>
            FilExportBuilder.BuildClearRows(new[] { clear }, Match, File));

        var readd = new ReAddEntry { Item = Item(""), TargetField = 1, ExistingValue = "", ExistingValueIsSafe = true };
        Assert.Throws<InvalidOperationException>(() =>
            FilExportBuilder.BuildReAddRows(new[] { readd }, "54", Match, File));
    }
}
