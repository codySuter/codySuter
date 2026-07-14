using OptiAudit.Core;
using static OptiAudit.Core.Tests.TestData;

namespace OptiAudit.Core.Tests;

public class LocationMatcherTests
{
    private static readonly MatchOptions Default = new();

    [Fact]
    public void Finds_code_in_searchable_fields_only()
    {
        var items = new[]
        {
            Item("1001", l1: "54"),
            Item("1002", l2: "54", l5: "54"),
            Item("1003", l4: "54"),
            Item("1004", l6: "54"),
            Item("1005", l1: "A9"),
        };
        var report = LocationMatcher.FindMatches(items, new[] { "54" }, Default);

        Assert.Equal(4, report.Matches.Count);
        Assert.Equal(new[] { 1 }, report.Matches[0].MatchedFields);
        Assert.Equal(new[] { 2, 5 }, report.Matches[1].MatchedFields);
        Assert.Equal(new[] { 4 }, report.Matches[2].MatchedFields);
        Assert.Equal(new[] { 6 }, report.Matches[3].MatchedFields);
        Assert.Equal(5, report.TotalFieldsToClear);
    }

    [Fact]
    public void Never_matches_substrings_or_supersets()
    {
        var items = new[]
        {
            Item("2001", l1: "540"),
            Item("2002", l1: "154"),
            Item("2003", l1: "54A"),
            Item("2004", l1: "A54"),
            Item("2005", l1: "5 4"),
            Item("2006", l1: "54.0"),
            Item("2007", l1: "54"),
        };
        var report = LocationMatcher.FindMatches(items, new[] { "54" }, Default);
        Assert.Single(report.Matches);
        Assert.Equal("2007", report.Matches[0].Item.Sku);
    }

    [Fact]
    public void Location_3_is_never_clearable_even_when_it_matches()
    {
        var items = new[]
        {
            Item("3001", l3: "54"),               // only protected hit
            Item("3002", l1: "54", l3: "54"),      // both
        };
        var report = LocationMatcher.FindMatches(items, new[] { "54" }, Default);

        Assert.Single(report.Matches);
        Assert.Equal("3002", report.Matches[0].Item.Sku);
        Assert.Equal(new[] { 1 }, report.Matches[0].MatchedFields);
        Assert.Equal(new[] { 3 }, report.Matches[0].ProtectedFieldHits);

        Assert.Single(report.ProtectedOnlyMatches);
        Assert.Equal("3001", report.ProtectedOnlyMatches[0].Item.Sku);
        Assert.Empty(report.ProtectedOnlyMatches[0].MatchedFields);
    }

    [Fact]
    public void Values_are_trimmed_before_comparison()
    {
        var items = new[] { Item("4001", l1: "  54  "), Item("4002", l2: "\t54") };
        var report = LocationMatcher.FindMatches(items, new[] { " 54 " }, Default);
        Assert.Equal(2, report.Matches.Count);
    }

    [Fact]
    public void Case_insensitive_by_default_case_sensitive_when_configured()
    {
        var items = new[] { Item("5001", l1: "opti54") };

        var insensitive = LocationMatcher.FindMatches(items, new[] { "OPTI54" }, Default);
        Assert.Single(insensitive.Matches);

        var sensitive = LocationMatcher.FindMatches(items, new[] { "OPTI54" }, new MatchOptions { CaseInsensitive = false });
        Assert.Empty(sensitive.Matches);
    }

    [Fact]
    public void Multiple_codes_are_all_searched_and_deduplicated()
    {
        var items = new[] { Item("6001", l1: "54"), Item("6002", l2: "054") };
        var report = LocationMatcher.FindMatches(items, new[] { "54", "054", " 54" }, Default);
        Assert.Equal(2, report.Matches.Count);
        Assert.Equal(new[] { "54", "054" }, report.SearchedCodes);
    }

    [Fact]
    public void Empty_location_values_never_match()
    {
        var items = new[] { Item("7001"), Item("7002", l1: "   ") };
        var report = LocationMatcher.FindMatches(items, new[] { "54" }, Default);
        Assert.Empty(report.Matches);
        Assert.Empty(report.ProtectedOnlyMatches);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("?")]
    [InlineData("5?4")]
    [InlineData("54*")]
    [InlineData("--")]
    public void Invalid_codes_are_rejected(string code)
    {
        Assert.NotNull(LocationMatcher.ValidateCode(code));
        Assert.Throws<ArgumentException>(() =>
            LocationMatcher.FindMatches(new[] { Item("1") }, new[] { code }, Default));
    }

    [Fact]
    public void No_codes_at_all_is_rejected()
    {
        Assert.Throws<ArgumentException>(() =>
            LocationMatcher.FindMatches(new[] { Item("1") }, Array.Empty<string>(), Default));
    }

    [Fact]
    public void Custom_protected_fields_are_honored()
    {
        var options = new MatchOptions { ProtectedFields = new HashSet<int> { 2, 3 } };
        var items = new[] { Item("8001", l1: "54", l2: "54", l3: "54") };
        var report = LocationMatcher.FindMatches(items, new[] { "54" }, options);
        Assert.Equal(new[] { 1 }, report.Matches[0].MatchedFields);
        Assert.Equal(new[] { 2, 3 }, report.Matches[0].ProtectedFieldHits);
    }

    [Fact]
    public void Searchable_fields_default_is_1_2_4_5_6()
    {
        Assert.Equal(new[] { 1, 2, 4, 5, 6 }, Default.SearchableFields().ToArray());
    }

    [Fact]
    public void Rows_with_empty_skus_are_never_matched()
    {
        var items = new[] { Item("", l1: "54"), Item("   ", l1: "54"), Item("9001", l1: "54") };
        var report = LocationMatcher.FindMatches(items, new[] { "54" }, Default);
        Assert.Single(report.Matches);
        Assert.Equal("9001", report.Matches[0].Item.Sku);
    }
}
