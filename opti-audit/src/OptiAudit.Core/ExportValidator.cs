using OptiAudit.Core.Model;

namespace OptiAudit.Core;

public sealed class ExportValidation
{
    public List<string> Errors { get; } = new();
    public List<string> Warnings { get; } = new();
    public bool IsUsable => Errors.Count == 0;
}

public static class ExportValidator
{
    /// <summary>
    /// Checks that a parsed export + mapping is safe to search against.
    /// Errors block the workflow; warnings are shown to the user.
    /// </summary>
    public static ExportValidation Validate(
        IReadOnlyList<string[]> dataRows,
        ColumnMapping mapping,
        MatchOptions options)
    {
        ArgumentNullException.ThrowIfNull(dataRows);
        ArgumentNullException.ThrowIfNull(mapping);
        ArgumentNullException.ThrowIfNull(options);

        var v = new ExportValidation();

        if (mapping.SkuColumn < 0)
            v.Errors.Add("No SKU / Item column is mapped. Map it before continuing.");

        // Every searchable location field must be present — if Location 5 is
        // missing from the export we cannot know whether a SKU has the OPTI
        // there, and a partial audit silently leaves stale locations behind.
        foreach (var field in options.SearchableFields())
        {
            if (mapping.LocationColumns[field - 1] < 0)
                v.Errors.Add(
                    $"Location {field} column is not mapped. The export must include ALL searchable location fields " +
                    "(1, 2, 4, 5, 6) or the audit would miss locations.");
        }

        foreach (var field in options.ProtectedFields)
        {
            if (field >= 1 && field <= ItemRecord.LocationFieldCount && mapping.LocationColumns[field - 1] < 0)
                v.Warnings.Add(
                    $"Location {field} (protected) column is not in the export. That is OK — it is never touched.");
        }

        var duplicateColumns = mapping.MappedColumns()
            .GroupBy(c => c)
            .Where(g => g.Count() > 1)
            .Select(g => g.Key)
            .ToList();
        if (duplicateColumns.Count > 0)
            v.Errors.Add(
                $"The same export column is mapped to more than one field (column index {string.Join(", ", duplicateColumns)}).");

        if (dataRows.Count == 0)
            v.Errors.Add("The export contains no data rows.");

        if (!v.IsUsable)
            return v;

        int emptySkus = 0;
        int shortRows = 0;
        int maxMapped = mapping.MappedColumns().Max();
        var skuCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in dataRows)
        {
            var sku = (mapping.SkuColumn < row.Length ? row[mapping.SkuColumn] : string.Empty).Trim();
            if (sku.Length == 0) emptySkus++;
            else skuCounts[sku] = skuCounts.GetValueOrDefault(sku) + 1;
            if (row.Length <= maxMapped) shortRows++;
        }

        if (emptySkus > 0)
            v.Warnings.Add($"{emptySkus} row(s) have an empty SKU and will be ignored.");
        if (shortRows > 0)
            v.Warnings.Add(
                $"{shortRows} row(s) have fewer columns than expected; missing cells are treated as empty. " +
                "Re-export from Compass if this looks wrong.");

        var duplicates = skuCounts.Where(kv => kv.Value > 1).Select(kv => kv.Key).ToList();
        if (duplicates.Count > 0)
        {
            var sample = string.Join(", ", duplicates.Take(5));
            v.Warnings.Add(
                $"{duplicates.Count} SKU(s) appear more than once (e.g. {sample}). " +
                "If your export covers multiple stores, re-export for a single store — FIL updates are per store, " +
                "and duplicate rows each produce an output row.");
        }

        return v;
    }
}
