using OptiAudit.Core;
using OptiAudit.Core.Csv;

namespace OptiAudit.Core.Tests;

/// <summary>Full workflow: Compass CSV text → mapping → validation → match → FIL clear file → re-add file.</summary>
public class EndToEndTests
{
    private const string CompassExport =
        "Item,Description,Location Code 1,Location Code 2,Location Code 3,Location Code 4,Location Code 5,Location Code 6\r\n" +
        "100200,\"HAMMER, CLAW 16OZ\",54,,24,,,\r\n" +          // OPTI in Loc1
        "100201,SCREWDRIVER SET,A12,54,12,,54,\r\n" +           // OPTI in Loc2 + Loc5
        "100202,TAPE MEASURE,540,,,,,\r\n" +                    // 540 must NOT match
        "100203,WD-40 12OZ,,,54,,,\r\n" +                       // OPTI only in protected Loc3
        "100204,\"BOLT, HEX 1/2\"\"\",,,,54,,\r\n" +            // OPTI in Loc4, quoted desc with quote
        "100205,PAINT BRUSH 2IN,B7,,36,,,\r\n" +                // no match
        "100206,ZIP TIES 100PK,,,,,,54\r\n";                     // OPTI in Loc6

    [Fact]
    public void Clear_workflow_produces_exact_fil_file()
    {
        var records = CsvFile.ParseText(CompassExport);
        var headers = records[0];
        var dataRows = records.Skip(1).ToList();

        var mapping = ColumnMapper.AutoDetect(headers);
        var options = new MatchOptions();
        var validation = ExportValidator.Validate(dataRows, mapping, options);
        Assert.True(validation.IsUsable, string.Join("; ", validation.Errors));

        var items = ColumnMapper.BuildItems(dataRows, mapping);
        var report = LocationMatcher.FindMatches(items, new[] { "54" }, options);

        Assert.Equal(new[] { "100200", "100201", "100204", "100206" },
            report.Matches.Select(m => m.Item.Sku).ToArray());
        Assert.Equal(new[] { "100203" },
            report.ProtectedOnlyMatches.Select(m => m.Item.Sku).ToArray());

        var rows = FilExportBuilder.BuildClearRows(report.Matches, options, new FilFileOptions());
        var text = FilExportBuilder.ToCsvText(rows);

        Assert.Equal(
            "SKU,Location 1,Location 2,Location 3,Location 4,Location 5,Location 6\r\n" +
            "100200,?,,,,,\r\n" +
            "100201,,?,,,?,\r\n" +
            "100204,,,,?,,\r\n" +
            "100206,,,,,,?\r\n",
            text);
    }

    [Fact]
    public void ReAdd_workflow_after_rescan_produces_exact_fil_file()
    {
        var records = CsvFile.ParseText(CompassExport);
        var mapping = ColumnMapper.AutoDetect(records[0]);
        var items = ColumnMapper.BuildItems(records.Skip(1).ToList(), mapping);
        var options = new MatchOptions();
        var report = LocationMatcher.FindMatches(items, new[] { "54" }, options);
        var clearedBySku = report.Matches.ToDictionary(m => m.Item.Sku, m => m, StringComparer.OrdinalIgnoreCase);

        // Rescan finds: 100200 (still there), 100205 (newly stored), 100201 NOT found (was moved out).
        var plan = ReAddPlanner.Plan(
            new[] { "100200", "100205" }, items, clearedBySku, "54", ReAddPlanner.AutoTargetField, options);

        Assert.Equal(2, plan.Ready.Count);
        Assert.Empty(plan.Conflicts);
        Assert.Empty(plan.Exceptions);

        var text = FilExportBuilder.ToCsvText(
            FilExportBuilder.BuildReAddRows(plan.Ready, "54", options, new FilFileOptions()));

        Assert.Equal(
            "SKU,Location 1,Location 2,Location 3,Location 4,Location 5,Location 6\r\n" +
            "100200,54,,,,,\r\n" +      // back into Loc1 (the field that was cleared)
            "100205,,54,,,,\r\n",       // Loc1 holds B7, Loc2 is the lowest empty searchable field
            text);
    }

    [Fact]
    public void Audit_report_contains_the_critical_facts()
    {
        var records = CsvFile.ParseText(CompassExport);
        var mapping = ColumnMapper.AutoDetect(records[0]);
        var items = ColumnMapper.BuildItems(records.Skip(1).ToList(), mapping);
        var options = new MatchOptions();
        var report = LocationMatcher.FindMatches(items, new[] { "54" }, options);

        var audit = AuditReport.BuildClearAudit(
            new DateTime(2026, 7, 14, 9, 30, 0), "C:\\exports\\inv.csv", "ABC123",
            items.Count, report, report.Matches, options, "C:\\out\\FIL_OPTI_54.csv");

        Assert.Contains("OPTI code(s):     54", audit);
        Assert.Contains("Protected fields: Location 3", audit);
        Assert.Contains("never searched, never cleared", audit);
        Assert.Contains("100200", audit);
        Assert.Contains("WARNING", audit);   // protected-only hit for 100203
        Assert.Contains("100203", audit);

        var checklist = AuditReport.BuildScanChecklistCsv(report.Matches);
        Assert.Contains("100206", checklist);
        Assert.Contains("HAMMER", checklist);
    }
}
