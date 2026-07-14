using OptiAudit.Core.Csv;
using OptiAudit.Core.Model;

namespace OptiAudit.Core;

public sealed class FilFileOptions
{
    public bool IncludeHeader { get; init; } = true;
    public bool IncludeStoreColumn { get; init; }
    public string SkuHeader { get; init; } = "SKU";
    public string StoreHeader { get; init; } = "Store";

    public string LocationHeader(int fieldNumber) => $"Location {fieldNumber}";
}

/// <summary>
/// Builds the CSV consumed by Eagle FIL (Flexible Inventory Load).
/// Convention: a cell containing "?" clears that field, an empty cell leaves
/// the field untouched.
/// </summary>
public static class FilExportBuilder
{
    public const string ClearMarker = "?";

    /// <summary>
    /// Builds rows that clear the matched location fields for each SKU.
    /// Throws if any match would touch a protected field — that must be
    /// impossible by construction, and we refuse to emit the file if it isn't.
    /// </summary>
    public static List<string[]> BuildClearRows(
        IEnumerable<SkuMatch> matches,
        MatchOptions matchOptions,
        FilFileOptions fileOptions)
    {
        ArgumentNullException.ThrowIfNull(matches);
        ArgumentNullException.ThrowIfNull(matchOptions);
        ArgumentNullException.ThrowIfNull(fileOptions);

        var rows = new List<string[]>();
        if (fileOptions.IncludeHeader)
            rows.Add(BuildHeader(fileOptions));

        foreach (var match in matches)
        {
            if (match.MatchedFields.Count == 0)
                continue;

            if (match.Item.Sku.Trim().Length == 0)
                throw new InvalidOperationException(
                    "SAFETY STOP: a row with an empty SKU cannot go into a FIL file. File not generated.");

            foreach (var field in match.MatchedFields)
            {
                if (matchOptions.ProtectedFields.Contains(field))
                    throw new InvalidOperationException(
                        $"SAFETY STOP: SKU {match.Item.Sku} would clear protected Location {field}. File not generated.");
                if (field < 1 || field > ItemRecord.LocationFieldCount)
                    throw new InvalidOperationException(
                        $"SAFETY STOP: SKU {match.Item.Sku} has invalid field number {field}. File not generated.");
            }

            var row = NewRow(fileOptions, match.Item);
            foreach (var field in match.MatchedFields)
                row[LocationCellIndex(fileOptions, field)] = ClearMarker;
            rows.Add(row);
        }
        return rows;
    }

    /// <summary>Builds rows that write <paramref name="code"/> into one target field per SKU.</summary>
    public static List<string[]> BuildReAddRows(
        IEnumerable<ReAddEntry> entries,
        string code,
        MatchOptions matchOptions,
        FilFileOptions fileOptions)
    {
        ArgumentNullException.ThrowIfNull(entries);
        ArgumentNullException.ThrowIfNull(matchOptions);
        ArgumentNullException.ThrowIfNull(fileOptions);
        var codeError = LocationMatcher.ValidateCode(code);
        if (codeError != null) throw new ArgumentException(codeError, nameof(code));
        code = code.Trim();

        var rows = new List<string[]>();
        if (fileOptions.IncludeHeader)
            rows.Add(BuildHeader(fileOptions));

        foreach (var entry in entries)
        {
            if (entry.Item.Sku.Trim().Length == 0)
                throw new InvalidOperationException(
                    "SAFETY STOP: a row with an empty SKU cannot go into a FIL file. File not generated.");
            if (matchOptions.ProtectedFields.Contains(entry.TargetField))
                throw new InvalidOperationException(
                    $"SAFETY STOP: SKU {entry.Item.Sku} targets protected Location {entry.TargetField}. File not generated.");
            if (entry.TargetField < 1 || entry.TargetField > ItemRecord.LocationFieldCount)
                throw new InvalidOperationException(
                    $"SAFETY STOP: SKU {entry.Item.Sku} has invalid field number {entry.TargetField}. File not generated.");

            var row = NewRow(fileOptions, entry.Item);
            row[LocationCellIndex(fileOptions, entry.TargetField)] = code;
            rows.Add(row);
        }
        return rows;
    }

    public static string ToCsvText(IEnumerable<string[]> rows) => CsvFile.Write(rows.Select(r => (IReadOnlyList<string>)r));

    private static string[] BuildHeader(FilFileOptions o)
    {
        var header = new List<string> { o.SkuHeader };
        if (o.IncludeStoreColumn) header.Add(o.StoreHeader);
        for (int f = 1; f <= ItemRecord.LocationFieldCount; f++)
            header.Add(o.LocationHeader(f));
        return header.ToArray();
    }

    private static string[] NewRow(FilFileOptions o, ItemRecord item)
    {
        int width = 1 + (o.IncludeStoreColumn ? 1 : 0) + ItemRecord.LocationFieldCount;
        var row = new string[width];
        Array.Fill(row, string.Empty);
        row[0] = item.Sku;
        if (o.IncludeStoreColumn) row[1] = item.Store;
        return row;
    }

    private static int LocationCellIndex(FilFileOptions o, int fieldNumber)
        => (o.IncludeStoreColumn ? 2 : 1) + (fieldNumber - 1);
}
