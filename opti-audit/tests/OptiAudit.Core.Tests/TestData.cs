using OptiAudit.Core.Model;

namespace OptiAudit.Core.Tests;

internal static class TestData
{
    public static ItemRecord Item(string sku, string l1 = "", string l2 = "", string l3 = "",
        string l4 = "", string l5 = "", string l6 = "", string desc = "", string store = "", int row = 1)
        => new()
        {
            RowNumber = row,
            Sku = sku,
            Description = desc,
            Store = store,
            Locations = new[] { l1, l2, l3, l4, l5, l6 },
        };
}
