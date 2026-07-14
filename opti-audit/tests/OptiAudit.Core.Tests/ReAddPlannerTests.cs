using OptiAudit.Core;
using OptiAudit.Core.Model;
using static OptiAudit.Core.Tests.TestData;

namespace OptiAudit.Core.Tests;

public class ReAddPlannerTests
{
    private static readonly MatchOptions Options = new();
    private static readonly IReadOnlyDictionary<string, SkuMatch> NoCleared =
        new Dictionary<string, SkuMatch>();

    private static IReadOnlyDictionary<string, SkuMatch> Cleared(params SkuMatch[] matches)
        => matches.ToDictionary(m => m.Item.Sku, m => m, StringComparer.OrdinalIgnoreCase);

    [Fact]
    public void Auto_prefers_the_field_cleared_this_session()
    {
        var item = Item("1001", l1: "A9", l4: "54", l5: "54");
        var cleared = Cleared(new SkuMatch { Item = item, MatchedFields = new[] { 4, 5 }, ProtectedFieldHits = Array.Empty<int>() });

        var plan = ReAddPlanner.Plan(new[] { "1001" }, new[] { item }, cleared, "54", ReAddPlanner.AutoTargetField, Options);

        Assert.Single(plan.Ready);
        Assert.Equal(4, plan.Ready[0].TargetField);
        Assert.Empty(plan.Conflicts);
    }

    [Fact]
    public void Auto_uses_lowest_empty_searchable_field_for_new_items()
    {
        var item = Item("2001", l1: "B2", l2: "");
        var plan = ReAddPlanner.Plan(new[] { "2001" }, new[] { item }, NoCleared, "54", ReAddPlanner.AutoTargetField, Options);
        Assert.Equal(2, plan.Ready[0].TargetField);
    }

    [Fact]
    public void Auto_never_picks_location_3_even_when_it_is_the_only_empty_field()
    {
        var item = Item("3001", l1: "A", l2: "B", l3: "", l4: "C", l5: "D", l6: "E");
        var plan = ReAddPlanner.Plan(new[] { "3001" }, new[] { item }, NoCleared, "54", ReAddPlanner.AutoTargetField, Options);
        Assert.Empty(plan.Ready);
        Assert.Single(plan.Exceptions);
        Assert.Contains("No empty location field", plan.Exceptions[0].Reason);
    }

    [Fact]
    public void Auto_reuses_field_already_holding_the_code()
    {
        var item = Item("4001", l1: "A", l2: "54", l4: "B", l5: "C", l6: "D");
        var plan = ReAddPlanner.Plan(new[] { "4001" }, new[] { item }, NoCleared, "54", ReAddPlanner.AutoTargetField, Options);
        Assert.Single(plan.Ready);
        Assert.Equal(2, plan.Ready[0].TargetField);
        Assert.False(plan.Ready[0].OverwritesExistingValue);
    }

    [Fact]
    public void Auto_prefers_field_holding_the_code_over_an_empty_field_to_avoid_duplicates()
    {
        // Loc1 is empty AND Loc2 already holds the code: writing into Loc1 would
        // leave the OPTI listed twice, so the existing field must win.
        var item = Item("4002", l1: "", l2: "54");
        var plan = ReAddPlanner.Plan(new[] { "4002" }, new[] { item }, NoCleared, "54", ReAddPlanner.AutoTargetField, Options);
        Assert.Single(plan.Ready);
        Assert.Equal(2, plan.Ready[0].TargetField);
        Assert.False(plan.Ready[0].OverwritesExistingValue);
    }

    [Fact]
    public void Existing_values_are_reported_truthfully_even_when_safe()
    {
        var justCleared = Item("4100", l2: "54");
        var cleared = Cleared(new SkuMatch { Item = justCleared, MatchedFields = new[] { 2 }, ProtectedFieldHits = Array.Empty<int>() });
        var plan = ReAddPlanner.Plan(new[] { "4100" }, new[] { justCleared }, cleared, "54", ReAddPlanner.AutoTargetField, Options);

        Assert.Single(plan.Ready);
        Assert.Equal("54", plan.Ready[0].ExistingValue);       // real value, not masked
        Assert.True(plan.Ready[0].ExistingValueIsSafe);
        Assert.False(plan.Ready[0].OverwritesExistingValue);
    }

    [Fact]
    public void Unknown_sku_becomes_an_exception()
    {
        var plan = ReAddPlanner.Plan(new[] { "9999" }, new[] { Item("1001") }, NoCleared, "54", ReAddPlanner.AutoTargetField, Options);
        Assert.Empty(plan.Ready);
        Assert.Single(plan.Exceptions);
        Assert.Equal("9999", plan.Exceptions[0].ScannedSku);
    }

    [Fact]
    public void Duplicate_and_blank_scans_are_ignored()
    {
        var item = Item("5001");
        var plan = ReAddPlanner.Plan(new[] { "5001", " 5001", "", "  ", "5001" }, new[] { item }, NoCleared, "54", ReAddPlanner.AutoTargetField, Options);
        Assert.Single(plan.Ready);
    }

    [Fact]
    public void Explicit_field_with_other_value_is_a_conflict()
    {
        var item = Item("6001", l2: "ZZ");
        var plan = ReAddPlanner.Plan(new[] { "6001" }, new[] { item }, NoCleared, "54", 2, Options);
        Assert.Empty(plan.Ready);
        Assert.Single(plan.Conflicts);
        Assert.Equal("ZZ", plan.Conflicts[0].ExistingValue);
        Assert.True(plan.Conflicts[0].OverwritesExistingValue);
    }

    [Fact]
    public void Explicit_field_is_ready_when_empty_or_just_cleared_or_same_code()
    {
        var empty = Item("7001");
        var justCleared = Item("7002", l2: "54");
        var sameCode = Item("7003", l2: "54");
        var cleared = Cleared(new SkuMatch { Item = justCleared, MatchedFields = new[] { 2 }, ProtectedFieldHits = Array.Empty<int>() });

        var plan = ReAddPlanner.Plan(new[] { "7001", "7002", "7003" },
            new[] { empty, justCleared, sameCode }, cleared, "54", 2, Options);

        Assert.Equal(3, plan.Ready.Count);
        Assert.Empty(plan.Conflicts);
        Assert.All(plan.Ready, e => Assert.Equal(2, e.TargetField));
    }

    [Fact]
    public void Explicit_protected_field_is_rejected_outright()
    {
        Assert.Throws<ArgumentException>(() =>
            ReAddPlanner.Plan(new[] { "1" }, Array.Empty<ItemRecord>(), NoCleared, "54", 3, Options));
    }

    [Fact]
    public void Invalid_explicit_field_is_rejected()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            ReAddPlanner.Plan(new[] { "1" }, Array.Empty<ItemRecord>(), NoCleared, "54", 7, Options));
    }

    [Fact]
    public void Invalid_code_is_rejected()
    {
        Assert.Throws<ArgumentException>(() =>
            ReAddPlanner.Plan(new[] { "1" }, Array.Empty<ItemRecord>(), NoCleared, " ", ReAddPlanner.AutoTargetField, Options));
    }

    [Fact]
    public void Sku_lookup_ignores_case_and_whitespace()
    {
        var item = Item("AB123");
        var plan = ReAddPlanner.Plan(new[] { " ab123 " }, new[] { item }, NoCleared, "54", ReAddPlanner.AutoTargetField, Options);
        Assert.Single(plan.Ready);
        Assert.Equal("AB123", plan.Ready[0].Item.Sku);
    }
}
