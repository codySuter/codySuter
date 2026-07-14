using OptiAudit.Core.Model;

namespace OptiAudit.Core;

/// <summary>A scanned SKU with a resolved target location field for re-adding the OPTI code.</summary>
public sealed class ReAddEntry
{
    public required ItemRecord Item { get; init; }

    /// <summary>Location field (1–6, never protected) that will receive the code.</summary>
    public required int TargetField { get; init; }

    /// <summary>Actual current value of the target field in the loaded export ("" if empty). Never masked — audits must be truthful.</summary>
    public required string ExistingValue { get; init; }

    /// <summary>
    /// True when writing the code here loses nothing: the field is empty in the
    /// export, was cleared by this session's clear file, or already holds the code.
    /// </summary>
    public required bool ExistingValueIsSafe { get; init; }

    /// <summary>True when the target field holds a value that would actually be destroyed.</summary>
    public bool OverwritesExistingValue =>
        ExistingValue.Length > 0 && !ExistingValueIsSafe;
}

public sealed class ReAddException
{
    public required string ScannedSku { get; init; }
    public required string Reason { get; init; }
}

public sealed class ReAddPlan
{
    /// <summary>Entries that can be written safely (target field empty, or field this session just cleared).</summary>
    public required IReadOnlyList<ReAddEntry> Ready { get; init; }

    /// <summary>Entries whose target field currently holds a different value — need explicit user confirmation.</summary>
    public required IReadOnlyList<ReAddEntry> Conflicts { get; init; }

    /// <summary>SKUs that cannot be planned automatically and must be handled manually in Eagle.</summary>
    public required IReadOnlyList<ReAddException> Exceptions { get; init; }
}

/// <summary>
/// Plans the "re-add" half of the audit: after the OPTI container has been
/// cleared and physically rescanned, put the OPTI code back on the SKUs that
/// are actually in it.
/// </summary>
public static class ReAddPlanner
{
    public const int AutoTargetField = 0;

    /// <summary>
    /// <paramref name="explicitField"/>: pass <see cref="AutoTargetField"/> to pick per-SKU
    /// (prefer the field this session's clear step just emptied, else the lowest empty
    /// non-protected field), or a specific non-protected field number 1–6.
    /// <paramref name="clearedThisSession"/>: matches from the clear step, keyed by trimmed SKU; may be empty.
    /// </summary>
    public static ReAddPlan Plan(
        IEnumerable<string> scannedSkus,
        IReadOnlyList<ItemRecord> exportItems,
        IReadOnlyDictionary<string, SkuMatch> clearedThisSession,
        string code,
        int explicitField,
        MatchOptions options)
    {
        ArgumentNullException.ThrowIfNull(scannedSkus);
        ArgumentNullException.ThrowIfNull(exportItems);
        ArgumentNullException.ThrowIfNull(clearedThisSession);
        ArgumentNullException.ThrowIfNull(options);
        var codeError = LocationMatcher.ValidateCode(code);
        if (codeError != null) throw new ArgumentException(codeError, nameof(code));
        code = code.Trim();

        if (explicitField != AutoTargetField)
        {
            if (explicitField < 1 || explicitField > ItemRecord.LocationFieldCount)
                throw new ArgumentOutOfRangeException(nameof(explicitField));
            if (options.ProtectedFields.Contains(explicitField))
                throw new ArgumentException(
                    $"Location {explicitField} is protected and cannot be a re-add target.", nameof(explicitField));
        }

        var bySku = new Dictionary<string, ItemRecord>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in exportItems)
        {
            if (item.Sku.Length == 0) continue;
            bySku.TryAdd(item.Sku, item); // duplicates already surfaced by the validator; first row wins
        }

        var ready = new List<ReAddEntry>();
        var conflicts = new List<ReAddEntry>();
        var exceptions = new List<ReAddException>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var raw in scannedSkus)
        {
            var sku = (raw ?? string.Empty).Trim();
            if (sku.Length == 0) continue;
            if (!seen.Add(sku)) continue; // scanning the same item twice is normal; plan it once

            if (!bySku.TryGetValue(sku, out var item))
            {
                exceptions.Add(new ReAddException
                {
                    ScannedSku = sku,
                    Reason = "SKU not found in the loaded export — verify the scan and add the location manually in Eagle.",
                });
                continue;
            }

            clearedThisSession.TryGetValue(sku, out var cleared);

            int target;
            if (explicitField != AutoTargetField)
            {
                target = explicitField;
            }
            else
            {
                target = PickAutoField(item, cleared, code, options);
                if (target == 0)
                {
                    exceptions.Add(new ReAddException
                    {
                        ScannedSku = sku,
                        Reason = "No empty location field available (1, 2, 4, 5, 6 are all in use) — assign manually in Eagle.",
                    });
                    continue;
                }
            }

            var existing = item.LocationValue(target).Trim();
            bool fieldWasJustCleared = cleared != null && cleared.MatchedFields.Contains(target);
            bool alreadyHoldsCode = existing.Length > 0 && options.Comparer.Equals(existing, code);
            bool safe = existing.Length == 0 || fieldWasJustCleared || alreadyHoldsCode;

            var entry = new ReAddEntry
            {
                Item = item,
                TargetField = target,
                ExistingValue = existing,
                ExistingValueIsSafe = safe,
            };

            if (safe)
                ready.Add(entry);
            else
                conflicts.Add(entry);
        }

        return new ReAddPlan { Ready = ready, Conflicts = conflicts, Exceptions = exceptions };
    }

    /// <summary>
    /// Auto target: the lowest field this session's clear step emptied for the SKU,
    /// else a field that already holds the code (no-op rewrite — never create a
    /// duplicate OPTI entry), else the lowest non-protected empty field, else 0.
    /// </summary>
    private static int PickAutoField(ItemRecord item, SkuMatch? cleared, string code, MatchOptions options)
    {
        if (cleared != null && cleared.MatchedFields.Count > 0)
            return cleared.MatchedFields.Min();

        foreach (var field in options.SearchableFields())
            if (options.Comparer.Equals(item.LocationValue(field).Trim(), code))
                return field;

        foreach (var field in options.SearchableFields())
            if (item.LocationValue(field).Trim().Length == 0)
                return field;

        return 0;
    }
}
