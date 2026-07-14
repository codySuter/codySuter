using System.Security.Cryptography;
using System.Text;
using OptiAudit.Core.Csv;
using OptiAudit.Core.Model;

namespace OptiAudit.Core;

/// <summary>
/// Human-readable audit trail written next to every generated FIL file, plus a
/// scan checklist CSV the auditor can take to the OPTI container.
/// </summary>
public static class AuditReport
{
    public static string Sha256OfFile(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream));
    }

    public static string BuildClearAudit(
        DateTime timestamp,
        string sourceFile,
        string sourceSha256,
        int exportRowCount,
        MatchReport report,
        IReadOnlyList<SkuMatch> selectedMatches,
        MatchOptions options,
        string outputFile)
    {
        var sb = new StringBuilder();
        sb.AppendLine("OptiAudit — FIL location clear audit log");
        sb.AppendLine(new string('=', 60));
        sb.AppendLine($"Generated:        {timestamp:yyyy-MM-dd HH:mm:ss}");
        sb.AppendLine($"Source export:    {sourceFile}");
        sb.AppendLine($"Source SHA-256:   {sourceSha256}");
        sb.AppendLine($"Export data rows: {exportRowCount}");
        sb.AppendLine($"OPTI code(s):     {string.Join(", ", report.SearchedCodes)}");
        sb.AppendLine($"Match rule:       whole-field exact match, trimmed, {(options.CaseInsensitive ? "case-insensitive" : "case-sensitive")}");
        sb.AppendLine($"Protected fields: Location {string.Join(", Location ", options.ProtectedFields.OrderBy(f => f))} (never searched, never cleared)");
        sb.AppendLine($"FIL output file:  {outputFile}");
        sb.AppendLine();
        sb.AppendLine($"SKUs matched: {report.Matches.Count}   selected for clear: {selectedMatches.Count}   fields to clear: {selectedMatches.Sum(m => m.MatchedFields.Count)}");
        sb.AppendLine();
        sb.AppendLine("SKU               Fields cleared      Locations before clear (1|2|3|4|5|6)");
        sb.AppendLine(new string('-', 100));
        foreach (var m in selectedMatches)
        {
            var fields = string.Join(",", m.MatchedFields.Select(f => "Loc" + f));
            var locs = string.Join("|", Enumerable.Range(1, ItemRecord.LocationFieldCount).Select(f => m.Item.LocationValue(f).Trim()));
            sb.AppendLine($"{m.Item.Sku,-18}{fields,-20}{locs}");
        }

        var skipped = report.Matches.Count - selectedMatches.Count;
        if (skipped > 0)
        {
            sb.AppendLine();
            sb.AppendLine($"NOTE: {skipped} matched SKU(s) were deselected by the operator and are NOT in the FIL file.");
        }

        if (report.ProtectedOnlyMatches.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("WARNING — code found in a PROTECTED field (not cleared, review manually):");
            foreach (var m in report.ProtectedOnlyMatches)
                sb.AppendLine($"  {m.Item.Sku}: Location {string.Join(", Location ", m.ProtectedFieldHits)}");
        }
        return sb.ToString();
    }

    public static string BuildReAddAudit(
        DateTime timestamp,
        string code,
        IReadOnlyList<ReAddEntry> written,
        IReadOnlyList<ReAddException> exceptions,
        string outputFile)
    {
        var sb = new StringBuilder();
        sb.AppendLine("OptiAudit — FIL location re-add audit log");
        sb.AppendLine(new string('=', 60));
        sb.AppendLine($"Generated:       {timestamp:yyyy-MM-dd HH:mm:ss}");
        sb.AppendLine($"OPTI code:       {code}");
        sb.AppendLine($"FIL output file: {outputFile}");
        sb.AppendLine();
        sb.AppendLine($"SKUs written: {written.Count}");
        sb.AppendLine();
        sb.AppendLine("SKU               Target field   Previous value");
        sb.AppendLine(new string('-', 60));
        foreach (var e in written)
            sb.AppendLine($"{e.Item.Sku,-18}Loc{e.TargetField,-12}{(e.ExistingValue.Length == 0 ? "(empty)" : e.ExistingValue)}");

        if (exceptions.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("NEEDS MANUAL ATTENTION (not in the FIL file):");
            foreach (var ex in exceptions)
                sb.AppendLine($"  {ex.ScannedSku}: {ex.Reason}");
        }
        return sb.ToString();
    }

    /// <summary>CSV checklist of everything expected in the container — print or open on a handheld while scanning.</summary>
    public static string BuildScanChecklistCsv(IReadOnlyList<SkuMatch> matches)
    {
        var rows = new List<IReadOnlyList<string>>
        {
            new[] { "SKU", "Description", "Matched fields", "Loc 1", "Loc 2", "Loc 3", "Loc 4", "Loc 5", "Loc 6" },
        };
        foreach (var m in matches)
        {
            var row = new List<string>
            {
                m.Item.Sku,
                m.Item.Description,
                string.Join(" ", m.MatchedFields.Select(f => "Loc" + f)),
            };
            for (int f = 1; f <= ItemRecord.LocationFieldCount; f++)
                row.Add(m.Item.LocationValue(f).Trim());
            rows.Add(row);
        }
        return CsvFile.Write(rows);
    }
}
