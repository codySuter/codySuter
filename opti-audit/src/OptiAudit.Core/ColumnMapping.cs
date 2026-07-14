using OptiAudit.Core.Model;

namespace OptiAudit.Core;

/// <summary>Maps columns in a Compass export to the fields OptiAudit needs.</summary>
public sealed class ColumnMapping
{
    public int SkuColumn { get; set; } = -1;
    public int DescriptionColumn { get; set; } = -1;
    public int StoreColumn { get; set; } = -1;

    /// <summary>Index 0 = Location 1 … index 5 = Location 6. -1 = not present.</summary>
    public int[] LocationColumns { get; } = { -1, -1, -1, -1, -1, -1 };

    public IEnumerable<int> MappedColumns()
    {
        if (SkuColumn >= 0) yield return SkuColumn;
        if (DescriptionColumn >= 0) yield return DescriptionColumn;
        if (StoreColumn >= 0) yield return StoreColumn;
        foreach (var c in LocationColumns)
            if (c >= 0) yield return c;
    }
}

public static class ColumnMapper
{
    /// <summary>
    /// Guesses the column mapping from header names. Matching is done on a
    /// normalized form (lowercase, alphanumerics only) so "Location Code 1",
    /// "LOC1" and "loc 1" all resolve to Location 1.
    /// </summary>
    public static ColumnMapping AutoDetect(IReadOnlyList<string> headers)
    {
        ArgumentNullException.ThrowIfNull(headers);
        var mapping = new ColumnMapping();
        var normalized = headers.Select(Normalize).ToArray();

        string[] skuNames = { "sku", "skuno", "skunumber", "item", "itemno", "itemnumber", "itemcode" };
        string[] descNames = { "description", "desc", "itemdescription", "shortdescription", "desc1", "description1" };
        string[] storeNames = { "store", "str", "storeno", "storenumber", "storecode" };

        mapping.SkuColumn = FindFirst(normalized, skuNames);
        mapping.DescriptionColumn = FindFirst(normalized, descNames);
        mapping.StoreColumn = FindFirst(normalized, storeNames);

        for (int field = 1; field <= ItemRecord.LocationFieldCount; field++)
        {
            string n = field.ToString();
            string[] locNames =
            {
                "loc" + n, "location" + n, "locationcode" + n,
                "loccode" + n, "locationcd" + n,
            };
            mapping.LocationColumns[field - 1] = FindFirst(normalized, locNames);
        }

        // Some exports label the first location plainly ("Location" / "Loc" /
        // "Location Code") with no number.
        if (mapping.LocationColumns[0] < 0)
        {
            mapping.LocationColumns[0] = FindFirst(normalized, new[] { "loc", "location", "locationcode", "loccode" });
        }

        return mapping;
    }

    public static string Normalize(string? header)
    {
        if (string.IsNullOrEmpty(header)) return string.Empty;
        return new string(header.Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();
    }

    private static int FindFirst(string[] normalizedHeaders, string[] candidates)
    {
        foreach (var candidate in candidates)
        {
            if (candidate.Length == 0) continue;
            for (int i = 0; i < normalizedHeaders.Length; i++)
                if (normalizedHeaders[i] == candidate)
                    return i;
        }
        return -1;
    }

    /// <summary>Materializes item records from parsed CSV rows using a mapping.</summary>
    public static List<ItemRecord> BuildItems(IReadOnlyList<string[]> dataRows, ColumnMapping mapping)
    {
        ArgumentNullException.ThrowIfNull(dataRows);
        ArgumentNullException.ThrowIfNull(mapping);
        if (mapping.SkuColumn < 0)
            throw new InvalidOperationException("SKU column is not mapped.");

        var items = new List<ItemRecord>(dataRows.Count);
        for (int r = 0; r < dataRows.Count; r++)
        {
            var row = dataRows[r];
            var locations = new string[ItemRecord.LocationFieldCount];
            for (int f = 0; f < ItemRecord.LocationFieldCount; f++)
                locations[f] = Cell(row, mapping.LocationColumns[f]);

            items.Add(new ItemRecord
            {
                RowNumber = r + 1,
                Sku = Cell(row, mapping.SkuColumn).Trim(),
                Description = Cell(row, mapping.DescriptionColumn).Trim(),
                Store = Cell(row, mapping.StoreColumn).Trim(),
                Locations = locations,
            });
        }
        return items;
    }

    private static string Cell(string[] row, int column)
    {
        if (column < 0 || column >= row.Length) return string.Empty;
        return row[column] ?? string.Empty;
    }
}
