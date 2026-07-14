using OptiAudit.Core;

namespace OptiAudit.Core.Tests;

public class ColumnMapperTests
{
    [Fact]
    public void Detects_typical_compass_headers()
    {
        var mapping = ColumnMapper.AutoDetect(new[]
        {
            "Item", "Description", "Store", "Location Code 1", "Location Code 2",
            "Location Code 3", "Location Code 4", "Location Code 5", "Location Code 6",
        });
        Assert.Equal(0, mapping.SkuColumn);
        Assert.Equal(1, mapping.DescriptionColumn);
        Assert.Equal(2, mapping.StoreColumn);
        Assert.Equal(new[] { 3, 4, 5, 6, 7, 8 }, mapping.LocationColumns);
    }

    [Fact]
    public void Detects_terse_headers_case_insensitively()
    {
        var mapping = ColumnMapper.AutoDetect(new[] { "SKU", "LOC1", "loc 2", "Loc3", "LOC4", "loc5", "LOC 6" });
        Assert.Equal(0, mapping.SkuColumn);
        Assert.Equal(new[] { 1, 2, 3, 4, 5, 6 }, mapping.LocationColumns);
    }

    [Fact]
    public void Unnumbered_location_header_maps_to_location_1()
    {
        var mapping = ColumnMapper.AutoDetect(new[] { "SKU", "Location", "Loc 2" });
        Assert.Equal(1, mapping.LocationColumns[0]);
        Assert.Equal(2, mapping.LocationColumns[1]);
    }

    [Fact]
    public void Unknown_headers_stay_unmapped()
    {
        var mapping = ColumnMapper.AutoDetect(new[] { "Foo", "Bar" });
        Assert.Equal(-1, mapping.SkuColumn);
        Assert.All(mapping.LocationColumns, c => Assert.Equal(-1, c));
    }

    [Fact]
    public void BuildItems_trims_sku_and_fills_missing_cells_with_empty()
    {
        var mapping = ColumnMapper.AutoDetect(new[] { "SKU", "Loc 1", "Loc 2", "Loc 3", "Loc 4", "Loc 5", "Loc 6" });
        var items = ColumnMapper.BuildItems(new[]
        {
            new[] { " 1001 ", "54", "", "CAP12", "54" }, // short row: loc5, loc6 missing
        }, mapping);

        Assert.Equal("1001", items[0].Sku);
        Assert.Equal("54", items[0].LocationValue(1));
        Assert.Equal("CAP12", items[0].LocationValue(3));
        Assert.Equal("54", items[0].LocationValue(4));
        Assert.Equal("", items[0].LocationValue(5));
        Assert.Equal("", items[0].LocationValue(6));
        Assert.Equal(1, items[0].RowNumber);
    }

    [Fact]
    public void BuildItems_requires_sku_mapping()
    {
        Assert.Throws<InvalidOperationException>(() =>
            ColumnMapper.BuildItems(new[] { new[] { "x" } }, new ColumnMapping()));
    }

    [Fact]
    public void Location_values_are_not_trimmed_at_build_time()
    {
        // Trimming happens at comparison time; raw values are preserved for display/audit.
        var mapping = new ColumnMapping { SkuColumn = 0 };
        mapping.LocationColumns[0] = 1;
        var items = ColumnMapper.BuildItems(new[] { new[] { "1", " 54 " } }, mapping);
        Assert.Equal(" 54 ", items[0].LocationValue(1));
    }
}
